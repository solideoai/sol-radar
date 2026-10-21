import { describe, expect, it } from "vitest";
import type { AnalysisStatus, BidListItem } from "./bid.model";
import type {
  DashboardAnalysisRow,
  DashboardBidRow,
  DashboardRepo,
  DashboardReviewRow,
  DashboardSource,
  FinishedScoreRow,
} from "./bids.repo";
import { dashboardSummarySchema } from "./dashboard.model";
import {
  finishedAnalysesOf,
  getDashboardSummary,
  getFinishedAnalyses,
  getStatusSummary,
} from "./dashboard.service";

const NOW = new Date("2026-10-19T00:00:00Z");

const analysis = (over: Partial<DashboardAnalysisRow> & { id: string }): DashboardAnalysisRow => ({
  status: "COMPLETED",
  recommendation: "BID",
  reviewFlagCount: 0,
  createdAt: "2026-10-10T00:00:00Z",
  ...over,
});
const review = (over: Partial<DashboardReviewRow> = {}): DashboardReviewRow => ({
  decision: "BID",
  disagreementFlag: false,
  decidedAt: "2026-10-12T00:00:00Z",
  ...over,
});
const bid = (id: string, over: Partial<DashboardBidRow> = {}): DashboardBidRow => ({
  bidId: id,
  title: `공고 ${id}`,
  stage: "NOTICE",
  status: "OPEN",
  deadlineAt: null,
  analyses: [],
  reviews: [],
  ...over,
});

const source = (bids: DashboardBidRow[]): DashboardSource => ({
  bids,
  dataFreshness: { lastIngestAt: null, lastIngestStatus: null, lastIngestSummary: null },
  ai: { provider: "mock", kevEnabled: true, lastGatewayCheckAt: null, healthy: true },
  unreadNotifications: 3,
});
const noStatus = async (): Promise<never> => {
  throw new Error("요약 시험은 loadStatus 를 부르지 않는다");
};
const noFinished = async (): Promise<never> => {
  throw new Error("요약 시험은 listFinishedScores 를 부르지 않는다");
};
const summaryOf = (bids: DashboardBidRow[], origin: "live" | "demo" | "all" = "demo") => {
  const repo: DashboardRepo = {
    load: async () => source(bids),
    loadStatus: noStatus,
    listFinishedScores: noFinished,
  };
  return getDashboardSummary("org1", origin, { repo }, NOW);
};

