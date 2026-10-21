"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, type TransitionStartFunction } from "react";
import { OpportunityTable } from "@/components/work/opportunities-table";
import type { OpportunityItem } from "@/server/opportunities";
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
}: {
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
    startTransition(() => router.push(`/bids?${params.toString()}`, { scroll: false }));
  };
  return (
    <div className="flex min-w-0 flex-col gap-3" ref={tableRef}>
      <p role="status" className="type-label text-muted-foreground">
        {busy
          ? "검색 조건에 맞는 공고를 불러오는 중…"
          : `사업기회 ${total.toLocaleString("ko-KR")}건 · 현재 ${items.length.toLocaleString("ko-KR")}건 표시`}
      </p>
      {items.length === 0 ? (
        empty
      ) : (
        <OpportunityTable items={items} now={at} listQuery={query} busy={busy} />
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
