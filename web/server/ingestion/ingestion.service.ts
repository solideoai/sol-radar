import "server-only";
import { z } from "zod";
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
  StartedRun,
  StartRunInput,
} from "./ingestion.repo";
import { normalizeFixtureRecord, type NormalizeOutcome } from "./normalize";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import type { BidSource } from "./normalized-bid.model";
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
  /**
   * fixture 상대 날짜(+Nd)의 기준. 주지 않으면 run.params.anchor → SEED 는 now() → LIVE 는 가장 최근 SEED 의 anchor(5-B).
   * SEED·LIVE 가 같은 값을 써야 FX-09 가 중복으로 잡힌다. g2b run 은 쓰지 않는다
   */
  anchor?: Date;
  /** fetchedAt */
  now: () => Date;
  retry: RetryDeps;
  /** 기록 전에 가릴 값(서비스키) */
  secrets?: readonly string[];
  /** 주면 저장할 bid·revision 의 id 를 정한다(demo:reset 의 결정적 id). 없으면 DB 가 만든다(6-2) */
  idFor?: IdFor;
};

export type IdFor = (
  kind: "bid" | "revision",
  keys: { source: BidSource; noticeId: string; revision?: number },
) => string;

export type SavedBidRevision = {
  bidId: string;
  revisionId: string;
  noticeId: string;
  kind: "CREATED" | "CHANGED" | "CANCELLED";
  reanalyze: boolean;
  /** 저장한 revision 의 checksum(5-D) */
  checksum: string;
  /** fixture 레코드면 그 fixture 파일의 id, g2b 면 null(5-D) */
  fixtureId: string | null;
  /** 저장한 revision 의 첨부 수. documents job 을 등록할지 정한다(6-2) */
  attachmentCount: number;
};

export type IngestRunResult = {
  runId: string;
  status: IngestRunStatus;
  summary: IngestSummary;
  saved: SavedBidRevision[];
  resumedFromCursor: string | null;
  alreadyFinished: boolean;
};

/** ingest_runs.params 에서 fixture 날짜 기준을 담는 키 */
export const FIXTURE_ANCHOR_PARAM = "anchor";
/** SEED run 이 없어 LIVE 배치의 날짜 기준을 정하지 못했을 때의 ingest_errors.error_code */
export const SEED_ANCHOR_MISSING = "SEED_ANCHOR_MISSING";

type RunContext = {
  input: RunIngestInput;
  runId: string;
  /** fixture 레코드에만 쓴다. g2b run 에서는 input.anchor 를 그대로 둔다 */
  anchor: Date | null;
  redact: (text: string) => string;
};

type PageResult = { summary: IngestSummary; saved: SavedBidRevision[] };

const FINISHED_STATUSES: ReadonlySet<IngestRunStatus> = new Set(["SUCCEEDED", "PARTIAL"]);
const isoInstantSchema = z.iso.datetime();

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const isoInstantOf = (value: unknown): Date | null =>
  typeof value === "string" && isoInstantSchema.safeParse(value).success
    ? new Date(Date.parse(value))
    : null;

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

// 5-B 1단계: 직접 준 값 → run.params → SEED 는 지금 → LIVE 는 가장 최근에 끝난 SEED 의 값.
async function anchorCandidate(input: RunIngestInput): Promise<Date | null> {
  if (input.anchor !== undefined) return input.anchor;
  const fromParams = isoInstantOf(input.run.params?.[FIXTURE_ANCHOR_PARAM]);
  if (fromParams !== null) return fromParams;
  if (input.run.batch === "SEED") return input.now();
  if (input.run.batch === "LIVE") return input.repo.findLatestSeedAnchor("fixture");
  return null;
}

function normalizeRecord(
  record: SourceRecord,
  fetchedAt: Date,
  anchor: Date | null,
): NormalizeOutcome {
  if (record.kind === "g2b-bid-notice") return normalizeG2bBidNotice(record.item, { fetchedAt });
  // fixture run 은 anchor 가 없으면 connector 를 부르기 전에 멈춘다. 여기 닿으면 g2b run 에 fixture 레코드가 섞인 프로그램 오류다.
  if (anchor === null) throw new Error("runIngest: fixture 레코드의 날짜 기준(anchor)이 없다");
  return normalizeFixtureRecord(record.record, { fetchedAt, anchor });
}

// 5-F: b3 가 raw_payload->>'fixtureId' 로 mock 추출 파일을 고른다. g2b 행은 connector 가 이미 담당자 필드를 뺐다.
const rawPayloadOf = (record: SourceRecord): Record<string, unknown> =>
  record.kind === "fixture" ? { fixtureId: record.fixtureId, ...record.record } : record.item;

const fixtureIdOf = (record: SourceRecord): string | null =>
  record.kind === "fixture" ? record.fixtureId : null;

const recordIssue = (context: RunContext, issue: IngestIssue): Promise<void> =>
  context.input.repo.recordError(context.runId, {
    sourceKey: issue.sourceKey,
    errorCode: issue.code,
    resultCode: null,
    redactedDetail: context.redact(issue.detail),
  });

