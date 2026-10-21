import "server-only";
import { z } from "zod";
import type { Json, Tables } from "@/lib/database.types";
import type { SolRole } from "@/server/organization";
import type {
  IngestRunSource,
  IngestRunStatus,
  IngestSummary,
  IngestTrigger,
} from "./ingestion.port";

// ── N8 수집 관리(05 §2 :75-77)의 순수 규칙: 입력 검증·실행 모드·행 → IngestionRun 변환·결과 모양 ──
// 저장·큐·Redis 는 모른다. 흐름은 ingestion-admin.service.ts, 사용자 세션 읽기는 ingestion-admin.repo.ts 다.

/**
 * 화면 역할이 읽을 수 있는 ingest_runs 열(20261019000019, N8 보안 점검 W1). job_key·idempotency_key·requested_by·params 는
 * 열 단위 권한이 없어 고르면 권한 오류다. 요청자는 행이 아니라 지금 조직 감사(INGEST_MANUAL)로 찾는다.
 */
export type IngestionRunRow = Pick<
  Tables<"ingest_runs">,
  | "id"
  | "source"
  | "run_mode"
  | "trigger"
  | "batch"
  | "cursor"
  | "status"
  | "summary"
  | "quota_used"
  | "started_at"
  | "finished_at"
>;
type IngestErrorRow = Tables<"ingest_errors">;

/** 실행 모드(SOL_RUN_MODE). API 는 소문자로 낸다 */
export type IngestionRunMode = "live" | "fixture" | "mock";
/** fixture 배치. API 는 소문자, 저장은 대문자(04 :282) */
export type IngestionBatch = "seed" | "live";

// ── 권한 ──

/** 수집 관리는 근무 조직 sol_role 이 ADMIN 인 사람만 한다(06 §5.8). 운영자(profiles.is_admin)라도 마찬가지다 */
export const INGESTION_ADMIN_ROLES = ["ADMIN"] as const satisfies readonly SolRole[];
export const canManageIngestion = (role: SolRole): boolean =>
  INGESTION_ADMIN_ROLES.some((allowed) => allowed === role);

// ── 입력(05 IngestionRunInput :361-366, 검증 :428) ──

// 05: g2b 수집 창은 최대 7일이다(큐 job 스키마와 같은 값).
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** window.to 가 지금보다 이만큼 넘게 미래면 받지 않는다(큐 job 스키마의 INGEST_WINDOW_FUTURE_TOLERANCE_MS 와 같다) */
export const WINDOW_FUTURE_TOLERANCE_MS = 5 * 60_000;

// 큐 job 스키마와 같이 offset 있는 ISO 시각만 받는다(날짜뿐인 값은 큐에서 거절된다).
const isoInstantSchema = z.iso.datetime({ offset: true });

const windowSchema = z.strictObject({ from: isoInstantSchema, to: isoInstantSchema }).refine(
  ({ from, to }) => {
    const length = Date.parse(to) - Date.parse(from);
    return length > 0 && length <= MAX_WINDOW_MS;
  },
  { error: "window 는 from < to 이고 7일 이하여야 합니다" },
);

const STORED_BATCH = { seed: "SEED", live: "LIVE" } as const;

// fixture 는 batch 필수·window·stages 금지, g2b 는 batch 금지. strict 객체라 반대쪽 키는 모르는 키로 거절된다.
// stages 는 지금 수집하는 단계가 공고뿐이라 생략과 ["NOTICE"] 만 받는다(e8 판정 1). 큐에는 싣지 않는다.
export const ingestionRunInputSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("fixture"),
    batch: z.enum(["seed", "live"]).transform((batch) => STORED_BATCH[batch]),
  }),
  z.strictObject({
    source: z.literal("g2b"),
    window: windowSchema.optional(),
    stages: z
      .tuple([z.literal("NOTICE")], { error: 'stages 는 ["NOTICE"] 만 받습니다' })
      .optional(),
  }),
]);
export type IngestionRunInput = z.infer<typeof ingestionRunInputSchema>;

/** 05 :428·ADR-020: live 는 g2b 만, fixture·mock 은 fixture 만 받는다 */
export const acceptsSourceForMode = (
  runMode: IngestionRunMode,
  source: IngestRunSource,
): boolean => (runMode === "live" ? source === "g2b" : source === "fixture");

// ── 출력(05 IngestionRun :367-376, §6.5·6.6) ──

export type IngestionRunError = {
  sourceKey: string;
  errorCode: string;
  resultCode: string | null;
  detail: string;
};
/** 요청자. 지금 조직(ctx.orgId)의 구성원일 때만 싣는다 */
export type IngestionRunRequester = { id: string; name: string };

