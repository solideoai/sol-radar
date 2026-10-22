import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson } from "./checksum";
import { normalizeExternalNotice } from "./external-normalize";
import { sanitizeExternalValue } from "./external-payload";
import { isPlainRecord } from "./normalize-common";
import { z } from "zod";
import {
  ingestErrorCodeOf,
  type BeforeApiRequest,
  type BidSourceConnector,
  type ConnectorFailure,
  type FetchedPage,
  type IngestCompleteness,
  type SourceRecord,
} from "./connector.model";
import type { G2bAuxFetcher } from "./g2b-aux";
import type {
  IngestionRepo,
  IngestRunItemInput,
  IngestRunStatus,
  IngestSummary,
  StartedRun,
  StartRunInput,
} from "./ingestion.port";
import { normalizeFixtureRecord, type NormalizeOutcome } from "./normalize";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import {
  auxLookupOf,
  isAuxIncomplete,
  listOnlyRevision,
  mergeG2bAux,
  registeredAtOf,
  skippedQuotaLookup,
  withAuxLookup,
} from "./normalize-g2b-aux";
import type { BidSource, NormalizedBidDraft } from "./normalized-bid.model";
import { quotaKey, quotaState, type QuotaState } from "./quota";
import type { IngestQuota } from "./quota-store";
import { redactSecrets, redactUrl } from "./redaction";
import { decideRevision, type ChangeDecision, type StoredRevision } from "./revision";
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
  /**
   * 보조 조회 3종(07 §2.2). g2b 레코드가 새 revision(재분석 대상)이 될 때만 부른다. 없으면(fixture·녹음 재생) 부르지 않는다.
   * 실패는 ingest_errors 에 남기고 공고는 보조 없이 저장한다(07 §2.6)
   */
  aux?: G2bAuxFetcher;
  /**
   * 공공 API 호출 예산(07 §2.2). 실제 HTTP마다 원자적으로 1회를 예약한다. 거절/저장소 장애면 송신하지 않는다.
   * 공고 앞에서 AUXILIARY_STOPPED(한도의 90%) 이상이면 보조 조회를 건너뛴다(auxLookup SKIPPED_QUOTA).
   * 없으면(시험·녹음 재생) 예산을 보지 않는다. live Worker는 누락을 거절한다. 결과코드 22 중단은 항상 적용한다.
   */
  quota?: IngestQuota;
};

export type IdFor = (
  kind: "bid" | "revision",
  keys: { source: BidSource; noticeId: string; revision?: number },
) => string;

