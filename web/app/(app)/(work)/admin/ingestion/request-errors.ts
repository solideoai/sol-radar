import type { ApiFailure } from "@/app/(app)/(work)/bids/[id]/api-envelope";
import type { RunMode } from "@/server/bids";
import { isUuid } from "./ingest-runs";
import {
  IN_PROGRESS_NOTICE,
  SCHEDULER_INACTIVE_NOTICE,
  SESSION_EXPIRED,
  sourceBlockText,
  sourceLabel,
  type IngestSource,
} from "./ingestion-copy";
import { dailyLimitText, joinNotice, nextAvailableText, sharedRunText } from "./manual-gate";

// 수동 수집 요청(POST) 실패 → 대화상자·[지금 불러오기] 곁 오류(N8 스펙 §4.11, 10-26 manual-gate). 서버 message 는 보이지 않는다(영어·내부 표현일 수 있다).
// 멱등 키: 같은 제출을 다시 보내도 되는 실패(429·5xx·네트워크)는 같은 키, 내용을 바꾸거나 새로 시작해야 하는 실패는 새 키다.
// 쿨다운·공유 run·하루 한도(MANUAL_*)는 서버가 정한 시각을 그대로 보인다. 화면 시계로 다시 계산하지 않는다.

export type FormField = "source" | "batch";

export type RequestError = {
  message: string;
  requestId?: string;
  /** 문단 옆 단추. show-run 은 runId 의 서랍을 연다. */
  action?: { kind: "refresh" } | { kind: "login" } | { kind: "show-run"; runId: string };
  fieldErrors?: Partial<Record<FormField, string>>;
  /** 429: 이 초 동안 [수집 실행]을 막는다. */
  retryAfterSec?: number;
  /** 다음 제출에 새 Idempotency-Key 를 쓸지. */
  renewKey: boolean;
};

const DEFAULT_RETRY_AFTER_SEC = 60;
const FIELD_NAME = { source: "소스", batch: "배치" } as const satisfies Record<FormField, string>;
const RETRY_LATER = "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.";
const TRY_AGAIN = "잠시 뒤 다시 시도하세요.";
const UNAVAILABLE: ReadonlyMap<string, string> = new Map([
  ["queue", "수집 작업을 대기열에 넣지 못했습니다. Redis·worker 상태를 확인하세요."],
  ["redis", "요청 수를 확인하지 못했습니다. Redis 상태를 확인하세요."],
  ["db", "데이터베이스에 연결하지 못했습니다."],
  // Vercel 웹이 회사 redis-api 로 중계하지 못했다(ADR-045·049).
  ["redis-api", "회사 수집 서버에 연결하지 못했습니다."],
]);

const isoOf = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
const positiveIntOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const isFormField = (value: string): value is FormField => value === "source" || value === "batch";

// details.issues[].path 는 "batch"·"window.from" 같은 글자이거나 ["window","from"] 같은 배열이다.
function issuePaths(details: Record<string, unknown>): string[] {
  const { issues } = details;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null || !("path" in issue)) return [];
    const { path } = issue;
    if (typeof path === "string") return path === "" ? [] : [path];
    if (Array.isArray(path)) return path.length === 0 ? [] : [path.map(String).join(".")];
    return [];
  });
}

function validationError(failure: ApiFailure): RequestError {
  const paths = [...new Set(issuePaths(failure.details))];
  const fieldErrors: Partial<Record<FormField, string>> = {};
  const unknown: string[] = [];
  for (const path of paths) {
    const head = path.split(".")[0] ?? path;
    if (isFormField(head)) fieldErrors[head] = `${FIELD_NAME[head]}를 다시 고르세요.`;
    else unknown.push(path);
  }
  const base = "입력값이 올바르지 않습니다.";
  return {
    message: unknown.length === 0 ? base : `${base} 확인할 항목: ${unknown.join(", ")}`,
    fieldErrors,
    renewKey: true,
  };
}

const sourceOf = (value: unknown, fallback: IngestSource): IngestSource =>
  value === "fixture" || value === "g2b" ? value : fallback;
const runModeOf = (value: unknown, fallback: RunMode): RunMode =>
  value === "live" || value === "fixture" || value === "mock" ? value : fallback;

/**
 * 실패 하나를 대화상자 문구로 바꾼다. submitted 는 보낸 소스, runMode 는 화면이 아는 실행 모드다
 * (서버가 details 에 값을 실어 주면 그 값을 먼저 쓴다).
 */
