import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  EMPTY_INGEST_SUMMARY,
  createFixtureConnector,
  loadFixtureManifest,
  type BidSource,
  type BidSourceConnector,
  type FetchPageInput,
  type FixtureBatch,
  type FixtureManifest,
  type IngestErrorInput,
  type IngestRunStatus,
  type IngestSummary,
  type SavedRevision,
  type SaveRevisionInput,
  type StartedRun,
  type StartRunInput,
  type StoredRevision,
} from "@/server/ingestion";
import {
  DEFAULT_G2B_INGEST_INTERVAL_MINUTES,
  DEFAULT_G2B_LOOKBACK_MS,
  processIngestJob,
  readIngestIntervalMinutes,
  readRunMode,
  type IngestJobDeps,
  type RunMode,
} from "@/worker/ingest-queue";

// ingest job 처리(C3 계약 6-4, 05 IngestionRunInput·RUN_MODE_MISMATCH, 07 §2.2 수집 창).
// 저장은 이 파일의 가짜 저장소(IngestionRepo 포트), fixture 는 실제 FixtureConnector, g2b 는 받은 창을 기록하는 가짜 connector 다.
// 메모리 저장소(ingestion.repo.memory)는 배럴 밖이라 worker 층에서 부르지 않는다(도메인 딥 import 금지).

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
// 초·밀리초가 있는 시각. 일정 실행의 to 는 분 단위로 내린다.
const NOW = new Date("2026-10-19T09:37:45.123Z");
const NOW_FLOORED = "2026-10-19T09:37:00.000Z";
// 분 경계 시각(now − 1일 대체값을 내림 여부와 상관없이 하나로 정하려고)
const NOW_ON_MINUTE = new Date("2026-10-19T09:37:00.000Z");
const LAST_G2B_WINDOW_END = new Date("2026-10-19T09:00:00.000Z");
const MANUAL_WINDOW = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };

