import "server-only";
import type { BidStatus, Recommendation } from "./bid.model";
import type { DashboardAnalysisRow, DashboardBidRow, DashboardReviewRow } from "./bids.repo";

// 입찰 프로젝트 보드(P1 N6)의 "검토 대기" 칸. 저장하지 않고 기존 표에서 계산한다(M14).
// 정의는 대시보드 reviews.pending(getDashboardSummary, C6 D11)과 같다: 공고별 끝난 분석(QUEUED·RUNNING 제외,
// FAILED 포함) 중 최신 1건이 COMPLETED·PARTIAL 이고 이 조직의 사람 결정이 없다.
// 같은 원본이면 개수가 같다는 것을 review-pending.test.ts 가 본다. 한쪽 정의를 바꾸면 그 시험이 깨진다.

// 대시보드 원본 행 + 카드가 보이는 두 값(기관·데모 여부).
export type PendingSourceRow = DashboardBidRow & { agency: string | null; isDemo: boolean };

export type PendingBidCard = {
  bidId: string;
  title: string;
  agency: string | null;
  deadlineAt: string | null;
  // 최신 점수 분석의 권고
  recommendation: Recommendation | null;
  bidStatus: BidStatus;
  isDemo: boolean;
};

// 대시보드 서비스와 같은 고르기: 같은 시각이면 배열에서 뒤에 있는 쪽이 최신이다.
function latestOf<T>(rows: readonly T[], timeOf: (row: T) => string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || Date.parse(timeOf(row)) >= Date.parse(timeOf(best))) best = row;
  }
  return best;
}

const isFinished = (a: DashboardAnalysisRow) => a.status !== "QUEUED" && a.status !== "RUNNING";
const isScored = (a: DashboardAnalysisRow) => a.status === "COMPLETED" || a.status === "PARTIAL";

// 칸 안 순서(UI 스펙 U18): 마감 가까운 순. 지난 마감은 그 뒤(방금 지난 것이 먼저), 마감 없음은 맨 뒤.
// 같으면 제목 가나다, 그래도 같으면 id 로 고정한다. 입찰 프로젝트 칸(실효 마감)도 이 비교를 쓴다.
type DueOrdered = { id: string; dueAt: string | null; title: string };

function dueGroupOf(dueMs: number | null, nowMs: number): 0 | 1 | 2 {
  if (dueMs === null) return 2;
  return dueMs >= nowMs ? 0 : 1;
}

export function compareDueOrder(a: DueOrdered, b: DueOrdered, nowMs: number): number {
  const aMs = a.dueAt === null ? null : Date.parse(a.dueAt);
  const bMs = b.dueAt === null ? null : Date.parse(b.dueAt);
  const aGroup = dueGroupOf(aMs, nowMs);
  const bGroup = dueGroupOf(bMs, nowMs);
  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aMs !== null && bMs !== null && aMs !== bMs) return aGroup === 0 ? aMs - bMs : bMs - aMs;
  const byTitle = a.title.localeCompare(b.title, "ko");
  if (byTitle !== 0) return byTitle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const isPending = (analysis: DashboardAnalysisRow | null, review: DashboardReviewRow | null) =>
  analysis !== null && isScored(analysis) && review === null;

export function reviewPendingBids(
  source: { bids: readonly PendingSourceRow[] },
  now: Date,
): PendingBidCard[] {
  const nowMs = now.getTime();
  return source.bids
    .flatMap((row): PendingBidCard[] => {
      const analysis = latestOf(row.analyses.filter(isFinished), (a) => a.createdAt);
      const review = latestOf(row.reviews, (r) => r.decidedAt);
      if (!isPending(analysis, review)) return [];
      return [
        {
          bidId: row.bidId,
          title: row.title,
          agency: row.agency,
          deadlineAt: row.deadlineAt,
          recommendation: analysis?.recommendation ?? null,
          bidStatus: row.status,
          isDemo: row.isDemo,
        },
      ];
    })
    .toSorted((a, b) =>
      compareDueOrder(
        { id: a.bidId, dueAt: a.deadlineAt, title: a.title },
        { id: b.bidId, dueAt: b.deadlineAt, title: b.title },
        nowMs,
      ),
    );
}
