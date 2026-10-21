import { describe, expect, it } from "vitest";
import { listQueryOf } from "@/app/(app)/(work)/bids/list-query";
import { watchlistEmptyKindOf, watchlistQueryOf } from "./list-query";

// /watchlist 주소 쿼리(N3 디자인 §4.2·§10-2). 조건은 /bids 와 같은 규칙으로 읽고(Q3 ①) watched=me 만 고정으로 더한다.
// search 는 watched 없는 화면 조건(필터 초기화·처음부터 보기·빈 상태 판단), listSearch 는 watched=me 를 붙인 것(더 보기 API·상세 ?list=)이다.

describe("watchlistQueryOf", () => {
  it("쿼리가 없으면 /bids 기본 조건에 watched=me 만 더하고 search 는 빈 글자다", () => {
    const { query, search, listSearch } = watchlistQueryOf({}, "mock");
    const { query: bids } = listQueryOf({}, "mock");
    expect(query).toEqual({ ...bids, watched: "me" });
    expect(search).toBe("");
    expect(listSearch).toBe("watched=me");
  });

  it("필터 조건은 /bids 와 같게 읽고 listSearch 끝에 watched=me 를 붙인다", () => {
    const raw = { sort: "deadlineAt:asc", stage: "NOTICE", cursor: "abc", utm: "x" };
    const { query, search, listSearch } = watchlistQueryOf(raw, "mock");
    const bids = listQueryOf(raw, "mock");
    expect(query).toEqual({ ...bids.query, watched: "me" });
    expect(search).toBe(bids.search);
    expect(listSearch).toBe(`${bids.search}&watched=me`);
  });

  it("주소에 watched 가 와도 화면 조건에 두 번 싣지 않는다(watched 는 화면이 고정한다)", () => {
    const { query, search, listSearch } = watchlistQueryOf(
      { watched: ["me", "all"], sort: "score:desc" },
      "mock",
    );
    expect(query.watched).toBe("me");
    expect(search).toBe("sort=score%3Adesc");
    expect(listSearch).toBe("sort=score%3Adesc&watched=me");
  });

  it("마감·취소 포함(status 네 값)을 받는다(D10)", () => {
    const { query, search } = watchlistQueryOf(
      { status: ["OPEN", "AMENDED", "CANCELLED", "CLOSED"] },
      "mock",
    );
    expect(query.status).toEqual(["OPEN", "AMENDED", "CANCELLED", "CLOSED"]);
    expect(search).toBe("status=OPEN&status=AMENDED&status=CANCELLED&status=CLOSED");
  });

  it("잘못된 값은 그 키만 버리고 watched=me 는 남는다", () => {
    const { query, search, listSearch } = watchlistQueryOf(
      { sort: "nope", stage: "NOTICE" },
      "mock",
    );
    expect(query.watched).toBe("me");
    expect(query.sort).toBe("publishedAt:desc");
    expect(search).toBe("stage=NOTICE");
    expect(listSearch).toBe("stage=NOTICE&watched=me");
  });
});

describe("watchlistEmptyKindOf", () => {
  it("관심이 하나도 없으면 조건과 상관없이 none(E1)이다", () => {
    expect(watchlistEmptyKindOf(0, "")).toBe("none");
    expect(watchlistEmptyKindOf(0, "stage=NOTICE")).toBe("none");
  });

  it("관심이 있고 조건을 바꿨으면 filtered(E2), 기본 조건이면 default(E3)다", () => {
    expect(watchlistEmptyKindOf(2, "stage=NOTICE")).toBe("filtered");
    expect(watchlistEmptyKindOf(2, "")).toBe("default");
  });
});
