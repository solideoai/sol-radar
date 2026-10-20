import type { ApiFailure } from "@/app/(app)/(work)/bids/[id]/api-envelope";
import type { RunMode } from "@/server/bids";
import { isUuid } from "./ingest-runs";
import { SESSION_EXPIRED, sourceLabel, type IngestSource } from "./ingestion-copy";

// 수동 수집 요청(POST) 실패 → 대화상자 안 오류(N8 스펙 §4.11). 서버 message 는 보이지 않는다(영어·내부 표현일 수 있다).
// 멱등 키: 같은 제출을 다시 보내도 되는 실패(429·5xx·네트워크)는 같은 키, 내용을 바꾸거나 새로 시작해야 하는 실패는 새 키다.

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
const UNAVAILABLE: ReadonlyMap<string, string> = new Map([
  ["queue", "수집 작업을 대기열에 넣지 못했습니다. Redis·worker 상태를 확인하세요."],
  ["redis", "요청 수를 확인하지 못했습니다. Redis 상태를 확인하세요."],
  ["db", "데이터베이스에 연결하지 못했습니다."],
]);

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
  context: { retryAfterSec: number | null; submitted: IngestSource; runMode: RunMode },
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
  if (status === 409 && code === "INGESTION_IN_PROGRESS") {
    const runId = typeof details.runId === "string" && isUuid(details.runId) ? details.runId : null;
    return withId({
      message: "같은 소스의 수집이 이미 실행 중입니다.",
      ...(runId === null ? {} : { action: { kind: "show-run" as const, runId } }),
      renewKey: true,
    });
  }
  if (status === 409)
    return withId({
      message:
        "같은 요청 번호로 다른 내용이 이미 접수되었습니다. 다시 실행하면 새 번호로 요청합니다.",
      renewKey: true,
    });
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
    return withId({
      message: UNAVAILABLE.get(component) ?? "잠시 뒤 다시 시도하세요.",
      renewKey: false,
    });
  }
  return withId({ message: RETRY_LATER, renewKey: status < 500 });
}
