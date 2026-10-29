import "server-only";
import { isItBatchIdempotencyKey } from "@/server/analysis";
import type { BidStatus, Recommendation } from "./bid.model";
import type { DashboardAnalysisRow, DashboardBidRow, DashboardReviewRow } from "./bids.repo";

// 입찰 프로젝트 보드(P1 N6)의 "검토 대기" 칸. 저장하지 않고 기존 표에서 계산한다(M14).
// 정의는 대시보드 reviews.pending(getDashboardSummary, C6 D11)을 따른다: 공고별 끝난 분석(QUEUED·RUNNING 제외,
// FAILED 포함) 중 최신 1건이 COMPLETED·PARTIAL 이고 이 조직의 사람 결정이 없다.
// 단 그 최신 1건이 IT 일괄 분석 run 이면 대기로 세지 않는다(ADR-069, 사용자 결정 2026-10-29: 일괄 분석 결과는 빼기).
// 대시보드 reviews.pending 은 이 예외가 없다(화면에 보이지 않는다).

// 검토 대기 판정의 분석 행: 대시보드 행 + 멱등 키(일괄 분석 run 을 가른다).
export type PendingAnalysisRow = DashboardAnalysisRow & { idempotencyKey: string | null };

// 대시보드 원본 행 + 카드가 보이는 두 값(기관·데모 여부). 분석 행에는 멱등 키가 붙는다.
export type PendingSourceRow = Omit<DashboardBidRow, "analyses"> & {
  agency: string | null;
  isDemo: boolean;
  analyses: PendingAnalysisRow[];
};

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

// 사람이 누른 분석이 일괄 분석보다 새것이면 최신 1건이 그 분석이라 대기로 센다.
const isPending = (analysis: PendingAnalysisRow | null, review: DashboardReviewRow | null) =>
  analysis !== null &&
  isScored(analysis) &&
  !isItBatchIdempotencyKey(analysis.idempotencyKey) &&
  review === null;

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
