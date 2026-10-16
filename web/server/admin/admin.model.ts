import "server-only";
import type { Tables } from "@/lib/database.types";

// ── 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 관리자 화면은 서비스 운영자(profiles.is_admin)만 연다. 하는 일은 사용자 목록 보기와 정지·해제뿐이다.
// 운영자도 남의 조직·작업은 읽지 못한다.

export const USER_PAGE_SIZE = 20;

// UTF-16 단위(입력칸의 maxLength 와 같은 셈). 화면의 입력칸도 같은 값으로 막는다.
export const USER_SEARCH_MAX_LENGTH = 100;

export type UserRow = Pick<
  Tables<"profiles">,
  "id" | "email" | "display_name" | "is_admin" | "status" | "created_at"
>;

// DB 제약 profiles_status_check 와 같은 두 값.
const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type UserView = {
  id: string;
  // 가입 정보(auth.users)를 비춘 값이라 비어 있을 수 있다.
  email: string | null;
  // 관리자 화면은 이메일 앞부분으로 채우지 않고 비어 있다고 보여 준다.
  displayName: string | null;
  isAdmin: boolean;
  isMe: boolean;
  status: UserStatus;
  // 자기 자신과 다른 운영자는 정지하지 못한다(DB 함수도 거절한다). 화면은 그 줄에 버튼을 두지 않는다.
  canChangeStatus: boolean;
  joinedAt: string;
  joinedDateText: string;
  joinedAtText: string;
};

// q 는 이메일·표시 이름의 부분 일치(대소문자 무시)이고, 없으면 null 이다.
export type UserListQuery = { q: string | null; page: number };

export type UserListPage = {
  rows: UserView[];
  // 지금 조건에 맞는 사용자 수(모든 쪽).
  total: number;
  // 실제로 보인 쪽. 요청한 쪽이 범위를 넘었으면 1 이다.
  page: number;
  // 사용자가 없어도 1 이다.
  pageCount: number;
  pageSize: number;
  // 잘못된 값은 기본값(null)으로 바꾼 검색어.
  q: string | null;
};

// 운영자가 아니면(forbidden) 로그인 전·DB 없음과 함께 화면이 404 로 그린다 — 관리자 화면이 있는지 알리지 않는다.
export type AdminAccess =
  | { status: "no-database" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "ready"; userId: string };

export type AdminUserList =
  | Exclude<AdminAccess, { status: "ready" }>
  | {
      status: "ready";
      list: UserListPage;
    };

// ── URL 쿼리 ──

// 같은 이름이 여럿이면 첫 값만 본다.
type QueryValue = string | string[] | undefined;
const firstOf = (value: QueryValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PAGE_PATTERN = /^[1-9]\d{0,5}$/;
// 제어 문자(C0·DEL·C1)는 화면의 입력칸으로 들어오지 않는다. NUL 은 PostgreSQL 이 글자로 받지 않아 질의가 실패한다.
const isControl = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

// 비었거나 너무 길면(화면이 보낼 수 없는 값) 검색하지 않는다.
export function parseSearch(value: QueryValue): string | null {
  const raw = firstOf(value) ?? "";
  const text = Array.from(raw)
    .filter((char) => !isControl(char))
    .join("")
    .trim();
  return text === "" || text.length > USER_SEARCH_MAX_LENGTH ? null : text;
}

// 잘못된 값은 그 조건만 기본값이다. 쪽이 범위를 넘는지는 개수를 세 봐야 알므로 서비스가 본다.
export function parseUserListQuery(query: Readonly<Record<string, QueryValue>>): UserListQuery {
  const page = firstOf(query.page);
  return {
    q: parseSearch(query.q),
    page: page !== undefined && PAGE_PATTERN.test(page) ? Number(page) : 1,
  };
}

export const pageCountOf = (total: number): number =>
  Math.max(1, Math.ceil(total / USER_PAGE_SIZE));

// ── 검색 필터 ──
// 검색어를 PostgREST or=(…) 필터에 그대로 넣으면 질의 문법이 된다(, ( ) 는 조건을 나누고 ilike 의 % _ 는 아무 글자).
// PostgREST 는 ilike 값의 * 를 % 로 바꿔 이스케이프할 길이 없으므로 정규식 imatch(~*, 대소문자 무시)를 쓰고
//   1. 정규식: ASCII 문장 부호에만 \ 를 붙인다. 영숫자 앞의 \ 는 \d 같은 다른 뜻이다.
//   2. PostgREST: 값을 큰따옴표로 감싸 , . : ( ) 를 글자로 읽게 하고, 따옴표 안의 " 와 \ 앞에 \ 를 붙인다.
// 그래서 검색어는 늘 글자 그대로만 읽힌다 — 되돌아가며 맞춰 보는 패턴이 생기지 않는다.
const REGEX_PUNCTUATION = /[!-/:-@[-`{-~]/g;
const QUOTED_VALUE_SPECIAL = /["\\]/g;

export const literalPattern = (text: string): string => text.replace(REGEX_PUNCTUATION, "\\$&");

export const quoteFilterValue = (value: string): string =>
  `"${value.replace(QUOTED_VALUE_SPECIAL, "\\$&")}"`;

export function userSearchFilter(q: string): string {
  const value = quoteFilterValue(literalPattern(q));
  return `email.imatch.${value},display_name.imatch.${value}`;
}

// ── 화면 모양 ──
// 서버의 시간대(UTC)와 상관없이 서울로 적는다. 오전 9시 전에 가입한 사람이 전날로 가지 않게 한다.

const seoulDate = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});
const seoulDateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

// status 는 DB 제약이 두 값으로 묶는다. 다른 값이 오면 스키마와 코드가 어긋난 것이라 던진다.
const toStatus = (value: string): UserStatus => {
  const status = USER_STATUSES.find((known) => known === value);
  if (!status) throw new Error(`알 수 없는 회원 상태입니다: ${value}`);
  return status;
};

export function toUserView(row: UserRow, viewerId: string): UserView {
  const joined = new Date(row.created_at);
  const isMe = row.id === viewerId;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    isMe,
    status: toStatus(row.status),
    canChangeStatus: !isMe && !row.is_admin,
    joinedAt: row.created_at,
    joinedDateText: seoulDate.format(joined),
    joinedAtText: seoulDateTime.format(joined),
  };
}

// ── 정지·해제 ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 서버 함수·API 가 화면 밖에서 직접 불릴 수 있어 입력을 믿지 않는다.
export function parseStatusChange(
  userId: unknown,
  status: unknown,
): { userId: string; status: UserStatus } | null {
  const next = USER_STATUSES.find((known) => known === status);
  return typeof userId === "string" && UUID.test(userId) && next
    ? { userId: userId.toLowerCase(), status: next }
    : null;
}

//   self·admin-target — 자기 자신·다른 운영자. not-found — 없는 회원(탈퇴했다).
export type StatusChangeResult =
  | Exclude<AdminAccess, { status: "ready" }>
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "self" }
  | { status: "admin-target" }
  | { status: "not-found" };
