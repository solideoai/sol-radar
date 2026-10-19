import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { defaultOrigin } from "@/server/bids";
import { loadBidPage, loadDashboardSummary } from "@/app/_lib/work-data";
import { requireWork } from "@/app/(app)/(work)/work";
import { dashboardQueries } from "./dashboard-queries";
import { DASHBOARD_DESCRIPTION, DASHBOARD_TITLE, DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: DASHBOARD_TITLE };

// 스펙 §5.2. 화면은 세지 않는다 — 카드 값은 DashboardSummary(05 §4.6), 표는 GET /bids 와 같은 서비스가 정한다.
// 요약은 (work) layout 이 같은 요청에서 이미 읽었다(React cache). 누가 무엇을 읽는지는 RLS 가 정한다.
export default async function DashboardPage() {
  await connection();
  const work = await requireWork("/dashboard");
  // D-n·상대 시각의 기준. 요청마다 한 번 만들어 내린다(P1, 하이드레이션 차이 없음).
  const now = new Date();
  const queries = dashboardQueries(now, work.runMode);
  const [summary, recommended, deadline] = await Promise.all([
    loadDashboardSummary(work.orgId, defaultOrigin(work.runMode)),
    loadBidPage(work.orgId, queries.bid),
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
        deadline={deadline.items}
        now={now}
        showIngestHint={work.role === "ADMIN"}
      />
    </AppPage>
  );
}
