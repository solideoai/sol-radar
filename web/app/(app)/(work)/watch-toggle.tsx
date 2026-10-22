"use client";

import { cn } from "cn";
import { StarIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestWatch, type WatchOutcome } from "./watch-bid";
import { WATCH_ADD_FAILED, WATCH_REMOVE_FAILED, WATCH_TOGGLE_LABEL } from "./watch-copy";

// ★ 토글(N3 디자인 §3). 표 행(32px ghost)과 상세 머리(36px outline) 두 자리에서 같은 동작을 쓴다.
// 누르면 바로 바꾸고(낙관적) 응답으로 확정한다. 실패하면 누르기 전으로 되돌리고 토스트 한 줄을 낸다.
// router.refresh() 를 부르지 않는다 — 더 보기로 붙인 행과 초점이 사라진다(§3.3-4).
// 서버가 새 처음 값을 내려 주면 부모가 key 를 바꿔 다시 붙인다(예: key={`${id}:${initialWatched}`}).

const SIZE = {
  row: { variant: "ghost", size: "icon-sm" },
  header: { variant: "outline", size: "icon" },
} as const;

// 기본 요청은 던지지 않지만 바꿔 끼운 요청이 던져도 실패 갈래로 보낸다(버튼이 잠긴 채 남지 않게).
async function attempt(run: () => Promise<WatchOutcome>): Promise<WatchOutcome> {
  try {
    return await run();
  } catch {
    return { ok: false };
  }
}

type WatchToggleProps = {
  bidId: string;
  initialWatched: boolean;
  size: "row" | "header";
  /** 이 버튼이 어느 공고인지 들려줄 요소의 id(표: 같은 행 제목 링크, 상세: "관심 N명" 글자). */
  describedBy?: string;
  /** 요청이 성공해 응답 값으로 확정됐을 때. 상세가 인원 수를 바꾼다(D7). */
  onSettled?: (result: { watched: boolean; watcherCount: number }) => void;
  /** 시험이 요청을 바꿔 끼운다. 기본은 PUT·DELETE /api/v1/bids/:id/watch. */
  request?: (bidId: string, watched: boolean) => Promise<WatchOutcome>;
};

export function WatchToggle({
  bidId,
  initialWatched,
  size,
  describedBy,
  onSettled,
  request = requestWatch,
}: WatchToggleProps) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, setPending] = useState(false);
  // 같은 렌더 안에서 두 번 눌린 것도 막는다(상태는 다음 렌더에야 보인다).
  const inFlight = useRef(false);

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const before = watched;
    const wanted = !before;
    setWatched(wanted);
    setPending(true);
    const outcome = await attempt(() => request(bidId, wanted));
    inFlight.current = false;
    setPending(false);
    if (outcome.ok) {
      setWatched(outcome.watched);
      onSettled?.({ watched: outcome.watched, watcherCount: outcome.watcherCount });
      return;
    }
    setWatched(before);
    toast.error(wanted ? WATCH_ADD_FAILED : WATCH_REMOVE_FAILED);
  };

  return (
    // 응답 전에는 disabled 대신 aria-disabled 로 막는다. 초점이 버튼에 남고 같은 버튼 연타는 무시된다(D3).
    <Button
      type="button"
      {...SIZE[size]}
      data-slot="watch-toggle"
      data-bid-id={bidId}
      aria-pressed={watched}
      aria-label={WATCH_TOGGLE_LABEL}
      aria-describedby={describedBy}
      disabled={pending}
      focusableWhenDisabled
      onClick={() => void toggle()}
    >
      {/* 색은 아이콘에 둔다. 버튼에 두면 ghost·outline 의 hover:text-foreground 가 켜진 별의 brand 를 덮는다(§3.2). */}
      <StarIcon
        aria-hidden="true"
        className={cn(
          "size-4",
          watched
            ? "fill-current text-brand"
            : "text-muted-foreground group-hover/button:text-foreground",
        )}
      />
    </Button>
  );
}
