import "server-only";
import { parseProgramNoticeListQuery, type ProgramNoticeListQuery } from "@/server/program-notices";

// /bids/programs 화면 주소의 쿼리를 목록 조건으로 바꾼다(/bids 의 list-query.ts 와 같은 규칙, 디자인 스펙 §4.4).
// - 아는 키(source·q·sort·includeClosed)만 남긴다.
// - 잘못된 값은 그 키만 버리고 나머지 조건으로 읽는다. 필터 막대가 모르는 값을 기본으로 보이는 것과 맞춘다(오류 화면 대신, §11-8).
// - search 는 남은 조건의 쿼리 문자열이다. 목록 화면이 조건이 바뀐 것(열린 서랍 닫기)과 빈 상태 단추의 주소에 쓴다.
// - isDefault 는 출처·검색어·마감 지난 공고 포함이 모두 기본인지다. 정렬은 거르지 않으므로 보지 않는다(빈 상태 판정, §12.1 Q3).

type RawQuery = Readonly<Record<string, string | string[] | undefined>>;

const LIST_KEYS = ["source", "q", "sort", "includeClosed"] as const;

const toParams = (raw: RawQuery): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (!LIST_KEYS.some((known) => known === key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
};

const toRaw = (params: URLSearchParams): RawQuery =>
  Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      // 한 번 온 키는 글자 하나로 넘긴다. 서버 파서는 배열(반복 키)을 틀린 값으로 본다.
      return [key, values.length === 1 ? values[0] : values];
    }),
  );

const isDefaultQuery = (query: ProgramNoticeListQuery): boolean =>
  query.source === null && query.q === null && !query.includeClosed;

export function listQueryOf(raw: RawQuery): {
  query: ProgramNoticeListQuery;
  search: string;
  isDefault: boolean;
} {
  const params = toParams(raw);
  // 잘못된 키를 하나씩 버리며 다시 읽는다. 키 수만큼만 돌면 끝난다.
  for (let attempt = 0; attempt <= LIST_KEYS.length; attempt += 1) {
    const parsed = parseProgramNoticeListQuery(toRaw(params));
    if (parsed.ok)
      return {
        query: parsed.value,
        search: params.toString(),
        isDefault: isDefaultQuery(parsed.value),
      };
    const bad = new Set(parsed.issues.map((issue) => issue.path.split(".")[0]));
    const before = params.size;
    for (const key of bad) params.delete(key);
    if (params.size === before) break;
  }
  const fallback = parseProgramNoticeListQuery({});
  if (!fallback.ok) throw new Error("기본 목록 조건을 만들지 못했습니다");
  return { query: fallback.value, search: "", isDefault: true };
}
