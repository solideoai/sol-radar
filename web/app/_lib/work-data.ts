import "server-only";
import { cache } from "react";
import {
  countBids,
  getDashboardSummary,
  getStatusSummary,
  listBids,
  listNotifications,
  type BidListItem,
  type BidListOrigin,
  type BidListQuery,
  type Notification,
  type Page,
  type StatusSummary,
} from "@/server/bids";
import {
  getWatchSummary,
  listMyWatchedBidIds,
  type WatchScope,
  type WatchSummary,
} from "@/server/watchlist";
import { watchDeps } from "@/app/_lib/watch-deps";
import { workDeps } from "@/app/_lib/work-deps";

// 대시보드 요약 한 벌(공고 집계·AI 상태 포함). 대시보드 화면만 읽는다.
export const loadDashboardSummary = cache((orgId: string, origin: BidListOrigin) =>
  getDashboardSummary(orgId, origin, { repo: workDeps().dashboard }, new Date()),
);

// (work) layout 상단바의 수집 신선도·안 읽은 수. 화면마다 도는 자리라 가벼운 질의만 한다(M3).
export const loadStatusSummary = cache((origin: BidListOrigin): Promise<StatusSummary> =>
  getStatusSummary(origin, { repo: workDeps().dashboard }),
);

// 업무 화면(서버 컴포넌트)이 읽는 공고 목록 한 쪽. GET /api/v1/bids 와 같은 서비스다.
// 예상한 실패(커서 비밀 없음 503 등)도 화면에서는 읽기 실패라 오류 경계(error.tsx)로 던진다. message 는 서비스의 한국어 문장이다.
export async function loadBidPage(orgId: string, query: BidListQuery): Promise<Page<BidListItem>> {
  const deps = workDeps();
  const result = await listBids(orgId, query, deps.cursorSecret, { repo: deps.bids });
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

// 같은 조건의 전체 건수. 대시보드 "BID 권고" 카드가 BID 표와 같은 조건(BidListQuery)을 넘겨 센다(M4).
export function loadBidCount(orgId: string, query: BidListQuery): Promise<number> {
  return countBids(orgId, query, { repo: workDeps().bids });
}

// 내 알림 첫 쪽(20건). GET /api/v1/notifications 와 같은 서비스다. 링크는 서비스가 앱 안 경로로 바꿔 준다.
// 다음 쪽 커서는 이 조직·이 사람에게 묶인다(API 가 같은 ctx 로 검증한다).
export async function loadNotificationPage(
  orgId: string,
  userId: string,
  unreadOnly: boolean,
): Promise<Page<Notification>> {
  const deps = workDeps();
  const result = await listNotifications(
    orgId,
    userId,
    { cursor: null, limit: 20, unreadOnly },
    deps.cursorSecret,
    { repo: deps.notifications },
  );
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

// 내 관심 공고 id(N3, Q2 ①). 목록 응답(BidListItem)은 그대로 두고 ★ 처음 값을 화면이 따로 읽는다.
// /watchlist 는 관심이 곧 목록이라 읽지 못하면 오류 경계(error.tsx)로 던진다(D15).
export async function loadMyWatchedBidIds(scope: WatchScope): Promise<string[]> {
  return listMyWatchedBidIds(scope, { repo: watchDeps().repo });
}

// 관심이 보조 정보인 화면(/bids·상세)은 읽지 못해도 본 화면을 그린다. ★ 를 빼고 서버 로그 한 줄만 남긴다(D15).
// 오류 message·값은 싣지 않는다 — 저장 오류 문장에 질의 조건이 섞일 수 있다.
const logWatchReadFailed = (screen: "bids" | "bid_detail"): void => {
  console.error(JSON.stringify({ event: "watch.read_failed", screen }));
};

export async function loadWatchedBidIdsOrNull(scope: WatchScope): Promise<string[] | null> {
  try {
    return await loadMyWatchedBidIds(scope);
  } catch {
    logWatchReadFailed("bids");
    return null;
  }
}

export async function loadWatchSummaryOrNull(
  scope: WatchScope,
  bidId: string,
): Promise<WatchSummary | null> {
  try {
    return await getWatchSummary(scope, bidId, { repo: watchDeps().repo });
  } catch {
    logWatchReadFailed("bid_detail");
    return null;
  }
}
