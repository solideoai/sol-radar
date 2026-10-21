"use client";

import { useId, useState } from "react";
import type { WatchSummary } from "@/server/watchlist";
import { watcherCountLabel } from "@/app/(app)/(work)/watch-copy";
import { WatchToggle } from "@/app/(app)/(work)/watch-toggle";

// 상세 머리의 [관심 N명][★](N3 디자인 §4.3, D5). 버튼 줄(HeaderActions) 맨 앞 두 칸으로 들어간다.
// 숫자는 토글 응답의 watcherCount 로만 바꾼다(D7) — 다른 사람이 들어 있어 화면이 ±1 로 짐작하면 틀릴 수 있다.
// 인원 글자 요소는 0명일 때도 DOM 에 둔다(aria-live 가 생긴 뒤의 변화만 읽는다). 줄이 오른쪽 정렬이라 글자가 생기거나 사라져도 ★ 는 움직이지 않는다.

export function DetailWatch({ bidId, watch }: { bidId: string; watch: WatchSummary }) {
  const countId = useId();
  // 서버가 새 요약을 내려 주면(결정 기록 뒤 router.refresh 등) 서버 숫자로 맞춘다. 같은 값이면 화면 값을 그대로 둔다.
  const [count, setCount] = useState({ server: watch.watcherCount, shown: watch.watcherCount });
  if (count.server !== watch.watcherCount) {
    setCount({ server: watch.watcherCount, shown: watch.watcherCount });
  }
  const label = watcherCountLabel(count.shown);
  return (
    <>
      <span
        id={countId}
        data-slot="watch-count"
        aria-live="polite"
        className="type-label whitespace-nowrap text-muted-foreground tabular-nums"
      >
        {label}
      </span>
      <WatchToggle
        key={`${bidId}:${watch.watched}`}
        bidId={bidId}
        initialWatched={watch.watched}
        size="header"
        describedBy={label === "" ? undefined : countId}
        onSettled={({ watcherCount }) => setCount((prev) => ({ ...prev, shown: watcherCount }))}
      />
    </>
  );
}
