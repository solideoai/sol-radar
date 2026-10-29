import { cn } from "cn";
import {
  ArrowRightIcon,
  BellRingIcon,
  CalendarDaysIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
  RadarIcon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import type { QualificationStatus } from "@/components/landing/analysis";
import { WORK_DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import { RecommendationBadge } from "@/components/landing/status-badges";
import {
  COLLECTED,
  COLLECTED_TOTAL,
  STEP,
  dDayOf,
  formatEok,
  reminderDateOf,
  type CursorTarget,
} from "@/components/landing/work-demo-data";
import styles from "@/components/landing/work-demo.module.css";

// 업무 데모(work-demo.tsx)의 다섯 장면. 장면은 모두 그려 두고 지금 장면만 보인다.
// 요소마다 "이 단계부터 보인다"를 step 으로 정하고, 나타나는 모습은 CSS 전환(투명도·위치·폭·숫자)이 맡는다.
// 첫 화면 규칙대로 글자는 13px(type-label) 이상이다. 판 전체가 aria-hidden 이라 버튼처럼 보이는 것도 글자 칸이다.

type SceneProps = { active: boolean; step: number; pressed: CursorTarget | undefined };

const RELATED = WORK_DEMO_BIDS;
const NEEDS_REVIEW = RELATED.filter((bid) => bid.counts.NEEDS_REVIEW > 0);
const NEEDS_REVIEW_ITEMS = NEEDS_REVIEW.flatMap((bid) =>
  bid.checks.filter((check) => check.status === "NEEDS_REVIEW").map((check) => check.requirement),
);
const bidById = (id: string): DemoBid => {
  const bid = RELATED.find((candidate) => candidate.id === id);
  if (bid === undefined) throw new Error(`가상 공고 없음: ${id}`);
  return bid;
};
// 표에서 여는 공고, 관심 공고에 담는 공고. 자격 확인이 필요한 첫 공고다.
const OPENED = bidById("demo-1");
// 이미 담아 둔 공고. 대시보드의 관심 공고 수에 담은 1건을 더한 것이 마지막 장면의 줄 수와 같다.
const ALREADY_WATCHED = [bidById("demo-5"), bidById("demo-2")];
const REMIND_DAYS_BEFORE = 3;

// 단계 상태가 keyframe을 시작한다. CSS 변수를 써서 멈춤 중 지연 시간도 함께 멈춘다.
const reveal = (on: boolean, delay = 0) => ({
  className: cn(styles.reveal, on && styles.revealed),
  style: { "--reveal-delay": `${delay}ms` } as React.CSSProperties,
});

function Reveal({
  on,
  delay = 0,
  className,
  children,
}: {
  on: boolean;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const motion = reveal(on, delay);
  return (
    <div className={cn(motion.className, className)} style={motion.style}>
      {children}
    </div>
  );
}

function ScenePanel({
  active,
  panelDuration,
  children,
}: {
  active: boolean;
  panelDuration?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      data-active={active}
      data-demo-panel={panelDuration === undefined ? "scene" : "slide"}
      className={cn(
        styles.scene,
        panelDuration !== undefined && styles.panel,
        "absolute inset-0 overflow-hidden bg-background px-7 pt-5 pb-6",
      )}
      style={{ "--panel-duration": `${panelDuration ?? 0}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function Breadcrumb({ parts }: { parts: readonly string[] }) {
  return <p className="type-label text-muted-foreground">{parts.join(" / ")}</p>;
}

/** 0 에서 value 까지 오르는 숫자. on 이 아니면 0 이다. */
function Count({ value, on, delay = 0 }: { value: number; on: boolean; delay?: number }) {
  return (
    <span
      className={cn(styles.count, "tabular-nums")}
      style={
        {
          "--work-demo-count": on ? value : 0,
          transitionDelay: on ? `${delay}ms` : "0ms",
        } as React.CSSProperties
      }
    />
  );
}

/** 커서가 누르는 칸. 누르는 단계에서 살짝 눌린다. */
function Target({
  name,
  pressed,
  className,
  children,
}: {
  name: CursorTarget;
  pressed: CursorTarget | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-demo-target={name}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md transition-[scale,background-color] duration-120 motion-reduce:transition-none",
        pressed === name && "scale-95",
        className,
      )}
    >
      {children}
    </span>
  );
}

const dDay = (bid: DemoBid) => `D-${dDayOf(bid.proposalDue)}`;

// ── 1. 대시보드 ──
export function DashboardScene({ active, step, pressed }: SceneProps) {
  const hovered = step >= STEP.agentHover;
  return (
    <ScenePanel active={active}>
      <Breadcrumb parts={["업무", "대시보드"]} />
      <p className="mt-1.5 type-heading-lg text-foreground">대시보드</p>
      <p className="mt-0.5 type-body text-muted-foreground">
        오늘 확인할 공고와 마감을 한곳에서 봅니다.
      </p>
      <div className="mt-5 grid grid-cols-4 gap-3">
        <div
          className={cn(
            "flex flex-col rounded-lg border bg-selected p-4 transition-colors duration-240 motion-reduce:transition-none",
            hovered ? "border-brand/50" : "border-brand/20",
          )}
        >
          <p className="flex items-center gap-1.5 type-label font-semibold text-selected-foreground">
            <RadarIcon aria-hidden className="size-4" />
            수집 에이전트
            <span className="ml-auto font-normal text-foreground">06:00</span>
          </p>
          <p className="mt-3 type-label text-foreground">오늘 새 공고</p>
          <p className="type-heading text-foreground">{COLLECTED_TOTAL}건을 가져왔어요</p>
          <Target
            name="agent-confirm"
            pressed={pressed}
            className="mt-4 h-8 w-full border border-brand/30 bg-background type-label font-semibold text-selected-foreground"
          >
            확인
          </Target>
        </div>
        <Stat label="관심 공고" value={ALREADY_WATCHED.length} foot="마감 30일 안" />
        <Stat label="분석 완료" value={12} foot="이번 주" />
        <Stat label="자격 확인 필요" value={NEEDS_REVIEW.length} foot="필수 자격 확인 대기" />
      </div>
      <p className="mt-6 type-heading text-foreground">마감이 가까운 관심 공고</p>
      <ul className="mt-2.5 divide-y divide-border rounded-lg border border-border">
        {ALREADY_WATCHED.map((bid) => (
          <li key={bid.id} className="flex items-center gap-4 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate type-body font-medium text-foreground">{bid.title}</p>
              <p className="type-label text-muted-foreground">{bid.agency}</p>
            </div>
            <span className="type-body font-semibold text-foreground tabular-nums">
              {dDay(bid)}
            </span>
            <span className="w-24 text-right type-label text-muted-foreground">
              SOL Score{" "}
              <span className="type-body font-semibold text-foreground tabular-nums">
                {bid.score}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </ScenePanel>
  );
}

function Stat({ label, value, foot }: { label: string; value: number; foot: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="type-label text-muted-foreground">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="type-subhead text-foreground tabular-nums">{value}</span>
        <span className="type-body text-muted-foreground">건</span>
      </p>
      <p className="mt-1 type-label text-muted-foreground">{foot}</p>
    </div>
  );
}

// ── 2. 수집 ──
// 패널이 도착한 뒤 숫자와 완료 표시를 순서대로 시작한다.
const ROW_START_MS = 520;
const ROW_GAP_MS = 240;
const COUNT_MS = 880;

export function CollectScene({ active, step, pressed }: SceneProps) {
  const collecting = step >= STEP.collectRows;
  const typing = step >= STEP.collectCaret && step < STEP.collectMessage;
  const said = step >= STEP.collectMessage;
  const lastDoneMs = ROW_START_MS + ROW_GAP_MS * (COLLECTED.length - 1) + COUNT_MS;
  return (
    <ScenePanel active={active} panelDuration={480}>
      <Breadcrumb parts={["업무", "대시보드", "수집 에이전트"]} />
      <div className="mt-2 flex items-center gap-3">
        <AgentAvatar />
        <div>
          <p className="type-heading text-foreground">수집 에이전트</p>
          <p className="type-label text-muted-foreground">
            오늘 06:00 정기 수집 · 공고 출처 {COLLECTED.length}곳
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        {COLLECTED.map((source, index) => {
          const startMs = ROW_START_MS + ROW_GAP_MS * index;
          const doneMs = startMs + COUNT_MS;
          return (
            <div
              key={source.name}
              className="relative isolate grid h-13 grid-cols-[148px_minmax(0,1fr)_96px_96px] items-center gap-4 border-b border-border px-4"
            >
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 -z-10 bg-selected opacity-0",
                  active && collecting && styles.flash,
                )}
                style={{ animationDelay: `${doneMs}ms` }}
              />
              <span className="flex h-7 w-30 items-center">
                <Image
                  src={source.logo.src}
                  alt=""
                  width={source.logo.width}
                  height={source.logo.height}
                  unoptimized
                  style={{ height: source.logo.displayHeight }}
                  className="w-auto max-w-full object-contain object-left"
                />
              </span>
              <span className="type-label text-muted-foreground">{source.kind}</span>
              <span className="text-right type-body font-semibold text-foreground">
                <Count value={source.count} on={collecting} delay={startMs} />건
              </span>
              <span className="relative h-5">
                <span
                  className={cn(
                    "absolute inset-0 flex items-center gap-1.5 type-label text-muted-foreground transition-opacity duration-240 motion-reduce:transition-none",
                    collecting ? "opacity-0" : "opacity-100",
                  )}
                  style={{ transitionDelay: collecting ? `${doneMs}ms` : "0ms" }}
                >
                  <LoaderCircleIcon aria-hidden className="size-4 motion-safe:animate-spin" />
                  받는 중
                </span>
                <span
                  className={cn(
                    "absolute inset-0 flex items-center gap-1.5 type-label font-semibold text-success transition-opacity duration-240 motion-reduce:transition-none",
                    collecting ? "opacity-100" : "opacity-0",
                  )}
                  style={{ transitionDelay: collecting ? `${doneMs}ms` : "0ms" }}
                >
                  <CircleCheckIcon aria-hidden className="size-4" />
                  완료
                </span>
              </span>
            </div>
          );
        })}
        <div className="grid h-11 grid-cols-[148px_minmax(0,1fr)_96px_96px] items-center gap-4 bg-muted/40 px-4">
          <span className="type-label font-semibold text-foreground">새 공고 합계</span>
          <span />
          <span className="text-right type-body font-semibold text-foreground">
            <Count value={COLLECTED_TOTAL} on={collecting} delay={lastDoneMs - COUNT_MS} />건
          </span>
          <span />
        </div>
      </div>
      <Reveal on={collecting} delay={520} className="mt-5 flex items-start gap-3">
        <AgentAvatar />
        <div className="min-h-16 pt-1">
          {!typing && !said && (
            <p className="flex items-center gap-1 type-label-lg text-muted-foreground">
              출처 {COLLECTED.length}곳에서 새 공고를 받는 중이에요
              <span className={cn("inline-block h-5 w-0.5 bg-muted-foreground", styles.caret)} />
            </p>
          )}
          <span
            aria-hidden
            className={cn(
              "inline-block h-5 w-0.5 bg-foreground align-middle",
              styles.caret,
              typing ? "opacity-100" : "hidden",
            )}
          />
          <Reveal on={said} className="type-label-lg text-foreground">
            새 공고 {COLLECTED_TOTAL}건 중 우리 회사 업종에 맞는 공고{" "}
            <strong className="font-semibold">{RELATED.length}건</strong>을 골랐어요.{" "}
            <strong className="font-semibold">{NEEDS_REVIEW.length}건</strong>은 자격 확인이
            필요해요.
          </Reveal>
          <Reveal on={said} delay={480} className="mt-3">
            <Target
              name="collect-next"
              pressed={pressed}
              className="h-8 border border-border bg-background px-3 type-label font-semibold text-foreground"
            >
              관련 공고 {RELATED.length}건 보기
              <ArrowRightIcon aria-hidden className="size-4" />
            </Target>
          </Reveal>
        </div>
      </Reveal>
    </ScenePanel>
  );
}

function AgentAvatar() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected text-selected-foreground">
      <RadarIcon aria-hidden className="size-4.5" />
    </span>
  );
}

// ── 3. 관련 공고 표 ──
const TABLE_COLUMNS = "grid-cols-[104px_minmax(0,1fr)_64px_52px_80px_100px]";

export function TableScene({ active, step, pressed }: SceneProps) {
  const listed = step >= STEP.tableRows;
  const hovered = step >= STEP.rowHover;
  return (
    <ScenePanel active={active}>
      <Breadcrumb parts={["업무", "입찰 공고"]} />
      <div className="mt-1.5 flex items-center gap-2.5">
        <p className="type-heading-lg text-foreground">관련 공고</p>
        <span className="rounded-md bg-secondary px-2 py-0.5 type-label text-secondary-foreground">
          우리 회사 업종 · {RELATED.length}건
        </span>
      </div>
      <p className="mt-0.5 type-label text-muted-foreground">
        오늘 06:00 수집분에서 골랐습니다 · SOL Score 높은 순
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <div
          className={cn(
            "grid h-9 items-center gap-3 bg-muted/50 px-4 type-label text-muted-foreground",
            TABLE_COLUMNS,
          )}
        >
          <span>출처</span>
          <span>공고명</span>
          <span className="text-right">예산</span>
          <span>마감</span>
          <span className="text-right">SOL Score</span>
          <span>권고</span>
        </div>
        {RELATED.map((bid, index) => {
          const shown = reveal(listed, 240 + index * 120);
          const opened = bid.id === OPENED.id;
          return (
            <div
              key={bid.id}
              style={shown.style}
              className={cn(
                shown.className,
                "grid h-13 items-center gap-3 border-t border-border px-4",
                TABLE_COLUMNS,
                opened && hovered && "bg-selected",
              )}
            >
              <span className="w-fit rounded-md border border-border px-1.5 type-label whitespace-nowrap text-foreground">
                {bid.source}
              </span>
              <span className="min-w-0">
                {opened ? (
                  <Target
                    name="bid-row"
                    pressed={pressed}
                    className="block max-w-full truncate text-left type-body font-medium text-foreground"
                  >
                    {bid.title}
                  </Target>
                ) : (
                  <span className="block truncate type-body font-medium text-foreground">
                    {bid.title}
                  </span>
                )}
                <span className="block truncate type-label text-muted-foreground">
                  {bid.agency}
                </span>
              </span>
              <span className="text-right type-body text-foreground tabular-nums">
                {formatEok(bid.budgetWon)}
              </span>
              <span className="type-body text-foreground tabular-nums">{dDay(bid)}</span>
              <span className="text-right type-body font-semibold text-foreground">
                <Count value={bid.score} on={listed} delay={200 + index * 136} />
              </span>
              <span>
                <RecommendationBadge value={bid.recommendation} />
              </span>
            </div>
          );
        })}
      </div>
      <Reveal
        on={step >= STEP.tableReview}
        className="mt-3.5 flex items-center gap-2 type-label-lg text-foreground"
      >
        <CircleHelpIcon aria-hidden className="size-4.5 shrink-0 text-warning" />
        <span className="font-semibold">자격 확인이 필요한 공고 {NEEDS_REVIEW.length}건</span>
        <span className="text-muted-foreground">{NEEDS_REVIEW_ITEMS.join(" · ")}</span>
      </Reveal>
    </ScenePanel>
  );
}

// ── 4. 분석 상세 ──
const CHECK_STATUS: Record<QualificationStatus, { label: string; icon: LucideIcon; tone: string }> =
  {
    SATISFIED: { label: "충족", icon: CircleCheckIcon, tone: "text-success" },
    NEEDS_REVIEW: { label: "확인 필요", icon: CircleHelpIcon, tone: "text-warning" },
    NOT_SATISFIED: { label: "미충족", icon: CircleXIcon, tone: "text-destructive" },
  };
const CHECK_START_MS = 560;
const CHECK_GAP_MS = 520;

export function DetailScene({ active, step, pressed }: SceneProps) {
  const judging = step >= STEP.detailChecks;
  const scoring = step >= STEP.detailScore;
  const quoting = step >= STEP.detailQuote;
  const bubble = step >= STEP.detailBubble;
  const bid = OPENED;
  return (
    <ScenePanel active={active} panelDuration={500}>
      <Breadcrumb parts={["업무", "입찰 공고"]} />
      <p className="mt-1.5 type-heading-lg text-foreground">{bid.title}</p>
      <p className="mt-0.5 type-label-lg text-muted-foreground">
        {bid.agency} · 예산 {formatWon(bid.budgetWon)} · 제안서 마감 {formatDate(bid.proposalDue)} (
        {dDay(bid)})
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_264px] gap-7">
        <div className="min-w-0">
          <div className="flex items-center justify-between border-t border-foreground py-2.5">
            <p className="type-heading text-foreground">참가 자격 검토</p>
            <Reveal on={scoring} className="type-label text-muted-foreground">
              충족 {bid.counts.SATISFIED} · 확인 필요 {bid.counts.NEEDS_REVIEW} · 미충족{" "}
              {bid.counts.NOT_SATISFIED}
            </Reveal>
          </div>
          <ul className="border-b border-border">
            {bid.checks.map((check, index) => {
              const delay = CHECK_START_MS + CHECK_GAP_MS * index;
              const status = CHECK_STATUS[check.status];
              const highlight = quoting && check.status === "NEEDS_REVIEW";
              return (
                <li
                  key={check.requirement}
                  className="relative isolate grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 border-t border-border py-2.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 -z-10 bg-selected opacity-0",
                      active && judging && styles.flash,
                    )}
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <span className="relative h-6">
                    <span
                      className={cn(
                        "absolute inset-0 flex items-center gap-1.5 type-label text-muted-foreground transition-opacity duration-240 motion-reduce:transition-none",
                        judging ? "opacity-0" : "opacity-100",
                      )}
                      style={{ transitionDelay: judging ? `${delay}ms` : "0ms" }}
                    >
                      <LoaderCircleIcon aria-hidden className="size-4 motion-safe:animate-spin" />
                      판정 중
                    </span>
                    <span
                      className={cn(
                        "absolute inset-0 flex items-center gap-1.5 type-body font-semibold whitespace-nowrap",
                        reveal(judging, delay).className,
                        styles.check,
                        status.tone,
                      )}
                      style={reveal(judging, delay).style}
                    >
                      <status.icon aria-hidden className="size-4" />
                      {status.label}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="type-body font-semibold text-foreground">{check.requirement}</p>
                    <p className="mt-1 flex items-start gap-2 type-label text-foreground">
                      <span className="shrink-0 font-semibold">공고문 p.{check.evidence.page}</span>
                      <span
                        className={cn(
                          "relative isolate rounded-sm bg-brand/8 px-0.5",
                          highlight && "ring-1 ring-brand/40",
                        )}
                      >
                        {highlight && (
                          <span
                            aria-hidden
                            className={cn(
                              styles.evidenceSweep,
                              "pointer-events-none absolute inset-0 -z-10 rounded-sm bg-selected",
                            )}
                          />
                        )}
                        「{check.evidence.quote}」
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="type-label text-muted-foreground">SOL Score</p>
          <p className="flex items-baseline gap-1">
            <span className="type-subhead text-foreground">
              <Count value={bid.score} on={scoring} />
            </span>
            <span className="type-body text-muted-foreground">/ 100</span>
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-800 ease-out motion-reduce:transition-none"
              style={{ width: scoring ? `${bid.score}%` : "0%" }}
            />
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {bid.factors.map((factor, index) => (
              <li key={factor.label}>
                <p className="flex items-center justify-between type-label text-foreground">
                  {factor.label}
                  <span className="text-muted-foreground tabular-nums">
                    {factor.points} / {factor.max}
                  </span>
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand/70 transition-[width] duration-720 ease-out motion-reduce:transition-none"
                    style={{
                      width: scoring ? `${(factor.points / factor.max) * 100}%` : "0%",
                      transitionDelay: scoring ? `${120 + index * 96}ms` : "0ms",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 type-label text-muted-foreground">
            SOL Score는 사업 적합도 지표입니다.
          </p>
          <Reveal
            on={scoring}
            delay={960}
            className="mt-3 grid grid-cols-2 border-y border-border py-2.5"
          >
            <div>
              <p className="type-label text-muted-foreground">시스템 권고</p>
              <RecommendationBadge value={bid.recommendation} className="mt-1.5" />
            </div>
            <div className="border-l border-border pl-3">
              <p className="type-label text-muted-foreground">담당자 결정</p>
              <p className="mt-2 flex items-center gap-1.5 type-body font-semibold text-muted-foreground">
                <ClockIcon aria-hidden className="size-4" />
                대기
              </p>
            </div>
          </Reveal>
        </div>
      </div>
      <Reveal
        on={bubble}
        className="absolute bottom-6 left-7 flex w-[calc(100%-264px-28px-56px)] items-center gap-4 rounded-lg border border-border bg-background px-4 py-3"
      >
        <p className="min-w-0 flex-1 type-label-lg text-foreground">
          근거와 함께 보여 드려요. 참여 결정은 사람이 합니다.
        </p>
        <Target
          name="watch-add"
          pressed={pressed}
          className="h-9 shrink-0 bg-primary px-3.5 type-label font-semibold text-primary-foreground"
        >
          관심 공고에 담기
        </Target>
      </Reveal>
    </ScenePanel>
  );
}

// ── 5. 관심 공고와 알림 ──
export function WatchlistScene({ active, step, pressed }: SceneProps) {
  const added = step >= STEP.watchlist;
  const reminded = step >= STEP.reminder;
  const replay = step >= STEP.replay;
  const rows = [OPENED, ...ALREADY_WATCHED];
  return (
    <ScenePanel active={active}>
      <Breadcrumb parts={["업무", "관심 공고"]} />
      <p className="mt-1.5 type-heading-lg text-foreground">관심 공고</p>
      <p className="mt-0.5 type-body text-muted-foreground">마감과 알림을 함께 봅니다.</p>
      <Reveal
        on={added}
        delay={560}
        className={cn(
          styles.receipt,
          "absolute top-5 right-6 flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 type-label-lg",
        )}
      >
        <CircleCheckIcon aria-hidden className="size-4.5 text-success" />
        <span className="font-semibold text-foreground">관심 공고에 담았어요</span>
        <span className="text-muted-foreground">
          · 마감 D-{REMIND_DAYS_BEFORE} 에 알려 드릴게요
        </span>
      </Reveal>
      <ul className="mt-5 divide-y divide-border rounded-lg border border-border">
        {rows.map((bid) => {
          const fresh = bid.id === OPENED.id;
          return (
            <li
              key={bid.id}
              style={fresh ? reveal(added, 240).style : undefined}
              className={cn(
                "flex items-center gap-4 px-4 py-3",
                fresh && reveal(added, 240).className,
                fresh && styles.insert,
                fresh && added && "bg-selected/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 type-body font-medium text-foreground">
                  <span className="truncate">{bid.title}</span>
                  {fresh && (
                    <span
                      style={reveal(added, 240).style}
                      className={cn(
                        reveal(added, 240).className,
                        "shrink-0 rounded-md border border-brand/30 px-1.5 type-label text-selected-foreground",
                      )}
                    >
                      방금 담음
                    </span>
                  )}
                </p>
                <p className="type-label text-muted-foreground">{bid.agency}</p>
              </div>
              <span className="type-body font-semibold text-foreground tabular-nums">
                {dDay(bid)}
              </span>
              <span className="w-24 text-right type-label text-muted-foreground">
                SOL Score{" "}
                <span className="type-body font-semibold text-foreground tabular-nums">
                  {bid.score}
                </span>
              </span>
              <RecommendationBadge value={bid.recommendation} />
            </li>
          );
        })}
      </ul>
      <Reveal on={reminded} className="mt-4 rounded-lg border border-border px-4 py-3">
        <p className="flex items-center gap-1.5 type-label font-semibold text-foreground">
          <CalendarDaysIcon aria-hidden className="size-4 text-muted-foreground" />
          알림 일정 · {OPENED.title}
        </p>
        <ol className="mt-2.5 flex items-center gap-3 type-label">
          <li className="flex items-center gap-1.5 font-semibold text-selected-foreground">
            <BellRingIcon aria-hidden className="size-4" />
            {reminderDateOf(OPENED.proposalDue, REMIND_DAYS_BEFORE)} 알림(D-{REMIND_DAYS_BEFORE})
          </li>
          <li aria-hidden className="h-px flex-1 bg-border" />
          <li className="font-semibold text-foreground">
            {reminderDateOf(OPENED.proposalDue, 0)} 제안서 마감
          </li>
        </ol>
      </Reveal>
      <Reveal
        on={replay}
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-background px-4 py-3"
      >
        <p className="type-label-lg whitespace-nowrap text-foreground">
          내일 아침 06:00 에 새 공고를 다시 가져와요.
        </p>
        <Target
          name="replay"
          pressed={pressed}
          className="h-9 bg-primary px-3.5 type-label font-semibold text-primary-foreground"
        >
          <RotateCcwIcon aria-hidden className="size-4" />
          다시보기
        </Target>
      </Reveal>
    </ScenePanel>
  );
}
