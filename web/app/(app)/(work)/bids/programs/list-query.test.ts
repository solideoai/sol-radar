import { describe, expect, it } from "vitest";
import { PROGRAM_NOTICE_SOURCE_LABELS } from "@/server/program-notices";
import { listQueryOf } from "./list-query";
import { SOURCE_LABEL } from "./programs-copy";

describe("listQueryOf", () => {
  it("쿼리가 없으면 두 출처·검색어 없음·마감 빠른 순·마감 지난 공고 숨김이고 기본 조건이다", () => {
    const { query, search, isDefault } = listQueryOf({});
    expect(query).toEqual({ source: null, q: null, sort: "deadline", includeClosed: false });
    expect(search).toBe("");
    expect(isDefault).toBe(true);
  });

  it("아는 키는 남기고 모르는 키는 버린다", () => {
    const { query, search, isDefault } = listQueryOf({
      source: "mss",
      q: "중소",
      sort: "published",
      includeClosed: "true",
      utm: "x",
      cursor: "abc",
    });
    expect(query).toEqual({ source: "mss", q: "중소", sort: "published", includeClosed: true });
    expect(search).toBe(
      `source=mss&q=${encodeURIComponent("중소")}&sort=published&includeClosed=true`,
    );
    expect(isDefault).toBe(false);
  });

  it("잘못된 값은 그 키만 버리고 나머지 조건으로 읽는다(오류 화면을 내지 않는다)", () => {
    const { query, search } = listQueryOf({
      source: "foo",
      sort: "x",
      includeClosed: "1",
      q: "기관",
    });
    expect(query).toEqual({ source: null, q: "기관", sort: "deadline", includeClosed: false });
    expect(search).toBe(`q=${encodeURIComponent("기관")}`);
  });

  it("반복된 키는 그 키만 버린다", () => {
    const { query, search } = listQueryOf({ source: ["mss", "bizinfo"], sort: "published" });
    expect(query.source).toBeNull();
    expect(query.sort).toBe("published");
    expect(search).toBe("sort=published");
  });

  it("50자를 넘는 검색어는 버린다", () => {
    const { query, search } = listQueryOf({ q: "가".repeat(51), source: "bizinfo" });
    expect(query.q).toBeNull();
    expect(query.source).toBe("bizinfo");
    expect(search).toBe("source=bizinfo");
  });

  it("정렬만 바꾼 조건과 공백뿐인 검색어는 기본 조건으로 본다(빈 상태 판정)", () => {
    expect(listQueryOf({ sort: "published" }).isDefault).toBe(true);
    expect(listQueryOf({ q: "   " }).isDefault).toBe(true);
    expect(listQueryOf({ includeClosed: "false" }).isDefault).toBe(true);
    expect(listQueryOf({ includeClosed: "true" }).isDefault).toBe(false);
    expect(listQueryOf({ source: "bizinfo" }).isDefault).toBe(false);
    expect(listQueryOf({ q: "중소벤처기업부" }).isDefault).toBe(false);
  });
});

describe("programs-copy", () => {
  it("출처 배지 글자는 서버 도메인의 출처 이름과 같다", () => {
    expect(SOURCE_LABEL).toEqual(PROGRAM_NOTICE_SOURCE_LABELS);
  });
});
