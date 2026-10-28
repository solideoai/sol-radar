"use client";

import { cn } from "cn";
import {
  BellIcon,
  BriefcaseIcon,
  Building2Icon,
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  ClockIcon,
  MousePointer2Icon,
  PanelLeftIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

// 히어로 아래 "SOL RADAR 업무 데모". 동영상이 아니라 앱 화면을 닮게 HTML 로 그리고, 가짜 커서가 흐름을 따라 누른다.
// 상태는 단계 번호 하나다. 단계가 바뀌면 화면 쪽 요소가 CSS 전환(투명도·위치·막대 폭·숫자)으로 따라온다.
// 화면에 보이고 탭이 보일 때만 흐른다. 움직임 줄이기면 분석 상세의 완성 화면에서 멈춰 있고, 재생 버튼을 눌러야 흐른다.
// 움직이는 판은 화면 낭독기와 키보드에서 뺀다(aria-hidden·inert). 같은 흐름을 sr-only 문단으로 읽게 한다.
// 판 밖 오른쪽 아래의 멈춤·재생 버튼은 늘 보인다(WCAG 2.2.2).

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;

const subscribeTabVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const isTabVisible = () => document.visibilityState === "visible";

// 서버는 설정을 모른다. 첫 렌더(hydration)까지 이 값이고, 그 뒤 브라우저 값으로 바뀐다.
const onServer = { reducedMotion: () => false, tabVisible: () => true };

/** 사용자가 버튼으로 고른 것. null 이면 기본(움직임 줄이기가 아니면 흐른다). */
type Choice = "play" | "pause" | null;

export function WorkDemo() {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<Choice>(null);
  const [inView, setInView] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    onServer.reducedMotion,
  );
  const tabVisible = useSyncExternalStore(
    subscribeTabVisibility,
    isTabVisible,
    onServer.tabVisible,
  );

  const wantsPlay = choice === "play" || (choice === null && !reducedMotion);
  const running = wantsPlay && inView && tabVisible;
  // 움직임 줄이기에서 아직 재생을 누르지 않았으면 정지 화면을 보인다.
  const shownStep = reducedMotion && choice === null ? STATIC_STEP : step;
  const current = STEPS[shownStep];
  const showCursor = !(reducedMotion && choice === null);

  // 판이 화면에 30% 이상 보일 때만 흐른다.
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.3,
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // 단계마다 정한 시간이 지나면 다음 단계로. 마지막 단계 뒤에는 처음으로 돌아간다.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setStep((value) => (value + 1) % STEPS.length),
      STEPS[step].ms,
    );
    return () => window.clearTimeout(timer);
  }, [running, step]);

  // 커서는 그 단계가 가리키는 요소의 가운데 조금 오른쪽 아래로 옮긴다. 장면이 바뀌면 오른쪽 아래 여백으로 비켜 서고,
  // 가리킬 곳이 없는 단계는 그 자리에 둔다.
  useEffect(() => {
    const frame = frameRef.current;
    const cursor = cursorRef.current;
    const target = current.cursor;
    if (frame === null || cursor === null || target === undefined) return;
    if (target === "rest") {
      cursor.style.transform = `translate(${CURSOR_REST.x}px, ${CURSOR_REST.y}px)`;
      return;
    }
    const element = frame.querySelector(`[data-demo-target="${target}"]`);
    if (element === null) return;
    const box = frame.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const x = rect.left - box.left + Math.min(rect.width * 0.6, rect.width - 12);
    const y = rect.top - box.top + rect.height * 0.62;
    cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [current]);

  const pressed = current.press === true && current.cursor !== "rest" ? current.cursor : undefined;

  return (
    <section
      ref={sectionRef}
      aria-label="SOL RADAR 업무 데모"
      data-scene={current.scene}
      data-step={shownStep}
      className="mx-auto w-full max-w-300 px-10 pb-6"
    >
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
          "relative grid h-150 grid-cols-[208px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-background text-left select-none",
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
        {showCursor && <DemoCursor ref={cursorRef} pressed={pressed !== undefined} />}
      </div>
      {/* 캡션은 가운데, 멈춤·재생 버튼은 판 밖 오른쪽 끝이다. 어떤 장면의 내용과도 겹치지 않는다. */}
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <span />
        <p className="type-label-lg text-muted-foreground">
          가상 공고로 만든 예시 화면입니다. 출처 이름과 로고만 실제입니다.
        </p>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={wantsPlay ? "데모 멈춤" : "데모 재생"}
          onClick={() => setChoice(wantsPlay ? "pause" : "play")}
          className="justify-self-end"
        >
          {wantsPlay ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
        </Button>
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
                  "flex h-8 items-center rounded-md pl-8 type-body transition-colors duration-300 motion-reduce:transition-none",
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
            "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand transition-opacity duration-300 motion-reduce:transition-none",
            alert ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </div>
  );
}

// 가짜 커서: 화살표와 "담당자" 꼬리표. 누르는 단계에서 살짝 작아진다.
function DemoCursor({ ref, pressed }: { ref: React.Ref<HTMLDivElement>; pressed: boolean }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 z-20 transition-transform duration-900 ease-[cubic-bezier(0.45,0,0.2,1)] motion-reduce:transition-none"
      style={{ transform: `translate(${CURSOR_REST.x}px, ${CURSOR_REST.y}px)` }}
    >
      <div
        className={cn(
          "flex items-start transition-transform duration-150 motion-reduce:transition-none",
          pressed ? "scale-85" : "scale-100",
        )}
      >
        <MousePointer2Icon
          aria-hidden
          className="size-6 -translate-x-1 -translate-y-1 fill-foreground stroke-background stroke-[1.5]"
        />
        <span className="mt-4 -ml-1 rounded-full bg-foreground px-2 py-0.5 type-label font-semibold text-background">
          담당자
        </span>
      </div>
    </div>
  );
}
