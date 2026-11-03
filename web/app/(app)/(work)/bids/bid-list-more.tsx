"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type TransitionStartFunction } from "react";
import { OpportunityTable } from "@/components/work/opportunities-table";
import type { OpportunityItem } from "@/server/opportunities";
import { WatchToggle } from "@/app/(app)/(work)/watch-toggle";
import { LoadMoreFooter, useLoadMore } from "@/app/(app)/(work)/load-more";

export function BidListMore({
  initialItems,
  initialNextCursor,
  total,
  query,
  now,
  busy,
  empty,
  startTransition,
  basePath = "/bids",
  watchedIds,
}: {
  basePath?: "/bids" | "/watchlist";
  watchedIds?: string[] | null;
  initialItems: OpportunityItem[];
  initialNextCursor: string | null;
  total: number;
  query: string;
  now: string;
  busy: boolean;
  empty: React.ReactNode;
  startTransition: TransitionStartFunction;
}) {
  const router = useRouter();
  const [removedWatchIds, setRemovedWatchIds] = useState<string[]>([]);
  const at = useMemo(() => new Date(now), [now]);
  const { items, hasNext, status, appendedFrom, loadMore } = useLoadMore({
    endpoint: `/api/v1/opportunities?${query}`,
    initialItems,
    initialNextCursor,
  });
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (appendedFrom === null) return;
    tableRef.current
      ?.querySelectorAll<HTMLElement>("tbody tr")
      [appendedFrom]?.querySelector<HTMLElement>("a")
      ?.focus();
  }, [appendedFrom, items.length]);
  const restart = () => {
    const params = new URLSearchParams(query);
    params.delete("asOf");
    if (basePath === "/watchlist") params.delete("watched");
    startTransition(() => router.push(`${basePath}?${params.toString()}`, { scroll: false }));
  };
  return (
    <div className="flex min-w-0 flex-col gap-3" ref={tableRef}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p role="status" className="type-label text-muted-foreground">
          {busy
            ? "검색 조건에 맞는 공고를 불러오는 중…"
            : `${basePath === "/watchlist" ? "사업기회" : "IT 공고"} ${total.toLocaleString("ko-KR")}건 · 현재 ${items.length.toLocaleString("ko-KR")}건 표시`}
        </p>
      </div>
      {items.length === 0 ? (
        empty
      ) : (
        <OpportunityTable
          items={items}
          now={at}
          listQuery={query}
          busy={busy}
          caption={
            basePath === "/watchlist"
              ? "내 관심 공고 사업기회 목록. DEMO는 데모용 가상 공고입니다."
              : undefined
          }
          removedWatchIds={basePath === "/watchlist" ? removedWatchIds : undefined}
          watchColumn={
            watchedIds
              ? (item, titleId) => (
                  <WatchToggle
                    key={`${item.bidId}:${watchedIds.includes(item.bidId)}`}
                    bidId={item.bidId}
                    initialWatched={watchedIds.includes(item.bidId)}
                    size="row"
                    describedBy={titleId}
                    onSettled={({ watched }) =>
                      setRemovedWatchIds((current) =>
                        watched
                          ? current.filter((id) => id !== item.bidId)
                          : [...new Set([...current, item.bidId])],
                      )
                    }
                  />
                )
              : undefined
          }
        />
      )}
      <LoadMoreFooter
        status={status}
        hasNext={hasNext}
        onLoadMore={() => void loadMore()}
        onRestart={restart}
      />
    </div>
  );
}