const COUNTER_OF = { CREATED: "created", CHANGED: "changed", CANCELLED: "cancelled" } as const;

const counted = (
  progress: PageResult,
  counter: "quarantined" | "skippedDuplicate",
): PageResult => ({
  ...progress,
  summary: { ...progress.summary, [counter]: progress.summary[counter] + 1 },
});

async function ingestRecord(
  context: RunContext,
  record: SourceRecord,
  progress: PageResult,
): Promise<PageResult> {
  const { repo, now } = context.input;
  const outcome = normalizeRecord(record, now(), context.anchor);
  if (!outcome.ok) {
    await recordIssue(context, outcome.issue);
    return counted(progress, "quarantined");
  }
  // 경고는 기록만 하고 적재는 계속한다(15 §6).
  for (const warning of outcome.warnings) await recordIssue(context, warning);

  const { draft } = outcome;
  const previous = await repo.findLatestRevision(draft.source, draft.noticeId);
  const decision = decideRevision(previous, draft);
  // 이전 차수(STALE)는 이미 더 새 차수가 있는 공고의 재수신이라 중복과 같이 센다(summary 키를 늘리지 않는다, 5-E).
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE") {
    return counted(progress, "skippedDuplicate");
  }

  const { idFor } = context.input;
  const { source, noticeId, revision } = decision.bid;
  const ids =
    idFor === undefined
      ? undefined
      : {
          bidId: idFor("bid", { source, noticeId }),
          revisionId: idFor("revision", { source, noticeId, revision }),
        };
  const stored = await repo.saveRevision({
    decision,
    rawPayload: rawPayloadOf(record),
    ...(ids === undefined ? {} : { ids }),
  });
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
        checksum: decision.bid.checksum,
        fixtureId: fixtureIdOf(record),
        attachmentCount: decision.bid.attachments.length,
      },
    ],
  };
}

async function ingestPage(
  context: RunContext,
  page: FetchedPage,
  start: PageResult,
): Promise<PageResult> {
  // 같은 페이지 안의 같은 공고(경계 겹침·000/001)가 앞 레코드의 저장을 보고 걸러져야 해서 차례로 처리한다.
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

const finishedResult = (started: StartedRun): IngestRunResult => ({
  runId: started.runId,
  status: started.status,
  summary: started.summary,
  saved: [],
  resumedFromCursor: null,
  alreadyFinished: true,
});

// 5-B 5단계: 날짜 기준이 없으면 fixture 날짜를 지어낼 수 없다. connector 를 부르지 않고 FAILED 로 끝낸다(seed 먼저).
async function failMissingAnchor(
  repo: IngestionRepo,
  started: StartedRun,
): Promise<IngestRunResult> {
  await repo.recordError(started.runId, {
    sourceKey: "fixture:anchor",
    errorCode: SEED_ANCHOR_MISSING,
    resultCode: null,
    redactedDetail: "SEED run 이 없어 LIVE 배치의 날짜 기준이 없다",
  });
  await repo.finishRun(started.runId, { status: "FAILED", summary: started.summary });
  return {
    runId: started.runId,
    status: "FAILED",
    summary: started.summary,
    saved: [],
    resumedFromCursor: started.cursor,
    alreadyFinished: false,
  };
}

async function pullPages(context: RunContext, started: StartedRun): Promise<IngestRunResult> {
  const { connector, repo, run, retry } = context.input;
  const { from, to } = windowOf(run.params);
  const finish = (status: IngestRunStatus, result: PageResult): IngestRunResult => ({
    runId: started.runId,
    status,
    summary: result.summary,
    saved: result.saved,
    resumedFromCursor: started.cursor,
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

export async function runIngest(input: RunIngestInput): Promise<IngestRunResult> {
  const { repo, run } = input;
  const secrets = input.secrets ?? [];
  const redact = (text: string): string => redactSecrets(redactUrl(text), secrets);

  if (run.source !== "fixture") {
    const started = await repo.startRun(run);
    if (FINISHED_STATUSES.has(started.status)) return finishedResult(started);
    return pullPages(
      { input, runId: started.runId, anchor: input.anchor ?? null, redact },
      started,
    );
  }

  // 5-B: 정한 anchor 를 params 에 남겨 LIVE 와 이어 가는 run 이 같은 날짜 기준을 쓰게 한다.
  const candidate = await anchorCandidate(input);
  const params =
    candidate === null
      ? run.params
      : { ...run.params, [FIXTURE_ANCHOR_PARAM]: candidate.toISOString() };
  const started = await repo.startRun({ ...run, params });
  if (FINISHED_STATUSES.has(started.status)) return finishedResult(started);

  // 이어 가는 run 은 처음 정한 anchor 를 쓴다. 그사이 다른 SEED 가 돌았어도 날짜가 바뀌지 않는다.
  const anchor = isoInstantOf(started.params?.[FIXTURE_ANCHOR_PARAM]) ?? candidate;
  if (anchor === null) return failMissingAnchor(repo, started);
  return pullPages({ input, runId: started.runId, anchor, redact }, started);
}
