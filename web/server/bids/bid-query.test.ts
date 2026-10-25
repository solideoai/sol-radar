import { describe, expect, it } from "vitest";
import { defaultOrigin, parseBidListQuery, parseOriginQuery } from "./bid-query";

// 화면의 기본 출처는 SOL_DEFAULT_ORIGIN 이 맞는 값일 때만 그 값을 쓰고, 아니면 실행 모드로 정한다(10-25 계획 D2).
describe("기본 출처", () => {
  it("SOL_DEFAULT_ORIGIN 이 없으면 실행 모드로 정한다(mock·fixture → demo, live → live)", () => {
    expect(defaultOrigin("mock")).toBe("demo");
    expect(defaultOrigin("fixture", undefined)).toBe("demo");
    expect(defaultOrigin("live", null)).toBe("live");
  });

  it.each(["live", "demo", "all"] as const)(
    "SOL_DEFAULT_ORIGIN=%s 이면 실행 모드와 상관없이 그 값이다",
    (value) => {
      expect(defaultOrigin("mock", value)).toBe(value);
      expect(defaultOrigin("live", ` ${value} `)).toBe(value);
    },
  );

  it.each(["", "   ", "LIVE", "bogus", "mock"])(
    "잘못된 값(%j)은 버리고 실행 모드로 정한다",
    (value) => {
      expect(defaultOrigin("mock", value)).toBe("demo");
      expect(defaultOrigin("live", value)).toBe("live");
    },
  );

  it("목록·대시보드 쿼리는 origin 이 없을 때 넘겨받은 기본 출처를 쓴다", () => {
    const list = parseBidListQuery({}, "all");
    expect(list.ok && list.value.origin).toBe("all");
    const explicit = parseBidListQuery({ origin: "demo" }, "live");
    expect(explicit.ok && explicit.value.origin).toBe("demo");
    const summary = parseOriginQuery({}, "live");
    expect(summary.ok && summary.value.origin).toBe("live");
  });
});
