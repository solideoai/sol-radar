"use client";

import { cn } from "cn";
import {
  BellIcon,
  BriefcaseIcon,
  Building2Icon,
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  ClockIcon,
  PanelLeftIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { DemoCursor, pointAt, translateOf } from "@/components/landing/demo-cursor";
import { useOnScreen, useReducedMotion, useStepLoop } from "@/components/landing/demo-playback";
import { SectionHeading } from "@/components/landing/section-heading";
import {
  CollectScene,
  DashboardScene,
  DetailScene,
  TableScene,
  WatchlistScene,
} from "@/components/landing/work-demo-scenes";
import {
  CURSOR_REST,
  STATIC_STEP,
  STEP,
  STEPS,
  type DemoScene,
} from "@/components/landing/work-demo-data";
import styles from "@/components/landing/work-demo.module.css";
import { Button } from "@/components/ui/button";

// 흐르는 줄 둘(출처 고지 문장) 아래 "SOL RADAR 업무 데모". 동영상이 아니라 앱 화면을 닮게 HTML 로 그리고, 가짜 커서가 흐름을 따라 누른다.
// 판 위에는 아래 구역들과 같은 왼쪽 구역 제목·설명과 위 여백을 둔다(2026-10-28 사용자 요청: "공고 검색보다 …" 구역과 같은 글씨·위치).
// 출처 줄과는 화면 폭 전체 가는 선으로 나눈다(같은 날 사용자 요청 "section 나누라고 했잖아. 선으로라도").
// 상태는 단계 번호 하나다. 단계가 바뀌면 화면 쪽 요소가 CSS 전환(투명도·위치·막대 폭·숫자)으로 따라온다.
// 화면에 보이고 탭이 보일 때만 흐른다. 움직임 줄이기면 분석 상세의 완성 화면에서 멈춰 있고, 재생 버튼을 눌러야 흐른다.
// 움직이는 판은 화면 낭독기와 키보드에서 뺀다(aria-hidden·inert). 같은 흐름을 sr-only 문단으로 읽게 한다.
// 멈춤·재생 버튼은 화면에서 숨기고 키보드 초점이 올 때만 판 밖 오른쪽 아래에 보인다(2026-10-28 사용자 요청).
// WCAG 2.2.2(움직임 멈춤)는 이 버튼(키보드)과 움직임 줄이기 설정으로 지킨다.
// 재생 조건(화면에 보임·탭 보임·움직임 줄이기)과 단계 타이머, 가짜 커서는 분석 예시와 같이 쓴다(demo-playback.ts·demo-cursor.tsx).

/** 사용자가 버튼으로 고른 것. null 이면 기본(움직임 줄이기가 아니면 흐른다). */
type Choice = "play" | "pause" | null;

export function WorkDemo() {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const reducedMotion = useReducedMotion();
  // 판이 화면에 30% 이상 보이고 탭이 보일 때만 흐른다.
  const onScreen = useOnScreen(sectionRef);

  const wantsPlay = choice === "play" || (choice === null && !reducedMotion);
  const running = wantsPlay && onScreen;
  // 단계마다 정한 시간이 지나면 다음 단계로. 마지막 단계 뒤에는 처음으로 돌아간다.
  const step = useStepLoop(STEPS, running);
  // 움직임 줄이기에서 아직 재생을 누르지 않았으면 정지 화면을 보인다.
  const shownStep = reducedMotion && choice === null ? STATIC_STEP : step;
  const current = STEPS[shownStep];
  const showCursor = !(reducedMotion && choice === null);

  // 커서는 그 단계가 가리키는 요소의 가운데 조금 오른쪽 아래로 옮긴다. 장면이 바뀌면 오른쪽 아래 여백으로 비켜 서고,
  // 가리킬 곳이 없는 단계는 그 자리에 둔다.
  useEffect(() => {
    const frame = frameRef.current;
    const cursor = cursorRef.current;
    const target = current.cursor;
    if (frame === null || cursor === null || target === undefined) return;
    if (target === "rest") {
      cursor.style.transform = translateOf(CURSOR_REST);
      return;
    }
    const element = frame.querySelector(`[data-demo-target="${target}"]`);
    if (element === null) return;
    cursor.style.transform = translateOf(pointAt(frame, element));
  }, [current]);

  const pressed = current.press === true && current.cursor !== "rest" ? current.cursor : undefined;

  return (
    <section
      ref={sectionRef}
      aria-label="SOL RADAR 업무 데모"
      data-scene={current.scene}
      data-step={shownStep}
      className="mt-8 border-t border-border"
    >
      <div className="mx-auto w-full max-w-300 px-10 pt-28 pb-6">
        <SectionHeading
          id="work-demo-title"
          title="매일 아침, 새 공고가 검토 목록이 되기까지"
          description={
            <>
              수집 에이전트가 공고를 모으면 우리 회사에 맞는 공고를 골라 자격·점수·근거를 붙입니다.
              <br />
              참여 여부는 담당자가 정합니다.
            </>
          }
        />
        <p className="sr-only">
          SOL RADAR 의 하루 흐름을 보여 주는 예시 화면입니다. 매일 아침 수집 에이전트가
          나라장터·LH·K-water·한국전력공사·기업마당에서 새 공고를 가져오고, 우리 회사 업종에 맞는
          공고를 골라 SOL Score 와 권고를 붙입니다. 공고를 열면 필수 자격을 공고문 인용과 함께
          판정하고 다섯 요소 점수를 보여 줍니다. 담당자가 관심 공고에 담으면 마감 사흘 전에 알림을
          보냅니다. 참여 결정은 사람이 합니다. 가상 공고로 만든 예시입니다.
        </p>
        <div
          ref={frameRef}
          aria-hidden
          inert
          className={cn(
            "relative mt-14 grid h-150 grid-cols-[208px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-background text-left select-none",
            !running && styles.paused,
          )}
        >
          <DemoSidebar scene={current.scene} />
          <div className="flex min-w-0 flex-col">
            <DemoTopBar alert={shownStep >= STEP.reminder} />
            <div className="relative min-h-0 flex-1">
              <DashboardScene active={current.scene === 1} step={shownStep} pressed={pressed} />
              <CollectScene active={current.scene === 2} step={shownStep} pressed={pressed} />
              <TableScene active={current.scene === 3} step={shownStep} pressed={pressed} />
              <DetailScene active={current.scene === 4} step={shownStep} pressed={pressed} />
              <WatchlistScene active={current.scene === 5} step={shownStep} pressed={pressed} />
            </div>
          </div>
          {showCursor && (
            <DemoCursor ref={cursorRef} rest={CURSOR_REST} pressed={pressed !== undefined} />
          )}
        </div>
        {/* 멈춤·재생 버튼은 판 밖 오른쪽 끝이고 키보드 초점이 올 때만 보인다. 어떤 장면의 내용과도 겹치지 않는다. */}
        {/* 판 아래 캡션 문장은 2026-10-28 사용자 요청으로 뺐다. 가상임은 기관 이름("가상 …")과 sr-only 문단이 알린다. */}
        {/* not-sr-only 는 여백을 0 으로 되돌리므로 판과의 간격은 버튼 쪽에 둔다. */}
        <div className="sr-only flex justify-end has-focus-visible:not-sr-only">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={wantsPlay ? "데모 멈춤" : "데모 재생"}
            onClick={() => setChoice(wantsPlay ? "pause" : "play")}
            className="mt-3"
          >
            {wantsPlay ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          </Button>
        </div>
      </div>
    </section>
  );
}

// 앱 사이드바(ADR-061 4차)를 닮게: 묶음 줄에만 아이콘, 메뉴는 글자만 들여 쓰고 지금 메뉴는 연한 파랑.
const SIDEBAR_GROUPS = [
  {
    label: "업무",
    icon: BriefcaseIcon,
    items: ["대시보드", "입찰 공고", "관심 공고", "입찰 일정", "알림"],
  },
  { label: "분석", icon: ChartNoAxesColumnIcon, items: ["자격 갭 레이더", "발주 현황"] },
  { label: "회사", icon: Building2Icon, items: ["회사 역량"] },
] as const;

const ACTIVE_MENU: Record<DemoScene, string> = {
  1: "대시보드",
  2: "대시보드",
  3: "입찰 공고",
  4: "입찰 공고",
  5: "관심 공고",
};

function DemoSidebar({ scene }: { scene: DemoScene }) {
  return (
    <div className="flex min-h-0 flex-col border-r border-border bg-background px-3 py-4">
      <div className="flex items-center gap-1.5 px-1">
        <Image
          src="/logo/sol-radar.webp"
          alt=""
          width={28}
          height={28}
          unoptimized
          className="size-7 object-contain"
        />
        <span className="type-heading font-extrabold text-foreground">SOL RADAR</span>
      </div>
      <p className="mt-1 px-1 type-label text-muted-foreground">예시 회사</p>
      <div className="mt-5 flex flex-col gap-3">
        {SIDEBAR_GROUPS.map(({ label, icon: Icon, items }) => (
          <div key={label}>
            <p className="flex h-8 items-center gap-2 px-2 type-label font-semibold text-foreground">
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              {label}
              <ChevronDownIcon aria-hidden className="ml-auto size-4 text-muted-foreground" />
            </p>
            {items.map((item) => (
              <p
                key={item}
                className={cn(
                  "flex h-8 items-center rounded-md pl-8 type-body transition-colors duration-240 motion-reduce:transition-none",
                  item === ACTIVE_MENU[scene]
                    ? "bg-selected font-semibold text-selected-foreground"
                    : "text-foreground",
                )}
              >
                {item}
              </p>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-auto flex h-8 items-center gap-2 px-2 type-body text-foreground">
        <SettingsIcon aria-hidden className="size-4 text-muted-foreground" />
        설정
      </p>
    </div>
  );
}

function DemoTopBar({ alert }: { alert: boolean }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
      <PanelLeftIcon aria-hidden className="size-4 text-muted-foreground" />
      <span className="ml-auto flex items-center gap-1.5 type-label text-muted-foreground">
        <ClockIcon aria-hidden className="size-4" />
        수집 오늘 06:00
      </span>
      <span aria-hidden className="h-4 w-px bg-border" />
      <span className="relative">
        <BellIcon aria-hidden className="size-4 text-foreground" />
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand transition-opacity duration-240 motion-reduce:transition-none",
            alert ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </div>
  );
}
