import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { formatKst } from "@/components/bids/format";
import { OpportunityRefresh } from "@/components/work/opportunities-refresh";
import { nextScheduledIngestAt } from "@/server/opportunities";
import { countActiveProjects } from "@/server/projects";
import { projectDeps } from "@/app/_lib/project-deps";
import {
  loadLastScheduledIngestAt,
  loadOpportunityLiveMetrics,
  loadOpportunityPage,
  loadOpportunitySources,
  loadOpportunitySummary,
} from "@/app/_lib/opportunity-data";
import { currentIngestIntervalMinutes } from "@/app/_lib/run-mode";
import { canRunIngestion } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { dashboardListQuery, dashboardOriginOf, dashboardQueries } from "./dashboard-queries";
import { DASHBOARD_DESCRIPTION, DASHBOARD_TITLE, DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: DASHBOARD_TITLE };

// 스펙 §5.2. 화면은 세지 않는다 — 카드 값은 DashboardSummary(05 §4.6), 표는 GET /bids 와 같은 서비스가 정한다.
// (work) layout 은 상단바 두 값만 가볍게 읽는다(M3). 전체 요약은 이 화면만 읽는다. 누가 무엇을 읽는지는 RLS 가 정한다.
// ?origin=live|demo|all 로 출처를 고른다(발표 북마크 /dashboard?origin=demo). 없거나 틀리면 화면 기본 출처다.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  await connection();
  const requested = (await searchParams).origin;
  const work = await requireWork(nextPathOf(requested));
  const origin = dashboardOriginOf(requested, work.defaultOrigin);
  // D-n·상대 시각의 기준. 요청마다 한 번 만들어 내린다(P1, 하이드레이션 차이 없음).
  const now = new Date();
  const queries = dashboardQueries(now, origin);
  // 수집 주기(분). 없으면 "다음 수집 예정"을 숨기고 정기 수집 시각도 읽지 않는다.
  const intervalMinutes = currentIngestIntervalMinutes();
  // "BID 권고" 카드는 BID 표와 같은 조건(queries.bid)으로 센다. 표·전체 보기와 숫자가 갈라지지 않는다(M4).
  const [
    summaryResult,
    reviewResult,
    earlyResult,
    sourcesResult,
    projectsResult,
    metricsResult,
    lastScheduledResult,
  ] = await Promise.allSettled([
    loadOpportunitySummary(work.orgId, origin, now.toISOString()),
    loadOpportunityPage(work.orgId, queries.review),
    loadOpportunityPage(work.orgId, queries.early),
    loadOpportunitySources(origin),
    countActiveProjects(work.orgId, projectDeps(), origin),
    loadOpportunityLiveMetrics(work.orgId, origin, now.toISOString()),
    intervalMinutes === null ? Promise.resolve(null) : loadLastScheduledIngestAt(origin),
  ]);
  if (summaryResult.status === "rejected") throw summaryResult.reason;
  const summary = summaryResult.value;
  const nextIngest =
    intervalMinutes === null
      ? null
      : lastScheduledResult.status === "fulfilled"
        ? { at: nextScheduledIngestAt(lastScheduledResult.value, intervalMinutes), failed: false }
        : { at: null, failed: true };
  return (
    <AppPage
      title={DASHBOARD_TITLE}
      description={DASHBOARD_DESCRIPTION}
      typeScale="dashboard"
      contentClassName="max-w-360"
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <time
            dateTime={summary.generatedAt}
            className="type-caption text-muted-foreground tabular-nums"
          >
            {formatKst(summary.generatedAt)} 기준 · KST
          </time>
          <OpportunityRefresh />
        </div>
      }
    >
      <DashboardView
        summary={summary}
        metrics={metricsResult.status === "fulfilled" ? metricsResult.value : null}
        nextIngest={nextIngest}
        activeProjects={projectsResult.status === "fulfilled" ? projectsResult.value : null}
        review={reviewResult.status === "fulfilled" ? reviewResult.value.items : null}
        early={earlyResult.status === "fulfilled" ? earlyResult.value.items : null}
        sources={sourcesResult.status === "fulfilled" ? sourcesResult.value : null}
        reviewQuery={dashboardListQuery(queries.review)}
        earlyQuery={dashboardListQuery(queries.early)}
        now={now}
        canRunIngestion={canRunIngestion(work.role)}
      />
    </AppPage>
  );
}

// 로그인·가입 보완 뒤 돌아올 주소. 맞는 출처 값만 붙인다(경로는 /dashboard 고정이라 바깥으로 새지 않는다).
function nextPathOf(origin: string | string[] | undefined): string {
  return origin === "live" || origin === "demo" || origin === "all"
    ? `/dashboard?origin=${origin}`
    : "/dashboard";
}
