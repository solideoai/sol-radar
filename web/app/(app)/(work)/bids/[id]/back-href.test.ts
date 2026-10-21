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

  it("여러 번 오면 첫 값만 쓰고, 경로는 /bids 다(관심 공고에서 왔을 때만 /watchlist)", () => {
    expect(backHrefOf(["sort=score%3Adesc", "sort=bogus"], "mock")).toBe("/bids?sort=score%3Adesc");
    expect(backHrefOf("//evil.example/x", "mock").startsWith("/bids")).toBe(true);
  });

  // N3 D14: 관심 공고 목록은 상세 링크의 list 에 watched=me 를 싣는다. 그 조건이면 /watchlist 로 돌아가고 watched 는 뺀다.
  it("watched=me 가 있으면 나머지 조건으로 /watchlist 에 돌아간다", () => {
    expect(backHrefOf("watched=me", "mock")).toBe("/watchlist");
    expect(backHrefOf("sort=deadlineAt%3Aasc&watched=me&stage=NOTICE", "mock")).toBe(
      "/watchlist?sort=deadlineAt%3Aasc&stage=NOTICE",
    );
    expect(backHrefOf("watched=all", "mock")).toBe("/bids");
    expect(backHrefOf("watched=me&sort=bogus", "mock")).toBe("/bids");
  });
});