export type IngestionRunView = {
  id: string;
  source: IngestRunSource;
  runMode: IngestionRunMode;
  batch: IngestionBatch | null;
  trigger: IngestTrigger;
  status: IngestRunStatus;
  summary: IngestSummary;
  quotaUsed: number;
  errors: IngestionRunError[];
  cursor: string | null;
  requestedBy: IngestionRunRequester | null;
  startedAt: string;
  finishedAt: string | null;
};

export type IngestionRunPage = {
  items: IngestionRunView[];
  pageInfo: { cursor: string | null; nextCursor: string | null; hasNext: boolean };
};

const isPlainObject = (value: Json): value is { [key: string]: Json | undefined } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 빠진 키·숫자가 아닌 값은 0 이다. summary 는 worker 가 쓰는 jsonb 라 모양을 믿지 않는다.
function summaryOf(value: Json): IngestSummary {
  const stored = isPlainObject(value) ? value : {};
  const countOf = (key: keyof IngestSummary): number => {
    const count = stored[key];
    return typeof count === "number" && Number.isFinite(count) ? count : 0;
  };
  return {
    created: countOf("created"),
    changed: countOf("changed"),
    cancelled: countOf("cancelled"),
    skippedDuplicate: countOf("skippedDuplicate"),
    quarantined: countOf("quarantined"),
    retried: countOf("retried"),
  };
}

// 저장값 → API 값. DB check 제약(20261019000006 ingest_runs_*_check)이 막는 값만 온다.
const SOURCES = [
  ["fixture", "fixture"],
  ["g2b", "g2b"],
] as const satisfies readonly (readonly [string, IngestRunSource])[];
const RUN_MODES = [
  ["LIVE", "live"],
  ["FIXTURE", "fixture"],
  ["MOCK", "mock"],
] as const satisfies readonly (readonly [string, IngestionRunMode])[];
const BATCHES = [
  ["SEED", "seed"],
  ["LIVE", "live"],
] as const satisfies readonly (readonly [string, IngestionBatch])[];
const TRIGGERS = [
  ["SCHEDULED", "SCHEDULED"],
  ["MANUAL", "MANUAL"],
  ["DEMO", "DEMO"],
] as const satisfies readonly (readonly [string, IngestTrigger])[];
const STATUSES = [
  ["RUNNING", "RUNNING"],
  ["SUCCEEDED", "SUCCEEDED"],
  ["PARTIAL", "PARTIAL"],
  ["FAILED", "FAILED"],
] as const satisfies readonly (readonly [string, IngestRunStatus])[];

// 제약 밖 값이 닿으면 스키마와 코드가 어긋난 것이라 이어 가지 않는다(toStartedRun 과 같다). 오류에는 열 이름만 싣는다.
function apiValueOf<A>(
  pairs: readonly (readonly [string, A])[],
  stored: string,
  column: string,
): A {
  const found = pairs.find(([value]) => value === stored);
  if (found === undefined) throw new Error(`ingest_runs.${column} 가 알 수 없는 값이다`);
  return found[1];
}

const toRunError = (row: IngestErrorRow): IngestionRunError => ({
  sourceKey: row.source_key,
  errorCode: row.error_code,
  resultCode: row.result_code,
  detail: row.redacted_detail,
});

/**
 * ingest_runs 행 → IngestionRun. errors 는 이 run 의 ingest_errors 행(순서 그대로),
 * requester 는 요청자가 지금 조직 구성원일 때만 준다. null 이면 요청자 id 도 싣지 않는다(e8 판정 2).
 * job_key·idempotency_key·params 는 내보내지 않는다(행에도 없다).
 */
