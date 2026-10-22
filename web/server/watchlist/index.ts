import "server-only";

// ── 배럴: watchlist 도메인의 공개 API. 바깥(app·components)은 @/server/watchlist 만 부른다 ──
export { getWatchSummary, listMyWatchedBidIds, unwatchBid, watchBid } from "./watchlist.service";
export { watchlistRepo } from "./watchlist.repo";
export type {
  WatchlistRepo,
  WatchResult,
  WatchScope,
  WatchState,
  WatchSummary,
} from "./watchlist.model";
