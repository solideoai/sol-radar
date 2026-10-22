import "server-only";

// ── 관심 공고(N3, ADR-021 P1-1)의 타입과 저장 포트 ──
// 관심은 본인 것만이다(설계 D6). 조직에는 공고별 관심 인원 수만 보인다 — 누가 표시했는지는 돌려주지 않는다.
// 접근 통제는 RLS(bid_watches 본인 행만)와 집계 함수(bid_watch_count, 호출자 조직 안만)가 한다.

/** 화면·Route Handler 가 확인한 지금 조직과 사용자. 조직은 서버가 정한다(M17). */
export type WatchScope = { orgId: string; userId: string };

/** PUT·DELETE /bids/:id/watch 의 응답 본문. watcherCount 는 바꾼 뒤의 조직 관심 인원 수다. */
export type WatchState = { bidId: string; watched: boolean; watcherCount: number };

/** 공고 상세 머리가 그리는 값. */
export type WatchSummary = { watched: boolean; watcherCount: number };

export type WatchResult =
  | { ok: true; status: 200; data: WatchState }
  | {
      ok: false;
      status: 404;
      code: "NOT_FOUND";
      message: string;
      details: { resource: "bid" };
    };

/**
 * 저장 포트. 구현(watchlist.repo)은 요청마다 Supabase 를 부른다.
 * addWatch·removeWatch 는 멱등이다: 이미 있는 행을 넣거나 없는 행을 지워도 던지지 않는다.
 */
export type WatchlistRepo = {
  /** 공고 자체가 있는지. 공고는 모든 조직이 같이 본다. */
  bidExists(bidId: string): Promise<boolean>;
  addWatch(scope: WatchScope, bidId: string): Promise<void>;
  removeWatch(scope: WatchScope, bidId: string): Promise<void>;
  isWatching(scope: WatchScope, bidId: string): Promise<boolean>;
  /** 호출자 조직 안의 관심 인원 수(집계 함수). */
  countWatchers(bidId: string): Promise<number>;
  listMyWatchedBidIds(scope: WatchScope): Promise<string[]>;
};

export const BID_NOT_FOUND_MESSAGE = "공고를 찾을 수 없습니다";
