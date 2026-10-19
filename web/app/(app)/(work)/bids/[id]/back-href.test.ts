import { describe, expect, it } from "vitest";
import { backHrefOf } from "./back-href";

describe("backHrefOf", () => {
  it("목록 조건이 읽히면 그 조건으로 돌아간다", () => {
    expect(backHrefOf("sort=score%3Adesc&stage=NOTICE", "mock")).toBe(
      "/bids?sort=score%3Adesc&stage=NOTICE",
    );
    expect(backHrefOf("q=%EC%84%B8%EC%A2%85&recommendation=BID&recommendation=WATCH", "mock")).toBe(
      "/bids?q=%EC%84%B8%EC%A2%85&recommendation=BID&recommendation=WATCH",
    );
  });

  it("없거나 비었으면 기본 목록이다", () => {
    expect(backHrefOf(undefined, "mock")).toBe("/bids");
    expect(backHrefOf("", "mock")).toBe("/bids");
    expect(backHrefOf("   ", "mock")).toBe("/bids");
  });

  it("목록 조건으로 읽히지 않으면 기본 목록이다", () => {
    expect(backHrefOf("sort=bogus", "mock")).toBe("/bids");
    expect(backHrefOf("stage=NOPE", "mock")).toBe("/bids");
    expect(backHrefOf("origin=live&isDemo=true", "mock")).toBe("/bids");
  });

  it("여러 번 오면 첫 값만 쓰고, 경로는 늘 /bids 다", () => {
    expect(backHrefOf(["sort=score%3Adesc", "sort=bogus"], "mock")).toBe("/bids?sort=score%3Adesc");
    expect(backHrefOf("//evil.example/x", "mock").startsWith("/bids")).toBe(true);
  });
});