export type SavedBidRevision = {
  bidId: string;
  revisionId: string;
  /** 저장한 revision 행의 created_at(DB timestamptz 문자열). documents jobId 를 만든다(C1') */
  revisionCreatedAt: string;
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

/** 이번 실행에서 격리한 레코드 하나. 경고(적재는 함)·connector 실패·anchor 없음은 레코드 격리가 아니다(6-5) */
export type QuarantinedRecord = { sourceKey: string; errorCode: string; fixtureId: string | null };

export type IngestRunResult = {
  runId: string;
  status: IngestRunStatus;
  summary: IngestSummary;
  saved: SavedBidRevision[];
  quarantined: QuarantinedRecord[];
  resumedFromCursor: string | null;
  alreadyFinished: boolean;
};

/** ingest_runs.params 에서 fixture 날짜 기준을 담는 키 */
export const FIXTURE_ANCHOR_PARAM = "anchor";
/** SEED run 이 없어 LIVE 배치의 날짜 기준을 정하지 못했을 때의 ingest_errors.error_code */
export const SEED_ANCHOR_MISSING = "SEED_ANCHOR_MISSING";
/** 호출 예산 소진으로 run 을 멈췄을 때의 ingest_errors.error_code(run 수준, 호출 자체의 API_QUOTA_EXCEEDED 와 다르다) */
export const QUOTA_EXCEEDED_ERROR_CODE = "QUOTA_EXCEEDED";
/** 예산 저장소(Redis)를 읽지 못해 run 을 멈췄을 때의 ingest_errors.error_code. 소진(QUOTA_EXCEEDED)과 섞지 않는다(11 V2-03, 02 장애 원칙) */
export const QUOTA_STORE_UNAVAILABLE_ERROR_CODE = "QUOTA_STORE_UNAVAILABLE";
/** 위 기록의 source_key */
export const QUOTA_SOURCE_KEY = "g2b:quota";

type RunContext = {
  input: RunIngestInput;
  runId: string;
  /** fixture 레코드에만 쓴다. g2b run 에서는 input.anchor 를 그대로 둔다 */
  anchor: Date | null;
  redact: (text: string) => string;
  /** 공공 API 호출 수를 세는 run(g2b)인지. fixture 는 세지 않아 quota_used 가 0 으로 남는다 */
  countsCalls: boolean;
  /** 호출 예산. g2b run 에 주입됐을 때만 있다 */
  quota: IngestQuota | null;
  budget: RequestBudget | null;
};

type RequestBudget = {
  beforeRequest: BeforeApiRequest;
  calls: number;
  lastRequestAt: Date | null;
};

function requestBudget(input: RunIngestInput): RequestBudget | null {
  const { quota, now } = input;
  if (quota === undefined) return null;
  const unavailable: ConnectorFailure = {
    kind: "QUOTA_UNAVAILABLE",
    detail: "호출 예산 예약을 확인하지 못해 HTTP 요청을 차단한다",
  };
  const budget: RequestBudget = {
    calls: 0,
    lastRequestAt: null,
    async beforeRequest() {
      try {
        // Redis 응답을 기다리는 동안 KST 날짜가 바뀌면 새 날짜에도 예약한다.
        // 이전 예약은 실제 송신 여부가 불확실한 예약과 마찬가지로 환불하지 않는다.
        for (let attempt = 0; attempt < 2; attempt++) {
          const at = now();
          const reserved = await quota.store.reserve(quota.serviceId, at);
          if (quotaKey(quota.serviceId, at) !== quotaKey(quota.serviceId, now())) continue;
          if (reserved === false)
            return { kind: "QUOTA_EXCEEDED", detail: "일일 호출 예산을 예약할 수 없다" };
          if (reserved !== true) return unavailable;
          budget.calls++;
          budget.lastRequestAt = at;
          return null;
        }
      } catch {
        // 오류 원문은 접속 문자열을 담을 수 있다. 응답 성공 여부가 불명확하면 재송신하지 않는다.
      }
      return unavailable;
    },
  };
  return budget;
}

type PageResult = {
  summary: IngestSummary;
  saved: SavedBidRevision[];
  quarantined: QuarantinedRecord[];
  /** 이 run 이 쓴 공공 API 호출 수(목록 쪽 + 보조 조회, 재시도 포함). 이어 가는 run 은 저장된 값부터 센다 */
  quotaUsed: number;
  /** 보조 조회의 예산 소진/예약 실패. 같은 run의 남은 공고·다음 쪽을 부르지 않는다. */
  halted: ConnectorFailure | null;
};

const isFinishedRun = (started: StartedRun): boolean =>
  started.status === "SUCCEEDED" ||
  (started.status === "PARTIAL" &&
    started.completeness !== "PARTIAL" &&
    started.completeness !== "UNKNOWN");
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
  secrets: readonly string[] = [],
): NormalizeOutcome {
  if (record.kind === "external") {
    const safe = sanitizeExternalValue(record.item, secrets);
    if (!isPlainRecord(safe)) throw new Error("external record must be an object");
    return normalizeExternalNotice(record.sourceKey, safe, {
      fetchedAt,
      companyId: record.companyId,
      operation: record.operation,
    });
  }
  if (record.kind === "g2b-bid-notice") return normalizeG2bBidNotice(record.item, { fetchedAt });
  // fixture run 은 anchor 가 없으면 connector 를 부르기 전에 멈춘다. 여기 닿으면 g2b run 에 fixture 레코드가 섞인 프로그램 오류다.
  if (anchor === null) throw new Error("runIngest: fixture 레코드의 날짜 기준(anchor)이 없다");
  return normalizeFixtureRecord(record.record, { fetchedAt, anchor });
}

