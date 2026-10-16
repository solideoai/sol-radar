import { describe, expect, it } from "vitest";
import {
  literalPattern,
  pageCountOf,
  parseSearch,
  parseStatusChange,
  parseUserListQuery,
  quoteFilterValue,
  toUserView,
  USER_PAGE_SIZE,
  USER_SEARCH_MAX_LENGTH,
  type UserRow,
  userSearchFilter,
} from "./admin.model";

const ADMIN = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const OTHER = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

const userRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: OTHER,
  email: "kim@example.com",
  display_name: "김철수",
  is_admin: false,
  status: "active",
  created_at: "2026-10-14T06:00:00.000Z",
  ...overrides,
});

// PostgREST 의 or=(…) 안 큰따옴표 값을 읽는 규칙(따옴표 안에서 \ 는 다음 글자를 그대로 둔다)을 그대로 흉내 낸다.
// 필터 글을 이 규칙으로 되읽어, 검색어가 조건 하나 안의 값으로만 남는지 본다.
const readQuotedValues = (filter: string): string[] => {
  const values: string[] = [];
  const chars = Array.from(filter);
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== '"') continue;
    let value = "";
    index += 1;
    while (chars[index] !== '"') {
      if (index >= chars.length) throw new Error("따옴표가 닫히지 않았다");
      if (chars[index] === "\\") index += 1;
      value += chars[index];
      index += 1;
    }
    values.push(value);
  }
  return values;
};

// PostgreSQL 정규식에서 \ + 문장 부호는 그 글자 하나다. 패턴을 글자로 되돌린다.
const unescapePattern = (pattern: string): string => pattern.replace(/\\(.)/gu, "$1");

describe("상수", () => {
  it("한 쪽은 20줄이고 검색어는 100자까지다", () => {
    expect(USER_PAGE_SIZE).toBe(20);
    expect(USER_SEARCH_MAX_LENGTH).toBe(100);
  });
});

