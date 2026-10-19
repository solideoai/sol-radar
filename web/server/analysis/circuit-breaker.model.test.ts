import { describe, expect, it } from "vitest";
import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_OPEN_MS,
  INITIAL_BREAKER,
  admit,
  record,
  type BreakerState,
} from "./circuit-breaker.model";

/** 같은 결과를 여러 번 반영한 상태. */
function recordTimes(
  state: BreakerState,
  outcome: "success" | "failure",
  times: number,
  now: number,
): BreakerState {
  return Array.from({ length: times }).reduce<BreakerState>(
    (current) => record(current, outcome, now),
    state,
  );
}

const OPENED_AT = 1_000;
const open: BreakerState = { kind: "OPEN", openedAt: OPENED_AT };
const halfOpen: BreakerState = { kind: "HALF_OPEN" };

describe("circuit breaker 상수", () => {
  it("연속 실패 3회에서 연다(02 장애 원칙)", () => {
    expect(BREAKER_FAILURE_THRESHOLD).toBe(3);
  });

  it("15초 뒤 half-open 으로 간다(02 장애 원칙)", () => {
    expect(BREAKER_OPEN_MS).toBe(15_000);
  });

  it("처음 상태는 실패 0회인 CLOSED", () => {
    expect(INITIAL_BREAKER).toEqual({ kind: "CLOSED", failures: 0 });
  });
});

describe("admit", () => {
  it("CLOSED 는 요청을 허용하고 상태를 바꾸지 않는다", () => {
    const state: BreakerState = { kind: "CLOSED", failures: 2 };
    expect(admit(state, 5_000)).toEqual({ allowed: true, state });
  });

  it("OPEN 은 15초가 지나기 전(14.999초)에는 거부하고 상태를 바꾸지 않는다", () => {
    expect(admit(open, OPENED_AT + 14_999)).toEqual({ allowed: false, state: open });
  });

  it("OPEN 은 정확히 15초가 지나면 시험 요청을 허용하고 HALF_OPEN 으로 간다", () => {
    expect(admit(open, OPENED_AT + 15_000)).toEqual({ allowed: true, state: halfOpen });
  });

  it("OPEN 은 15초보다 오래 지나도 시험 요청을 허용하고 HALF_OPEN 으로 간다", () => {
    expect(admit(open, OPENED_AT + 60_000)).toEqual({ allowed: true, state: halfOpen });
  });

  it("HALF_OPEN 은 시험 요청이 나가 있으므로 추가 요청을 거부한다", () => {
    expect(admit(halfOpen, OPENED_AT + 20_000)).toEqual({ allowed: false, state: halfOpen });
  });

  it("half-open 으로 간 뒤 같은 시각의 다음 요청은 거부한다", () => {
    const first = admit(open, OPENED_AT + 15_000);
    expect(admit(first.state, OPENED_AT + 15_000).allowed).toBe(false);
  });

  it("입력 상태를 바꾸지 않는다", () => {
    const state = Object.freeze({ kind: "OPEN", openedAt: OPENED_AT } as const);
    admit(state, OPENED_AT + 15_000);
    expect(state).toEqual({ kind: "OPEN", openedAt: OPENED_AT });
  });
});

describe("record", () => {
  it("CLOSED 에서 실패 2회는 아직 CLOSED 이고 실패 수 2", () => {
    expect(recordTimes(INITIAL_BREAKER, "failure", 2, 5_000)).toEqual({
      kind: "CLOSED",
      failures: 2,
    });
  });

  it("CLOSED 에서 연속 실패 3회째에 그 시각으로 OPEN 한다", () => {
    const afterTwo = recordTimes(INITIAL_BREAKER, "failure", 2, 4_000);
    expect(record(afterTwo, "failure", 5_000)).toEqual({ kind: "OPEN", openedAt: 5_000 });
  });

  it("CLOSED 에서 success 는 연속 실패 수를 0 으로 되돌린다", () => {
    expect(record({ kind: "CLOSED", failures: 2 }, "success", 5_000)).toEqual({
      kind: "CLOSED",
      failures: 0,
    });
  });

  it("중간에 success 가 끼면 실패 2회 + 2회로는 열리지 않는다(연속 실패만 센다)", () => {
    const twoFailures = recordTimes(INITIAL_BREAKER, "failure", 2, 5_000);
    const reset = record(twoFailures, "success", 5_000);
    expect(recordTimes(reset, "failure", 2, 5_000)).toEqual({ kind: "CLOSED", failures: 2 });
  });

  it("HALF_OPEN 에서 success 는 실패 0회인 CLOSED", () => {
    expect(record(halfOpen, "success", 20_000)).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("HALF_OPEN 에서 failure 는 새 시각으로 다시 OPEN", () => {
    expect(record(halfOpen, "failure", 20_000)).toEqual({ kind: "OPEN", openedAt: 20_000 });
  });

  it("OPEN 에서 failure 는 새 시각으로 OPEN", () => {
    expect(record(open, "failure", 9_000)).toEqual({ kind: "OPEN", openedAt: 9_000 });
  });

  it("OPEN 에서 success 는 실패 0회인 CLOSED", () => {
    expect(record(open, "success", 9_000)).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("입력 상태를 바꾸지 않는다", () => {
    const state = Object.freeze({ kind: "CLOSED", failures: 2 } as const);
    record(state, "failure", 5_000);
    expect(state).toEqual({ kind: "CLOSED", failures: 2 });
  });
});

describe("breaker 한 바퀴", () => {
  it("3회 실패로 열리고 15초 뒤 시험 요청이 성공하면 다시 닫힌다", () => {
    const opened = recordTimes(INITIAL_BREAKER, "failure", 3, OPENED_AT);
    const trial = admit(opened, OPENED_AT + 15_000);
    expect(record(trial.state, "success", OPENED_AT + 15_100)).toEqual({
      kind: "CLOSED",
      failures: 0,
    });
  });

  it("다시 열린 뒤에는 새 시각부터 15초를 다시 센다", () => {
    const reopened = record(halfOpen, "failure", 20_000);
    expect(admit(reopened, 20_000 + 14_999).allowed).toBe(false);
  });
});
