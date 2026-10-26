import { cn } from "cn";
import { CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import { formatKrwCompact, formatKst } from "@/components/bids/format";
import { StatusBadge } from "@/components/bids/status-badge";
import { StatCard } from "@/components/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OpportunityReviewRows } from "@/components/work/opportunities-review-rows";
import { OpportunitySourceStatus } from "@/components/work/opportunities-source-status";
import type {
  OpportunityItem,
  OpportunityLiveMetrics,
  OpportunitySummary,
  SourceSummary,
} from "@/server/opportunities";
import { NoBidsEmptyState } from "@/app/(app)/(work)/empty-state";
import { DashboardAiBanner } from "./dashboard-ai-banner";

export const DASHBOARD_TITLE = "대시보드";
export const DASHBOARD_DESCRIPTION = "공공조달 데이터와 수집 현황, 검토할 사업기회를 확인합니다.";
const count = (value: number) => value.toLocaleString("ko-KR");

function OpportunityPanel({
  title,
  description,
  items,
  query,
  emptyText,
  early = false,
}: {
  title: string;
  description: string;
  items: OpportunityItem[] | null;
  query: string;
  emptyText: string;
  early?: boolean;
}) {
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription className="type-caption">{description}</CardDescription>
        <CardAction>
          <Link
            href={`/bids?${query}`}
            aria-label={`${title} 전체 보기`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            전체 보기
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {items === null ? (
          <p className="px-6 type-label text-muted-foreground">
            목록을 불러오지 못했습니다. 데이터 새로고침으로 다시 시도하세요.
          </p>
        ) : items.length === 0 ? (
          <p className="px-6 type-label text-muted-foreground">{emptyText}</p>
        ) : (
          <OpportunityReviewRows items={items} query={query} early={early} />
        )}
      </CardContent>
    </Card>
  );
}

function Portfolio({ summary }: { summary: OpportunitySummary }) {
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>
          <h2>입찰 포트폴리오</h2>
        </CardTitle>
        <CardDescription className="type-caption">
          권고 분포 · 입찰 프로젝트·수주 실적이 아닙니다
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {(["BID", "WATCH", "NO_BID", "PENDING"] as const).map((key) => (
            <li key={key} className="flex items-center justify-between gap-3 py-3 first:pt-0">
              {key === "PENDING" ? (
                <span className="inline-flex items-center gap-1 type-caption text-muted-foreground">
                  <CircleDashedIcon aria-hidden className="size-4" />
                  분석 대기
                </span>
              ) : (
                <StatusBadge kind="recommendation" value={key} variant="inline" />
              )}
              <span className="type-body tabular-nums">{count(summary.portfolio[key])}건</span>
            </li>
          ))}
        </ul>
        {(summary.sourceConflictCount ?? 0) > 0 && (
          <p className="mt-3 type-caption text-warning">
            출처 간 확인 필요 {count(summary.sourceConflictCount ?? 0)}건 · 별도 검토
          </p>
        )}
        <p className="mt-3 border-t border-border pt-3 type-caption wrap-anywhere text-muted-foreground">
          확인 예산{" "}
          <span className="font-mono" title={formatKrwCompact(summary.knownBudgetKrw).full}>
            {formatKrwCompact(summary.knownBudgetKrw).text}
          </span>
          <br />
          예산 미확인 {count(summary.unknownBudgetCount)}건
        </p>
      </CardContent>
    </Card>
  );
}

/** 다음 정기 수집 예정. at 은 마지막 정기 수집 + 주기(없으면 null), failed 는 정기 수집 시각 조회 실패다 */
export type NextIngest = { at: string | null; failed: boolean };

// "2026-10-25 14:05" → 값 칸에는 시각, 보조 줄에는 날짜·KST. 좁은 카드에서 값이 꺾이지 않게 나눈다.
function kstParts(iso: string): { time: string; day: string } {
  const [day = "—", time = "—"] = formatKst(iso).split(" ");
  return { time, day };
}

