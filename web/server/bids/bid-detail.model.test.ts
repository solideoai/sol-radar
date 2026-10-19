import { describe, expect, it } from "vitest";
import { bidDetailSchema, reviewSchema } from "./index";

const review = {
  id: "review-1",
  bidId: "bid-1",
  revisionId: "revision-1",
  scoreRunId: "run-1",
  reviewer: { id: "sales-1", name: "가상 담당자", role: "SALES" },
  decision: "WATCH",
  reason: "추가 인력 확보 가능성을 확인합니다",
  decidedAt: "2026-10-16T09:00:00Z",
  assignee: null,
  systemRecommendationAtDecision: "BID",
  disagreementFlag: true,
};

const detail = {
  id: "bid-1",
  source: "fixture",
  noticeId: "FX-01",
  title: "가상 입찰 공고",
  agency: null,
  stage: "NOTICE",
  status: "OPEN",
  budgetKrw: "1200000000",
  publishedAt: null,
  deadlineAt: null,
  latestRevision: 1,
  planRef: null,
  isDemo: true,
  sourceUrl: "https://example.test/FX-01",
  lastSyncedAt: "2026-10-16T09:00:00Z",
  origin: "demo",
  documentsStatus: {
    total: 1,
    pending: 1,
    parsed: 0,
    partial: 0,
    unsupported: 0,
    failed: 0,
    downloadFailed: 0,
  },
  latestAnalysis: null,
  latestReview: null,
  content: "본문만 확보한 DEMO 공고입니다",
  original: { noticeNo: "FX-01" },
  revisions: [],
  documents: [
    {
      id: "document-1",
      name: "첨부.pdf",
      mimeType: "application/pdf",
      sizeBytes: null,
      format: "PDF",
      downloadStatus: "PENDING",
      parseStatus: null,
      downloadErrorCode: null,
      pageCount: null,
      parseErrorCode: null,
      downloadPath: null,
    },
  ],
  stageLinks: { planRef: null, preSpecRef: null },
  structuredQualifications: [],
  extraction: null,
  extractionStatus: "PENDING",
  reviews: [review],
};

describe("FX-01 detail and review contracts", () => {
  it("preserves source, DEMO provenance and pending document state before analysis", () => {
    const parsed = bidDetailSchema.parse(detail);
    expect(parsed.isDemo).toBe(true);
    expect(parsed.sourceUrl).toBe(detail.sourceUrl);
    expect(parsed.latestAnalysis).toBeNull();
    expect(parsed.documents[0]).toMatchObject({ downloadStatus: "PENDING", parseStatus: null });
  });

  it("rejects an invented document download status", () => {
    expect(
      bidDetailSchema.safeParse({
        ...detail,
        documents: [{ ...detail.documents[0], downloadStatus: "MOCK_PARSED" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a list analysis summary in place of the full analysis view", () => {
    expect(
      bidDetailSchema.safeParse({
        ...detail,
        latestAnalysis: { id: "run-1", status: "COMPLETED", solScore: 94 },
      }).success,
    ).toBe(false);
  });

  it("keeps the user decision distinct from the system recommendation snapshot", () => {
    const parsed = reviewSchema.parse(review);
    expect(parsed.decision).toBe("WATCH");
    expect(parsed.systemRecommendationAtDecision).toBe("BID");
    expect(parsed.disagreementFlag).toBe(true);
  });

  it("allows a review without an analysis or assignee", () => {
    expect(
      reviewSchema.parse({ ...review, scoreRunId: null, systemRecommendationAtDecision: null })
        .scoreRunId,
    ).toBeNull();
  });

  it("rejects unknown reviewer roles and uncontracted review properties", () => {
    expect(
      reviewSchema.safeParse({ ...review, reviewer: { ...review.reviewer, role: "OWNER" } })
        .success,
    ).toBe(false);
    expect(reviewSchema.safeParse({ ...review, organizationId: "foreign-org" }).success).toBe(
      false,
    );
  });
});
