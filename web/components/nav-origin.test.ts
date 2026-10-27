import { describe, expect, it } from "vitest";
import { navHrefOf, nextNavOrigin } from "./nav-origin";

// 발표 북마크 /dashboard?origin=demo 에서 사이드바로 옮겨 가도 DEMO 출처가 이어지는지(공고 상세를 거쳐도).
describe("사이드바 출처 이어 가기", () => {
  it("출처를 읽는 화면의 주소 출처를 기억하고, 상세 같은 다른 화면에서는 그대로 둔다", () => {
    expect(nextNavOrigin("/dashboard", "demo", null)).toBe("demo");
    expect(nextNavOrigin("/bids/123", null, "demo")).toBe("demo");
    expect(nextNavOrigin("/bids", null, "demo")).toBeNull();
    expect(nextNavOrigin("/watchlist", "DEMO", "demo")).toBeNull();
  });

  it("기억한 출처가 기본 출처와 다를 때만 출처를 읽는 화면 링크에 붙인다", () => {
    expect(navHrefOf("/bids", "demo", "live")).toBe("/bids?origin=demo");
    expect(navHrefOf("/dashboard", "all", "live")).toBe("/dashboard?origin=all");
    expect(navHrefOf("/bids", "live", "live")).toBe("/bids");
    expect(navHrefOf("/bids", null, "live")).toBe("/bids");
    expect(navHrefOf("/projects", "demo", "live")).toBe("/projects");
  });
});
