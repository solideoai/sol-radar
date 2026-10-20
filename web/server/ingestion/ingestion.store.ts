import "server-only";
import { z } from "zod";
import type { Json, Tables, TablesInsert } from "@/lib/database.types";
import type {
  IngestErrorInput,
  IngestRunStatus,
  IngestSummary,
  SaveRevisionInput,
  StartedRun,
  StartRunInput,
} from "./ingestion.port";
import { normalizedBidSchema, type StructuredRequirement } from "./normalized-bid.model";
import type { StoredRevision } from "./revision";

// ── 저장 포트 ↔ DB 행·RPC 인자 변환(순수, 6-2). Supabase 구현은 이 규칙만 부르고 판단하지 않는다 ──
const INGEST_RUN_STATUSES: readonly IngestRunStatus[] = [
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// JSON 으로 한 번 왕복해 RPC 로 보낼 수 있는 값만 남긴다(undefined 키는 빠진다). 입력과 객체를 나눠 쓰지 않게도 한다.
const jsonCopy = (value: unknown): Json => JSON.parse(JSON.stringify(value));

/** RPC ingest_save_revision(6-1)의 p. snake_case, 날짜는 ISO UTC 문자열이다. */
export function toSaveRevisionParams(input: SaveRevisionInput): Json {
  const { decision, rawPayload, ids } = input;
  const { bid } = decision;
  const changedFields = decision.changes.map(({ field }) => field);
  return jsonCopy({
    ...(ids?.bidId === undefined ? {} : { bid_id: ids.bidId }),
    ...(ids?.revisionId === undefined ? {} : { revision_id: ids.revisionId }),
    notice: {
      source: bid.source,
      notice_id: bid.noticeId,
      plan_ref: bid.planRef ?? null,
      pre_spec_ref: bid.preSpecRef ?? null,
      title: bid.title,
      agency: bid.agency,
      stage: bid.stage,
      status: bid.status,
      budget_krw: bid.budgetKrw,
      published_at: bid.noticeDate,
      deadline_at: bid.deadlineAt,
      source_url: bid.sourceUrl,
      is_demo: bid.isDemo,
    },
    revision: {
      revision: bid.revision,
      amendment_no: bid.amendmentNo ?? null,
      raw_payload: rawPayload,
      normalized: bid,
      checksum: bid.checksum,
      changed_fields: changedFields,
      fetched_at: bid.fetchedAt,
    },
    documents: bid.attachments.map(({ name, url }) => ({ name, original_url: url })),
    event: {
      event_type: decision.event.type,
      idempotency_key: decision.event.idempotencyKey,
      payload: {
        source: bid.source,
        noticeId: bid.noticeId,
        revision: bid.revision,
        kind: decision.kind,
        changedFields,
      },
    },
  });
}

// zod 메시지에는 받은 값이 들어갈 수 있어서 경로만 남긴다.
const issuePaths = (paths: readonly (readonly PropertyKey[])[]): string =>
  [
    ...new Set(paths.map((path) => (path.length === 0 ? "(root)" : path.map(String).join(".")))),
  ].join(", ");

/** bid_revisions 행 → StoredRevision. 저장된 normalized 가 계약을 어기면 비교할 수 없어 던진다. */
export function toStoredRevision(row: {
  bid_id: string;
  revision: number;
  checksum: string;
  normalized: unknown;
}): StoredRevision {
  const parsed = normalizedBidSchema.safeParse(row.normalized);
  if (!parsed.success) {
    throw new Error(
      `bid_revisions.normalized 가 NormalizedBid 가 아니다: ${issuePaths(parsed.error.issues.map(({ path }) => path))}`,
    );
  }
  return {
    bidId: row.bid_id,
    revision: row.revision,
    checksum: row.checksum,
    normalized: parsed.data,
  };
}

// 0 이상 정수가 아닌 값(음수·소수·문자열 등)은 0 으로 읽는다. 집계가 깨져도 run 을 이어 갈 수 있게 한다.
const countOf = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function summaryOf(value: Json): IngestSummary {
  const source = isPlainObject(value) ? value : {};
  return {
    created: countOf(source.created),
    changed: countOf(source.changed),
    cancelled: countOf(source.cancelled),
    skippedDuplicate: countOf(source.skippedDuplicate),
    quarantined: countOf(source.quarantined),
    retried: countOf(source.retried),
  };
}

function statusOf(value: string): IngestRunStatus {
  const status = INGEST_RUN_STATUSES.find((candidate) => candidate === value);
  // DB 의 check 제약이 막는 값이다. 여기 닿으면 스키마와 코드가 어긋난 것이라 이어 가지 않는다.
  if (status === undefined) throw new Error("ingest_runs.status 가 알 수 없는 값이다");
  return status;
}

/** ingest_runs 행 → StartedRun. */
export function toStartedRun(row: Tables<"ingest_runs">): StartedRun {
  return {
    runId: row.id,
    status: statusOf(row.status),
    cursor: row.cursor,
    summary: summaryOf(row.summary),
    params: isPlainObject(row.params) ? row.params : null,
    quotaUsed: countOf(row.quota_used),
  };
}

/** checkpoint·finish 의 quotaUsed → ingest_runs.quota_used. 주지 않은 run(fixture)은 열을 건드리지 않는다. */
export const toQuotaUsedUpdate = (
  quotaUsed: number | undefined,
): Pick<TablesInsert<"ingest_runs">, "quota_used"> =>
  quotaUsed === undefined ? {} : { quota_used: countOf(quotaUsed) };

/**
 * NormalizedBid.structuredQualifications → bid_structured_requirements 행(04 §3, 15 §3 B13).
 * seq 는 배열 index(0부터)다. 수집이 kind 순으로 안정 정렬해 두므로 같은 입력이면 같은 seq 다.
 */
export const toStructuredRequirementInserts = (
  ids: { bidId: string; revisionId: string },
  rows: readonly StructuredRequirement[],
): TablesInsert<"bid_structured_requirements">[] =>
  rows.map((row, index) => ({
    bid_id: ids.bidId,
    revision_id: ids.revisionId,
    kind: row.kind,
    seq: index,
    code: row.code,
    name: row.name,
    value: jsonCopy(row.value),
    source_operation: row.sourceOperation,
  }));

const EMPTY_SUMMARY: IngestSummary = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

/** startRun 이 새로 넣는 ingest_runs 행. 상태는 RUNNING, 집계는 0 에서 시작한다. */
export function toIngestRunInsert(input: StartRunInput): TablesInsert<"ingest_runs"> {
  return {
    source: input.source,
    run_mode: input.runMode,
    job_key: input.jobKey,
    trigger: input.trigger,
    batch: input.batch,
    params: input.params === null ? null : jsonCopy(input.params),
    requested_by: input.requestedBy ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    status: "RUNNING",
    summary: jsonCopy(EMPTY_SUMMARY),
  };
}

export const toSummaryJson = (summary: IngestSummary): Json => jsonCopy(summary);

export const toIngestErrorInsert = (
  runId: string,
  error: IngestErrorInput,
): TablesInsert<"ingest_errors"> => ({
  ingest_run_id: runId,
  source_key: error.sourceKey,
  error_code: error.errorCode,
  result_code: error.resultCode,
  redacted_detail: error.redactedDetail,
});

const isoInstantSchema = z.iso.datetime({ offset: true });

const isoInstantOf = (value: unknown): Date | null =>
  typeof value === "string" && isoInstantSchema.safeParse(value).success
    ? new Date(Date.parse(value))
    : null;

/** SEED run 의 params.anchor(5-B). ISO 시각이 아니면 null 이다. */
export const anchorOfParams = (params: Json | null): Date | null =>
  isPlainObject(params) ? isoInstantOf(params.anchor) : null;

/** g2b run 의 params.window.to(6-2). ISO 시각이 아니면 null 이다. */
export const windowEndOfParams = (params: Json | null): Date | null => {
  const window = isPlainObject(params) ? params.window : null;
  return isPlainObject(window) ? isoInstantOf(window.to) : null;
};

/** 수동 수집 감사 한 줄(6-6). 조직 소유 감사라 org_id 가 있어야 한다. */
export const toManualAuditInsert = (input: {
  orgId: string;
  actorId: string | null;
  runId: string;
}): TablesInsert<"audit_logs"> => ({
  org_id: input.orgId,
  actor_id: input.actorId,
  action: "INGEST_MANUAL",
  target_type: "ingest_run",
  target_id: input.runId,
  before_after: {},
});

const RPC_ERROR_CODE = /^INGEST_[A-Z_]+$/;

/**
 * DB 오류 → 기록할 수 있는 코드. RPC 의 거절은 메시지가 곧 코드(INGEST_BID_EXISTS 등)이고, 그 밖은 SQLSTATE 만 쓴다.
 * 메시지·details 는 행 값을 담을 수 있어 싣지 않는다.
 */
export const dbErrorCodeOf = (error: { code?: string; message?: string }): string => {
  const message = error.message?.trim() ?? "";
  if (RPC_ERROR_CODE.test(message)) return message;
  return typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
};
