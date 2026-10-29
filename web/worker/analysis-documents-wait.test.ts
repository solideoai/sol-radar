import { DelayedError } from "bullmq";
import { describe, expect, it } from "vitest";
import { ANALYSIS_JOB } from "@/server/analysis";
import type { ProcessingRevision } from "@/server/documents";
import {
  DOCUMENTS_RECHECK_MS,
  DOCUMENTS_WAIT_TIMEOUT,
  type DocumentsWaitPort,
} from "@/worker/analysis-documents-wait";
import { createAnalysisProcessor } from "@/worker/analysis-job";
import {
  IDEMPOTENCY_KEY,
  ORG_ID,
  QUEUED_AT,
  SCORE_RUN_ID,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  fakeLoader,
  fakeSink,
  fakeTracker,
  healthyRoutes,
  jsonReply,
  loadExtraction,
  loaded,
  type EventLog,
} from "@/worker/analysis-job.test-support";

// ADR-056 대안 A: live 분석은 run 을 잡기 전에 처리 범위 안 첨부를 최대 300초 기다린다.

const LOADED = loaded("FX-01");
const at = (secondsAfterQueued: number) =>
  new Date(Date.parse(QUEUED_AT) + secondsAfterQueued * 1000);

type Document = ProcessingRevision["documents"][number];
const pendingPdf = (id: string, name = `${id} 제안요청서.pdf`): Document => ({
  id,
  name,
  downloadStatus: "PENDING",
  parseStatus: null,
});
const parsedPdf = (id: string): Document => ({
  id,
  name: `${id} 제안요청서.pdf`,
  downloadStatus: "OK",
  parseStatus: "PARSED",
});

function revisionWith(
  documents: Document[],
  notice: Partial<ProcessingRevision["notice"]> = {},
): ProcessingRevision {
  return {
    bidId: LOADED.bidId,
    revisionId: LOADED.bid.revisionId,
    revision: 1,
    createdAt: QUEUED_AT,
    notice: {
      isDemo: false,
      status: "OPEN",
      deadlineAt: at(86_400).toISOString(),
      latestRevision: 1,
      ...notice,
    },
    documents,
  };
}

function setup(options: {
  runMode: "live" | "mock";
  revision: ProcessingRevision;
  now: Date;
  /** 캐시 추출이 없으면 /extract 를 부르고, 추출 원문을 읽는 context 를 남긴다 */
  withoutCachedExtraction?: boolean;
}) {
  const events: EventLog = [];
  const lines: string[] = [];
  const revisionLoads: { bidId: string; revisionId: string }[] = [];
  const documents: DocumentsWaitPort = {
    repo: {
      loadRevision: async (input) => {
        revisionLoads.push(input);
        return options.revision;
      },
    },
    maxPerBid: 3,
  };
  const tracker = fakeTracker(events);
  const sink = fakeSink(events);
  const extraction = fakeExtractionStore(events);
  const target = options.withoutCachedExtraction ? { ...LOADED, extraction: null } : LOADED;
  const routes = {
    ...healthyRoutes("FX-01", { runMode: options.runMode, kevEnabled: false }),
    "/extract": jsonReply(extractBody(loadExtraction("FX-01"))),
  };
  const processor = createAnalysisProcessor({
    gateway: fakeGateway(routes).gateway,
    loader: fakeLoader(events, () => target).loader,
    tracker: tracker.tracker,
    extraction: extraction.store,
    sink: sink.sink,
    documents,
    now: () => options.now,
    env: { runMode: options.runMode, given: true },
    log: (line) => {
      lines.push(line);
    },
  });
  const delayedTo: number[] = [];
  const job = {
    id: "analysis-job",
    name: ANALYSIS_JOB,
    data: { orgId: ORG_ID, scoreRunId: SCORE_RUN_ID, idempotencyKey: IDEMPOTENCY_KEY },
    attemptsMade: 0,
    opts: { attempts: 3 },
    moveToDelayed: async (timestamp: number) => {
      delayedTo.push(timestamp);
    },
  };
  return {
    run: () => processor(job, "lock-token"),
    delayedTo,
    revisionLoads,
    running: tracker.running,
    saved: sink.attempts,
    extractionSources: extraction.sources,
    lines,
  };
}

describe("분석의 첨부 처리 대기 (ADR-056 대안 A)", () => {
  it("처리 범위 안 첨부가 남았으면 run 을 잡지 않고 지연 재확인으로 넘긴다", async () => {
    const now = at(10);
    const test = setup({
      runMode: "live",
      revision: revisionWith([parsedPdf("doc-a"), pendingPdf("doc-b")]),
      now,
    });

    await expect(test.run()).rejects.toBeInstanceOf(DelayedError);
    expect(test.delayedTo).toEqual([now.getTime() + DOCUMENTS_RECHECK_MS]);
    expect(test.running).toEqual([]);
    expect(test.saved).toEqual([]);
    expect(test.lines.some((line) => line.includes('"event":"analysis.failed"'))).toBe(false);
  });

  it("300초가 지나면 남은 첨부를 사유와 함께 붙여 부분 입력으로 분석한다", async () => {
    const test = setup({
      runMode: "live",
      revision: revisionWith([parsedPdf("doc-a"), pendingPdf("doc-b")]),
      now: at(301),
      withoutCachedExtraction: true,
    });

    const summary = await test.run();

    expect(summary.outcome).toBe("ANALYZED");
    expect(test.delayedTo).toEqual([]);
    expect(test.running).toHaveLength(1);
    expect(test.extractionSources[0]?.documentIssues).toEqual([
      {
        documentId: "doc-b",
        downloadStatus: "PENDING",
        parseStatus: "NOT_PARSED",
        errorCode: DOCUMENTS_WAIT_TIMEOUT,
      },
    ]);
    expect(test.saved[0]?.input.bid.attachmentsIncomplete).toBe(true);
    const completed = test.lines.find((line) => line.includes('"event":"analysis.completed"'));
    expect(completed).toContain('"documentsTimedOut":1');
  });

  it.each([
    [
      "형식 밖·상한 밖 첨부만 PENDING",
      revisionWith([
        parsedPdf("doc-a"),
        parsedPdf("doc-b"),
        parsedPdf("doc-c"),
        pendingPdf("doc-d"),
        pendingPdf("doc-e", "가격 내역서.xlsx"),
      ]),
    ],
    [
      "마감이 지난 공고",
      revisionWith([pendingPdf("doc-a")], { deadlineAt: at(-60).toISOString() }),
    ],
  ])("범위 밖 PENDING 은 기다리지 않는다: %s", async (_label, revision) => {
    const test = setup({ runMode: "live", revision, now: at(10) });

    await test.run();

    expect(test.delayedTo).toEqual([]);
    expect(test.running).toHaveLength(1);
    expect(test.saved[0]?.input.bid.attachmentsIncomplete).toBeUndefined();
  });

  it("mock 은 documents 소비자가 없어 첨부를 보지 않고 바로 분석한다", async () => {
    const test = setup({
      runMode: "mock",
      revision: revisionWith([pendingPdf("doc-a")]),
      now: at(10),
    });

    await test.run();

    expect(test.revisionLoads).toEqual([]);
    expect(test.delayedTo).toEqual([]);
    expect(test.running).toHaveLength(1);
  });
});
