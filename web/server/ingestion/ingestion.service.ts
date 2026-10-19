import "server-only";
import {
  ingestErrorCodeOf,
  type BidSourceConnector,
  type ConnectorFailure,
  type FetchedPage,
  type SourceRecord,
} from "./connector.model";
import type {
  IngestionRepo,
  IngestRunStatus,
  IngestSummary,
  StartRunInput,
} from "./ingestion.repo";
import { normalizeFixtureRecord, type NormalizeOutcome } from "./normalize";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import { redactSecrets, redactUrl } from "./redaction";
import { decideRevision } from "./revision";
import { fetchPageWithRetry, type RetryDeps } from "./retry";
import type { IngestIssue } from "./validation";

// ── 수집 흐름(07 §5·§6.4, 15 §6): 페이지를 받아 정규화 → 변경 감지 → 저장, 페이지마다 체크포인트 ──
// 실패한 수집은 기존 공고를 건드리지 않는다. 같은 jobKey 로 다시 돌리면 저장된 cursor 부터 잇는다.
export type RunIngestInput = {
  connector: BidSourceConnector;
  repo: IngestionRepo;
  run: StartRunInput;
  /** fixture 상대 날짜(+Nd)의 기준. SEED·LIVE 가 같은 값을 써야 FX-09 가 중복으로 잡힌다. g2b 는 쓰지 않는다 */
  anchor: Date;
  /** fetchedAt */
  now: () => Date;
  retry: RetryDeps;
  /** 기록 전에 가릴 값(서비스키) */
  secrets?: readonly string[];
};

export type SavedBidRevision = {
  bidId: string;
  revisionId: string;
  noticeId: string;
  kind: "CREATED" | "CHANGED" | "CANCELLED";
  reanalyze: boolean;
};

export type IngestRunResult = {
  runId: string;
  status: IngestRunStatus;
  summary: IngestSummary;
  saved: SavedBidRevision[];
  resumedFromCursor: string | null;
  alreadyFinished: boolean;
};

type RunContext = {
  input: RunIngestInput;
  runId: string;
  redact: (text: string) => string;
};

type PageResult = { summary: IngestSummary; saved: SavedBidRevision[] };

const FINISHED_STATUSES: ReadonlySet<IngestRunStatus> = new Set(["SUCCEEDED", "PARTIAL"]);

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function windowOf(params: Record<string, unknown> | null): {
  from: string | null;
  to: string | null;
} {
  const window = params?.window;
  if (typeof window !== "object" || window === null) return { from: null, to: null };
  return {
    from: "from" in window ? stringOrNull(window.from) : null,
    to: "to" in window ? stringOrNull(window.to) : null,
  };
}

function normalizeRecord(record: SourceRecord, fetchedAt: Date, anchor: Date): NormalizeOutcome {
  return record.kind === "fixture"
    ? normalizeFixtureRecord(record.record, { fetchedAt, anchor })
    : normalizeG2bBidNotice(record.item, { fetchedAt });
}

// g2b 행은 connector 가 이미 담당자 필드를 뺐다.
const rawPayloadOf = (record: SourceRecord): Record<string, unknown> =>
  record.kind === "fixture" ? record.record : record.item;

const recordIssue = (context: RunContext, issue: IngestIssue): Promise<void> =>
  context.input.repo.recordError(context.runId, {
    sourceKey: issue.sourceKey,
    errorCode: issue.code,
    resultCode: null,
    redactedDetail: context.redact(issue.detail),
  });

const COUNTER_OF = { CREATED: "created", CHANGED: "changed", CANCELLED: "cancelled" } as const;