const FIXTURE_SEED = {
  source: "fixture",
  batch: "SEED",
  trigger: "DEMO",
  jobKey: "fixture:SEED:demo",
};
const G2B_SCHEDULED = { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" };
const G2B_MANUAL = {
  source: "g2b",
  trigger: "MANUAL",
  jobKey: "g2b:MANUAL:20261019",
  window: MANUAL_WINDOW,
  idempotencyKey: "idem-20261019-1",
  requestedBy: USER_ID,
  orgId: ORG_ID,
};

// SEED 기대값: 계약 Stage 2(07 §6.4) {created 19, quarantined 1(FX-12 제목 없음), retried 2(FX-20)}.
// 격리가 있으니 status 는 PARTIAL(04 §4 ingest_status). documents 등록은 첨부가 있는 공고 18건이다:
// SEED 20건 중 FX-12 는 격리, FX-04 는 첨부 없음(07 §6.2 "첨부 없음", fixtures/bids/FX-04.json attachments [])
const SEED_SUMMARY: IngestSummary = {
  created: 19,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 1,
  retried: 2,
};
const SEED_DOCUMENT_JOBS = 18;

let manifest: FixtureManifest;
beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

// IngestionRepo 포트를 따르는 가짜 저장소. 실제 Supabase 는 부르지 않는다.
const createFakeRepo = (lastG2bWindowEnd: Date | null = null) => {
  const starts: StartRunInput[] = [];
  const errors: (IngestErrorInput & { runId: string })[] = [];
  const finishes: { runId: string; status: IngestRunStatus; summary: IngestSummary }[] = [];
  const runs = new Map<string, StartedRun>();
  const latest = new Map<string, StoredRevision>();
  const bidIds = new Map<string, string>();
  let counter = 0;
  const nextUuid = (): string => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
  const findLatestRunWindowEnd = vi.fn(async (source: "g2b") =>
    source === "g2b" ? lastG2bWindowEnd : null,
  );

  const repo = {
    async startRun(input: StartRunInput): Promise<StartedRun> {
      starts.push(structuredClone(input));
      const existing = runs.get(input.jobKey);
      if (existing) return existing;
      const run: StartedRun = {
        runId: nextUuid(),
        status: "RUNNING",
        cursor: null,
        summary: { ...EMPTY_INGEST_SUMMARY },
        params: input.params,
      };
      runs.set(input.jobKey, run);
      return run;
    },
    async findLatestRevision(source: BidSource, noticeId: string): Promise<StoredRevision | null> {
      return latest.get(`${source}:${noticeId}`) ?? null;
    },
    async findLatestSeedAnchor(): Promise<Date | null> {
      return null;
    },
    findLatestRunWindowEnd,
    async saveRevision({ decision }: SaveRevisionInput): Promise<SavedRevision> {
      const key = `${decision.bid.source}:${decision.bid.noticeId}`;
      const bidId = bidIds.get(key) ?? nextUuid();
      bidIds.set(key, bidId);
      latest.set(key, {
        bidId,
        revision: decision.bid.revision,
        checksum: decision.bid.checksum,
        normalized: decision.bid,
      });
      return { bidId, revisionId: nextUuid() };
    },
    async recordError(runId: string, error: IngestErrorInput): Promise<void> {
      errors.push({ runId, ...error });
    },
    async saveCheckpoint(): Promise<void> {},
    async finishRun(
      runId: string,
      result: { status: IngestRunStatus; summary: IngestSummary },
    ): Promise<void> {
      finishes.push({ runId, ...result });
    },
  };
  return { repo, starts, errors, finishes, findLatestRunWindowEnd };
};

const createDeps = (
  runMode: RunMode,
  options: { now?: Date; lastG2bWindowEnd?: Date | null } = {},
) => {
  const fake = createFakeRepo(options.lastG2bWindowEnd ?? null);
  const g2bInputs: FetchPageInput[] = [];
  const g2bConnector: BidSourceConnector = {
    source: "g2b",
    async fetchPage(input) {
      g2bInputs.push(input);
      return { ok: true, page: { records: [], nextCursor: null, rateLimitInfo: null } };
    },
  };
  const createFixtureConnectorFake = vi.fn(async (batch: FixtureBatch) =>
    createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch, manifest }),
  );
  const createG2bConnector = vi.fn(async () => g2bConnector);
  const enqueueDocuments = vi.fn<IngestJobDeps["enqueueDocuments"]>(async () => undefined);
  const recordManualAudit = vi.fn<IngestJobDeps["recordManualAudit"]>(async () => undefined);
  const deps: IngestJobDeps = {
    repo: fake.repo,
    runMode,
    createFixtureConnector: createFixtureConnectorFake,
    createG2bConnector,
    enqueueDocuments,
    recordManualAudit,
    now: () => options.now ?? NOW,
    retry: { sleep: vi.fn(async () => undefined), random: () => 0 },
    secrets: [],
  };
  return {
    deps,
    ...fake,
    g2bInputs,
    createFixtureConnector: createFixtureConnectorFake,
    createG2bConnector,
    enqueueDocuments,
    recordManualAudit,
  };
};

