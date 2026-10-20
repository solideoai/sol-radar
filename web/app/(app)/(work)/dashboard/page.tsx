import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { defaultOrigin } from "@/server/bids";
import { loadBidCount, loadBidPage, loadDashboardSummary } from "@/app/_lib/work-data";
import { canRunIngestion } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { dashboardQueries } from "./dashboard-queries";
import { DASHBOARD_DESCRIPTION, DASHBOARD_TITLE, DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: DASHBOARD_TITLE };

// 스펙 §5.2. 화면은 세지 않는다 — 카드 값은 DashboardSummary(05 §4.6), 표는 GET /bids 와 같은 서비스가 정한다.
// (work) layout 은 상단바 두 값만 가볍게 읽는다(M3). 전체 요약은 이 화면만 읽는다. 누가 무엇을 읽는지는 RLS 가 정한다.
export default async function DashboardPage() {
  await connection();
  const work = await requireWork("/dashboard");
  // D-n·상대 시각의 기준. 요청마다 한 번 만들어 내린다(P1, 하이드레이션 차이 없음).
  const now = new Date();
  const queries = dashboardQueries(now, work.runMode);
  // "BID 권고" 카드는 BID 표와 같은 조건(queries.bid)으로 센다. 표·전체 보기와 숫자가 갈라지지 않는다(M4).
  const [summary, recommended, recommendedTotal, deadline] = await Promise.all([
    loadDashboardSummary(work.orgId, defaultOrigin(work.runMode)),
    loadBidPage(work.orgId, queries.bid),
    loadBidCount(work.orgId, queries.bid),
    loadBidPage(work.orgId, queries.deadline),
  ]);
  return (
    <AppPage
      title={DASHBOARD_TITLE}
      description={DASHBOARD_DESCRIPTION}
      typeScale="dashboard"
      contentClassName="max-w-360"
    >
      <DashboardView
        summary={summary}
        recommended={recommended.items}
        recommendedTotal={recommendedTotal}
        deadline={deadline.items}
        now={now}
        canRunIngestion={canRunIngestion(work.role)}
      />
    </AppPage>
  );
}