async function ingestRecord(
  context: RunContext,
  record: SourceRecord,
  progress: PageResult,
): Promise<PageResult> {
  const { repo, now, anchor } = context.input;
  const outcome = normalizeRecord(record, now(), anchor);
  if (!outcome.ok) {
    await recordIssue(context, outcome.issue);
    return {
      ...progress,
      summary: { ...progress.summary, quarantined: progress.summary.quarantined + 1 },
    };
  }
  // 경고는 기록만 하고 적재는 계속한다(15 §6).
  for (const warning of outcome.warnings) await recordIssue(context, warning);

  const { draft } = outcome;
  const previous = await repo.findLatestRevision(draft.source, draft.noticeId);
  const decision = decideRevision(previous, draft);
  if (decision.kind === "DUPLICATE") {
    return {
      ...progress,
      summary: { ...progress.summary, skippedDuplicate: progress.summary.skippedDuplicate + 1 },
    };
  }

  const stored = await repo.saveRevision({ decision, rawPayload: rawPayloadOf(record) });
  const counter = COUNTER_OF[decision.kind];
  return {
    summary: { ...progress.summary, [counter]: progress.summary[counter] + 1 },
    saved: [
      ...progress.saved,
      {
        bidId: stored.bidId,
        revisionId: stored.revisionId,
        noticeId: decision.bid.noticeId,
        kind: decision.kind,
        reanalyze: decision.reanalyze,
      },
    ],
  };
}

async function ingestPage(
  context: RunContext,
  page: FetchedPage,
  start: PageResult,
): Promise<PageResult> {
  // 같은 페이지 안의 같은 공고(경계 겹침)가 앞 레코드의 저장을 보고 중복으로 걸러져야 해서 차례로 처리한다.
  let progress = start;
  for (const record of page.records) progress = await ingestRecord(context, record, progress);
  return progress;
}

async function failRun(
  context: RunContext,
  cursor: string | null,
  failure: ConnectorFailure,
  summary: IngestSummary,
): Promise<void> {
  const { repo, run } = context.input;
  await repo.recordError(context.runId, {
    sourceKey: `${run.source}:page:${cursor ?? "start"}`,
    errorCode: ingestErrorCodeOf(failure),
    resultCode: failure.resultCode ?? null,
    redactedDetail: context.redact(failure.detail),
  });
  // 실패한 cursor 를 남겨 같은 jobKey 재실행이 그 페이지부터 다시 받게 한다.
  await repo.saveCheckpoint(context.runId, { cursor, summary });
  await repo.finishRun(context.runId, { status: "FAILED", summary });
}

export async function runIngest(input: RunIngestInput): Promise<IngestRunResult> {
  const { connector, repo, run, retry } = input;
  const started = await repo.startRun(run);
  if (FINISHED_STATUSES.has(started.status)) {
    return {
      runId: started.runId,
      status: started.status,
      summary: started.summary,
      saved: [],
      resumedFromCursor: null,
      alreadyFinished: true,
    };
  }

  const secrets = input.secrets ?? [];
  const context: RunContext = {
    input,
    runId: started.runId,
    redact: (text) => redactSecrets(redactUrl(text), secrets),
  };
  const { from, to } = windowOf(run.params);
  const resumedFromCursor = started.cursor;
  const finish = (status: IngestRunStatus, result: PageResult): IngestRunResult => ({
    runId: started.runId,
    status,
    summary: result.summary,
    saved: result.saved,
    resumedFromCursor,
    alreadyFinished: false,
  });

  let cursor = started.cursor;
  let progress: PageResult = { summary: { ...started.summary }, saved: [] };
  for (;;) {
    const { outcome, retried } = await fetchPageWithRetry(connector, { from, to, cursor }, retry);
    progress = {
      ...progress,
      summary: { ...progress.summary, retried: progress.summary.retried + retried },
    };
    if (!outcome.ok) {
      // 처리한 페이지가 있어도 connector 실패로 멈췄으면 FAILED 다(그 창의 수집을 끝내지 못했다).
      await failRun(context, cursor, outcome.failure, progress.summary);
      return finish("FAILED", progress);
    }
    progress = await ingestPage(context, outcome.page, progress);
    await repo.saveCheckpoint(started.runId, {
      cursor: outcome.page.nextCursor,
      summary: progress.summary,
    });
    if (outcome.page.nextCursor === null) break;
    cursor = outcome.page.nextCursor;
  }

  // 04 §4: 끝까지 처리했지만 격리한 레코드가 있으면 PARTIAL 이다. 경고는 PARTIAL 사유가 아니다.
  const status = progress.summary.quarantined > 0 ? "PARTIAL" : "SUCCEEDED";
  await repo.finishRun(started.runId, { status, summary: progress.summary });
  return finish(status, progress);
}
