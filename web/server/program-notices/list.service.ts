import "server-only";
import type { Tables } from "@/lib/database.types";
import {
  PROGRAM_NOTICE_SOURCES,
  isItProgramNotice,
  type ProgramNoticeSource,
} from "./program-notice.model";

// ── 부처 공고 목록(스펙 §6): 출처·소관기관 검색·정렬·마감 지난 공고 숨김, 두 소스 사이 중복 묶기 ──
// repo 는 거르지 않고 최근 등록 순으로 읽는다. 출처·마감·검색·정렬은 여기서 순수 함수로 한다(fake 저장소로 시험한다).
// 출처도 여기서 거른다. 그래야 "저장된 공고가 아예 없다"(hasAnyNotice)를 조건과 상관없이 판단한다.
// 마감 판정의 "오늘"은 KST 날짜다(Route 가 kstToday 로 넘긴다). 마감이 null 인 공고는 늘 보인다.
// 묶기를 마감 거르기보다 먼저 한다. 마감 지난 기업마당 공고의 중기부 쌍둥이(마감 null)가 "기간 미표기"로 남지 않게 한다.
// IT 관련 공고만 보인다(ADR-069, isItProgramNotice). "저장된 공고"(hasAnyNotice)도 IT 관련 공고만 센다.
// 묶기는 IT 거르기 전 행으로 한다. 기업마당 공고가 있으면 IT 판정과 상관없이 중기부 쌍둥이를 숨긴다.

/** repo 가 읽는 최대 행 수(최근 등록 순). 거른 뒤 화면에는 LIST_MAX_ITEMS 까지만 보인다. */
export const LIST_FETCH_LIMIT = 600;
export const LIST_MAX_ITEMS = 300;
const Q_MAX_LENGTH = 50;

export type ProgramNoticeSort = "deadline" | "published";

export type ProgramNoticeListQuery = {
  source: ProgramNoticeSource | null;
  q: string | null;
  sort: ProgramNoticeSort;
  includeClosed: boolean;
};

export type RawQuery = Readonly<Record<string, string | string[] | undefined>>;
export type QueryIssue = { path: string; message: string };

export type ProgramNoticeRow = Pick<
  Tables<"program_notices">,
  | "id"
  | "source"
  | "title"
  | "agency"
  | "source_url"
  | "published_at"
  | "apply_start_on"
  | "apply_end_on"
  | "summary"
  | "apply_method"
  | "target"
  | "tags"
  | "is_demo"
  | "dedupe_key"
>;

export type ProgramNoticesRepo = {
  listRecent(input: { limit: number }): Promise<ProgramNoticeRow[]>;
};

export type ProgramNoticeListItem = {
  id: string;
  source: ProgramNoticeSource;
  title: string;
  agency: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  applyStartOn: string | null;
  applyEndOn: string | null;
  summary: string | null;
  applyMethod: string | null;
  target: string | null;
  tags: string[];
  isDemo: boolean;
};

export type ProgramNoticeList = {
  items: ProgramNoticeListItem[];
  total: number;
  /** 조건으로 거르기 전에 저장된 IT 관련 공고가 하나라도 있는가("수집 0건"과 "조건 결과 0건"을 가른다). */
  hasAnyNotice: boolean;
  /** 거른 결과가 LIST_MAX_ITEMS 를 넘어 잘렸는가. */
  isCapped: boolean;
};

const SORTS: readonly ProgramNoticeSort[] = ["deadline", "published"];
const BOOLEANS: Readonly<Record<string, boolean>> = { true: true, false: false };

type Parsed<T> = { ok: true; value: T } | { ok: false; issue: QueryIssue };

const fail = (path: string, message: string): { ok: false; issue: QueryIssue } => ({
  ok: false,
  issue: { path, message },
});

/** 반복된 키는 거부한다. 없으면 null. */
const single = (raw: RawQuery, key: string): Parsed<string | null> => {
  const value = raw[key];
  return Array.isArray(value) ? fail(key, "한 번만 보낸다") : { ok: true, value: value ?? null };
};

const oneOf = <T extends string>(
  raw: RawQuery,
  key: string,
  allowed: readonly T[],
): Parsed<T | null> => {
  const value = single(raw, key);
  if (!value.ok) return value;
  if (value.value === null) return { ok: true, value: null };
  const found = allowed.find((candidate) => candidate === value.value);
  return found === undefined
    ? fail(key, `${allowed.join("·")} 중 하나다`)
    : { ok: true, value: found };
};

const flag = (raw: RawQuery, key: string): Parsed<boolean> => {
  const value = single(raw, key);
  if (!value.ok) return value;
  if (value.value === null) return { ok: true, value: false };
  const parsed = BOOLEANS[value.value];
  return parsed === undefined ? fail(key, "true·false 중 하나다") : { ok: true, value: parsed };
};

