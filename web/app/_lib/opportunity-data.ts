import "server-only";
import { unstable_cache } from "next/cache";
import { readCursorSecret } from "@/server/bids";
import {
  getLastScheduledIngestAt,
  getOpportunityChangedAt,
  getOpportunityClient,
  getOpportunityLiveMetrics,
  getOpportunityFilterOptions,
  getOpportunitySummary,
  listOpportunities,
  type OpportunityQuery,
} from "@/server/opportunities";
import { loadSourceSummary } from "@/app/_lib/opportunity-sources";

async function opportunityClient() {
  const client = await getOpportunityClient();
  if (client === null) throw new Error("업무 데이터베이스에 연결할 수 없습니다");
  return client;
}

export async function loadOpportunityPage(orgId: string, query: OpportunityQuery, userId?: string) {
  const secret = readCursorSecret(process.env.API_CURSOR_SECRET);
  if (secret === null) throw new Error("목록을 읽을 준비가 되지 않았습니다");
  return listOpportunities(await opportunityClient(), orgId, query, secret, userId);
}

export async function loadOpportunitySummary(
  orgId: string,
  origin: OpportunityQuery["origin"],
  asOf: string,
) {
  return getOpportunitySummary(await opportunityClient(), orgId, origin, asOf);
}

export async function loadOpportunityLiveMetrics(
  orgId: string,
  origin: OpportunityQuery["origin"],
  asOf: string,
) {
  return getOpportunityLiveMetrics(await opportunityClient(), orgId, origin, asOf);
}

export async function loadLastScheduledIngestAt(origin: OpportunityQuery["origin"]) {
  return getLastScheduledIngestAt(await opportunityClient(), origin);
}

export async function loadOpportunityChangedAt(orgId: string, bidId: string) {
  return getOpportunityChangedAt(await opportunityClient(), orgId, bidId);
}

export async function loadOpportunitySources(origin: OpportunityQuery["origin"]) {
  return loadSourceSummary(await opportunityClient(), origin);
}

// client 는 캐시 키에 넣지 않는다. 원천 표 RLS 가 모두 is_active_user() 라 활동 회원 누구에게나 같은 값이고,
// 호출 화면(/bids·/watchlist)이 먼저 requireWork 를 통과한다(next/dist/docs/…/04-functions/unstable_cache.md).
export async function loadOpportunityFilters(origin: OpportunityQuery["origin"]) {
  const client = await opportunityClient();
  return unstable_cache(
    (o: OpportunityQuery["origin"]) => getOpportunityFilterOptions(client, o),
    ["opportunity-filter-options"],
    { revalidate: 600, tags: ["opportunity-filter-options"] },
  )(origin);
}
