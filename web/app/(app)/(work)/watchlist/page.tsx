import { cn } from "cn";
import { StarIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { defaultOrigin } from "@/server/bids";
import { loadBidPage, loadMyWatchedBidIds } from "@/app/_lib/work-data";
import { BidListView } from "@/app/(app)/(work)/bids/bid-list-view";
import { canRunIngestion, EmptyState } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { watchlistEmptyKindOf, watchlistQueryOf, type WatchlistEmptyKind } from "./list-query";
import {
  WATCHLIST_ALL_HREF,
  WATCHLIST_CAPTION,
  WATCHLIST_DESCRIPTION,
  WATCHLIST_EMPTY_ACTION,
  WATCHLIST_EMPTY_DESCRIPTION,
  WATCHLIST_EMPTY_TITLE,
  WATCHLIST_INACTIVE_ACTION,
  WATCHLIST_INACTIVE_TITLE,
  WATCHLIST_PATH,
  WATCHLIST_STATUS_WITH_CLOSED,
  WATCHLIST_TITLE,
  watchlistInactiveDescription,
} from "./watchlist-copy";

export const metadata: Metadata = { title: WATCHLIST_TITLE };

// N3 디자인 §4.2. /bids 와 같은 필터 막대·표·더 보기에 watched=me 를 고정으로 붙인다. 관심은 본인 것만 보인다(RLS).
// 첫 쪽(20건)은 서버가 그리고 다음 쪽은 "더 보기"가 GET /api/v1/bids?watched=me&… 로 읽는다.
// 관심 id 를 읽지 못하면 그릴 것이 없으므로 오류 경계(error.tsx)로 던진다(D15).
export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  await connection();
  const raw = await searchParams;
  const work = await requireWork(nextPathOf(raw));
  const { query, search, listSearch } = watchlistQueryOf(raw, work.runMode);
  // D-n 의 기준. 요청마다 한 번 만들어 내린다(하이드레이션 차이 없음).
  const now = new Date();
  const [first, watchedIds] = await Promise.all([
    loadBidPage(work.orgId, query),
    loadMyWatchedBidIds({ orgId: work.orgId, userId: work.userId }),
  ]);
  return (
    <AppPage
      title={WATCHLIST_TITLE}
      description={WATCHLIST_DESCRIPTION}
      contentClassName="max-w-360"
    >
      <BidListView
        defaultOrigin={defaultOrigin(work.runMode) === "live" ? "live" : "demo"}
        items={first.items}
        nextCursor={first.pageInfo.nextCursor}
        query={search}
        listSearch={listSearch}
        basePath={WATCHLIST_PATH}
        now={now.toISOString()}
        canRunIngestion={canRunIngestion(work.role)}
        watchedIds={watchedIds}
        caption={WATCHLIST_CAPTION}
        empty={emptyOf(watchlistEmptyKindOf(watchedIds.length, search), watchedIds.length)}
        closedStatusLabel={WATCHLIST_STATUS_WITH_CLOSED}
      />
    </AppPage>
  );
}

// E1·E3 은 링크라 여기서 그린다. E2(조건 0건)는 [필터 초기화]가 목록의 전환을 써야 해서 BidListView 기본(basePath 로)에 맡긴다.
function emptyOf(kind: WatchlistEmptyKind, watchedCount: number): React.ReactNode {
  const actionClass = cn(buttonVariants({ variant: "outline" }));
  switch (kind) {
    case "none":
      return (
        <EmptyState
          icon={StarIcon}
          title={WATCHLIST_EMPTY_TITLE}
          description={WATCHLIST_EMPTY_DESCRIPTION}
          action={
            <Link href="/bids" className={actionClass}>
              {WATCHLIST_EMPTY_ACTION}
            </Link>
          }
        />
      );
    case "default":
      return (
        <EmptyState
          icon={StarIcon}
          title={WATCHLIST_INACTIVE_TITLE}
          description={watchlistInactiveDescription(watchedCount)}
          action={
            <Link href={WATCHLIST_ALL_HREF} className={actionClass}>
              {WATCHLIST_INACTIVE_ACTION}
            </Link>
          }
        />
      );
    case "filtered":
      return undefined;
  }
}

// 로그인·가입 보완 뒤 돌아올 주소. 검색어 등 조건을 잃지 않게 쿼리를 그대로 붙인다(경로는 /watchlist 고정이라 바깥으로 새지 않는다).
function nextPathOf(raw: Awaited<PageProps<"/watchlist">["searchParams"]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `${WATCHLIST_PATH}?${search}` : WATCHLIST_PATH;
}