const searchText = (raw: RawQuery, key: string): Parsed<string | null> => {
  const value = single(raw, key);
  if (!value.ok) return value;
  const text = value.value?.trim() ?? "";
  if ([...text].length > Q_MAX_LENGTH) return fail(key, `${Q_MAX_LENGTH}자까지다`);
  return { ok: true, value: text === "" ? null : text };
};

/** 쿼리 → 목록 조건. 모르는 키는 무시하고, 아는 키의 값이 틀리면 이슈다. */
export function parseProgramNoticeListQuery(
  raw: RawQuery,
): { ok: true; value: ProgramNoticeListQuery } | { ok: false; issues: QueryIssue[] } {
  const source = oneOf(raw, "source", PROGRAM_NOTICE_SOURCES);
  const q = searchText(raw, "q");
  const sort = oneOf(raw, "sort", SORTS);
  const includeClosed = flag(raw, "includeClosed");

  const issues = [source, q, sort, includeClosed].flatMap((part) => (part.ok ? [] : [part.issue]));
  if (!source.ok || !q.ok || !sort.ok || !includeClosed.ok) return { ok: false, issues };
  return {
    ok: true,
    value: {
      source: source.value,
      q: q.value,
      sort: sort.value ?? "deadline",
      includeClosed: includeClosed.value,
    },
  };
}

const normalizeForSearch = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const isSource = (value: string): value is ProgramNoticeSource =>
  (PROGRAM_NOTICE_SOURCES as readonly string[]).includes(value);

const toItem = (
  row: ProgramNoticeRow & { source: ProgramNoticeSource },
): ProgramNoticeListItem => ({
  id: row.id,
  source: row.source,
  title: row.title,
  agency: row.agency,
  sourceUrl: row.source_url,
  publishedAt: row.published_at,
  applyStartOn: row.apply_start_on,
  applyEndOn: row.apply_end_on,
  summary: row.summary,
  applyMethod: row.apply_method,
  target: row.target,
  tags: row.tags,
  isDemo: row.is_demo,
});

/** null 은 뒤로. 둘 다 있으면 compare 결과. */
const nullsLast = <T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number => {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return compare(left, right);
};

const ascending = (left: string, right: string): number => left.localeCompare(right);
// published_at 은 timestamptz 문자열이라 형식이 섞일 수 있어 시각으로 비교한다.
const byInstantDesc = (left: string, right: string): number => Date.parse(right) - Date.parse(left);

const COMPARATORS: Record<
  ProgramNoticeSort,
  (a: ProgramNoticeListItem, b: ProgramNoticeListItem) => number
> = {
  deadline: (a, b) =>
    nullsLast(a.applyEndOn, b.applyEndOn, ascending) ||
    nullsLast(a.publishedAt, b.publishedAt, byInstantDesc) ||
    ascending(a.id, b.id),
  published: (a, b) =>
    nullsLast(a.publishedAt, b.publishedAt, byInstantDesc) || ascending(a.id, b.id),
};

/** 목록. 던지는 것은 repo 의 DB 오류뿐이다(Route 가 500 봉투로 바꾼다). */
export async function listProgramNotices(
  query: ProgramNoticeListQuery,
  deps: { repo: ProgramNoticesRepo; today: string },
): Promise<ProgramNoticeList> {
  const stored = await deps.repo.listRecent({ limit: LIST_FETCH_LIMIT });
  const itIds = new Set(stored.filter(isItProgramNotice).map((row) => row.id));
  const rows = stored.filter(
    (row): row is ProgramNoticeRow & { source: ProgramNoticeSource } =>
      isSource(row.source) && (query.source === null || row.source === query.source),
  );
  const bizinfoKeys = new Set(
    rows.filter((row) => row.source === "bizinfo").map((row) => row.dedupe_key),
  );
  const needle = query.q === null ? null : normalizeForSearch(query.q);
  const filtered = rows
    .filter((row) => row.source === "bizinfo" || !bizinfoKeys.has(row.dedupe_key))
    .filter((row) => itIds.has(row.id))
    .filter(
      (row) => query.includeClosed || row.apply_end_on === null || row.apply_end_on >= deps.today,
    )
    .filter((row) => needle === null || normalizeForSearch(row.agency ?? "").includes(needle))
    .map(toItem)
    .sort(COMPARATORS[query.sort]);
  const items = filtered.slice(0, LIST_MAX_ITEMS);
  return {
    items,
    total: items.length,
    hasAnyNotice: itIds.size > 0,
    isCapped: filtered.length > LIST_MAX_ITEMS,
  };
}
