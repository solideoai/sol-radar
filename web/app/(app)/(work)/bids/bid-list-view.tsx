"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BidFilters } from "@/components/bids/bid-filters";
import { Button } from "@/components/ui/button";
import type { BidListItem } from "@/server/bids";
import { EmptyState, NoBidsEmptyState } from "@/app/(app)/(work)/empty-state";
import { BidListMore } from "./bid-list-more";

// /bids 본문: 필터 막대 → 결과 줄 → 표 → 더 보기(스펙 §5.3 정보 위계).
// 필터를 바꾸면 주소만 바꾸고 서버가 다시 읽는다. 그동안 필터 막대는 그대로(초점은 고른 칸에 남는다) 두고 표만 흐린다.
// 관심 공고(/watchlist, N3 디자인 §4.2)도 같은 본문이다. 아래 선택 prop 을 넘기지 않으면 /bids 그대로다.

type BidListViewProps = {
  defaultOrigin: "demo" | "live";
  items: BidListItem[];
  nextCursor: string | null;
  /** 목록 조건(cursor 없는 쿼리 문자열). 비었으면 조건 없는 기본 목록이다. */
  query: string;
  now: string;
  /** 조건 없는 0건 빈 상태에 [수집 실행] 단추를 둘지(ADMIN). 아니면 "관리자에게 수집을 요청하세요"를 보인다. */
  canRunIngestion: boolean;
  /** 이 목록 화면의 주소. [필터 초기화]·[처음부터 보기]가 간다. 기본 /bids. */
  basePath?: string;
  /** 더 보기 API·상세 ?list= 에 싣는 조건. 없으면 query 와 같다(BidListMore). */
  listSearch?: string;
  /** 내 관심 공고 id. 없거나 null(읽기 실패)이면 ★ 열이 없다. */
  watchedIds?: readonly string[] | null;
  /** 표 이름(caption, 낭독 전용). */
  caption?: string;
  /**
   * 0건일 때 그릴 빈 상태. 없으면 기본 빈 상태다 — 조건이 없으면 "아직 수집된 공고가 없습니다",
   * 있으면 "조건에 맞는 공고가 없습니다" + [필터 초기화](basePath 로).
   */
  empty?: React.ReactNode;
  /** 있으면 상태 필터에 이 이름으로 "마감·취소 포함" 선택지를 더한다(BidFilters, N3 D10). */
  closedStatusLabel?: string;
};

export function BidListView({
  defaultOrigin,
  items,
  nextCursor,
  query,
  now,
  canRunIngestion,
  basePath = "/bids",
  listSearch,
  watchedIds,
  caption,
  empty: emptyOverride,
  closedStatusLabel,
}: BidListViewProps) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const resetFilters = () => startTransition(() => router.push(basePath, { scroll: false }));

  const empty =
    emptyOverride ??
    (query === "" ? (
      <NoBidsEmptyState canRun={canRunIngestion} />
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
    ));

  return (
    <>
      <BidFilters
        defaultOrigin={defaultOrigin}
        startTransition={startTransition}
        closedStatusLabel={closedStatusLabel}
      />
      <div className="flex flex-col gap-3">
        <BidListMore
          initialItems={items}
          initialNextCursor={nextCursor}
          query={query}
          basePath={basePath}
          listSearch={listSearch}
          caption={caption}
          watchedIds={watchedIds}
          now={now}
          busy={isNavigating}
          empty={empty}
          startTransition={startTransition}
        />
      </div>
    </>
  );
}
