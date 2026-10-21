import "server-only";
import type { AnalysisStatus, BidListItem, BidStage, BidStatus, Recommendation } from "./bid.model";
import type {
  DashboardAnalysisRow,
  DashboardBidRow,
  DashboardRepo,
  DashboardReviewRow,
  FinishedScoreRow,
} from "./bids.repo";
import type { DashboardSummary, FinishedAnalysis, StatusSummary } from "./dashboard.model";

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

// ── 대시보드 BID 권고 표의 점수·권고(미결정 30-8) ──
// 표의 행은 목록(GET /bids)이 끝난 분석의 권고 BID 로 고르고 점수로 줄 세운다. 그런데 칸은 최신 run 을 그려서,
// 재분석이 진행 중이거나 실패한 공고는 "—"가 된다. 그런 공고만 끝난 분석 중 최신 1건으로 칸을 채운다.

const isScoredStatus = (status: AnalysisStatus) => status === "COMPLETED" || status === "PARTIAL";

const needsFinished = ({ latestAnalysis }: BidListItem): boolean =>
  latestAnalysis !== null && !isScoredStatus(latestAnalysis.status);

export function finishedAnalysesOf(
  items: readonly BidListItem[],
  rows: readonly FinishedScoreRow[],
): Record<string, FinishedAnalysis> {
  const byBid = new Map(rows.map((row) => [row.bidId, row]));
  return Object.fromEntries(
    items.flatMap((item) => {
      const latest = item.latestAnalysis;
      const row = byBid.get(item.id);
      if (latest === null || isScoredStatus(latest.status) || row === undefined) return [];
      // 끝난 분석이 하나도 없으면 채울 값이 없다.
      if (row.solScore === null && row.recommendation === null) return [];
      const entry: FinishedAnalysis = {
        solScore: row.solScore,
        recommendation: row.recommendation,
        rerunning: latest.status === "QUEUED" || latest.status === "RUNNING",
      };
      return [[item.id, entry]];
    }),
  );
}

// 채울 공고가 없으면 읽지 않는다.
export async function getFinishedAnalyses(
  items: readonly BidListItem[],
  deps: { repo: Pick<DashboardRepo, "listFinishedScores"> },
): Promise<Record<string, FinishedAnalysis>> {
  const bidIds = items.filter(needsFinished).map((item) => item.id);
  if (bidIds.length === 0) return {};
  return finishedAnalysesOf(items, await deps.repo.listFinishedScores(bidIds));
}
