import "server-only";
import { DEFAULT_BID_STATUS, defaultOrigin, type BidListQuery, type RunMode } from "@/server/bids";

// 대시보드 표 두 개의 목록 조건(스펙 §5.2). 둘 다 실행 모드의 기본 출처와 진행 중 공고(ADR-029 A7)만 본다.
// BID 표는 권고 BID 를 점수 높은 순으로 5건(19 S3 1번: FX-01 94 · FX-18 82 · FX-06 78),
// 마감 표는 지금부터 7일 안에 마감되는 공고를 마감 빠른 순으로 5건이다.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TABLE_LIMIT = 5;

const baseQuery = (runMode: RunMode): BidListQuery => ({
  q: null,
  stage: [],
  status: [...DEFAULT_BID_STATUS],
  deadlineFrom: null,
  deadlineTo: null,
  recommendation: [],
  decision: [],
  origin: defaultOrigin(runMode),
  sort: "publishedAt:desc",
  cursor: null,
  limit: TABLE_LIMIT,
});

export function dashboardQueries(
  now: Date,
  runMode: RunMode,
): { bid: BidListQuery; deadline: BidListQuery } {
  return {
    bid: { ...baseQuery(runMode), recommendation: ["BID"], sort: "score:desc" },
    deadline: {
      ...baseQuery(runMode),
      deadlineFrom: now.toISOString(),
      deadlineTo: new Date(now.getTime() + WEEK_MS).toISOString(),
      sort: "deadlineAt:asc",
    },
  };
}