describe("상수", () => {
  it("g2b 일정 실행 기본 간격은 30분이다(07 에 정본값 없음, e8 판정)", () => {
    expect(DEFAULT_G2B_INGEST_INTERVAL_MINUTES).toBe(30);
  });

  it("첫 일정 실행의 창은 1일이다", () => {
    expect(DEFAULT_G2B_LOOKBACK_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("readRunMode", () => {
  it("SOL_RUN_MODE 가 없으면 mock 이다", () => {
    expect(readRunMode({})).toBe("mock");
  });

  it.each(["live", "fixture", "mock"])("SOL_RUN_MODE=%s 는 그 모드다", (mode) => {
    expect(readRunMode({ SOL_RUN_MODE: mode })).toBe(mode);
  });

  // 계약: 세 값 밖은 Error. 대문자도 세 값 밖으로 본다(대소문자를 접어 받는 규칙은 계약에 없다)
  it.each(["LIVE", "Live", "production", "demo"])("SOL_RUN_MODE=%s 는 던진다", (mode) => {
    expect(() => readRunMode({ SOL_RUN_MODE: mode })).toThrow();
  });
});

describe("readIngestIntervalMinutes", () => {
  it("G2B_INGEST_INTERVAL_MINUTES 가 없으면 기본 30분이다", () => {
    expect(readIngestIntervalMinutes({})).toBe(DEFAULT_G2B_INGEST_INTERVAL_MINUTES);
  });

  it("양의 정수면 그 분이다", () => {
    expect(readIngestIntervalMinutes({ G2B_INGEST_INTERVAL_MINUTES: "15" })).toBe(15);
  });

  it.each(["0", "-5", "1.5", "abc", "30분"])(
    "양의 정수가 아니면(%j) 기동 오류로 던진다",
    (value) => {
      expect(() => readIngestIntervalMinutes({ G2B_INGEST_INTERVAL_MINUTES: value })).toThrow();
    },
  );
});

describe("processIngestJob — mock 모드 fixture SEED", () => {
  it("SEED 요약은 created 19·quarantined 1·retried 2 다", async () => {
    const { deps } = createDeps("mock");

    const result = await processIngestJob(FIXTURE_SEED, deps);

    expect(result.summary).toEqual(SEED_SUMMARY);
  });

  it("격리가 있어 run 은 PARTIAL 이다", async () => {
    const { deps } = createDeps("mock");

    const result = await processIngestJob(FIXTURE_SEED, deps);

    expect(result.status).toBe("PARTIAL");
  });

  it("startRun 에 runMode MOCK·source·batch·trigger·jobKey 를 넘긴다", async () => {
    const { deps, starts } = createDeps("mock");

    await processIngestJob(FIXTURE_SEED, deps);

    expect(starts[0]).toMatchObject({
      source: "fixture",
      runMode: "MOCK",
      batch: "SEED",
      trigger: "DEMO",
      jobKey: "fixture:SEED:demo",
    });
  });

  it("fixture connector 를 SEED 배치로 만들고 g2b connector 는 만들지 않는다", async () => {
    const { deps, createFixtureConnector: createFixture, createG2bConnector } = createDeps("mock");

    await processIngestJob(FIXTURE_SEED, deps);

    expect([createFixture.mock.calls, createG2bConnector.mock.calls.length]).toEqual([
      [["SEED"]],
      0,
    ]);
  });

  it(`첨부가 있는 저장 공고 ${SEED_DOCUMENT_JOBS}건마다 documents job 을 등록한다`, async () => {
    const { deps, enqueueDocuments } = createDeps("mock");

    await processIngestJob(FIXTURE_SEED, deps);

    expect(enqueueDocuments).toHaveBeenCalledTimes(SEED_DOCUMENT_JOBS);
  });

  it("documents job data 는 첨부가 있는 저장 결과의 bidId·revisionId 다", async () => {
    const { deps, enqueueDocuments } = createDeps("mock");

    const result = await processIngestJob(FIXTURE_SEED, deps);

    expect(enqueueDocuments.mock.calls.map(([data]) => data)).toEqual(
      result.saved
        .filter((saved) => saved.attachmentCount > 0)
        .map(({ bidId, revisionId }) => ({ bidId, revisionId })),
    );
  });

  it("DEMO trigger 는 수동 수집 감사를 남기지 않는다", async () => {
    const { deps, recordManualAudit } = createDeps("mock");

    await processIngestJob({ ...FIXTURE_SEED, orgId: ORG_ID }, deps);

    expect(recordManualAudit).not.toHaveBeenCalled();
  });

  it("fixture 모드도 fixture 수집을 받고 runMode 는 FIXTURE 다", async () => {
    const { deps, starts } = createDeps("fixture");

    const result = await processIngestJob(FIXTURE_SEED, deps);

    expect([result.status, starts[0]?.runMode]).toEqual(["PARTIAL", "FIXTURE"]);
  });
});

describe("processIngestJob — 실행 모드와 source 가 어긋날 때", () => {
  it("live 모드의 fixture 수집은 FAILED 다", async () => {
    const { deps } = createDeps("live");

    const result = await processIngestJob(FIXTURE_SEED, deps);

    expect(result.status).toBe("FAILED");
  });

  it("live 모드의 fixture 수집은 fixture:mode 에 RUN_MODE_MISMATCH 를 기록한다", async () => {
    const { deps, errors } = createDeps("live");

    await processIngestJob(FIXTURE_SEED, deps);

    expect(errors.map((error) => [error.sourceKey, error.errorCode])).toEqual([
      ["fixture:mode", "RUN_MODE_MISMATCH"],
    ]);
  });

  it("어긋남 기록에는 실행 모드와 source 를 적는다", async () => {
    const { deps, errors } = createDeps("live");

    await processIngestJob(FIXTURE_SEED, deps);

    expect(errors[0]?.redactedDetail).toMatch(/live.*fixture/i);
  });

  it("어긋나도 run 을 열고 FAILED 로 닫는다", async () => {
    const { deps, starts, finishes } = createDeps("live");

    await processIngestJob(FIXTURE_SEED, deps);

    expect([starts.length, finishes.map((finish) => finish.status)]).toEqual([1, ["FAILED"]]);
  });

  it("live 모드의 fixture 수집은 connector 를 만들지 않는다", async () => {
    const { deps, createFixtureConnector: createFixture, createG2bConnector } = createDeps("live");

    await processIngestJob(FIXTURE_SEED, deps);

    expect([createFixture.mock.calls.length, createG2bConnector.mock.calls.length]).toEqual([0, 0]);
  });

  it.each<RunMode>(["mock", "fixture"])(
    "%s 모드의 g2b 수집은 g2b:mode RUN_MODE_MISMATCH·FAILED 다",
    async (mode) => {
      const { deps, errors } = createDeps(mode);

      const result = await processIngestJob(G2B_MANUAL, deps);

      expect([result.status, errors.map((error) => [error.sourceKey, error.errorCode])]).toEqual([
        "FAILED",
        [["g2b:mode", "RUN_MODE_MISMATCH"]],
      ]);
    },
  );

  it.each<RunMode>(["mock", "fixture"])(
    "%s 모드의 g2b 수집은 connector 를 만들지 않는다",
    async (mode) => {
      const { deps, createFixtureConnector: createFixture, createG2bConnector } = createDeps(mode);

      await processIngestJob(G2B_MANUAL, deps);

      expect([createFixture.mock.calls.length, createG2bConnector.mock.calls.length]).toEqual([
        0, 0,
      ]);
    },
  );
});

describe("processIngestJob — live 모드 g2b 일정 실행(window 없음)", () => {
  it("from 은 저장소의 마지막 g2b 창 끝, to 는 now 를 분 단위로 내린 값이다", async () => {
    const { deps, g2bInputs } = createDeps("live", { lastG2bWindowEnd: LAST_G2B_WINDOW_END });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(g2bInputs.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: LAST_G2B_WINDOW_END.toISOString(), to: NOW_FLOORED },
    ]);
  });

  it("마지막 창 끝을 g2b 소스로 묻는다", async () => {
    const { deps, findLatestRunWindowEnd } = createDeps("live", {
      lastG2bWindowEnd: LAST_G2B_WINDOW_END,
    });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(findLatestRunWindowEnd.mock.calls).toEqual([["g2b"]]);
  });

  it("마지막 창이 없으면 from 은 now − 1일이다", async () => {
    const { deps, g2bInputs } = createDeps("live", { now: NOW_ON_MINUTE, lastG2bWindowEnd: null });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(g2bInputs.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: "2026-10-18T09:37:00.000Z", to: "2026-10-19T09:37:00.000Z" },
    ]);
  });

  it("jobKey 는 data.jobKey 대신 g2b:SCHEDULED:<to ISO> 다", async () => {
    const { deps, starts } = createDeps("live", { lastG2bWindowEnd: LAST_G2B_WINDOW_END });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(starts[0]?.jobKey).toBe(`g2b:SCHEDULED:${NOW_FLOORED}`);
  });

  it("params 에 정한 window 와 stages ['NOTICE'] 를 남긴다", async () => {
    const { deps, starts } = createDeps("live", { lastG2bWindowEnd: LAST_G2B_WINDOW_END });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(starts[0]?.params).toEqual({
      window: { from: LAST_G2B_WINDOW_END.toISOString(), to: NOW_FLOORED },
      stages: ["NOTICE"],
    });
  });

  it("startRun 에 runMode LIVE·trigger SCHEDULED·batch null 을 넘긴다", async () => {
    const { deps, starts } = createDeps("live", { lastG2bWindowEnd: LAST_G2B_WINDOW_END });

    await processIngestJob(G2B_SCHEDULED, deps);

    expect(starts[0]).toMatchObject({
      source: "g2b",
      runMode: "LIVE",
      trigger: "SCHEDULED",
      batch: null,
    });
  });

  it("g2b connector 를 만들고 fixture connector 는 만들지 않는다", async () => {
    const { deps, createFixtureConnector: createFixture, createG2bConnector } = createDeps("live");

    await processIngestJob(G2B_SCHEDULED, deps);

    expect([createG2bConnector.mock.calls.length, createFixture.mock.calls.length]).toEqual([1, 0]);
  });
});

describe("processIngestJob — live 모드 g2b 수동 실행", () => {
  it("data.window 를 그대로 connector 에 넘긴다", async () => {
    const { deps, g2bInputs } = createDeps("live");

    await processIngestJob(G2B_MANUAL, deps);

    expect(g2bInputs.map(({ from, to }) => ({ from, to }))).toEqual([MANUAL_WINDOW]);
  });

  it("jobKey·requestedBy·idempotencyKey 를 startRun 에 넘긴다", async () => {
    const { deps, starts } = createDeps("live");

    await processIngestJob(G2B_MANUAL, deps);

    expect(starts[0]).toMatchObject({
      jobKey: "g2b:MANUAL:20261019",
      trigger: "MANUAL",
      requestedBy: USER_ID,
      idempotencyKey: "idem-20261019-1",
      params: { window: MANUAL_WINDOW, stages: ["NOTICE"] },
    });
  });

  it("MANUAL 이고 orgId 가 있으면 수동 수집 감사를 한 번 남긴다", async () => {
    const { deps, recordManualAudit } = createDeps("live");

    const result = await processIngestJob(G2B_MANUAL, deps);

    expect(recordManualAudit.mock.calls).toEqual([
      [{ orgId: ORG_ID, actorId: USER_ID, runId: result.runId }],
    ]);
  });

  it("requestedBy 가 없으면 감사의 actorId 는 null 이다", async () => {
    const { deps, recordManualAudit } = createDeps("live");
    const { requestedBy: _requestedBy, ...withoutRequester } = G2B_MANUAL;
    void _requestedBy;

    await processIngestJob(withoutRequester, deps);

    expect(recordManualAudit.mock.calls[0]?.[0]?.actorId).toBeNull();
  });

  it("orgId 가 없으면 감사를 남기지 않는다", async () => {
    const { deps, recordManualAudit } = createDeps("live");
    const { orgId: _orgId, ...withoutOrg } = G2B_MANUAL;
    void _orgId;

    await processIngestJob(withoutOrg, deps);

    expect(recordManualAudit).not.toHaveBeenCalled();
  });
});

describe("processIngestJob — 잘못된 data", () => {
  it.each([
    ["fixture 에 batch 없음", { source: "fixture", trigger: "DEMO", jobKey: "fixture:x" }],
    ["g2b 에 batch 있음", { ...G2B_MANUAL, batch: "SEED" }],
    ["객체가 아님", "fixture"],
  ])("%s 면 던진다", async (_label, data) => {
    const { deps } = createDeps("mock");

    await expect(processIngestJob(data, deps)).rejects.toThrow();
  });

  it("잘못된 data 는 run 을 열지 않는다", async () => {
    const { deps, starts } = createDeps("live");

    await processIngestJob({ ...G2B_MANUAL, batch: "SEED" }, deps).catch(() => undefined);

    expect(starts).toEqual([]);
  });
});
