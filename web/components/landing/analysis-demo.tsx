"use client";

import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/use-mobile";
import { CURSOR_REST, SHOWN_ALL, STEPS } from "@/components/landing/analysis-demo-data";
import type { DemoBid } from "@/components/landing/demo-bids";
import { DemoCursor, pointAt, translateOf } from "@/components/landing/demo-cursor";
import { useOnScreen, useReducedMotion, useStepLoop } from "@/components/landing/demo-playback";
import { ProductPreview } from "@/components/landing/product-preview";

// 분석 예시 보기(/#demo)가 오는 구역. 위 업무 데모처럼 가짜 커서가 목록의 공고를 차례로 눌러 분석이 채워지는 것을 보여 준다
// (2026-10-28 사용자 결정: 자동 재생 + 직접 조작, 세 공고 차례로, 사이드바 없음).
// 업무 데모와 달리 판은 진짜 탭이라 키보드·화면 낭독기로 그대로 쓴다(aria-hidden·inert 를 걸지 않는다).
// 판 안을 누르거나(pointerdown) 키보드 초점이 들어오면(focusin) 이 페이지에서는 직접 조작이다:
// 자동 재생이 멈추고 커서가 사라지고 지금 공고가 다 보이며, 탭은 클릭·방향키로 고른다. 마우스를 올려 두기만 해서는 멈추지 않는다.
// 움직임 줄이기면 첫 공고 완성 화면에 멈춰 있고 커서도 없다. 따로 숨은 멈춤 버튼은 두지 않는다(초점 진입이 멈춤이다).
// 구역의 data-bid(고른 공고)·data-step(단계 번호)·data-playback(auto·manual·static)은 E2E 가 읽는다.

type Playback = "auto" | "manual" | "static";

export function AnalysisDemo({ children }: { children: React.ReactNode }) {
  const figureRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  // 사람이 고른 공고. null 이면 아직 판에 손대지 않았다.
  const [manualBid, setManualBid] = useState<DemoBid["id"] | null>(null);
  const reducedMotion = useReducedMotion();
  const isMobile = useIsMobile();
  // 판이 화면에 30% 이상 보이고 탭이 보일 때만 흐른다.
  const onScreen = useOnScreen(figureRef);

  const playback: Playback =
    manualBid !== null ? "manual" : reducedMotion || isMobile ? "static" : "auto";
  const auto = playback === "auto";
  const step = useStepLoop(STEPS, auto && onScreen);
  const current = STEPS[step];
  const selected = manualBid ?? current.bid;

  // 커서는 그 단계가 가리키는 목록 줄로 옮기고, 가리킬 줄이 없으면 목록 아래 쉼 자리로 비켜 선다.
  useEffect(() => {
    const figure = figureRef.current;
    const cursor = cursorRef.current;
    if (figure === null || cursor === null) return;
    const target =
      current.pointing === undefined
        ? null
        : figure.querySelector(`[data-demo-target="${current.pointing}"]`);
    cursor.style.transform = translateOf(target === null ? CURSOR_REST : pointAt(figure, target));
  }, [current]);

  const takeOver = () => setManualBid((value) => value ?? selected);

  return (
    <section
      aria-label="공고 분석 예시"
      data-bid={selected}
      data-step={step}
      data-playback={playback}
      className="border-y border-border"
    >
      <div className="mx-auto w-full max-w-300 px-4 sm:px-6 xl:px-10 pt-14 xl:pt-28 pb-8 motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        {children}
        {/* 분석 예시 보기는 제목이 아니라 이 틀(figure)로 바로 온다 — 점수와 고지가 13인치 화면 안에 함께 들어와야 한다. */}
        {/* 판 아래 캡션 문장은 2026-10-28 사용자 요청으로 뺐다. 예시임은 판 머리의 "예시 데이터" 표시가 알린다. */}
        <figure
          id="demo"
          ref={figureRef}
          onPointerDown={takeOver}
          onFocus={takeOver}
          className="relative mt-8 xl:mt-14 scroll-mt-24"
        >
          <ProductPreview
            value={selected}
            onSelect={setManualBid}
            shown={auto ? current.shown : SHOWN_ALL}
            pointing={auto ? current.pointing : undefined}
            pressed={auto && current.press === true}
          />
          {auto && (
            <DemoCursor ref={cursorRef} rest={CURSOR_REST} pressed={current.press === true} />
          )}
        </figure>
      </div>
    </section>
  );
}
