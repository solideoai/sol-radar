"use client";

import { InboxIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BidFilters } from "@/components/bids/bid-filters";
import { Button } from "@/components/ui/button";
import type { BidListItem } from "@/server/bids";
import { EmptyState, NO_BIDS_HINT, NO_BIDS_TITLE } from "@/app/(app)/(work)/empty-state";
import { BidListMore } from "./bid-list-more";

// /bids 본문: 필터 막대 → 결과 줄 → 표 → 더 보기(스펙 §5.3 정보 위계).
// 필터를 바꾸면 주소만 바꾸고 서버가 다시 읽는다. 그동안 필터 막대는 그대로(초점은 고른 칸에 남는다) 두고 표만 흐린다.

type BidListViewProps = {
  defaultOrigin: "demo" | "live";
  items: BidListItem[];
  nextCursor: string | null;
  /** 목록 조건(cursor 없는 쿼리 문자열). 비었으면 조건 없는 기본 목록이다. */
  query: string;
  now: string;
  /** 공고 0건 안내에 "관리자에게 수집을 요청하세요"를 붙일지(ADMIN). */
  showIngestHint: boolean;
};

export function BidListView({
  defaultOrigin,
  items,
  nextCursor,
  query,
  now,
  showIngestHint,
}: BidListViewProps) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const resetFilters = () => startTransition(() => router.push("/bids", { scroll: false }));

  const empty =
    query === "" ? (
      <EmptyState
        icon={InboxIcon}
        title={NO_BIDS_TITLE}
        description={showIngestHint ? NO_BIDS_HINT : undefined}
      />
    ) : (
      <EmptyState
        icon={SearchIcon}
        title="조건에 맞는 공고가 없습니다"
        action={
          <Button variant="outline" onClick={resetFilters}>
            필터 초기화
          </Button>
        }
      />
    );

  return (
    <>
      <BidFilters defaultOrigin={defaultOrigin} startTransition={startTransition} />
      <div className="flex flex-col gap-3">
        <BidListMore
          initialItems={items}
          initialNextCursor={nextCursor}
          query={query}
          now={now}
          busy={isNavigating}
          empty={empty}
          startTransition={startTransition}
        />
      </div>
    </>
  );
}
