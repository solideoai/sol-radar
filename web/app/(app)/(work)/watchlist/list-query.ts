import "server-only";
import type { BidListQuery, RawQuery, RunMode } from "@/server/bids";
import { listQueryOf } from "@/app/(app)/(work)/bids/list-query";

// /watchlist 화면 주소의 쿼리(N3 디자인 §4.2·§10-2). 조건은 /bids 와 같은 규칙으로 읽고(Q3 ①) watched=me 만 고정으로 더한다.
// - search: watched 없는 화면 조건. /watchlist?<search>(필터 초기화·처음부터 보기)와 빈 상태 판단에 쓴다.
//   watched 는 화면이 고정하므로 주소에 적지 않는다(listQueryOf 가 모르는 키로 버린다).
// - listSearch: search 에 watched=me 를 붙인 것. 더 보기 API 와 상세 ?list= 가 같은 조건을 읽게 한다.
const WATCHED_ME = "watched=me";

export function watchlistQueryOf(
  raw: RawQuery,
  runMode: RunMode,
): { query: BidListQuery; search: string; listSearch: string } {
  const { query, search } = listQueryOf(raw, runMode);
  return {
    query: { ...query, watched: "me" },
    search,
    listSearch: search === "" ? WATCHED_ME : `${search}&${WATCHED_ME}`,
  };
}

/** /watchlist 0건의 갈래(D9): E1 관심 0건 · E2 조건 0건 · E3 기본 조건 0건. */
export type WatchlistEmptyKind = "none" | "filtered" | "default";

// 관심 id 개수는 ★ 처음 값을 그리려고 어차피 읽는다(Q2 ①).
export function watchlistEmptyKindOf(watchedCount: number, search: string): WatchlistEmptyKind {
  if (watchedCount === 0) return "none";
  return search === "" ? "default" : "filtered";
}
