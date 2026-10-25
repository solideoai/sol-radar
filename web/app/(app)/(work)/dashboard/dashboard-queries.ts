import "server-only";
import { parseOriginQuery, type BidListOrigin } from "@/server/bids";
import {
  parseOpportunityQuery,
  serializeOpportunityQuery,
  type OpportunityQuery,
} from "@/server/opportunities";

// 대시보드의 ?origin=live|demo|all(발표 북마크 /dashboard?origin=demo 용).
// 없거나 틀린 값은 화면을 막지 않고 기본 출처(fallback)로 그린다. API(/dashboard/summary)와 달리 400 을 내지 않는다.
export function dashboardOriginOf(
  value: string | string[] | undefined,
  fallback: BidListOrigin,
): BidListOrigin {
  const parsed = parseOriginQuery({ origin: value }, fallback);
  return parsed.ok ? parsed.value.origin : fallback;
}

export function dashboardQueries(now: Date, origin: BidListOrigin) {
  const common = {
    origin,
    asOf: now.toISOString(),
    limit: "5",
  };
  const review = parseOpportunityQuery({ ...common, stage: "NOTICE" }, origin);
  const early = parseOpportunityQuery(
    {
      ...common,
      includeEarly: "true",
      stage: ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC"],
      status: ["OPEN", "AMENDED", "CLOSED", "CANCELLED"],
    },
    origin,
  );
  if (!review.ok || !early.ok) throw new Error("대시보드 목록 조건을 만들지 못했습니다");
  return { review: review.value, early: early.value };
}

export function dashboardListQuery(query: OpportunityQuery): string {
  const params = new URLSearchParams(serializeOpportunityQuery(query));
  params.delete("cursor");
  params.delete("limit");
  return params.toString();
}
