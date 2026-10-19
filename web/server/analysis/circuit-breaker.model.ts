import "server-only";

// ── circuit breaker 상태 전이: 연속 실패 3회면 열고, 15초 뒤 시험 요청 하나를 보낸다 (02 장애 원칙) ──
// 시각은 인자로 받는다. 상태는 부르는 쪽(클라이언트 인스턴스)이 들고 있고, 여기서는 바꾸지 않고 새 값을 돌려준다.

export const BREAKER_FAILURE_THRESHOLD = 3;
export const BREAKER_OPEN_MS = 15_000;

export type BreakerState =
  | { kind: "CLOSED"; failures: number }
  | { kind: "OPEN"; openedAt: number }
  // 시험 요청 하나가 나가 있다.
  | { kind: "HALF_OPEN" };

export const INITIAL_BREAKER: BreakerState = { kind: "CLOSED", failures: 0 };

/** 요청을 보내도 되는가. OPEN 에서 15초가 지났으면 이번 요청을 시험 요청으로 보내고 HALF_OPEN 으로 간다. */
export function admit(state: BreakerState, now: number): { allowed: boolean; state: BreakerState } {
  if (state.kind === "CLOSED") return { allowed: true, state };
  if (state.kind === "OPEN" && now - state.openedAt >= BREAKER_OPEN_MS) {
    return { allowed: true, state: { kind: "HALF_OPEN" } };
  }
  // OPEN 이고 15초 전이거나, HALF_OPEN 이라 시험 요청이 이미 나가 있다.
  return { allowed: false, state };
}

/** 호출 하나(재시도 포함 전체)가 끝난 뒤 결과를 반영한다. 시도(attempt) 단위로 세지 않는다. */
export function record(
  state: BreakerState,
  outcome: "success" | "failure",
  now: number,
): BreakerState {
  if (outcome === "success") return { kind: "CLOSED", failures: 0 };
  if (state.kind !== "CLOSED") return { kind: "OPEN", openedAt: now };
  const failures = state.failures + 1;
  return failures >= BREAKER_FAILURE_THRESHOLD
    ? { kind: "OPEN", openedAt: now }
    : { kind: "CLOSED", failures };
}
