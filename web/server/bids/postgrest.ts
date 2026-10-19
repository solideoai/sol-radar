import "server-only";
import type { CursorPayload } from "./bid-query";
import type { PagedRows } from "./bids.repo";

// PostgREST 필터 문자열(or=(…)·키셋)을 만드는 도구. 사용자 값과 커서 값은 모두 quoteValue 로 감싼다.
// PostgREST 는 큰따옴표 안에서 `\X` 를 X 한 글자로 읽는다(QueryParams.hs pQuotedValue). 그래서 감싼 값 안의
// 쉼표·괄호·마침표는 구분자가 되지 못하고, 큰따옴표·역슬래시는 이스케이프해야 값이 끝나지 않는다.

// 큰따옴표로 감싸고 안의 `"`·`\` 앞에 `\` 를 붙인다.
export function quoteValue(value: string): string {
  return `"${value.replace(/["\\]/g, (ch) => `\\${ch}`)}"`;
}

// (i)like 의 "포함" 패턴. LIKE 문자(`\`·`%`·`_`)를 이스케이프해 글자 그대로 찾고, 앞뒤에 PostgREST 와일드카드 `*` 를 둔다.
// quoteValue 로 감싸면 `\` 가 한 번 더 이스케이프되어 PostgREST 를 지난 뒤에도 LIKE 이스케이프가 남는다.
// 검색어 안의 `*` 는 PostgREST 가 `%` 로 바꾸므로 와일드카드로 남는다(이스케이프할 방법이 없다).
export function likePattern(q: string): string {
  return `*${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}*`;
}

// 키셋 다음 쪽 조건. 정렬 열은 nulls last, 같은 값은 id 오름차순이다. `.or(…)` 로 붙인다.
export function keysetFilter(
  column: string,
  direction: "asc" | "desc",
  after: CursorPayload,
): string {
  const q = quoteValue;
  if (after.sortValue === null) return `and(${column}.is.null,id.gt.${q(after.id)})`;
  const op = direction === "desc" ? "lt" : "gt";
  const v = q(String(after.sortValue));
  return `${column}.${op}.${v},and(${column}.eq.${v},id.gt.${q(after.id)}),${column}.is.null`;
}

const UNIQUE_VIOLATION = "23505";
const UNIQUE_CONSTRAINTS = [
  ["score_runs_active_input_key", "ACTIVE_INPUT"],
  ["score_runs_idempotency_key_key", "IDEMPOTENCY_KEY"],
] as const;

// 분석 요청 insert 의 UNIQUE 충돌을 제약 이름으로 가른다. 다른 오류는 null(호출자가 던진다).
export function uniqueViolation(error: {
  code?: string;
  message?: string;
}): "ACTIVE_INPUT" | "IDEMPOTENCY_KEY" | null {
  if (error.code !== UNIQUE_VIOLATION) return null;
  const message = error.message ?? "";
  const found = UNIQUE_CONSTRAINTS.find(([name]) => message.includes(`"${name}"`));
  return found === undefined ? null : found[1];
}

// limit+1 행으로 한 쪽을 만든다. 다음 쪽 키는 이 쪽의 마지막 행에서 만든다.
export function pageOf<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  keyOf: (row: Row, item: Item) => NonNullable<PagedRows<Item>["last"]>,
): PagedRows<Item> {
  const page = rows.slice(0, limit).map((row) => ({ row, item: toItem(row) }));
  const last = page.at(-1);
  return {
    items: page.map(({ item }) => item),
    hasNext: rows.length > limit,
    last: last === undefined ? null : keyOf(last.row, last.item),
  };
}