describe("getDashboardSummary", () => {
  it("같은 공고의 COMPLETED BID 와 PARTIAL BID 가 있어도 BID 는 1건이다 (D10)", async () => {
    const summary = await summaryOf([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a2", status: "PARTIAL", createdAt: "2026-10-11T00:00:00Z" }),
        ],
      }),
    ]);
    expect(summary.analyses.byRecommendation.BID).toBe(1);
    expect(summary.analyses.total).toBe(1);
    expect(summary.analyses.partial).toBe(1);
  });

  it("공고별 최신 분석의 권고만 센다", async () => {
    const summary = await summaryOf([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", recommendation: "BID", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a2", recommendation: "NO_BID", createdAt: "2026-10-12T00:00:00Z" }),
        ],
      }),
    ]);
    expect(summary.analyses.byRecommendation).toEqual({ BID: 0, WATCH: 0, NO_BID: 1 });
  });

  it("QUEUED·RUNNING 은 최신 상태 집계에서 빠지고 FAILED 는 따로 센다", async () => {
    const summary = await summaryOf([
      bid("b1", {
        analyses: [
          analysis({ id: "a1" }),
          analysis({ id: "a2", status: "RUNNING", createdAt: "2026-10-15T00:00:00Z" }),
        ],
      }),
      bid("b2", { analyses: [analysis({ id: "a3", status: "FAILED", recommendation: null })] }),
    ]);
    expect(summary.analyses.latestByStatus).toEqual({ completed: 1, partial: 0, failed: 1 });
    expect(summary.analyses.total).toBe(1);
  });

  it("결정이 없는 분석 공고 2건이면 reviews.pending 은 2 다 (D11)", async () => {
    const summary = await summaryOf([
      bid("b1", { analyses: [analysis({ id: "a1" })] }),
      bid("b2", { analyses: [analysis({ id: "a2", status: "PARTIAL" })] }),
      bid("b3", { analyses: [analysis({ id: "a3" })], reviews: [review()] }),
      bid("b4"),
    ]);
    expect(summary.reviews.pending).toBe(2);
    expect(summary.reviews.byDecision).toEqual({ BID: 1, WATCH: 0, NO_BID: 0 });
  });

  it("최신 결정만 센다. 불일치도 최신 결정 기준이다", async () => {
    const summary = await summaryOf([
      bid("b1", {
        analyses: [analysis({ id: "a1" })],
        reviews: [
          review({ decision: "NO_BID", disagreementFlag: true, decidedAt: "2026-10-12T00:00:00Z" }),
          review({ decision: "BID", disagreementFlag: false, decidedAt: "2026-10-14T00:00:00Z" }),
        ],
      }),
    ]);
    expect(summary.reviews.byDecision.BID).toBe(1);
    expect(summary.reviews.byDecision.NO_BID).toBe(0);
    expect(summary.reviews.disagreementWithSystem).toBe(0);
  });

  it("withReviewFlags 는 최신 분석에 플래그가 있는 공고 수다", async () => {
    const summary = await summaryOf([
      bid("b1", { analyses: [analysis({ id: "a1", reviewFlagCount: 2 })] }),
      bid("b2", { analyses: [analysis({ id: "a2" })] }),
    ]);
    expect(summary.analyses.withReviewFlags).toBe(1);
  });

  it("공고 수·단계·상태와 7일 안 마감을 센다", async () => {
    const summary = await summaryOf([
      bid("b1", { deadlineAt: "2026-10-22T00:00:00Z" }),
      bid("b2", { deadlineAt: "2026-10-25T23:59:59Z", stage: "PLAN" }),
      bid("b3", { deadlineAt: "2026-10-26T00:00:01Z" }),
      bid("b4", { deadlineAt: "2026-10-18T00:00:00Z" }),
      bid("b5", { deadlineAt: "2026-10-21T00:00:00Z", status: "CANCELLED" }),
    ]);
    expect(summary.bids.total).toBe(5);
    expect(summary.bids.byStage).toEqual({ PLAN: 1, PRE_SPEC: 0, NOTICE: 4 });
    expect(summary.bids.byStatus).toEqual({ OPEN: 4, AMENDED: 0, CANCELLED: 1, CLOSED: 0 });
    expect(summary.bids.deadlineWithin7Days).toBe(2);
  });

  it("마감 임박 목록은 마감 빠른 순 10건이고 권고·결정을 붙인다", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      bid(`b${i}`, { deadlineAt: `2026-10-${String(20 + i).padStart(2, "0")}T00:00:00Z` }),
    );
    const first = many[0];
    if (!first) throw new Error("빈 목록");
    many[0] = {
      ...first,
      analyses: [analysis({ id: "a1", recommendation: "WATCH" })],
      reviews: [review({ decision: "BID" })],
    };
    const summary = await summaryOf(many);
    expect(summary.upcoming).toHaveLength(10);
    expect(summary.upcoming[0]).toEqual({
      bidId: "b0",
      title: "공고 b0",
      deadlineAt: "2026-10-20T00:00:00Z",
      recommendation: "WATCH",
      decision: "BID",
    });
  });

  it("출처 표시·generatedAt·알림 수를 채우고 스키마를 통과한다", async () => {
    const demo = await summaryOf([], "demo");
    expect(demo.dataFreshness.isDemo).toBe(true);
    expect(demo.generatedAt).toBe(NOW.toISOString());
    expect(demo.unreadNotifications).toBe(3);
    expect(dashboardSummarySchema.safeParse(demo).success).toBe(true);
    expect((await summaryOf([], "live")).dataFreshness.isDemo).toBe(false);
  });
});

