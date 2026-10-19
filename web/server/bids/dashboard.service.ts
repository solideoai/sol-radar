import "server-only";
import type { BidStage, BidStatus, Recommendation } from "./bid.model";
import type {
  DashboardAnalysisRow,
  DashboardBidRow,
  DashboardRepo,
  DashboardReviewRow,
} from "./bids.repo";
import type { DashboardSummary, StatusSummary } from "./dashboard.model";

// 05 §4.6 DashboardSummary 집계. 정의는 C6 스펙 D10·D11 이다.
// D10: 권고는 공고별 최신 분석 1건 기준. D11: 검토 대기는 최신 분석이 있으나 사람 결정이 없는 공고 수.

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 10;

const STAGES: BidStage[] = ["PLAN", "PRE_SPEC", "NOTICE"];
const STATUSES: BidStatus[] = ["OPEN", "AMENDED", "CANCELLED", "CLOSED"];
const RECOMMENDATIONS: Recommendation[] = ["BID", "WATCH", "NO_BID"];

function zeros<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

// 같은 시각이면 배열에서 뒤에 있는 쪽이 최신이다.
function latestOf<T>(rows: readonly T[], timeOf: (row: T) => string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || Date.parse(timeOf(row)) >= Date.parse(timeOf(best))) best = row;
  }
  return best;
}

const isFinished = (a: DashboardAnalysisRow) => a.status !== "QUEUED" && a.status !== "RUNNING";
const isScored = (a: DashboardAnalysisRow) => a.status === "COMPLETED" || a.status === "PARTIAL";

type BidView = {
  row: DashboardBidRow;
  analysis: DashboardAnalysisRow | null; // 끝난 분석 중 최신(FAILED 포함)
  review: DashboardReviewRow | null;
};

export async function getDashboardSummary(
  orgId: string,
  origin: "live" | "demo" | "all",
  deps: { repo: DashboardRepo },
  now: Date,
): Promise<DashboardSummary> {
  const source = await deps.repo.load(orgId, origin);
  const views: BidView[] = source.bids.map((row) => ({
    row,
    analysis: latestOf(row.analyses.filter(isFinished), (a) => a.createdAt),
    review: latestOf(row.reviews, (r) => r.decidedAt),
  }));

  const byStage = zeros(STAGES);
  const byStatus = zeros(STATUSES);
  const nowMs = now.getTime();
  let deadlineWithin7Days = 0;
  for (const { row } of views) {
    byStage[row.stage] += 1;
    byStatus[row.status] += 1;
    const open = row.status === "OPEN" || row.status === "AMENDED";
    const deadline = row.deadlineAt === null ? null : Date.parse(row.deadlineAt);
    if (open && deadline !== null && deadline >= nowMs && deadline <= nowMs + 7 * DAY_MS) {
      deadlineWithin7Days += 1;
    }
  }

  const byRecommendation = zeros(RECOMMENDATIONS);
  const latestByStatus = { completed: 0, partial: 0, failed: 0 };
  let total = 0;
  let partial = 0;
  let withReviewFlags = 0;
  let pending = 0;
  for (const { analysis, review } of views) {
    if (analysis === null) continue;
    if (analysis.status === "COMPLETED") latestByStatus.completed += 1;
    if (analysis.status === "PARTIAL") latestByStatus.partial += 1;
    if (analysis.status === "FAILED") latestByStatus.failed += 1;
    if (!isScored(analysis)) continue;
    total += 1;
    if (analysis.status === "PARTIAL") partial += 1;
    if (analysis.reviewFlagCount > 0) withReviewFlags += 1;
    if (analysis.recommendation !== null) byRecommendation[analysis.recommendation] += 1;
    if (review === null) pending += 1;
  }

  const byDecision = zeros(RECOMMENDATIONS);
  let disagreementWithSystem = 0;
  for (const { review } of views) {
    if (review === null) continue;
    byDecision[review.decision] += 1;
    if (review.disagreementFlag) disagreementWithSystem += 1;
  }

  const upcoming = views
    .filter(({ row }) => {
      const open = row.status === "OPEN" || row.status === "AMENDED";
      return open && row.deadlineAt !== null && Date.parse(row.deadlineAt) >= nowMs;
    })
    .sort((a, b) => Date.parse(a.row.deadlineAt ?? "") - Date.parse(b.row.deadlineAt ?? ""))
    .slice(0, UPCOMING_LIMIT)
    .map(({ row, analysis, review }) => ({
      bidId: row.bidId,
      title: row.title,
      deadlineAt: row.deadlineAt ?? "",
      recommendation: analysis !== null && isScored(analysis) ? analysis.recommendation : null,
      decision: review?.decision ?? null,
    }));

  return {
    generatedAt: now.toISOString(),
    dataFreshness: { ...source.dataFreshness, isDemo: origin === "demo" },
    ai: source.ai,
    bids: { total: views.length, byStage, byStatus, deadlineWithin7Days },
    analyses: { total, byRecommendation, partial, withReviewFlags, latestByStatus },
    reviews: { pending, byDecision, disagreementWithSystem },
    upcoming,
    unreadNotifications: source.unreadNotifications,
  };
}

// 업무 틀(layout) 상단바용 가벼운 요약(M3). 공고 전체 집계와 AI 프로브를 부르지 않는다.
// AI 상태는 상단바가 마운트 때 /health/ready 로 읽는다.
export async function getStatusSummary(
  origin: "live" | "demo" | "all",
  deps: { repo: DashboardRepo },
): Promise<StatusSummary> {
  const status = await deps.repo.loadStatus(origin);
  return {
    dataFreshness: { ...status.dataFreshness, isDemo: origin === "demo" },
    unreadNotifications: status.unreadNotifications,
  };
}