export function requestErrorOf(
  failure: ApiFailure,
  context: { retryAfterSec: number | null; submitted: IngestSource; runMode: RunMode; now: Date },
): RequestError {
  const withId = (error: RequestError): RequestError =>
    failure.requestId === undefined ? error : { ...error, requestId: failure.requestId };
  const { status, code, details } = failure;

  if (status === 0) return { message: failure.message, renewKey: false };
  if (status === 400) return withId(validationError(failure));
  if (status === 401)
    return withId({ message: SESSION_EXPIRED, action: { kind: "login" }, renewKey: true });
  if (status === 403)
    return withId(
      code === "CSRF_REJECTED"
        ? {
            message: "요청을 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 시도하세요.",
            action: { kind: "refresh" },
            renewKey: true,
          }
        : {
            message: "이 작업을 할 권한이 없습니다. 업무 역할이 ADMIN이어야 합니다.",
            renewKey: true,
          },
    );
  if (status === 409 && code === "RUN_MODE_MISMATCH") {
    const runMode = runModeOf(details.runMode, context.runMode);
    const source = sourceLabel(sourceOf(details.source, context.submitted));
    return withId({
      message: `지금 실행 모드(${runMode})에서는 ${source} 수집을 할 수 없습니다. 실행 모드가 바뀌었을 수 있으니 화면을 새로 고치세요.`,
      action: { kind: "refresh" },
      renewKey: true,
    });
  }
  const runId = typeof details.runId === "string" && isUuid(details.runId) ? details.runId : null;
  const showRun = runId === null ? {} : { action: { kind: "show-run" as const, runId } };
  // 정기 수집이 돌고 있을 때도 같은 코드다. 끝나면 그 결과가 목록에 반영된다.
  if (status === 409 && code === "INGESTION_IN_PROGRESS")
    return withId({ message: IN_PROGRESS_NOTICE, ...showRun, renewKey: true });
  if (status === 409 && code === "MANUAL_SHARED_RUN") {
    const requestedAt = isoOf(details.requestedAt);
    return withId({
      message: joinNotice(
        requestedAt === null
          ? "다른 관리자가 요청한 수집이 진행 중입니다"
          : sharedRunText(requestedAt, context.now),
        nextAvailableText(isoOf(details.nextAvailableAt), context.now),
      ),
      ...showRun,
      renewKey: true,
    });
  }
  if (status === 409)
    return withId({
      message:
        "같은 요청 번호로 다른 내용이 이미 접수되었습니다. 다시 실행하면 새 번호로 요청합니다.",
      renewKey: true,
    });
  if (status === 429 && code === "MANUAL_COOLDOWN") {
    const seconds = positiveIntOf(details.retryAfterSeconds) ?? context.retryAfterSec;
    return withId({
      message:
        nextAvailableText(isoOf(details.nextAvailableAt), context.now) ??
        "방금 불러오기를 요청했습니다. 잠시 뒤 다시 시도하세요.",
      ...(seconds === null ? {} : { retryAfterSec: seconds }),
      renewKey: true,
    });
  }
  if (status === 429 && code === "MANUAL_DAILY_LIMIT")
    return withId({ message: dailyLimitText(positiveIntOf(details.limit)), renewKey: true });
  if (status === 429) {
    const seconds = context.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC;
    return withId({
      message: `수집 요청이 너무 잦습니다(조직당 1분에 5회). ${seconds}초 뒤 다시 시도하세요.`,
      retryAfterSec: seconds,
      renewKey: false,
    });
  }
  if (status === 503) {
    const component = typeof details.component === "string" ? details.component : "";
    // 수집 worker(정기 수집 일정)가 아직 켜지지 않았다. 다시 눌러도 같으므로 시각·재시도 안내를 두지 않는다.
    if (component === "ingest-worker" && details.reason === "SCHEDULER_INACTIVE")
      return withId({ message: SCHEDULER_INACTIVE_NOTICE, renewKey: true });
    // 외부 서비스를 아직 부를 수 없다(registry 사유·Worker 상태). 다시 눌러도 같다.
    if (component === "source")
      return withId({
        message: `${sourceBlockText(details.reason)} · 이 서비스는 지금 수집할 수 없습니다`,
        renewKey: true,
      });
    const cause = UNAVAILABLE.get(component);
    return withId({
      message: cause === undefined ? RETRY_LATER : `${cause} ${TRY_AGAIN}`,
      renewKey: false,
    });
  }
  return withId({ message: RETRY_LATER, renewKey: status < 500 });
}
