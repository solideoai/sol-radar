import "server-only";
import { cache } from "react";
import {
  getDashboardSummary,
  listBids,
  type BidListItem,
  type BidListOrigin,
  type BidListQuery,
  type Page,
} from "@/server/bids";
import { workDeps } from "@/app/_lib/work-deps";

// 대시보드 요약 한 벌. (work) layout 의 상단바와 대시보드 화면이 한 요청에서 나눠 쓴다.
export const loadDashboardSummary = cache((orgId: string, origin: BidListOrigin) =>
  getDashboardSummary(orgId, origin, { repo: workDeps().dashboard }, new Date()),
);

// 업무 화면(서버 컴포넌트)이 읽는 공고 목록 한 쪽. GET /api/v1/bids 와 같은 서비스다.
// 예상한 실패(커서 비밀 없음 503 등)도 화면에서는 읽기 실패라 오류 경계(error.tsx)로 던진다. message 는 서비스의 한국어 문장이다.
export async function loadBidPage(orgId: string, query: BidListQuery): Promise<Page<BidListItem>> {
  const deps = workDeps();
  const result = await listBids(orgId, query, deps.cursorSecret, { repo: deps.bids });
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
