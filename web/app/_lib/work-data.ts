import "server-only";
import { cache } from "react";
import { getDashboardSummary, type BidListOrigin } from "@/server/bids";
import { workDeps } from "@/app/_lib/work-deps";

// 대시보드 요약 한 벌. (work) layout 의 상단바와 대시보드 화면이 한 요청에서 나눠 쓴다.
export const loadDashboardSummary = cache((orgId: string, origin: BidListOrigin) =>
  getDashboardSummary(orgId, origin, { repo: workDeps().dashboard }, new Date()),
);
