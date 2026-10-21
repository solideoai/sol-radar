import "server-only";
import type { RunMode } from "@/server/bids";
import {
  parseOpportunityQuery,
  serializeOpportunityQuery,
  type OpportunityQuery,
} from "@/server/opportunities";

export function dashboardQueries(now: Date, runMode: RunMode) {
  const common = {
    origin: runMode === "live" ? "live" : "demo",
    asOf: now.toISOString(),
    limit: "5",
  };
  const review = parseOpportunityQuery({ ...common, stage: "NOTICE" }, runMode);
  const early = parseOpportunityQuery(
    {
      ...common,
      includeEarly: "true",
      stage: ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC"],
      status: ["OPEN", "AMENDED", "CLOSED", "CANCELLED"],
    },
    runMode,
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
