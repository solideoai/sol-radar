import { describe, expect, it } from "vitest";
import type {
  DashboardAnalysisRow,
  DashboardRepo,
  DashboardReviewRow,
  DashboardSource,
} from "./bids.repo";
import { getDashboardSummary } from "./dashboard.service";
import { compareDueOrder, reviewPendingBids, type PendingSourceRow } from "./review-pending";

const NOW = new Date("2026-10-21T00:00:00Z");

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
const bid = (id: string, over: Partial<PendingSourceRow> = {}): PendingSourceRow => ({
  bidId: id,
  title: `공고 ${id}`,
  agency: `기관 ${id}`,
  isDemo: true,
  stage: "NOTICE",
  status: "OPEN",
  deadlineAt: "2026-11-01T00:00:00Z",
  analyses: [],
  reviews: [],
  ...over,
});

const pendingIds = (rows: PendingSourceRow[]) =>
  reviewPendingBids({ bids: rows }, NOW).map((card) => card.bidId);

describe("reviewPendingBids — 대시보드 reviews.pending 과 같은 정의", () => {
  it("같은 원본이면 total 이 getDashboardSummary 의 reviews.pending 과 같다", async () => {
    const rows = [
      bid("pending-completed", { analyses: [analysis({ id: "a1" })] }),
      bid("pending-partial", { analyses: [analysis({ id: "a2", status: "PARTIAL" })] }),
      bid("decided", { analyses: [analysis({ id: "a3" })], reviews: [review()] }),
      bid("running-only", { analyses: [analysis({ id: "a4", status: "RUNNING" })] }),
      bid("failed-latest", {
        analyses: [
          analysis({ id: "a5", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a6", status: "FAILED", createdAt: "2026-10-11T00:00:00Z" }),
        ],
      }),
      bid("scored-then-queued", {
        analyses: [
          analysis({ id: "a7", createdAt: "2026-10-10T00:00:00Z" }),
          analysis({ id: "a8", status: "QUEUED", createdAt: "2026-10-12T00:00:00Z" }),
        ],
      }),
      bid("no-analysis"),
    ];
    const source: DashboardSource = {
      bids: rows,
      dataFreshness: { lastIngestAt: null, lastIngestStatus: null, lastIngestSummary: null },
      ai: { provider: "mock", kevEnabled: true, lastGatewayCheckAt: null, healthy: true },
      unreadNotifications: 0,
    };
    const repo: DashboardRepo = {
      load: async () => source,
      loadStatus: async () => {
        throw new Error("요약 시험은 loadStatus 를 부르지 않는다");
      },
    };
    const summary = await getDashboardSummary("org1", "demo", { repo }, NOW);
    const cards = reviewPendingBids({ bids: rows }, NOW);
    expect(cards).toHaveLength(summary.reviews.pending);
    expect(cards.map((card) => card.bidId).sort()).toEqual([
      "pending-completed",
      "pending-partial",
      "scored-then-queued",
    ]);
  });

  it("진행 중(QUEUED·RUNNING) 분석만 있는 공고는 빠진다", () => {
    expect(
      pendingIds([
        bid("queued", { analyses: [analysis({ id: "a1", status: "QUEUED" })] }),
        bid("running", { analyses: [analysis({ id: "a2", status: "RUNNING" })] }),
      ]),
    ).toEqual([]);
  });

  it("끝난 분석 중 최신이 FAILED 면 빠진다(그 전 분석이 COMPLETED 여도)", () => {
    expect(
      pendingIds([
        bid("failed", {
          analyses: [
            analysis({ id: "a1", createdAt: "2026-10-10T00:00:00Z" }),
            analysis({ id: "a2", status: "FAILED", createdAt: "2026-10-11T00:00:00Z" }),
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("결정이 하나라도 있는 공고는 빠진다(WATCH·NO_BID 도)", () => {
    expect(
      pendingIds([
        bid("bid", { analyses: [analysis({ id: "a1" })], reviews: [review()] }),
        bid("watch", {
          analyses: [analysis({ id: "a2" })],
          reviews: [review({ decision: "WATCH" })],
        }),
        bid("no-bid", {
          analyses: [analysis({ id: "a3" })],
          reviews: [review({ decision: "NO_BID" })],
        }),
      ]),
    ).toEqual([]);
  });

  it("카드는 최신 점수 분석의 권고와 공고 값을 싣는다", () => {
    const [card] = reviewPendingBids(
      {
        bids: [
          bid("b1", {
            title: "가상 공고",
            agency: null,
            isDemo: false,
            status: "AMENDED",
            deadlineAt: "2026-10-30T09:00:00Z",
            analyses: [
              analysis({ id: "a1", recommendation: "BID", createdAt: "2026-10-10T00:00:00Z" }),
              analysis({ id: "a2", recommendation: "WATCH", createdAt: "2026-10-11T00:00:00Z" }),
            ],
          }),
        ],
      },
      NOW,
    );
    expect(card).toEqual({
      bidId: "b1",
      title: "가상 공고",
      agency: null,
      deadlineAt: "2026-10-30T09:00:00Z",
      recommendation: "WATCH",
      bidStatus: "AMENDED",
      isDemo: false,
    });
  });

  it("순서는 마감 가까운 순, 지난 마감·마감 없음은 맨 뒤, 같으면 제목 가나다(U18)", () => {
    const scored = [analysis({ id: "a" })];
    expect(
      pendingIds([
        bid("none", { deadlineAt: null, analyses: scored }),
        bid("past-far", { deadlineAt: "2026-10-01T00:00:00Z", analyses: scored }),
        bid("later", { deadlineAt: "2026-11-30T00:00:00Z", analyses: scored }),
        bid("past-near", { deadlineAt: "2026-10-20T00:00:00Z", analyses: scored }),
        bid("soon-b", { title: "나 공고", deadlineAt: "2026-10-25T00:00:00Z", analyses: scored }),
        bid("soon-a", { title: "가 공고", deadlineAt: "2026-10-25T00:00:00Z", analyses: scored }),
      ]),
    ).toEqual(["soon-a", "soon-b", "later", "past-near", "past-far", "none"]);
  });
});

describe("compareDueOrder", () => {
  const nowMs = NOW.getTime();
  const item = (id: string, dueAt: string | null, title = id) => ({ id, dueAt, title });

  it("오늘 남은 마감(D-Day)은 지난 마감이 아니다", () => {
    const sorted = [
      item("past", "2026-10-20T23:59:00Z"),
      item("today", "2026-10-21T09:00:00Z"),
    ].toSorted((a, b) => compareDueOrder(a, b, nowMs));
    expect(sorted.map((entry) => entry.id)).toEqual(["today", "past"]);
  });

  it("제목까지 같으면 id 로 순서를 고정한다", () => {
    const sorted = [item("b", null, "같음"), item("a", null, "같음")].toSorted((a, b) =>
      compareDueOrder(a, b, nowMs),
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