// NAV-06(11 §9, 설계 §2.3): 분석 현황 카드는 공고별 끝난 분석(COMPLETED·PARTIAL·FAILED) 중 최신 1건만 센다.
// 같은 공고를 다시 분석해도(force 재분석·S6 PARTIAL) 공고 하나는 한 번만 세고, 진행 중 run 은 건너뛴다.
describe("getDashboardSummary · 분석 현황(latestByStatus) — NAV-06", () => {
  const latest = async (bids: DashboardBidRow[]) => (await summaryOf(bids)).analyses.latestByStatus;
  const sum = ({
    completed,
    partial,
    failed,
  }: {
    completed: number;
    partial: number;
    failed: number;
  }) => completed + partial + failed;

  it("COMPLETED 뒤 force 재분석이 PARTIAL 로 끝나면 부분 1 이고 완료는 세지 않는다(S6: 완료 17 · 부분 1)", async () => {
    const result = await latest([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a2", status: "PARTIAL", createdAt: "2026-10-11T00:00:00Z" }),
        ],
      }),
    ]);
    expect(result).toEqual({ completed: 0, partial: 1, failed: 0 });
  });

  it("같은 공고를 세 번 COMPLETED 로 다시 분석해도 완료 1 이다", async () => {
    const result = await latest([
      bid("b1", {
        analyses: ["10", "11", "12"].map((day, i) =>
          analysis({ id: `a${i}`, status: "COMPLETED", createdAt: `2026-10-${day}T00:00:00Z` }),
        ),
      }),
    ]);
    expect(result).toEqual({ completed: 1, partial: 0, failed: 0 });
  });

  it("FAILED 뒤 다시 분석해 COMPLETED 면 완료 1 · 실패 0 이고, 그 반대면 완료 0 · 실패 1 이다", async () => {
    const recovered = await latest([
      bid("b1", {
        analyses: [
          analysis({
            id: "a1",
            status: "FAILED",
            recommendation: null,
            createdAt: "2026-10-10T00:00:00Z",
          }),
          analysis({ id: "a2", status: "COMPLETED", createdAt: "2026-10-11T00:00:00Z" }),
        ],
      }),
    ]);
    expect(recovered).toEqual({ completed: 1, partial: 0, failed: 0 });
    const broken = await latest([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({
            id: "a2",
            status: "FAILED",
            recommendation: null,
            createdAt: "2026-10-11T00:00:00Z",
          }),
        ],
      }),
    ]);
    expect(broken).toEqual({ completed: 0, partial: 0, failed: 1 });
  });

  it.each(["QUEUED", "RUNNING"] as const)(
    "재분석이 %s 인 동안에는 앞의 끝난 분석을 센다 — 숫자가 1 줄지 않는다",
    async (status) => {
      const result = await latest([
        bid("b1", {
          analyses: [
            analysis({ id: "a1", status: "PARTIAL", createdAt: "2026-10-10T00:00:00Z" }),
            analysis({ id: "a2", status, recommendation: null, createdAt: "2026-10-11T00:00:00Z" }),
          ],
        }),
      ]);
      expect(result).toEqual({ completed: 0, partial: 1, failed: 0 });
    },
  );

  it("끝난 분석이 없고 진행 중 run 만 있는 공고는 세지 않는다", async () => {
    const result = await latest([
      bid("b1", { analyses: [analysis({ id: "a1", status: "QUEUED", recommendation: null })] }),
    ]);
    expect(result).toEqual({ completed: 0, partial: 0, failed: 0 });
  });

  it("행 순서와 상관없이 created_at 이 가장 늦은 끝난 분석을 고른다", async () => {
    const result = await latest([
      bid("b1", {
        analyses: [
          analysis({ id: "a3", status: "PARTIAL", createdAt: "2026-10-12T00:00:00Z" }),
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({
            id: "a2",
            status: "FAILED",
            recommendation: null,
            createdAt: "2026-10-11T00:00:00Z",
          }),
        ],
      }),
    ]);
    expect(result).toEqual({ completed: 0, partial: 1, failed: 0 });
  });

  it("created_at 이 같은 두 건이어도 공고 하나는 한 번만 센다(뒤에 읽은 행)", async () => {
    const result = await latest([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a2", status: "PARTIAL", createdAt: "2026-10-10T00:00:00Z" }),
        ],
      }),
    ]);
    expect(result).toEqual({ completed: 0, partial: 1, failed: 0 });
  });

  it("여러 공고를 섞어도 합계는 끝난 분석이 있는 공고 수와 같다", async () => {
    const result = await latest([
      bid("b1", {
        analyses: [
          analysis({ id: "a1", status: "COMPLETED", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a2", status: "PARTIAL", createdAt: "2026-10-11T00:00:00Z" }),
        ],
      }),
      bid("b2", {
        analyses: [
          analysis({
            id: "a3",
            status: "FAILED",
            recommendation: null,
            createdAt: "2026-10-10T00:00:00Z",
          }),
          analysis({ id: "a4", status: "COMPLETED", createdAt: "2026-10-11T00:00:00Z" }),
          analysis({ id: "a5", status: "COMPLETED", createdAt: "2026-10-12T00:00:00Z" }),
        ],
      }),
      bid("b3", { analyses: [analysis({ id: "a6", status: "FAILED", recommendation: null })] }),
      bid("b4", { analyses: [analysis({ id: "a7", status: "RUNNING", recommendation: null })] }),
      bid("b5"),
    ]);
    expect(result).toEqual({ completed: 1, partial: 1, failed: 1 });
    expect(sum(result)).toBe(3);
  });

  it("대시보드 출처(origin)를 그대로 repo 에 넘긴다 — 분석 현황도 같은 출처의 공고만 센다", async () => {
    const calls: [string, string][] = [];
    const repo: DashboardRepo = {
      load: async (orgId, origin) => {
        calls.push([orgId, origin]);
        return source([]);
      },
      loadStatus: noStatus,
      listFinishedScores: noFinished,
    };
    for (const origin of ["live", "demo", "all"] as const) {
      await getDashboardSummary("org1", origin, { repo }, NOW);
    }
    expect(calls).toEqual([
      ["org1", "live"],
      ["org1", "demo"],
      ["org1", "all"],
    ]);
  });
});

