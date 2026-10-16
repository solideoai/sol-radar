import { cn } from "cn";
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  PanelLeftIcon,
  SettingsIcon,
  TrendingUpIcon,
} from "lucide-react";
import { BarChart, type BarChartDay } from "@/components/bar-chart";
import { Logo } from "@/components/logo";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// 실제 사용 기록이 아닌 견본이다. 통계 카드의 숫자도 이 배열로 계산한다 — 따로 적으면 차트와 어긋난다.
const SAMPLE_COUNTS = [3, 5, 2, 6, 4, 1, 4, 6, 3, 7, 5, 8, 4, 6];

// 날짜는 고정한다. 첫 화면은 정적이라 지금 시각으로 계산해도 빌드한 날에 멈춘다.
const SAMPLE_DAYS: BarChartDay[] = SAMPLE_COUNTS.map((count, index) => ({
  date: `2026-10-${String(index + 1).padStart(2, "0")}`,
  label: `10. ${index + 1}.`,
  count,
}));

const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

const LAST_7_DAYS_COUNT = sum(SAMPLE_COUNTS.slice(-7));
const PREVIOUS_7_DAYS_COUNT = sum(SAMPLE_COUNTS.slice(0, 7));
const TODAY = SAMPLE_DAYS[SAMPLE_DAYS.length - 1];

// 앱 틀(components/app-shell.tsx)의 메뉴와 같은 이름·아이콘이다. 링크가 아니다.
const NAV = [
  { label: "대시보드", icon: LayoutDashboardIcon, isCurrent: true },
  { label: "작업", icon: ListChecksIcon, isCurrent: false },
  { label: "설정", icon: SettingsIcon, isCurrent: false },
];

// 그림이라 화면 낭독기에서 숨기고(aria-hidden) 초점·클릭을 막는다(inert).
// 무엇을 그린 것인지와 "견본 데이터"라는 사실은 쓰는 쪽이 틀 가까이에 글자로 밝힌다.
export function DashboardPreview({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      inert
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background text-left shadow-sm",
        className,
      )}
    >
      <WindowBar />
      <div className="flex">
        <PreviewSidebar />
        {/* min-w-0 이 없으면 차트의 날짜 글자가 이 단을 넓혀 좁은 폭에서 틀 밖으로 나간다. */}
        <div className="min-w-0 flex-1">
          <div className="flex min-h-10 items-center gap-3 border-b border-border px-4">
            <PanelLeftIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="h-4 w-px bg-border" />
            <p className="type-label font-medium text-foreground">대시보드</p>
          </div>
          <div className="flex flex-col gap-4 p-4 sm:gap-6 sm:p-6">
            {/* 화면 제목의 모양이지만 제목 요소(h1)로 쓰지 않는다. 첫 화면의 h1 은 히어로 하나다. */}
            <div>
              <p className="type-title text-foreground">대시보드</p>
              <p className="mt-1 type-body text-muted-foreground">
                내 작업의 진행 상황을 한눈에 봅니다.
              </p>
            </div>
            {/* 칸 수는 화면 폭이 아니라 이 단의 폭으로 정한다. */}
            <div className="@container">
              <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-3">
                <StatCard
                  label="최근 7일 추가"
                  value={String(LAST_7_DAYS_COUNT)}
                  hint={
                    <span className="flex items-center gap-1">
                      {/* 좁은 틀에서는 아이콘을 뺀다. 아이콘이 자리를 차지하면 글이 세 줄로 꺾인다. */}
                      <TrendingUpIcon className="hidden size-3.5 shrink-0 @md:block" />
                      <span>그 앞 7일보다 {LAST_7_DAYS_COUNT - PREVIOUS_7_DAYS_COUNT}개 많음</span>
                    </span>
                  }
                />
                <StatCard
                  label="오늘 추가"
                  value={String(TODAY.count)}
                  // 좁은 카드에서 날짜("10. 14.")가 가운데에서 꺾이지 않게 묶는다.
                  hint={
                    <>
                      서울 시간 기준 <span className="whitespace-nowrap">{TODAY.label}</span>
                    </>
                  }
                />
                {/* 좁은 틀에서는 셋째 카드를 숨겨 견본 화면의 키를 줄인다. */}
                <StatCard
                  className="hidden @md:col-span-2 @md:flex @2xl:col-span-1"
                  label="마지막 작성"
                  value={TODAY.label}
                  hint="서울 시간 오전 7:41"
                />
              </div>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>최근 14일</CardTitle>
                <CardDescription>날짜별로 추가한 작업 수입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  days={SAMPLE_DAYS}
                  caption="최근 14일 날짜별 작업 추가 수"
                  valueHeader="추가한 작업"
                  unit="개"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// 주소 칸에는 경로만 적는다 — 호스트를 적으면 배포한 뒤에도 그 주소로 보인다.
function WindowBar() {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted px-3 py-2">
      <div className="flex w-12 shrink-0 gap-1.5">
        <span className="size-2.5 rounded-full bg-input" />
        <span className="size-2.5 rounded-full bg-input" />
        <span className="size-2.5 rounded-full bg-input" />
      </div>
      {/* min-w-0 이 없으면 주소 글자가 말줄임되지 않고 좁은 폭에서 막대를 넓힌다. */}
      <div className="mx-auto flex h-6 max-w-xs min-w-0 flex-1 items-center justify-center rounded-md border border-border bg-background px-3">
        <span className="truncate type-caption text-muted-foreground">/dashboard</span>
      </div>
      {/* 점 묶음과 같은 폭의 빈칸이라 주소 칸이 창 가운데에 온다. */}
      <div className="hidden w-12 shrink-0 sm:block" />
    </div>
  );
}

// 좁은 폭에서는 숨긴다 — 실제 앱 틀도 좁으면 사이드바를 서랍으로 접는다.
function PreviewSidebar() {
  return (
    <div className="hidden w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground lg:flex">
      <div className="flex min-h-8 items-center px-2">
        <Logo />
      </div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {NAV.map((item) => (
          <li
            key={item.label}
            className={cn(
              "flex items-center gap-2 rounded-md p-2 type-body",
              item.isCurrent && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
