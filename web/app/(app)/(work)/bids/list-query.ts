import "server-only";
import { parseBidListQuery, type BidListQuery, type RawQuery, type RunMode } from "@/server/bids";

// /bids 화면 주소의 쿼리를 목록 조회 조건으로 바꾼다.
// - 첫 쪽만 서버가 그리므로 cursor·limit 은 버린다(다음 쪽은 "더 보기"가 API 로 읽는다).
// - 잘못된 값은 그 키만 버리고 나머지 조건으로 읽는다. 필터 막대가 모르는 값을 기본으로 보이는 것과 맞춘다(오류 화면 대신).
// - search 는 남은 조건의 쿼리 문자열이다. "더 보기" API 주소, [처음부터 보기], 상세의 ?list= 가 같이 쓴다.

const LIST_KEYS = [
  "q",
  "stage",
  "status",
  "deadlineFrom",
  "deadlineTo",
  "recommendation",
  "decision",
  "origin",
  "isDemo",
  "sort",
] as const;

const toParams = (raw: RawQuery): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (!LIST_KEYS.some((known) => known === key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
};

const toRaw = (params: URLSearchParams): RawQuery =>
  Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)]));

export function listQueryOf(
  raw: RawQuery,
  runMode: RunMode,
): { query: BidListQuery; search: string } {
  const params = toParams(raw);
  // 잘못된 키를 하나씩 버리며 다시 읽는다. 키 수만큼만 돌면 끝난다.
  for (let attempt = 0; attempt <= LIST_KEYS.length; attempt += 1) {
    const parsed = parseBidListQuery(toRaw(params), runMode);
    if (parsed.ok) return { query: parsed.value, search: params.toString() };
    const bad = new Set(parsed.issues.map((issue) => issue.path.split(".")[0]));
    const before = params.size;
    for (const key of bad) params.delete(key);
    if (params.size === before) break;
  }
  const fallback = parseBidListQuery({}, runMode);
  if (!fallback.ok) throw new Error("기본 목록 조건을 만들지 못했습니다");
  return { query: fallback.value, search: "" };
}
