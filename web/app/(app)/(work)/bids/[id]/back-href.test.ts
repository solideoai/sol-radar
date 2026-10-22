import { describe, expect, it } from "vitest";
import { backHrefOf } from "./back-href";

describe("공공조달 목록 복귀", () => {
  it("출처와 early 조건을 유지한 목록으로 돌아간다", () => {
    const query = new URLSearchParams({
      sourceFamily: "LH",
      category: "AI_AX",
      includeEarly: "true",
      stage: "PRE_SPEC",
      siAiFirst: "false",
      sort: "score:desc",
    }).toString();

    expect(backHrefOf(query, "live")).toBe(`/bids?${query}`);
  });

  it("지원하지 않는 수집 출처는 복귀 조건으로 신뢰하지 않는다", () => {
    expect(backHrefOf("sourceFamily=unknown-provider", "live")).toBe("/bids");
  });
});

it("관심 목록의 공공조달 필터를 유지해 돌아간다", () => {
  expect(backHrefOf("watched=me&sourceFamily=LH&category=AI_AX&cursor=old", "live")).toBe(
    "/watchlist?sourceFamily=LH&category=AI_AX",
  );
});
