import { StarIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { listMyWatchedBidIds } from "@/server/watchlist";
import { loadOpportunityFilters, loadOpportunityPage } from "@/app/_lib/opportunity-data";
import { BidListView } from "@/app/(app)/(work)/bids/bid-list-view";
import { listQueryOf } from "@/app/(app)/(work)/bids/list-query";
import { canRunIngestion, EmptyState } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import {
  WATCHLIST_ALL_HREF,
  WATCHLIST_DESCRIPTION,
  WATCHLIST_EMPTY_ACTION,
  WATCHLIST_EMPTY_DESCRIPTION,
  WATCHLIST_EMPTY_TITLE,
  WATCHLIST_INACTIVE_ACTION,
  WATCHLIST_INACTIVE_TITLE,
  WATCHLIST_TITLE,
  watchlistInactiveDescription,
} from "./watchlist-copy";

export const metadata: Metadata = { title: WATCHLIST_TITLE };

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  await connection();
  const raw = await searchParams;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value])
      next.append(key, item);
  const work = await requireWork(`/watchlist${next.size ? `?${next}` : ""}`);
  const { query, search, notice } = listQueryOf({ ...raw, watched: "me" }, work.defaultOrigin);
  const [first, filters, watchedIds] = await Promise.all([
    loadOpportunityPage(work.orgId, query, work.userId),
    loadOpportunityFilters(query.origin),
    listMyWatchedBidIds({ orgId: work.orgId, userId: work.userId }),
  ]);
  const stable = new URLSearchParams(search);
  stable.set("asOf", first.asOf);
  const hasFilters = Boolean(
    query.q ||
    query.sourceFamily.length ||
    query.agencyId.length ||
    query.companyId.length ||
    query.stage.length ||
    query.status.length ||
    query.category.length ||
    query.recommendation.length ||
    query.decision.length ||
    query.includeEarly ||
    !query.siAiFirst ||
    query.sortExplicit ||
    query.origin !== work.defaultOrigin,
  );
  const empty =
    watchedIds.length === 0 ? (
      <EmptyState
        icon={StarIcon}
        title={WATCHLIST_EMPTY_TITLE}
        description={WATCHLIST_EMPTY_DESCRIPTION}
        action={
          <Link href="/bids" className={buttonVariants({ variant: "outline" })}>
            {WATCHLIST_EMPTY_ACTION}
          </Link>
        }
      />
    ) : !hasFilters ? (
      <EmptyState
        icon={StarIcon}
        title={WATCHLIST_INACTIVE_TITLE}
        description={watchlistInactiveDescription(watchedIds.length)}
        action={
          <Link href={WATCHLIST_ALL_HREF} className={buttonVariants({ variant: "outline" })}>
            {WATCHLIST_INACTIVE_ACTION}
          </Link>
        }
      />
    ) : undefined;
  return (
    <AppPage
      title={WATCHLIST_TITLE}
      description={WATCHLIST_DESCRIPTION}
      contentClassName="max-w-360"
    >
      <BidListView
        defaultOrigin={work.defaultOrigin}
        items={first.items}
        total={first.total}
        nextCursor={first.pageInfo.nextCursor}
        query={stable.toString()}
        now={new Date().toISOString()}
        canRunIngestion={canRunIngestion(work.role)}
        agencies={filters.agencies}
        companies={filters.companies}
        notice={notice}
        hasFilters={hasFilters}
        basePath="/watchlist"
        watchedIds={watchedIds}
        empty={empty}
      />
    </AppPage>
  );
}
