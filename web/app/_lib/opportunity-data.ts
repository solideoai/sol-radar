import "server-only";
import { readCursorSecret } from "@/server/bids";
import {
  getOpportunityClient,
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

export async function loadOpportunitySources(origin: OpportunityQuery["origin"]) {
  return loadSourceSummary(await opportunityClient(), origin);
}

export async function loadOpportunityFilters(origin: OpportunityQuery["origin"]) {
  return getOpportunityFilterOptions(await opportunityClient(), origin);
}
