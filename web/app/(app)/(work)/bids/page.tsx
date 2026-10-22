import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { listMyWatchedBidIds } from "@/server/watchlist";
import { defaultOrigin } from "@/server/bids";
import { loadOpportunityFilters, loadOpportunityPage } from "@/app/_lib/opportunity-data";
import { canRunIngestion } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { BIDS_DESCRIPTION, BIDS_TITLE } from "./bids-copy";
import { BidListView } from "./bid-list-view";
import { listQueryOf } from "./list-query";

export const metadata: Metadata = { title: BIDS_TITLE };

// 스펙 §5.3. 필터 값은 주소 쿼리가 정본이다. 첫 쪽(20건)은 서버가 그리고, 다음 쪽은 "더 보기"가 API 로 읽는다.
// 누가 무엇을 읽는지는 RLS 가 정한다. 기본 출처는 실행 모드를 따른다(mock·fixture → demo, live → live).
export default async function BidsPage({ searchParams }: PageProps<"/bids">) {
  await connection();
  const raw = await searchParams;
  const work = await requireWork(nextPathOf(raw));
  const { query, search, notice } = listQueryOf(raw, work.runMode);
  // D-n 의 기준. 요청마다 한 번 만들어 내린다(P1, 하이드레이션 차이 없음).
  const now = new Date();
  const [first, filters, watchedIds] = await Promise.all([
    loadOpportunityPage(work.orgId, query, work.userId),
    loadOpportunityFilters(query.origin),
    listMyWatchedBidIds({ orgId: work.orgId, userId: work.userId }).catch(() => {
      console.error(JSON.stringify({ event: "bid_list_watches_failed" }));
      return null;
    }),
  ]);
  const stableQuery = new URLSearchParams(search);
  stableQuery.set("asOf", first.asOf);
  const hasFilters = Boolean(
    query.q ||
    query.sourceFamily.length ||
    query.agencyId.length ||
    query.companyId.length ||
    query.stage.length ||
    query.status.length ||
    query.category.length ||
    query.recommendation.length ||
    query.decision.length ||
    query.includeEarly ||
    !query.siAiFirst ||
    query.sortExplicit ||
    query.origin !== defaultOrigin(work.runMode),
  );
  return (
    <AppPage title={BIDS_TITLE} description={BIDS_DESCRIPTION} contentClassName="max-w-360">
      <BidListView
        defaultOrigin={defaultOrigin(work.runMode) === "live" ? "live" : "demo"}
        watchedIds={watchedIds}
        items={first.items}
        total={first.total}
        nextCursor={first.pageInfo.nextCursor}
        query={stableQuery.toString()}
        now={now.toISOString()}
        canRunIngestion={canRunIngestion(work.role)}
        agencies={filters.agencies}
        companies={filters.companies}
        notice={notice}
        hasFilters={hasFilters}
      />
    </AppPage>
  );
}

// 로그인·가입 보완 뒤 돌아올 주소. 검색어 등 조건을 잃지 않게 쿼리를 그대로 붙인다(경로는 /bids 고정이라 바깥으로 새지 않는다).
function nextPathOf(raw: Awaited<PageProps<"/bids">["searchParams"]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `/bids?${search}` : "/bids";
}
