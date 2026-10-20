import { describe, expect, it } from "vitest";
import { dashboardQueries } from "./dashboard-queries";

const NOW = new Date("2026-10-19T00:00:00Z");

describe("dashboardQueries", () => {
  it("BID 표는 권고 BID·점수 높은 순 5건, 마감 표는 지금부터 7일·마감 빠른 순 5건이다", () => {
    const { bid, deadline } = dashboardQueries(NOW, "mock");
    expect(bid.recommendation).toEqual(["BID"]);
    expect(bid.sort).toBe("score:desc");
    expect(bid.limit).toBe(5);
    expect(bid.deadlineFrom).toBeNull();
    expect(bid.deadlineTo).toBeNull();
    expect(deadline.deadlineFrom).toBe("2026-10-19T00:00:00.000Z");
    expect(deadline.deadlineTo).toBe("2026-10-26T00:00:00.000Z");
    expect(deadline.sort).toBe("deadlineAt:asc");
    expect(deadline.limit).toBe(5);
    expect(deadline.recommendation).toEqual([]);
  });

  it("두 표 모두 진행 중 공고(OPEN·AMENDED)만 보고 커서 없이 첫 쪽을 읽는다", () => {
    const { bid, deadline } = dashboardQueries(NOW, "mock");
    for (const query of [bid, deadline]) {
      expect(query.status).toEqual(["OPEN", "AMENDED"]);
      expect(query.cursor).toBeNull();
      expect(query.q).toBeNull();
      expect(query.stage).toEqual([]);
      expect(query.decision).toEqual([]);
    }
  });

  it.each([
    ["mock", "demo"],
    ["fixture", "demo"],
    ["live", "live"],
  ] as const)("실행 모드 %s 면 두 쿼리의 출처가 %s 다", (runMode, origin) => {
    const { bid, deadline } = dashboardQueries(NOW, runMode);
    expect(bid.origin).toBe(origin);
    expect(deadline.origin).toBe(origin);
  });

  it("인자로 받은 시각을 바꾸지 않는다", () => {
    const now = new Date(NOW);
    dashboardQueries(now, "mock");
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});
