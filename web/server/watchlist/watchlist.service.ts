import "server-only";
import {
  BID_NOT_FOUND_MESSAGE,
  type WatchlistRepo,
  type WatchResult,
  type WatchScope,
  type WatchSummary,
} from "./watchlist.model";
import { watchlistRepo } from "./watchlist.repo";

// ── 서비스: 관심 등록·해제와 화면이 읽는 값 ──
// 로그인·CSRF·가입 완료·업무 조직은 Route Handler 입구(businessRoute)와 화면 가드가 이미 봤다.
// 모든 역할(VIEWER 포함)이 자기 관심을 쓴다(설계 §2.4). 그래서 역할 검사가 없다.

type Deps = { repo?: WatchlistRepo };

const notFound: WatchResult = {
  ok: false,
  status: 404,
  code: "NOT_FOUND",
  message: BID_NOT_FOUND_MESSAGE,
  details: { resource: "bid" },
};

async function changeWatch(
  scope: WatchScope,
  bidId: string,
  watched: boolean,
  repo: WatchlistRepo,
): Promise<WatchResult> {
  if (!(await repo.bidExists(bidId))) return notFound;
  if (watched) await repo.addWatch(scope, bidId);
  else await repo.removeWatch(scope, bidId);
  // 인원 수는 바꾼 뒤에 센다. 응답의 수가 지금 DB 와 같게.
  const watcherCount = await repo.countWatchers(bidId);
  return { ok: true, status: 200, data: { bidId, watched, watcherCount } };
}

export function watchBid(
  scope: WatchScope,
  bidId: string,
  { repo = watchlistRepo }: Deps = {},
): Promise<WatchResult> {
  return changeWatch(scope, bidId, true, repo);
}

export function unwatchBid(
  scope: WatchScope,
  bidId: string,
  { repo = watchlistRepo }: Deps = {},
): Promise<WatchResult> {
  return changeWatch(scope, bidId, false, repo);
}

export async function getWatchSummary(
  scope: WatchScope,
  bidId: string,
  { repo = watchlistRepo }: Deps = {},
): Promise<WatchSummary> {
  const [watched, watcherCount] = await Promise.all([
    repo.isWatching(scope, bidId),
    repo.countWatchers(bidId),
  ]);
  return { watched, watcherCount };
}

export function listMyWatchedBidIds(
  scope: WatchScope,
  { repo = watchlistRepo }: Deps = {},
): Promise<string[]> {
  return repo.listMyWatchedBidIds(scope);
}
