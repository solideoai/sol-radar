import { cn } from "cn";
import { CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import { formatKrwCompact } from "@/components/bids/format";
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
import type { OpportunityItem, OpportunitySummary, SourceSummary } from "@/server/opportunities";
import type { RunMode } from "@/server/bids";
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

export function DashboardView({
  summary,
  review,
  early,
  sources,
  reviewQuery,
  earlyQuery,
  now,
  canRunIngestion,
  runMode,
}: {
  summary: OpportunitySummary;
  review: OpportunityItem[] | null;
  early: OpportunityItem[] | null;
  sources: SourceSummary | null;
  reviewQuery: string;
  earlyQuery: string;
  now: Date;
  canRunIngestion: boolean;
  runMode: RunMode;
}) {
  const healthy = sources?.groups.reduce((total, group) => total + group.healthyServices, 0) ?? 0;
  const enabled = sources?.groups.reduce((total, group) => total + group.enabledServices, 0) ?? 0;
  const isExternal = runMode === "live";
  return (
    <>
      <DashboardAiBanner />
      {summary.isDemo && (
        <p className="type-caption text-muted-foreground">DEMO · 예시 공고 기준</p>
      )}
      <section aria-label="공공조달 요약" className="grid grid-cols-5 gap-4 [&_p]:wrap-anywhere">
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
          label="수집 상태"
          value={!isExternal || sources === null || enabled === 0 ? "—" : `${healthy}/${enabled}`}
          hint={
            !isExternal
              ? `${runMode} 모드 · 외부 수집 없음`
              : sources === null
                ? "수집 현황 조회 실패"
                : enabled === 0
                  ? "활성 수집 서비스 없음"
                  : healthy < enabled
                    ? "일부 미완료 · 소스 상태 확인"
                    : "정상 · 활성 서비스 기준"
          }
          className="min-w-0 shadow-none"
        />
      </section>
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
