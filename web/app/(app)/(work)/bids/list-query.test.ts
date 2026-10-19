import { describe, expect, it } from "vitest";
import { listQueryOf } from "./list-query";

describe("listQueryOf", () => {
  it("쿼리가 없으면 실행 모드 기본 출처·진행 중 상태·최근 공고 순 20건이고 search 는 빈 글자다", () => {
    const { query, search } = listQueryOf({}, "mock");
    expect(query.origin).toBe("demo");
    expect(query.status).toEqual(["OPEN", "AMENDED"]);
    expect(query.sort).toBe("publishedAt:desc");
    expect(query.limit).toBe(20);
    expect(query.cursor).toBeNull();
    expect(search).toBe("");
  });

  it("필터 키는 남기고 cursor·limit·모르는 키는 버린다", () => {
    const { query, search } = listQueryOf(
      {
        recommendation: "BID",
        sort: "score:desc",
        status: ["OPEN", "AMENDED", "CANCELLED"],
        cursor: "abc",
        limit: "100",
        utm: "x",
      },
      "mock",
    );
    expect(query.recommendation).toEqual(["BID"]);
    expect(query.sort).toBe("score:desc");
    expect(query.status).toEqual(["OPEN", "AMENDED", "CANCELLED"]);
    expect(query.cursor).toBeNull();
    expect(query.limit).toBe(20);
    expect(search).toBe(
      "recommendation=BID&sort=score%3Adesc&status=OPEN&status=AMENDED&status=CANCELLED",
    );
  });

  it("잘못된 값은 그 키만 버리고 나머지 조건으로 읽는다", () => {
    const { query, search } = listQueryOf(
      { stage: "BOGUS", sort: "nope", decision: "NONE", origin: "all" },
      "live",
    );
    expect(query.stage).toEqual([]);
    expect(query.sort).toBe("publishedAt:desc");
    expect(query.decision).toEqual(["NONE"]);
    expect(query.origin).toBe("all");
    expect(search).toBe("decision=NONE&origin=all");
  });

  it("마감 범위가 뒤집혔으면 시작 값을 버린다", () => {
    const { query } = listQueryOf(
      { deadlineFrom: "2026-10-30T00:00:00Z", deadlineTo: "2026-10-20T00:00:00Z" },
      "mock",
    );
    expect(query.deadlineFrom).toBeNull();
    expect(query.deadlineTo).toBe("2026-10-20T00:00:00Z");
  });
});