// 5-F: b3 가 raw_payload->>'fixtureId' 로 mock 추출 파일을 고른다. g2b 행은 connector 가 이미 담당자 필드를 뺐다.
const rawPayloadOf = (
  record: SourceRecord,
  secrets: readonly string[] = [],
): Record<string, unknown> => {
  if (record.kind === "fixture") return { fixtureId: record.fixtureId, ...record.record };
  const safe = sanitizeExternalValue(record.item, secrets);
  if (!isPlainRecord(safe)) throw new Error("external payload must be an object");
  return safe;
};
async function recordRunItem(
  context: RunContext,
  record: SourceRecord,
  payloadId: string | null,
  sourceRecordKey: string,
  outcome: IngestRunItemInput["outcome"],
  saved?: { bidId: string; revisionId: string },
  errorCode?: string,
): Promise<boolean> {
  if (record.kind !== "external") return true;
  if (!context.input.repo.recordRunItem)
    throw new Error("수집 저장소: 외부 레코드 증거 저장이 없다");
  return context.input.repo.recordRunItem(context.runId, {
    sourceRecordKey,
    payloadHash: createHash("sha256")
      .update(canonicalJson(rawPayloadOf(record, context.input.secrets)))
      .digest("hex"),
    payloadId,
    outcome,
    ...saved,
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

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

const isSkipped = (
  decision: ChangeDecision,
): decision is Extract<ChangeDecision, { kind: "DUPLICATE" | "STALE" }> =>
  decision.kind === "DUPLICATE" || decision.kind === "STALE";

// ── 호출 예산(07 §2.2). 예산이 없는 run(시험·녹음·fixture)은 늘 OK 다 ──
/** unavailable: 저장소를 읽지 못해 상태를 EXHAUSTED 로 닫은 경우(used 는 NaN) */
type QuotaStatus = { state: QuotaState; used: number; unavailable: boolean };

async function quotaStatusOf(context: RunContext, at: Date): Promise<QuotaStatus> {
  const { quota } = context;
  if (quota === null) return { state: "OK", used: 0, unavailable: false };
  try {
    const used = await quota.store.get(quota.serviceId, at);
    return { state: quotaState(used, quota.dailyLimit), used, unavailable: false };
  } catch {
    // 저장소(Redis)에 닿지 못했다. 예산을 모르면 남았다고 낙관하지 않는다 — 소진과 같이 닫는다(07 §2.2).
    // 오류 내용은 싣지 않는다(연결 문자열이 섞일 수 있다).
    return { state: "EXHAUSTED", used: Number.NaN, unavailable: true };
  }
}

const isQuotaFailure = (failure: ConnectorFailure): boolean =>
  failure.kind === "QUOTA_EXCEEDED" || failure.kind === "QUOTA_UNAVAILABLE";

/** 공급자 코드 22만 카운터를 소진시킨다. 로컬 예약 거절/저장소 장애도 기록하고 남은 호출을 멈춘다. */
async function exhaustQuota(
  context: RunContext,
  failure: ConnectorFailure,
  at: Date,
): Promise<void> {
  const { quota } = context;
  let unavailable = failure.kind === "QUOTA_UNAVAILABLE";
  if (quota !== null && failure.resultCode === "22") {
    try {
      await quota.store.markExhausted(quota.serviceId, context.budget?.lastRequestAt ?? at);
    } catch {
      unavailable = true;
    }
  }
  await context.input.repo.recordError(context.runId, {
    sourceKey: QUOTA_SOURCE_KEY,
    errorCode: unavailable ? QUOTA_STORE_UNAVAILABLE_ERROR_CODE : QUOTA_EXCEEDED_ERROR_CODE,
    resultCode: failure.resultCode ?? null,
    redactedDetail: unavailable
      ? "호출 예산 저장소 오류로 이 run의 남은 호출을 차단한다"
      : "일일 호출 한도 소진으로 이 run의 남은 호출을 차단한다",
  });
}

type AuxDecision = { decision: ChangeDecision; calls: number; halted: ConnectorFailure | null };

const settled = (decision: ChangeDecision): AuxDecision => ({ decision, calls: 0, halted: null });

/**
 * 07 §2.2: 보조 조회는 새 revision 일 때만. 분석하지 않는 revision(취소, 처음부터 취소된 공고)에는 부르지 않는다.
 * 1차 판정은 목록만으로 한다. 저장된 revision 의 보조 유래 부분을 뺀 모양과 비교해야 같은 공고의 재수집이
 * DUPLICATE 로 걸러진다(보조 결과가 checksum 에 들어 있어 그대로 비교하면 매번 CHANGED 가 된다).
 * 다시 채우기: 목록이 같아도 저장된 revision 의 보조 조회가 불완전(FAILED·SKIPPED_QUOTA)하면 다시 부르고,
 * 셋 다 받으면 CHANGED revision 으로 저장한다. 또 실패하면 revision 을 늘리지 않는다.
 */
async function withAux(
  context: RunContext,
  record: Extract<SourceRecord, { kind: "g2b-bid-notice" }>,
  draft: NormalizedBidDraft,
  previous: StoredRevision | null,
  fetchedAt: Date,
): Promise<AuxDecision> {
  const { aux, repo } = context.input;
  if (aux === undefined) return settled(decideRevision(previous, draft));

  const listOnly = decideRevision(previous === null ? null : listOnlyRevision(previous), draft);
  const refills =
    listOnly.kind === "DUPLICATE" && previous !== null && isAuxIncomplete(previous.normalized);
  const fetches = refills || (!isSkipped(listOnly) && listOnly.reanalyze);
  if (!fetches) return settled(listOnly);

  const budgetStatus = await quotaStatusOf(context, fetchedAt);
  if (budgetStatus.state !== "OK") {
    // 한도의 90% 에 닿았다. 다시 채우기는 미루고(revision 없음), 새 revision 은 건너뜀 표시로 저장한다.
    const decision = refills
      ? listOnly
      : decideRevision(previous, withAuxLookup(draft, skippedQuotaLookup()));
    return {
      decision,
      calls: 0,
      // 저장소 장애를 정상적인 90% 중단으로 취급해 run을 성공 처리하지 않는다.
      halted: budgetStatus.unavailable
        ? { kind: "QUOTA_UNAVAILABLE", detail: "보조 조회의 호출 예산 저장소를 읽지 못했다" }
        : null,
    };
  }

  const before = context.budget?.calls ?? 0;
  const fetched = await aux.fetchAux({
    noticeId: draft.noticeId,
    amendmentNo: draft.amendmentNo ?? null,
    registeredAt: registeredAtOf(record.item, fetchedAt),
    ...(context.budget === null ? {} : { beforeRequest: context.budget.beforeRequest }),
  });
  const calls = context.budget === null ? fetched.calls : context.budget.calls - before;
  for (const { registryKey, failure } of fetched.failures) {
    await repo.recordError(context.runId, {
      sourceKey: `${registryKey}:${draft.noticeId}`,
      errorCode: ingestErrorCodeOf(failure),
      resultCode: failure.resultCode ?? null,
      redactedDetail: context.redact(failure.detail),
    });
  }
  const halted = fetched.failures.find(({ failure }) => isQuotaFailure(failure))?.failure ?? null;
  const lookup = auxLookupOf(fetched);
  // 다시 채우기가 또 실패하면 이전 revision 이 그대로 확인 필요다. 늘리지 않는다.
  if (refills && lookup.status !== "OK") return { decision: listOnly, calls, halted };
  // 2차 판정은 보조 결과까지 합친 모양으로 한다. 저장되는 checksum 은 이쪽이다.
  return {
    decision: decideRevision(previous, withAuxLookup(mergeG2bAux(draft, fetched.rows), lookup)),
    calls,
    halted,
  };
}

async function decideRecord(
  context: RunContext,
  record: SourceRecord,
  draft: NormalizedBidDraft,
  fetchedAt: Date,
): Promise<AuxDecision> {
  const previous = await context.input.repo.findLatestRevision(draft.source, draft.noticeId);
  if (record.kind === "g2b-bid-notice") return withAux(context, record, draft, previous, fetchedAt);
  return settled(decideRevision(previous, draft));
}

async function ingestRecord(
  context: RunContext,
  record: SourceRecord,
  progress: PageResult,
  payloadId: string | null,
): Promise<PageResult> {
  const { repo, now } = context.input;
  const fetchedAt = now();
  const outcome = normalizeRecord(record, fetchedAt, context.anchor, context.input.secrets);
  if (!outcome.ok) {
    const inserted = await recordRunItem(
      context,
      record,
      payloadId,
      outcome.issue.sourceKey,
      "QUARANTINED",
      undefined,
      outcome.issue.code,
    );
    if (!inserted) return progress;
    await recordIssue(context, outcome.issue);
    const quarantined: QuarantinedRecord = {
      sourceKey: outcome.issue.sourceKey,
      errorCode: outcome.issue.code,
      fixtureId: fixtureIdOf(record),
    };
    return {
      ...counted(progress, "quarantined"),
      quarantined: [...progress.quarantined, quarantined],
    };
  }
  // 경고는 기록만 하고 적재는 계속한다(15 §6).
  for (const warning of outcome.warnings) await recordIssue(context, warning);

  const { decision, calls, halted } = await decideRecord(context, record, outcome.draft, fetchedAt);
  const withCalls: PageResult = { ...progress, quotaUsed: progress.quotaUsed + calls, halted };
  // 이전 차수(STALE)는 이미 더 새 차수가 있는 공고의 재수신이라 중복과 같이 센다(summary 키를 늘리지 않는다, 5-E).
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE") {
    if (decision.kind === "DUPLICATE")
      await repo.ensureRevisionProjection?.(outcome.draft.source, outcome.draft.noticeId);
    const inserted = await recordRunItem(
      context,
      record,
      payloadId,
      `${outcome.draft.source}:${outcome.draft.noticeId}`,
      "DUPLICATE",
    );
    return inserted ? counted(withCalls, "skippedDuplicate") : withCalls;
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
    rawPayload: rawPayloadOf(record, context.input.secrets),
    ...(ids === undefined ? {} : { ids }),
  });
  const inserted = await recordRunItem(
    context,
    record,
    payloadId,
    `${source}:${noticeId}`,
    decision.kind,
    stored,
  );
  if (!inserted) return withCalls;
  const counter = COUNTER_OF[decision.kind];
  return {
    ...withCalls,
    summary: { ...withCalls.summary, [counter]: withCalls.summary[counter] + 1 },
    saved: [
      ...withCalls.saved,
      {
        bidId: stored.bidId,
        revisionId: stored.revisionId,
        revisionCreatedAt: stored.revisionCreatedAt,
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
  if (
    (page.capture !== undefined || page.records.some((record) => record.kind === "external")) &&
    context.input.repo.recordPayload === undefined
  )
    throw new Error("수집 저장소: 외부 원본 증거 저장이 없다");
  if (page.records.some((record) => record.kind === "external") && page.capture === undefined)
    throw new Error("수집 페이지: 외부 원본 증거가 없다");
  const payloadId =
    page.capture === undefined
      ? null
      : ((await context.input.repo.recordPayload?.(context.runId, page.capture)) ?? null);
  for (const record of page.records) {
    progress = await ingestRecord(context, record, progress, payloadId);
    // 22 를 받았다. 다음 공고의 보조 조회도 같은 답이라 여기서 멈춘다(저장한 공고는 그대로다).
    if (progress.halted !== null) break;
  }
  return progress;
}

// quota_used 는 공공 API 를 부른 run 만 쓴다. fixture run 은 주지 않아 DB 기본값 0 이 남는다.
const quotaOf = (context: RunContext, progress: PageResult): { quotaUsed?: number } =>
  context.countsCalls ? { quotaUsed: progress.quotaUsed } : {};

// 실패한 cursor 를 남겨 같은 jobKey 재실행이 그 페이지부터 다시 받게 한다(07 §2.6 cursor 보존).
async function closeFailed(
  context: RunContext,
  cursor: string | null,
  progress: PageResult,
): Promise<void> {
  const { repo } = context.input;
  await repo.saveCheckpoint(context.runId, {
    cursor,
    summary: progress.summary,
    ...quotaOf(context, progress),
  });
  await repo.finishRun(context.runId, {
    status: "FAILED",
    summary: progress.summary,
    ...quotaOf(context, progress),
  });
}

async function recordPageFailure(
  context: RunContext,
  cursor: string | null,
  failure: ConnectorFailure,
): Promise<void> {
  const { repo, run } = context.input;
  if (failure.capture !== undefined) {
    if (repo.recordPayload === undefined)
      throw new Error("수집 저장소: 오류 원본 증거 저장이 없다");
    await repo.recordPayload(context.runId, failure.capture);
  }
  await repo.recordError(context.runId, {
    sourceKey: `${run.source}:page:${cursor ?? "start"}`,
    errorCode: ingestErrorCodeOf(failure),
    resultCode: failure.resultCode ?? null,
    redactedDetail: context.redact(failure.detail),
  });
}

// 쪽을 부르기 전에 그날 예산이 소진됐으면(다른 run·앞 쪽이 다 썼다) 호출 없이 FAILED 로 닫는다. revision 은 만들지 않는다.
async function recordQuotaExhausted(context: RunContext, status: QuotaStatus): Promise<void> {
  const limit = context.quota?.dailyLimit ?? 0;
  // 실패 유형을 다른 유형의 코드로 남기지 않는다: 저장소 장애는 QUOTA_STORE_UNAVAILABLE, 실제 소진만 QUOTA_EXCEEDED.
  await context.input.repo.recordError(context.runId, {
    sourceKey: QUOTA_SOURCE_KEY,
    errorCode: status.unavailable ? QUOTA_STORE_UNAVAILABLE_ERROR_CODE : QUOTA_EXCEEDED_ERROR_CODE,
    resultCode: null,
    redactedDetail: status.unavailable
      ? `호출 예산을 읽지 못함(저장소 오류, 한도 ${limit}). 남았다고 보지 않고 목록을 부르지 않는다`
      : `일일 호출 한도 소진(${status.used}/${limit}). 목록을 부르지 않는다`,
  });
}

const finishedResult = (started: StartedRun): IngestRunResult => ({
  runId: started.runId,
  status: started.status,
  summary: started.summary,
  saved: [],
  quarantined: [],
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
    quarantined: [],
    resumedFromCursor: started.cursor,
    alreadyFinished: false,
  };
}

async function pullPages(context: RunContext, started: StartedRun): Promise<IngestRunResult> {
  const { connector, repo, run, retry, now } = context.input;
  const { from, to } = windowOf(run.params);
  const finish = (status: IngestRunStatus, result: PageResult): IngestRunResult => ({
    runId: started.runId,
    status,
    summary: result.summary,
    saved: result.saved,
    quarantined: result.quarantined,
    resumedFromCursor: started.cursor,
    alreadyFinished: false,
  });

  let completeness: IngestCompleteness = "COMPLETE";
  let cursor = started.cursor;
  let progress: PageResult = {
    summary: { ...started.summary },
    saved: [],
    quarantined: [],
    quotaUsed: started.quotaUsed ?? 0,
    halted: null,
  };
  for (;;) {
    const at = now();
    const budget = await quotaStatusOf(context, at);
    if (budget.state === "EXHAUSTED") {
      await recordQuotaExhausted(context, budget);
      await closeFailed(context, cursor, progress);
      return finish("FAILED", progress);
    }

    const before = context.budget?.calls ?? 0;
    const { outcome, retried } = await fetchPageWithRetry(
      connector,
      {
        from,
        to,
        cursor,
        ...(context.budget === null ? {} : { beforeRequest: context.budget.beforeRequest }),
      },
      retry,
    );
    // 목록 쪽 한 번 = 호출 한 번. 재시도한 만큼 더 나갔다.
    const rejectedBeforeFetch =
      !outcome.ok &&
      (outcome.failure.kind === "NOT_VERIFIED" || outcome.failure.kind === "INVALID_INPUT");
    const pageCalls =
      context.budget !== null
        ? context.budget.calls - before
        : context.countsCalls && !rejectedBeforeFetch
          ? retried + 1
          : 0;
    const actualRetries = context.budget === null ? retried : Math.max(0, pageCalls - 1);
    progress = {
      ...progress,
      summary: { ...progress.summary, retried: progress.summary.retried + actualRetries },
      quotaUsed: progress.quotaUsed + pageCalls,
    };
    if (!outcome.ok) {
      // 처리한 페이지가 있어도 connector 실패로 멈췄으면 FAILED 다(그 창의 수집을 끝내지 못했다).
      await recordPageFailure(context, cursor, outcome.failure);
      if (isQuotaFailure(outcome.failure)) await exhaustQuota(context, outcome.failure, at);
      await closeFailed(context, cursor, progress);
      return finish("FAILED", progress);
    }
    if (outcome.page.completeness !== undefined && outcome.page.completeness !== "COMPLETE")
      completeness = outcome.page.completeness;
    progress = await ingestPage(context, outcome.page, progress);
    if (progress.halted !== null) {
      // 이 쪽을 다 처리하지 못했다. 같은 cursor 를 남겨 이어 가는 run 이 이 쪽부터 다시 받게 한다
      // (저장한 공고는 DUPLICATE 로, 보조를 못 받은 공고는 다시 채우기로 걸러진다).
      await exhaustQuota(context, progress.halted, at);
      await closeFailed(context, cursor, progress);
      return finish("FAILED", progress);
    }
    if (completeness !== "COMPLETE") {
      await repo.saveCheckpoint(started.runId, {
        cursor,
        summary: progress.summary,
        completeness,
        fetchedCount:
          progress.summary.created +
          progress.summary.changed +
          progress.summary.cancelled +
          progress.summary.skippedDuplicate +
          progress.summary.quarantined,
        ...quotaOf(context, progress),
      });
      await repo.finishRun(started.runId, {
        status: "PARTIAL",
        summary: progress.summary,
        completeness,
        ...quotaOf(context, progress),
      });
      return finish("PARTIAL", progress);
    }
    await repo.saveCheckpoint(started.runId, {
      completeness,
      fetchedCount:
        progress.summary.created +
        progress.summary.changed +
        progress.summary.cancelled +
        progress.summary.skippedDuplicate +
        progress.summary.quarantined,
      cursor: outcome.page.nextCursor,
      summary: progress.summary,
      ...quotaOf(context, progress),
    });
    if (outcome.page.nextCursor === null) break;
    cursor = outcome.page.nextCursor;
  }

  // 04 §4: 끝까지 처리했지만 격리한 레코드가 있으면 PARTIAL 이다. 경고는 PARTIAL 사유가 아니다.
  const status = progress.summary.quarantined > 0 ? "PARTIAL" : "SUCCEEDED";
  await repo.finishRun(started.runId, {
    status,
    completeness,
    summary: progress.summary,
    ...quotaOf(context, progress),
  });
  return finish(status, progress);
}

export async function runIngest(input: RunIngestInput): Promise<IngestRunResult> {
  const { repo, run } = input;
  const secrets = input.secrets ?? [];
  const redact = (text: string): string => redactSecrets(redactUrl(text), secrets);

  if (run.source !== "fixture") {
    const started = await repo.startRun(run);
    if (isFinishedRun(started)) return finishedResult(started);
    return pullPages(
      {
        input,
        runId: started.runId,
        anchor: input.anchor ?? null,
        redact,
        countsCalls: true,
        quota: input.quota ?? null,
        budget: requestBudget(input),
      },
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
  if (isFinishedRun(started)) return finishedResult(started);

  // 이어 가는 run 은 처음 정한 anchor 를 쓴다. 그사이 다른 SEED 가 돌았어도 날짜가 바뀌지 않는다.
  const anchor = isoInstantOf(started.params?.[FIXTURE_ANCHOR_PARAM]) ?? candidate;
  if (anchor === null) return failMissingAnchor(repo, started);
  return pullPages(
    { input, runId: started.runId, anchor, redact, countsCalls: false, quota: null, budget: null },
    started,
  );
}
