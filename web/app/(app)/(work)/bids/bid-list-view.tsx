"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { OpportunityFilters } from "@/components/work/opportunities-filters";
import type { OpportunityItem } from "@/server/opportunities";
import { EmptyState, NoBidsEmptyState } from "@/app/(app)/(work)/empty-state";
import { BidListMore } from "./bid-list-more";

export function BidListView({
  defaultOrigin,
  items,
  nextCursor,
  total,
  query,
  now,
  canRunIngestion,
  agencies,
  companies,
  notice,
  hasFilters,
}: {
  defaultOrigin: "live" | "demo";
  items: OpportunityItem[];
  nextCursor: string | null;
  total: number;
  query: string;
  now: string;
  canRunIngestion: boolean;
  agencies: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  notice: string | null;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const empty = hasFilters ? (
    <EmptyState
      icon={SearchIcon}
      title="조건에 맞는 공고가 없습니다"
      action={
        <Button
          variant="outline"
          onClick={() => startTransition(() => router.push("/bids", { scroll: false }))}
        >
          필터 초기화
        </Button>
      }
    />
  ) : (
    <NoBidsEmptyState canRun={canRunIngestion} />
  );
  return (
    <>
      <OpportunityFilters
        query={query}
        defaultOrigin={defaultOrigin}
        agencies={agencies}
        companies={companies}
        startTransition={startTransition}
      />
      {notice && <p className="type-label text-warning">{notice}</p>}
      {new URLSearchParams(query).get("origin") === "demo" && (
        <p className="type-caption text-muted-foreground">DEMO · 예시 공고 기준</p>
      )}
      <BidListMore
        initialItems={items}
        initialNextCursor={nextCursor}
        total={total}
        query={query}
        now={now}
        busy={isNavigating}
        empty={empty}
        startTransition={startTransition}
      />
    </>
  );
}