const latestOf = (values: (string | null)[]): string | null =>
  values
    .filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1) ?? null;

function TimeStat({
  label,
  at,
  empty,
  suffix,
  late,
}: {
  label: string;
  at: string | null;
  empty: string;
  suffix?: string;
  late?: string;
}) {
  if (at === null)
    return <StatCard label={label} value="—" hint={empty} className="min-w-0 shadow-none" />;
  const { time, day } = kstParts(at);
  return (
    <StatCard
      label={label}
      value={time}
      hint={
        <>
          <time dateTime={at}>
            {day} KST{suffix}
          </time>
          {late !== undefined && <span className="block text-warning">{late}</span>}
        </>
      }
      className="min-w-0 shadow-none"
    />
  );
}

function TopAgencies({ metrics, wide }: { metrics: OpportunityLiveMetrics | null; wide: boolean }) {
  return (
    <Card size="sm" className={cn("min-w-0 shadow-none", wide && "col-span-2")}>
      <CardContent className="flex flex-col gap-2">
        <p className="type-label text-muted-foreground">기관별 공고 수</p>
        {metrics === null ? (
          <p className="type-caption text-muted-foreground">지표 조회 실패</p>
        ) : metrics.topAgencies.length === 0 ? (
          <p className="type-caption text-muted-foreground">기관이 확인된 입찰공고 없음</p>
        ) : (
          <ol aria-label="기관별 입찰공고 수 상위" className="flex flex-col gap-1">
            {metrics.topAgencies.map((agency) => (
              <li
                key={agency.name}
                className="flex items-baseline justify-between gap-2 type-caption"
              >
                <span className="min-w-0 truncate" title={agency.name}>
                  {agency.name}
                </span>
                <span className="shrink-0 tabular-nums">{count(agency.count)}건</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// 10-25 실수집 계획 B3. 값은 서버가 센다(procurement_summary·procurement_live_metrics·수집 소스 상태).
// 출처는 화면이 고른 origin 과 같다. live 는 실제 수집 출처의 공고만 센다(출처 미확인 제외).
function IngestMetrics({
  summary,
  metrics,
  sources,
  nextIngest,
  now,
}: {
  summary: OpportunitySummary;
  metrics: OpportunityLiveMetrics | null;
  sources: SourceSummary | null;
  nextIngest: NextIngest | null;
  now: Date;
}) {
  const lastSuccess = latestOf(sources?.groups.map((group) => group.lastSuccessAt) ?? []);
  const nextAt = nextIngest?.at ?? null;
  return (
    <section
      aria-label="수집 지표"
      className="grid grid-cols-5 gap-4 [&_p]:wrap-anywhere [&_.type-label]:min-h-12"
    >
      <StatCard
        label="전체 수집 공고"
        value={count(summary.totalOpportunities)}
        hint="입찰공고 · 출처 사본은 1건"
        className="min-w-0 shadow-none"
      />
      <StatCard
        label="진행 중 WATCH"
        value={metrics === null ? "—" : count(metrics.activeWatch)}
        hint={metrics === null ? "지표 조회 실패" : "현재 유효 분석 · 진행 중"}
        className="min-w-0 shadow-none"
      />
      <TimeStat
        label="마지막 수집 성공"
        at={lastSuccess}
        empty={sources === null ? "수집 현황 조회 실패" : "성공 기록 없음"}
      />
      {nextIngest !== null && (
        <TimeStat
          label="다음 수집 예정"
          at={nextAt}
          empty={nextIngest.failed ? "조회 실패" : "정기 수집 기록 없음"}
          suffix=" · 예정"
          late={
            nextAt !== null && Date.parse(nextAt) < now.getTime()
              ? "예정 시각 지남 · 수집 확인 필요"
              : undefined
          }
        />
      )}
      <TopAgencies metrics={metrics} wide={nextIngest === null} />
    </section>
  );
}

export function DashboardView({
  summary,
  metrics,
  nextIngest,
  activeProjects,
  review,
  early,
  sources,
  reviewQuery,
  earlyQuery,
  now,
  canRunIngestion,
}: {
  summary: OpportunitySummary;
  /** 실수집 지표. null 은 조회 실패다 */
  metrics: OpportunityLiveMetrics | null;
  /** 다음 수집 예정. null 이면 카드를 숨긴다. 웹은 수집 간격 env 를 읽지 않아(정기 일정은 worker Job Scheduler) 지금은 늘 null 이다 */
  nextIngest: NextIngest | null;
  activeProjects: number | null;
  review: OpportunityItem[] | null;
  early: OpportunityItem[] | null;
  sources: SourceSummary | null;
  reviewQuery: string;
  earlyQuery: string;
  now: Date;
  canRunIngestion: boolean;
}) {
  return (
    <>
      <DashboardAiBanner />
      {summary.isDemo && (
        <p className="type-caption text-muted-foreground">DEMO · 예시 공고 기준</p>
      )}
      {summary.origin === "all" && (
        <p className="type-caption text-muted-foreground">
          전체 출처 · DEMO 예시 공고와 출처 미확인 공고 포함
        </p>
      )}
      <section
        aria-label="공공조달 요약"
        className="grid grid-cols-5 gap-4 [&_p]:wrap-anywhere [&_.type-label]:min-h-12"
      >
        <StatCard
          label="신규 발견"
          value={count(summary.newlyDiscovered)}
          hint="최근 24시간 · 입찰공고"
          className="min-w-0 shadow-none"
        />
        <StatCard
          label="분석 대기"
          value={count(summary.pendingAnalysis)}
          hint="현재 입력의 분석 결과 없음"
          className="min-w-0 shadow-none"
        />
        <StatCard
          label="BID 권고"
          value={count(summary.bidRecommended)}
          hint="현재 유효 분석 · 진행 중"
          className="min-w-0 shadow-none"
        />
        <StatCard
          label="마감 임박 (7일)"
          value={count(summary.closingSoon)}
          hint="정확한 마감 확인 · 진행 중"
          className="min-w-0 shadow-none"
        />
        <StatCard
          label="진행 중 입찰 프로젝트"
          value={activeProjects === null ? "—" : count(activeProjects)}
          hint={
            activeProjects === null ? (
              "프로젝트 현황 조회 실패"
            ) : (
              <Link href="/projects" className="underline underline-offset-4">
                종료 제외 · 프로젝트 보기
              </Link>
            )
          }
          className="min-w-0 shadow-none"
        />
      </section>
      <IngestMetrics
        summary={summary}
        metrics={metrics}
        sources={sources}
        nextIngest={nextIngest}
        now={now}
      />
      {summary.potentialDuplicateCount > 0 && (
        <p className="type-caption text-warning">
          중복 후보 {count(summary.potentialDuplicateCount)}건은 별도 사업기회로 집계됩니다.
        </p>
      )}
      {summary.totalOpportunities === 0 && <NoBidsEmptyState canRun={canRunIngestion} />}
      <div className="@container">
        <div className="grid grid-cols-1 items-stretch gap-6 @min-[70rem]:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
          <OpportunityPanel
            title="우선 검토할 입찰"
            description="공공 SI·AI 우선 · 최근 공고 순"
            items={review}
            query={reviewQuery}
            emptyText="검토할 입찰공고가 없습니다"
          />
          <OpportunitySourceStatus summary={sources} now={now} canManage={canRunIngestion} />
          <OpportunityPanel
            title="예정 사업 및 사전규격"
            description="발주계획·조달요청·사전규격 · 별도 집계"
            items={early}
            query={earlyQuery}
            early
            emptyText="예정 사업 및 사전규격이 없습니다"
          />
          <Portfolio summary={summary} />
        </div>
      </div>
    </>
  );
}
