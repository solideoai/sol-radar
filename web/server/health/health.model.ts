import "server-only";

// ── health 도메인 모델: 의존성 검사 결과를 응답으로 바꾸는 순수 규칙 ──
export type CheckState = "ok" | "unavailable";
export type AiState = "mock" | "local" | "hosted" | "unavailable";

export type Readiness = {
  status: "ok" | "degraded" | "unavailable";
  checks: { db: CheckState; redis: CheckState; storage: CheckState; ai: AiState };
};

/** 검사 하나에 줄 수 있는 시간(밀리초). repo 의 자원 정리와 service 의 상한이 같은 값을 쓴다. */
export const PROBE_TIMEOUT_MS = 2000;

/** AI 상태는 데모를 멈추지 않는다(PARTIAL 대체). db·redis·storage 중 하나라도 없으면 503, AI 만 없으면 200 degraded. */
export function toReadiness(checks: Readiness["checks"]): {
  httpStatus: 200 | 503;
  body: Readiness;
} {
  const coreDown =
    checks.db === "unavailable" ||
    checks.redis === "unavailable" ||
    checks.storage === "unavailable";
  if (coreDown) return { httpStatus: 503, body: { status: "unavailable", checks } };
  if (checks.ai === "unavailable") return { httpStatus: 200, body: { status: "degraded", checks } };
  return { httpStatus: 200, body: { status: "ok", checks } };
}
