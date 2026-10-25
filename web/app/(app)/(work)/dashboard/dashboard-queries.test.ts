import { describe, expect, it } from "vitest";
import { dashboardOriginOf, dashboardQueries } from "./dashboard-queries";

// 발표 북마크(/dashboard?origin=demo)용. 값이 없거나 틀리면 화면 기본 출처를 쓰고 오류로 막지 않는다.
describe("대시보드 origin 파라미터", () => {
  it.each(["live", "demo", "all"] as const)("?origin=%s 는 그 출처다", (origin) => {
    expect(dashboardOriginOf(origin, "live")).toBe(origin);
  });

  it.each([undefined, "", "bogus", ["demo", "live"]])(
    "없거나 잘못된 값(%j)은 기본 출처를 쓴다",
    (value) => {
      expect(dashboardOriginOf(value, "live")).toBe("live");
      expect(dashboardOriginOf(value, "demo")).toBe("demo");
    },
  );

  it("목록 두 개(우선 검토·예정 사업)는 고른 출처로 읽는다", () => {
    const queries = dashboardQueries(new Date("2026-10-25T00:00:00.000Z"), "all");
    expect(queries.review.origin).toBe("all");
    expect(queries.early.origin).toBe("all");
  });
});
