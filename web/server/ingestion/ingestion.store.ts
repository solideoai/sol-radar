import "server-only";
import type { Json, Tables } from "@/lib/database.types";
import type {
  IngestRunStatus,
  IngestSummary,
  SaveRevisionInput,
  StartedRun,
} from "./ingestion.repo";
import { normalizedBidSchema } from "./normalized-bid.model";
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
  };
}
