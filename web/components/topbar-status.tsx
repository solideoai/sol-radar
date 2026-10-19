"use client";

import { cn } from "cn";
import { BellIcon, ClockIcon, CpuIcon, OctagonAlertIcon, ServerIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { DemoBadge } from "@/components/bids/status-badge";
import { formatKst, formatRelative } from "@/components/bids/format";
import { NOTIFICATION_ICON, NOTIFICATION_TYPE_LABEL } from "@/components/bids/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardSummary, Notification, RunMode } from "@/server/bids";

// 앱 상단바 오른쪽 지표 묶음(스펙 §4.1·§4.2·§4.3). 순서는 DEMO → 실행 모드 → AI → 수집 → 벨로 고정이다.
// 지표는 aria-live 를 두지 않는다. 30초마다 읽어 주면 시끄럽기 때문이다. AI 가 끊길 때만 숨은 status 한 곳이 읽는다.

export type TopbarSummary = Pick<DashboardSummary, "dataFreshness" | "unreadNotifications">;
export type AiIndicator = "mock" | "local" | "hosted" | "unavailable";

const AI_VALUES: readonly AiIndicator[] = ["mock", "local", "hosted", "unavailable"];
const DEFAULT_POLL_MS = 30_000;
const STALE_AFTER_MS = 60 * 60_000;
const CHECK_FAILED = "상태를 확인하지 못했습니다";
const LIST_LIMIT = 5;

// ── 마지막 값과 실패 여부 ──
type TopbarState = {
  summary: TopbarSummary | null;
  ai: AiIndicator | null;
  healthFailed: boolean;
  summaryFailed: boolean;
  /** 마지막으로 읽기를 끝낸 시각(ms). 상대 시각("12분 전")의 지금으로 쓴다. */
  checkedAt: number | null;
};
type TopbarActions = {
  seed: (summary: TopbarSummary | null, ai: AiIndicator | null) => void;
  reset: () => void;
};

const EMPTY_STATE: TopbarState = {
  summary: null,
  ai: null,
  healthFailed: false,
  summaryFailed: false,
  checkedAt: null,
};

export const useTopbarStore = create<TopbarState & TopbarActions>()((set) => ({
  ...EMPTY_STATE,
  // 서버가 그린 첫 값. 없는 쪽(null)은 지금 값을 지키고, 실패 표시는 지운다.
  seed: (summary, ai) =>
    set((prev) => ({
      summary: summary ?? prev.summary,
      ai: ai ?? prev.ai,
      healthFailed: false,
      summaryFailed: false,
    })),
  reset: () => set(EMPTY_STATE),
}));

// ── 읽기 ──
const isAi = (value: unknown): value is AiIndicator =>
  typeof value === "string" && AI_VALUES.some((known) => known === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readAi = async (): Promise<AiIndicator> => {
  const res = await fetch("/health/ready", { cache: "no-store" });
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body: unknown = await res.json();
  const ai = isRecord(body) && isRecord(body.checks) ? body.checks.ai : undefined;
  if (!isAi(ai)) throw new Error("health 응답 모양이 다르다");
  return ai;
};

const readSummary = async (): Promise<TopbarSummary> => {
  const res = await fetch("/api/v1/dashboard/summary", { cache: "no-store" });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  const body: unknown = await res.json();
  if (
    !isRecord(body) ||
    !isRecord(body.dataFreshness) ||
    typeof body.unreadNotifications !== "number"
  )
    throw new Error("summary 응답 모양이 다르다");
  // 위 검사로 필요한 두 칸이 있음을 확인했다. 나머지 칸은 이 부품이 쓰지 않는다.
  const { dataFreshness, unreadNotifications } = body as TopbarSummary;
  return { dataFreshness, unreadNotifications };
};

/** 두 주소를 바로 한 번 읽는다. 실패해도 던지지 않고 마지막 값을 지키며 실패 표시만 켠다. */
export async function refreshTopbarStatus(): Promise<void> {
  const { setState } = useTopbarStore;
  await Promise.all([
    readAi().then(
      (ai) => setState({ ai, healthFailed: false, checkedAt: Date.now() }),
      () => setState({ healthFailed: true, checkedAt: Date.now() }),
    ),
    readSummary().then(
      (summary) => setState({ summary, summaryFailed: false, checkedAt: Date.now() }),
      () => setState({ summaryFailed: true, checkedAt: Date.now() }),
    ),
  ]);
}

// ── 지표 하나의 껍데기. 설명(tip)이 있으면 초점을 받고 툴팁을 연다. ──
function Indicator({
  name,
  className,
  tip,
  children,
}: {
  name: string;
  className?: string;
  tip?: string | null;
  children: React.ReactNode;
}) {
  const box = cn("inline-flex items-center gap-1.5 whitespace-nowrap type-label", className);
  if (!tip)
    return (
      <span data-slot="topbar-item" data-indicator={name} className={box}>
        {children}
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        data-slot="topbar-item"
        data-indicator={name}
        className={cn(
          box,
          "rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function RunModeIndicator({ runMode }: { runMode: RunMode }) {
  return (
    <Indicator name="run-mode" className="text-muted-foreground">
      <ServerIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        실행 모드:{" "}
        <span data-part="value" className={runMode === "live" ? "text-foreground" : "text-warning"}>
          {runMode}
        </span>
      </span>
    </Indicator>
  );
}

function AiModeIndicator({ ai, healthFailed }: { ai: AiIndicator | null; healthFailed: boolean }) {
  if (ai === null)
    return (
      <Indicator
        name="ai"
        tip={healthFailed ? CHECK_FAILED : null}
        className="text-muted-foreground"
      >
        <CpuIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>AI: 확인 중</span>
        <Skeleton aria-hidden="true" className="h-3 w-16" />
      </Indicator>
    );
  const down = ai === "unavailable";
  const tip = [down ? "AI gateway에 연결할 수 없습니다" : null, healthFailed ? CHECK_FAILED : null]
    .filter((line) => line !== null)
    .join(" · ");
  const Icon = down ? OctagonAlertIcon : CpuIcon;
  return (
    <Indicator
      name="ai"
      tip={tip === "" ? null : tip}
      className={down ? "text-destructive" : "text-muted-foreground"}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>AI: {ai}</span>
    </Indicator>
  );
}

type FreshnessView = { text: string; className: string; tip: string | null };

const describeFreshness = (
  summary: TopbarSummary | null,
  now: Date,
  failed: boolean,
): FreshnessView => {
  if (summary === null)
    return { text: "—", className: "text-muted-foreground", tip: failed ? CHECK_FAILED : null };
  const { lastIngestAt, lastIngestStatus, lastIngestSummary } = summary.dataFreshness;
  const lines: string[] = [];
  if (lastIngestAt !== null) {
    const at = new Date(lastIngestAt);
    const utc = Number.isNaN(at.getTime()) ? "—" : at.toISOString().slice(0, 16).replace("T", " ");
    lines.push(`${formatKst(lastIngestAt)} KST · ${utc} UTC`);
  }
  if (lastIngestSummary !== null)
    lines.push(`적재 ${lastIngestSummary.created} · 격리 ${lastIngestSummary.quarantined}`);
  if (failed) lines.push(CHECK_FAILED);
  const tip = lines.length > 0 ? lines.join(" · ") : null;
  if (lastIngestAt === null)
    return { text: "수집 기록 없음", className: "text-muted-foreground", tip };
  const relative = formatRelative(lastIngestAt, now);
  if (lastIngestStatus === "FAILED")
    return { text: `수집 실패 · ${relative}`, className: "text-destructive", tip };
  const age = now.getTime() - new Date(lastIngestAt).getTime();
  if (age > STALE_AFTER_MS)
    return { text: `수집 지연 · ${relative}`, className: "text-warning", tip };
  return { text: `수집 ${relative}`, className: "text-muted-foreground", tip };
};

function DataFreshnessIndicator({
  summary,
  now,
  failed,
}: {
  summary: TopbarSummary | null;
  now: Date;
  failed: boolean;
}) {
  const view = describeFreshness(summary, now, failed);
  return (
    <Indicator name="freshness" className={view.className} tip={view.tip}>
      {summary !== null && <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />}
      {/* 서버가 그린 시각과 브라우저 시각이 달라도 경고를 내지 않는다. */}
      <span suppressHydrationWarning>{view.text}</span>
    </Indicator>
  );
}

// ── 알림 벨 ──
type ListState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; items: Notification[] };

const readNotifications = async (): Promise<Notification[]> => {
  const res = await fetch(`/api/v1/notifications?limit=${LIST_LIMIT}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`notifications ${res.status}`);
  const body: unknown = await res.json();
  if (!isRecord(body) || !Array.isArray(body.items)) throw new Error("알림 응답 모양이 다르다");
  // 서버 Route Handler 가 zod 로 검증한 Page<Notification> 이다. 그래도 이동 주소가 글자가 아닌 행은 건너뛰어 앱 셸이 오류 경계로 넘어가지 않게 한다.
  const items = body.items.filter(
    (item): item is Notification =>
      isRecord(item) && isRecord(item.payload) && typeof item.payload.link === "string",
  );
  return items.slice(0, LIST_LIMIT);
};

function NotificationBell({
  unread,
  failed,
  now,
}: {
  unread: number | null;
  failed: boolean;
  now: Date;
}) {
  const [list, setList] = useState<ListState>({ phase: "idle" });
  const open = useCallback((isOpen: boolean) => {
    if (!isOpen) return;
    setList({ phase: "loading" });
    readNotifications().then(
      (items) => setList({ phase: "ready", items }),
      () => setList({ phase: "error" }),
    );
  }, []);
  const count = unread ?? 0;
  const label = count > 0 ? `알림, 안 읽음 ${count}건` : "알림";
  return (
    <div data-slot="topbar-item" data-indicator="bell" className="relative">
      <DropdownMenu onOpenChange={open}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              title={failed ? CHECK_FAILED : undefined}
            />
          }
        >
          <BellIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-90">
          <BellList list={list} now={now} />
          <DropdownMenuSeparator />
          <DropdownMenuLinkItem render={<Link href="/notifications" />} className="justify-center">
            모두 보기
          </DropdownMenuLinkItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {count > 0 && (
        <span
          aria-hidden="true"
          data-part="count"
          className="pointer-events-none absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 type-caption text-primary-foreground tabular-nums"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </div>
  );
}

function BellList({ list, now }: { list: ListState; now: Date }) {
  if (list.phase === "idle" || list.phase === "loading")
    return <p className="px-2 py-3 type-label text-muted-foreground">알림을 불러오는 중</p>;
  if (list.phase === "error")
    return <p className="px-2 py-3 type-label text-destructive">알림을 불러오지 못했습니다</p>;
  if (list.items.length === 0)
    return <p className="px-2 py-3 type-label text-muted-foreground">알림이 없습니다</p>;
  return (
    <>
      {list.items.map((item) => {
        // 모르는 type 이면 기본 벨 아이콘과 type 글자를 쓴다.
        const Icon = NOTIFICATION_ICON[item.type] ?? BellIcon;
        return (
          // 이동 주소는 서버가 앱 안 경로로 걸러 준 payload.link 를 그대로 쓴다(걸러내는 규칙은 서버 한 곳에만 둔다).
          <DropdownMenuLinkItem
            key={item.id}
            render={<Link href={item.payload.link} />}
            className="items-start gap-2 py-2"
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-label text-foreground">
                {NOTIFICATION_TYPE_LABEL[item.type] ?? "알림"}
              </span>
              <span className="truncate type-caption text-muted-foreground">
                {item.payload.title}
              </span>
              <span className="type-caption text-muted-foreground">
                {formatRelative(item.createdAt, now)}
              </span>
            </span>
            {item.readAt === null && (
              <>
                <span
                  aria-hidden="true"
                  data-part="unread-dot"
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                />
                <span className="sr-only">안 읽음</span>
              </>
            )}
          </DropdownMenuLinkItem>
        );
      })}
    </>
  );
}

// ── 묶음 ──
export function TopbarStatus({
  runMode,
  initialSummary,
  initialAi,
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  runMode: RunMode;
  initialSummary: TopbarSummary | null;
  initialAi: AiIndicator | null;
  /** 시험에서 주기를 줄이려고 있다. 앱은 기본 30초를 쓴다. */
  pollIntervalMs?: number;
}) {
  const storedSummary = useTopbarStore((s) => s.summary);
  const storedAi = useTopbarStore((s) => s.ai);
  const healthFailed = useTopbarStore((s) => s.healthFailed);
  const summaryFailed = useTopbarStore((s) => s.summaryFailed);
  const checkedAt = useTopbarStore((s) => s.checkedAt);
  const [mountedAt] = useState(() => Date.now());
  const now = new Date(checkedAt ?? mountedAt);

  const summary = storedSummary ?? initialSummary;
  const ai = storedAi ?? initialAi;

  useEffect(() => {
    useTopbarStore.getState().seed(initialSummary, initialAi);
    const refresh = () => void refreshTopbarStatus();
    // 첫 값이 비어 있으면 바로 읽는다. 둘 다 있으면 첫 주기까지 기다린다.
    if (initialSummary === null || initialAi === null) refresh();
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, pollIntervalMs);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialSummary, initialAi, pollIntervalMs]);

  const demo = runMode !== "live";
  const divider = <Separator orientation="vertical" className="h-4 data-vertical:self-center" />;
  return (
    <div
      data-slot="topbar-status"
      className="flex items-center gap-3 whitespace-nowrap text-foreground"
    >
      {demo && (
        <>
          <span data-slot="topbar-item" data-indicator="demo" className="inline-flex">
            <DemoBadge withTooltip />
          </span>
          {divider}
        </>
      )}
      <RunModeIndicator runMode={runMode} />
      {divider}
      <AiModeIndicator ai={ai} healthFailed={healthFailed} />
      {divider}
      <DataFreshnessIndicator summary={summary} now={now} failed={summaryFailed} />
      {divider}
      <NotificationBell
        unread={summary?.unreadNotifications ?? null}
        failed={summaryFailed}
        now={now}
      />
      {/* 화면 낭독기용. 지표를 30초마다 읽지 않고, AI 가 끊겼을 때만 한 번 읽는다. */}
      <span role="status" className="sr-only">
        {ai === "unavailable" ? "AI 연결이 끊겼습니다" : ""}
      </span>
    </div>
  );
}