// M3: 업무 틀의 상단바용 가벼운 요약. 전체 집계(load)를 부르지 않는다.
describe("getStatusSummary", () => {
  const freshness = {
    lastIngestAt: "2026-10-19T00:01:00Z",
    lastIngestStatus: "SUCCEEDED" as const,
    lastIngestSummary: null,
  };
  const repoOf = (load: DashboardRepo["load"]): DashboardRepo => ({
    load,
    loadStatus: async () => ({ dataFreshness: freshness, unreadNotifications: 5 }),
    listFinishedScores: noFinished,
  });

  it.each([
    ["demo", true],
    ["live", false],
    ["all", false],
  ] as const)(
    "%s 출처면 신선도에 isDemo=%s 를 붙이고 안 읽은 수를 싣는다",
    async (origin, isDemo) => {
      const status = await getStatusSummary(origin, { repo: repoOf(noStatus) });
      expect(status).toEqual({
        dataFreshness: { ...freshness, isDemo },
        unreadNotifications: 5,
      });
      expect(dashboardSummarySchema.shape.dataFreshness.parse(status.dataFreshness)).toEqual(
        status.dataFreshness,
      );
    },
  );
});

// 미결정 30-8: 대시보드 BID 권고 표의 점수·권고 칸은 끝난 분석(COMPLETED·PARTIAL) 중 최신 1건이다.
// 표의 행은 목록이 끝난 분석의 권고 BID 로 고른다. 최신 run 이 진행 중·실패인 공고만 끝난 분석 값으로 칸을 채운다.
describe("대시보드 BID 표의 끝난 분석 값 — 미결정 30-8", () => {
  const listItem = (id: string, status: AnalysisStatus | null): BidListItem => ({
    id,
    source: "fixture",
    noticeId: `DEMO-${id}`,
    title: `공고 ${id}`,
    agency: null,
    stage: "NOTICE",
    status: "OPEN",
    budgetKrw: null,
    publishedAt: null,
    deadlineAt: null,
    latestRevision: 1,
    planRef: null,
    isDemo: true,
    sourceUrl: "https://example.invalid/bid",
    lastSyncedAt: "2026-10-19T00:00:00Z",
    origin: "demo",
    documentsStatus: {
      total: 0,
      pending: 0,
      parsed: 0,
      partial: 0,
      unsupported: 0,
      failed: 0,
      downloadFailed: 0,
    },
    latestAnalysis:
      status === null
        ? null
        : {
            id: `run-${id}`,
            status,
            solScore: status === "COMPLETED" || status === "PARTIAL" ? 90 : null,
            recommendation: status === "COMPLETED" || status === "PARTIAL" ? "BID" : null,
            recommendationBasis: null,
            reviewFlags: [],
            createdAt: "2026-10-19T00:00:00Z",
          },
    latestReview: null,
  });
  const scoreRow = (bidId: string, over: Partial<FinishedScoreRow> = {}): FinishedScoreRow => ({
    bidId,
    solScore: 82,
    recommendation: "BID",
    ...over,
  });

  it("재분석 RUNNING·QUEUED 인 공고는 끝난 분석의 점수·권고에 '재분석 중'을 붙인다(S6 FX-18)", () => {
    const items = [listItem("fx18", "RUNNING"), listItem("fx06", "QUEUED")];
    expect(
      finishedAnalysesOf(items, [scoreRow("fx18"), scoreRow("fx06", { solScore: 78 })]),
    ).toEqual({
      fx18: { solScore: 82, recommendation: "BID", rerunning: true },
      fx06: { solScore: 78, recommendation: "BID", rerunning: true },
    });
  });

  it("최신 run 이 FAILED 면 끝난 분석 값으로 채우고 '재분석 중'은 붙이지 않는다", () => {
    expect(finishedAnalysesOf([listItem("b1", "FAILED")], [scoreRow("b1")])).toEqual({
      b1: { solScore: 82, recommendation: "BID", rerunning: false },
    });
  });

  it("최신 run 이 COMPLETED·PARTIAL 이거나 분석이 없으면 칸을 바꾸지 않는다", () => {
    const items = [listItem("c", "COMPLETED"), listItem("p", "PARTIAL"), listItem("n", null)];
    expect(finishedAnalysesOf(items, [scoreRow("c"), scoreRow("p"), scoreRow("n")])).toEqual({});
  });

  it("끝난 분석이 하나도 없으면(값이 모두 null) 칸을 바꾸지 않는다", () => {
    const rows = [scoreRow("b1", { solScore: null, recommendation: null })];
    expect(finishedAnalysesOf([listItem("b1", "RUNNING")], rows)).toEqual({});
  });

  it("채울 공고만 repo 에 묻고, 없으면 읽지 않는다", async () => {
    const asked: string[][] = [];
    const repo = {
      listFinishedScores: async (bidIds: string[]) => {
        asked.push(bidIds);
        return bidIds.map((id) => scoreRow(id));
      },
    };
    const items = [listItem("done", "COMPLETED"), listItem("rerun", "RUNNING")];
    expect(await getFinishedAnalyses(items, { repo })).toEqual({
      rerun: { solScore: 82, recommendation: "BID", rerunning: true },
    });
    expect(asked).toEqual([["rerun"]]);
    expect(await getFinishedAnalyses([listItem("done", "COMPLETED")], { repo })).toEqual({});
    expect(asked).toHaveLength(1);
  });
});