describe("parseSearch", () => {
  it("앞뒤 공백을 걷고 가운데 공백은 둔다", () => {
    expect(parseSearch("  김 철수 ")).toBe("김 철수");
  });

  it("없거나 비었거나 공백뿐이면 검색하지 않는다", () => {
    expect(parseSearch(undefined)).toBeNull();
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  it("같은 이름이 여럿이면 첫 값만 본다", () => {
    expect(parseSearch(["kim", "lee"])).toBe("kim");
    expect(parseSearch([])).toBeNull();
  });

  it("제어 문자(NUL·줄바꿈·DEL)는 빼고 읽는다", () => {
    expect(parseSearch("ki\u0000m\n")).toBe("kim");
    expect(parseSearch("a\u007fb\u0085c")).toBe("abc");
    expect(parseSearch("\u0000\t")).toBeNull();
  });

  it("100자까지 받고 101자는 검색하지 않는다(화면이 보낼 수 없는 값)", () => {
    expect(parseSearch("가".repeat(USER_SEARCH_MAX_LENGTH))).toBe("가".repeat(100));
    expect(parseSearch("가".repeat(USER_SEARCH_MAX_LENGTH + 1))).toBeNull();
  });

  it("특수 글자는 그대로 둔다(이스케이프는 필터를 만들 때 한다)", () => {
    expect(parseSearch('%_*,()\\"')).toBe('%_*,()\\"');
  });
});

describe("parseUserListQuery", () => {
  it("검색어와 쪽을 읽는다", () => {
    expect(parseUserListQuery({ q: "kim", page: "3" })).toEqual({ q: "kim", page: 3 });
  });

  it("아무것도 없으면 검색 없음·1쪽이다", () => {
    expect(parseUserListQuery({})).toEqual({ q: null, page: 1 });
  });

  it("숫자가 아니거나 0·음수·소수·너무 큰 쪽은 1쪽이다", () => {
    for (const page of ["abc", "0", "-1", "1.5", "01", "1e3", "", "1234567"]) {
      expect(parseUserListQuery({ page }).page, page).toBe(1);
    }
    expect(parseUserListQuery({ page: "999999" }).page).toBe(999999);
  });

  it("쪽은 같은 이름이 여럿이면 첫 값만 본다", () => {
    expect(parseUserListQuery({ page: ["2", "5"] }).page).toBe(2);
  });

  it("검색어가 잘못되면 그 조건만 기본값이다", () => {
    expect(parseUserListQuery({ q: "   ", page: "2" })).toEqual({ q: null, page: 2 });
  });
});

describe("pageCountOf", () => {
  it("20개씩 나눠 올림하고, 없어도 1쪽이다", () => {
    expect(pageCountOf(0)).toBe(1);
    expect(pageCountOf(1)).toBe(1);
    expect(pageCountOf(20)).toBe(1);
    expect(pageCountOf(21)).toBe(2);
    expect(pageCountOf(57)).toBe(3);
  });
});

describe("검색 필터", () => {
  it("이메일과 표시 이름을 대소문자 무시 정규식(imatch)으로 함께 찾는다", () => {
    expect(userSearchFilter("kim")).toBe('email.imatch."kim",display_name.imatch."kim"');
  });

  it("한글·영숫자·공백은 이스케이프하지 않는다", () => {
    expect(literalPattern("김 철수 Kim2")).toBe("김 철수 Kim2");
  });

  it("ASCII 문장 부호는 모두 \\ 를 붙여 정규식의 글자 하나로 만든다", () => {
    const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    expect(punctuation).toHaveLength(32);
    expect(literalPattern(punctuation)).toBe(
      Array.from(punctuation, (char) => `\\${char}`).join(""),
    );
  });

  it('PostgREST 의 큰따옴표 값 안에서 " 와 \\ 앞에 \\ 를 붙인다', () => {
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  // 질의 문법이 되는 글자: or 조건을 나누는 , ( ), 연산자를 나누는 . :, ilike 의 % _ *, 따옴표·역슬래시.
  it.each([
    "%",
    "_",
    "*",
    ",",
    "(",
    ")",
    ".",
    ":",
    '"',
    "\\",
    "a,b",
    "x)",
    'k"),email.neq.("',
    "%_*",
  ])("검색어 %j 는 조건 두 개의 값으로만 들어가고, 되읽으면 글자 그대로다", (q) => {
    const filter = userSearchFilter(q);
    const values = readQuotedValues(filter);
    expect(values).toHaveLength(2);
    expect(values.map(unescapePattern)).toEqual([q, q]);
    // 따옴표 밖에는 두 조건의 이름·연산자와 그 사이 쉼표 하나만 남는다.
    expect(filter.replace(/"(?:[^"\\]|\\.)*"/gu, "")).toBe("email.imatch.,display_name.imatch.");
  });

  it("되읽은 패턴에는 \\ 없이 남은 문장 부호가 없다(정규식 연산자로 읽히는 글자가 없다)", () => {
    const [pattern] = readQuotedValues(userSearchFilter("a.b*c+(d)|[e]^$?{1}"));
    expect(pattern.replace(/\\[!-/:-@[-`{-~]/gu, "")).toMatch(/^[a-z1]+$/u);
  });
});

describe("toUserView", () => {
  it("행을 화면 모양으로 바꾸고, 가입 시각은 서울로 적는다", () => {
    expect(toUserView(userRow(), ADMIN)).toEqual({
      id: OTHER,
      email: "kim@example.com",
      displayName: "김철수",
      isAdmin: false,
      isMe: false,
      status: "active",
      canChangeStatus: true,
      joinedAt: "2026-10-14T06:00:00.000Z",
      joinedDateText: "2026. 10. 14.",
      joinedAtText: "2026. 10. 14. 오후 3:00",
    });
  });

  it("서울 자정을 넘긴 시각(UTC 로는 전날)은 서울 날짜로 적는다", () => {
    const view = toUserView(userRow({ created_at: "2026-10-14T15:30:00.000Z" }), ADMIN);
    expect(view.joinedDateText).toBe("2026. 10. 15.");
    expect(view.joinedAtText).toBe("2026. 10. 15. 오전 12:30");
  });

  it("보고 있는 운영자 자신의 줄을 표시하고, 비어 있는 이메일·표시 이름은 비운 채 둔다", () => {
    const view = toUserView(
      userRow({ id: ADMIN, email: null, display_name: null, is_admin: true }),
      ADMIN,
    );
    expect(view).toMatchObject({ isMe: true, isAdmin: true, email: null, displayName: null });
  });
});

describe("toUserView 의 상태와 정지 버튼", () => {
  it("다른 일반 회원의 줄만 상태를 바꿀 수 있다", () => {
    expect(toUserView(userRow(), ADMIN).canChangeStatus).toBe(true);
  });

  it("보고 있는 운영자 자신의 줄은 상태를 바꿀 수 없다", () => {
    expect(toUserView(userRow({ id: ADMIN, is_admin: true }), ADMIN).canChangeStatus).toBe(false);
  });

  it("다른 운영자의 줄은 상태를 바꿀 수 없다", () => {
    expect(toUserView(userRow({ is_admin: true }), ADMIN).canChangeStatus).toBe(false);
  });

  it("정지된 회원은 suspended 로 보이고, 해제할 수 있게 버튼이 남는다", () => {
    expect(toUserView(userRow({ status: "suspended" }), ADMIN)).toMatchObject({
      status: "suspended",
      canChangeStatus: true,
    });
  });

  it("DB 제약 밖의 상태가 오면 스키마와 코드가 어긋난 것이라 던진다", () => {
    expect(() => toUserView(userRow({ status: "deleted" }), ADMIN)).toThrow(
      "알 수 없는 회원 상태입니다: deleted",
    );
  });
});

describe("parseStatusChange", () => {
  it("회원 id(uuid)와 active·suspended 를 받는다", () => {
    expect(parseStatusChange(OTHER, "suspended")).toEqual({ userId: OTHER, status: "suspended" });
    expect(parseStatusChange(OTHER, "active")).toEqual({ userId: OTHER, status: "active" });
  });

  it("대문자 uuid 는 소문자로 맞춘다", () => {
    expect(parseStatusChange(OTHER.toUpperCase(), "active")?.userId).toBe(OTHER);
  });

  it("두 값이 아닌 상태는 받지 않는다", () => {
    ["deleted", "SUSPENDED", "", undefined, null, 1, ["active"]].forEach((status) =>
      expect(parseStatusChange(OTHER, status), JSON.stringify(status)).toBeNull(),
    );
  });

  it("uuid 가 아닌 id 는 받지 않는다", () => {
    ["abc", "", ` ${OTHER}`, `${OTHER}x`, OTHER.replaceAll("-", ""), undefined, null, 42].forEach(
      (userId) => expect(parseStatusChange(userId, "active"), String(userId)).toBeNull(),
    );
  });
});