export function toIngestionRunView(
  row: IngestionRunRow,
  errors: readonly IngestErrorRow[],
  requester: IngestionRunRequester | null,
): IngestionRunView {
  return {
    id: row.id,
    source: apiValueOf(SOURCES, row.source, "source"),
    runMode: apiValueOf(RUN_MODES, row.run_mode, "run_mode"),
    batch: row.batch === null ? null : apiValueOf(BATCHES, row.batch, "batch"),
    trigger: apiValueOf(TRIGGERS, row.trigger, "trigger"),
    status: apiValueOf(STATUSES, row.status, "status"),
    summary: summaryOf(row.summary),
    quotaUsed: row.quota_used,
    errors: errors.map(toRunError),
    cursor: row.cursor,
    requestedBy: requester,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// ── 소스별 최근 수집 카드(N8 디자인 스펙 §4.4, D3). 공개 API 없이 화면 서버 컴포넌트가 읽는다 ──

/** 카드를 읽는 소스. 화면도 이 순서(데모 데이터 → 나라장터)로 그린다 */
export const INGESTION_CARD_SOURCES = [
  "fixture",
  "g2b",
] as const satisfies readonly IngestRunSource[];
/** "마지막 성공"으로 치는 상태. 부분 완료(격리 있음)도 적재를 끝낸 run 이다 */
export const INGESTION_SUCCESS_STATUSES = [
  "SUCCEEDED",
  "PARTIAL",
] as const satisfies readonly IngestRunStatus[];
/** "마지막 실패"로 치는 상태 */
export const INGESTION_FAILURE_STATUSES = ["FAILED"] as const satisfies readonly IngestRunStatus[];

type IngestionSuccessStatus = (typeof INGESTION_SUCCESS_STATUSES)[number];

/** 마지막 성공 run. 적재·격리 숫자는 이 run 의 summary 다 */
export type IngestionSourceSuccess = {
  runId: string;
  status: IngestionSuccessStatus;
  finishedAt: string;
  created: number;
  changed: number;
  quarantined: number;
};
/** 마지막 실패 run. 중단 원인 고르기는 상태 줄과 같은 화면 쪽 오류 분류가 맡는다(분류 규칙을 두 곳에 두지 않는다) */
export type IngestionSourceFailure = {
  runId: string;
  finishedAt: string;
  /** 이 run 의 오류(저장 순서 그대로) */
  errors: IngestionRunError[];
};
export type IngestionSourceCard = {
  source: IngestRunSource;
  lastSuccess: IngestionSourceSuccess | null;
  lastFailure: IngestionSourceFailure | null;
};

const hasStatus = <S extends IngestRunStatus>(
  view: IngestionRunView,
  statuses: readonly S[],
): view is IngestionRunView & { status: S } => statuses.some((status) => status === view.status);

// 저장이 고른 행이 이 카드의 소스·상태가 아니면 읽기와 규칙이 어긋난 것이라 이어 가지 않는다(apiValueOf 와 같다).
function cardRunOf<S extends IngestRunStatus>(
  source: IngestRunSource,
  row: IngestionRunRow,
  statuses: readonly S[],
): IngestionRunView & { status: S } {
  const view = toIngestionRunView(row, [], null);
  if (view.source !== source || !hasStatus(view, statuses)) {
    throw new Error("ingest_runs 카드 행의 소스·상태가 요청과 맞지 않다");
  }
  return view;
}

// 끝난 run 은 finished_at 이 있어야 하지만 DB 제약이 없다. 비어 있으면 지어내지 않고 시작 시각을 보인다.
const finishedAtOf = (view: IngestionRunView): string => view.finishedAt ?? view.startedAt;

/**
 * 소스 하나의 카드. success·failure 는 그 소스의 최신 SUCCEEDED·PARTIAL run 과 최신 FAILED run 이고,
 * errors 는 실패 run 들의 ingest_errors 행(다른 run 것이 섞여 와도 이 카드의 실패 run 것만 고른다)이다.
 */
export function toIngestionSourceCard(
  source: IngestRunSource,
  latest: { success: IngestionRunRow | null; failure: IngestionRunRow | null },
  errors: readonly IngestErrorRow[],
): IngestionSourceCard {
  const success =
    latest.success === null ? null : cardRunOf(source, latest.success, INGESTION_SUCCESS_STATUSES);
  const failure =
    latest.failure === null ? null : cardRunOf(source, latest.failure, INGESTION_FAILURE_STATUSES);
  return {
    source,
    lastSuccess:
      success === null
        ? null
        : {
            runId: success.id,
            status: success.status,
            finishedAt: finishedAtOf(success),
            created: success.summary.created,
            changed: success.summary.changed,
            quarantined: success.summary.quarantined,
          },
    lastFailure:
      failure === null
        ? null
        : {
            runId: failure.id,
            finishedAt: finishedAtOf(failure),
            errors: errors.filter((error) => error.ingest_run_id === failure.id).map(toRunError),
          },
  };
}

// ── 서비스 결과(bids ServiceResult 와 같은 모양. Route Handler 가 serviceResponse 로 HTTP 봉투에 옮긴다) ──

export type IngestionAdminErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RUN_MODE_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INGESTION_IN_PROGRESS"
  | "RATE_LIMITED"
  | "INVALID_CURSOR"
  | "SERVICE_UNAVAILABLE";

export type IngestionAdminResult<T> =
  | { ok: true; status: 200 | 202; data: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 429 | 503;
      code: IngestionAdminErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };
export type IngestionAdminFailure = Extract<IngestionAdminResult<never>, { ok: false }>;

export function ingestionFailure(
  status: IngestionAdminFailure["status"],
  code: IngestionAdminErrorCode,
  message: string,
  details?: Record<string, unknown>,
): IngestionAdminFailure {
  return details === undefined
    ? { ok: false, status, code, message }
    : { ok: false, status, code, message, details };
}
