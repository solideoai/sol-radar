"use client";

import { useRouter } from "next/navigation";
import {
  startTransition as defaultStartTransition,
  useEffect,
  useMemo,
  useRef,
  type TransitionStartFunction,
} from "react";
import { BidTable } from "@/components/bids/bid-table";
import type { BidListItem } from "@/server/bids";
import { LoadMoreFooter, useLoadMore } from "@/app/(app)/(work)/load-more";

// /bids 결과 줄 + 표 + "더 보기"(스펙 §5.3). 서버가 그린 첫 쪽에 GET /api/v1/bids?{query}&cursor= 결과를 이어 붙인다.
// 행을 한 표(tbody) 안에 이어 붙이려고 첫 쪽(initialItems)도 받는다. 표가 둘로 갈리면 머리 줄과 표 이름이 겹친다.

type BidListMoreProps = {
  initialItems: BidListItem[];
  initialNextCursor: string | null;
  /** 목록 조건(cursor 없는 쿼리 문자열). API 주소·[처음부터 보기]·상세 ?list= 에 같이 쓴다. */
  query: string;
  /** 서버가 요청마다 한 번 만든 시각(ISO). D-n 의 기준이다. */
  now: string;
  /** 필터가 바뀌어 서버가 다시 읽는 중이면 표를 흐리게 한다. */
  busy?: boolean;
  /** 0건일 때 표 자리에 그릴 빈 상태. */
  empty: React.ReactNode;
  /** [처음부터 보기] 이동을 감쌀 전환. 목록 화면이 넘기면 다시 읽는 동안 표가 흐려진다. */
  startTransition?: TransitionStartFunction;
};

export function BidListMore({
  initialItems,
  initialNextCursor,
  query,
  now,
  busy = false,
  empty,
  startTransition = defaultStartTransition,
}: BidListMoreProps) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const { items, hasNext, status, appendedFrom, loadMore } = useLoadMore({
    endpoint: query ? `/api/v1/bids?${query}` : "/api/v1/bids",
    initialItems,
    initialNextCursor,
  });

  // 다음 쪽을 붙이면 초점을 새로 붙은 첫 행의 제목으로 옮긴다. 키보드로 이어서 훑을 수 있고, 단추가 사라져도 초점을 잃지 않는다.
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (appendedFrom === null) return;
    const rows = tableRef.current?.querySelectorAll<HTMLElement>("tbody tr");
    rows?.[appendedFrom]?.querySelector<HTMLElement>("a")?.focus();
  }, [appendedFrom, items.length]);

  // 커서가 무효면 이어 읽을 수 없다. 같은 조건의 첫 쪽으로 이동해 서버가 다시 읽게 한다.
  // 동적 화면이라 같은 주소로의 이동도 서버에서 새로 읽는다(Next 16 클라이언트 캐시의 동적 유지 시간 0). 새 첫 쪽이 오면 붙인 행은 버려진다.
  const restart = () => startTransition(() => router.push(query ? `/bids?${query}` : "/bids"));

  return (
    <>
      {/* 조건·쪽이 바뀐 것을 화면 낭독기에 여기 한 곳에서만 알린다. */}
      <p role="status" className="type-label text-muted-foreground">
        공고 {items.length}건 표시
      </p>
      {items.length === 0 ? (
        empty
      ) : (
        <div ref={tableRef}>
          <BidTable
            items={items}
            caption="입찰 공고 목록"
            now={at}
            listQuery={query || undefined}
            busy={busy}
            footer={
              <LoadMoreFooter
                status={status}
                hasNext={hasNext}
                onLoadMore={() => void loadMore()}
                onRestart={restart}
              />
            }
          />
        </div>
      )}
    </>
  );
}
