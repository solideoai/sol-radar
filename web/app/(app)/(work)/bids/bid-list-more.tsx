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
import { WatchToggle } from "@/app/(app)/(work)/watch-toggle";

// /bids 결과 줄 + 표 + "더 보기"(스펙 §5.3). 서버가 그린 첫 쪽에 GET /api/v1/bids?{query}&cursor= 결과를 이어 붙인다.
// 행을 한 표(tbody) 안에 이어 붙이려고 첫 쪽(initialItems)도 받는다. 표가 둘로 갈리면 머리 줄과 표 이름이 겹친다.
// 관심 공고(/watchlist, N3)도 같은 부품이다. 화면 주소(basePath)와 API·상세에 싣는 조건(listSearch)만 다르다.

const BIDS_PATH = "/bids";
const BIDS_CAPTION = "입찰 공고 목록";

type BidListMoreProps = {
  initialItems: BidListItem[];
  initialNextCursor: string | null;
  /** 화면 조건(cursor 없는 쿼리 문자열). [처음부터 보기] 주소에 쓴다. listSearch 가 없으면 API·상세 ?list= 에도 쓴다. */
  query: string;
  /** 이 목록 화면의 주소. [처음부터 보기]가 `${basePath}?${query}` 로 간다. */
  basePath?: string;
  /**
   * 더 보기 API(`/api/v1/bids?<listSearch>`)와 상세 ?list= 에 싣는 조건. 없으면 query 와 같다.
   * /watchlist 는 query 에 watched=me 를 붙인 값을 넘긴다(화면 주소에는 watched 를 적지 않는다).
   */
  listSearch?: string;
  /** 표 이름(caption, 낭독 전용). */
  caption?: string;
  /**
   * 내 관심 공고 id. 있으면 표 맨 앞에 ★ 열을 그리고 행마다 처음 값을 이 목록으로 정한다(더 보기로 붙은 행도).
   * 없거나 null(읽기 실패, D15)이면 ★ 열이 없다.
   */
  watchedIds?: readonly string[] | null;
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
  basePath = BIDS_PATH,
  listSearch = query,
  caption = BIDS_CAPTION,
  watchedIds = null,
  now,
  busy = false,
  empty,
  startTransition = defaultStartTransition,
}: BidListMoreProps) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const watched = useMemo(() => (watchedIds === null ? null : new Set(watchedIds)), [watchedIds]);
  const { items, hasNext, status, appendedFrom, loadMore } = useLoadMore({
    endpoint: listSearch ? `/api/v1/bids?${listSearch}` : "/api/v1/bids",
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
  const restart = () =>
    startTransition(() => router.push(query ? `${basePath}?${query}` : basePath));

  // 서버가 새 관심 id 를 내려 주면(조건 변경·새로 고침) 처음 값이 바뀐 행만 key 가 바뀌어 그 값으로 다시 붙는다.
  // 누른 뒤의 화면 값은 그대로 둔다 — /watchlist 에서 뺀 행도 다음 서버 읽기까지 그 자리에 남는다(D4).
  const watchSlot =
    watched === null
      ? undefined
      : (item: BidListItem, titleId: string) => {
          const initialWatched = watched.has(item.id);
          return (
            <WatchToggle
              key={`${item.id}:${initialWatched}`}
              bidId={item.id}
              initialWatched={initialWatched}
              size="row"
              describedBy={titleId}
            />
          );
        };

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
            caption={caption}
            now={at}
            listQuery={listSearch || undefined}
            busy={busy}
            watch={watchSlot}
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
