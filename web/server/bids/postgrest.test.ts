import "server-only";
import { describe, expect, it } from "vitest";
import { keysetFilter, likePattern, quoteValue, uniqueViolation } from "./postgrest";
import { topLevelParts, unquote } from "./supabase-fake.test-data";

const after = (sortValue: string | number | null, id: string) => ({
  sortValue,
  id,
  queryFingerprint: "fp",
});

describe("quoteValue", () => {
  it("큰따옴표로 감싸고 큰따옴표·역슬래시 앞에 역슬래시를 붙인다", () => {
    expect(quoteValue(String.raw`a"b\c`)).toBe(String.raw`"a\"b\\c"`);
  });

  it.each(["a,b)", 'x")', String.raw`\"`, "((,", "or(id.gt.0)", ""])(
    "PostgREST 가 읽으면 원래 글자 그대로다: %s",
    (value) => {
      const quoted = quoteValue(value);
      expect(unquote(quoted)).toBe(value);
      // 값 하나로 남는다: 최상위 쉼표로 나뉘지 않는다
      expect(topLevelParts(quoted)).toEqual([quoted]);
    },
  );
});

describe("likePattern", () => {
  it("LIKE 문자(\\ % _)를 이스케이프하고 앞뒤에 * 를 붙인다", () => {
    // 입력: 50%_off\  →  *50\%\_off\\*
    expect(likePattern("50%_off\\")).toBe("*50\\%\\_off\\\\*");
  });

  it("검색어의 예약 문자는 quoteValue 로 감싼 뒤에도 값 하나이고, LIKE 이스케이프가 DB 까지 남는다", () => {
    const quoted = quoteValue(likePattern('a,b)"c%'));
    // 브리프 예시 `"*a,b)\"c\%*"` 는 역슬래시가 하나 모자라다. PostgREST 는 따옴표 안의 `\%` 를 `%` 로 읽어
    // 와일드카드가 된다. 두 함수를 겹치면 `\\%` 가 되고, PostgREST 가 `\%`(글자 %)로 넘긴다.
    expect(quoted).toBe(String.raw`"*a,b)\"c\\%*"`);
    expect(unquote(quoted)).toBe(String.raw`*a,b)"c\%*`);
  });
});

describe("keysetFilter", () => {
  it("마지막 행의 정렬 값이 null 이면 null 꼬리에서 id 다음만 본다", () => {
    expect(keysetFilter("scored_score", "desc", after(null, "x"))).toBe(
      'and(scored_score.is.null,id.gt."x")',
    );
  });

  it("desc 는 lt, 같은 값은 id 다음, null 은 뒤에 붙는다", () => {
    expect(keysetFilter("scored_score", "desc", after(85, "x"))).toBe(
      'scored_score.lt."85",and(scored_score.eq."85",id.gt."x"),scored_score.is.null',
    );
  });

  it("asc 는 gt 를 쓰고 값을 따옴표로 감싼다", () => {
    const filter = keysetFilter("deadline_at", "asc", after("2026-10-20T09:00:00+00:00", "id-1"));
    expect(filter).toBe(
      'deadline_at.gt."2026-10-20T09:00:00+00:00",and(deadline_at.eq."2026-10-20T09:00:00+00:00",id.gt."id-1"),deadline_at.is.null',
    );
    expect(topLevelParts(filter)).toHaveLength(3);
  });

  it("커서 id 에 예약 문자가 있어도 조건 수가 바뀌지 않는다", () => {
    const filter = keysetFilter("published_at", "desc", after("v", 'x"),id.gt.(0'));
    expect(topLevelParts(filter)).toHaveLength(3);
  });
});

describe("uniqueViolation", () => {
  it("23505 + active 입력 인덱스 이름이면 ACTIVE_INPUT", () => {
    expect(
      uniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "score_runs_active_input_key"',
      }),
    ).toBe("ACTIVE_INPUT");
  });

  it("23505 + 멱등 키 제약 이름이면 IDEMPOTENCY_KEY", () => {
    expect(
      uniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "score_runs_idempotency_key_key"',
      }),
    ).toBe("IDEMPOTENCY_KEY");
  });

  it("다른 오류 코드·다른 제약·빈 값은 null", () => {
    expect(
      uniqueViolation({ code: "23503", message: '… "score_runs_active_input_key"' }),
    ).toBeNull();
    expect(uniqueViolation({ code: "23505", message: '… "bid_reviews_pkey"' })).toBeNull();
    expect(uniqueViolation({})).toBeNull();
  });
});
