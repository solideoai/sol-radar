import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { SolRole } from "@/server/organization";
import {
  bidListItemSchema,
  effectiveStatus,
  isUuid,
  reviewFlagSchema,
  reviewInputSchema,
  reviewSchema,
  roleSchema,
} from "./index";

const listItem = {
  id: "b1",
  source: "fixture",
  noticeId: "FX-01",
  title: "공고",
  agency: "기관",
  stage: "NOTICE",
  status: "OPEN",
  budgetKrw: "1200000000",
  publishedAt: "2026-10-01T00:00:00Z",
  deadlineAt: "2026-11-01T00:00:00Z",
  latestRevision: 1,
  planRef: null,
  isDemo: true,
  sourceUrl: "https://example.test/a",
  lastSyncedAt: "2026-10-01T00:00:00Z",
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
  latestAnalysis: null,
  latestReview: null,
};

describe("bid.model", () => {
  it("reviewFlag 는 17개다", () => {
    expect(reviewFlagSchema.options.length).toBe(17);
  });
  it("05 §4.3 모양의 BidListItem 을 받는다", () => {
    expect(bidListItemSchema.parse(listItem).id).toBe("b1");
  });
  it("latestAnalysis 가 있는 항목도 받는다", () => {
    const withRun = {
      ...listItem,
      latestAnalysis: {
        id: "a1",
        status: "COMPLETED",
        solScore: 94,
        recommendation: "BID",
        recommendationBasis: "RULES_ONLY",
        reviewFlags: [],
        createdAt: "2026-10-02T00:00:00Z",
      },
      latestReview: { decision: "BID", decidedAt: "2026-10-03T00:00:00Z", reviewerName: "홍길동" },
    };
    expect(bidListItemSchema.safeParse(withRun).success).toBe(true);
  });
  it("숫자 문자열이 아닌 budgetKrw 는 거절한다", () => {
    expect(bidListItemSchema.safeParse({ ...listItem, budgetKrw: "1,200" }).success).toBe(false);
  });
  it("알 수 없는 stage 는 거절한다", () => {
    expect(bidListItemSchema.safeParse({ ...listItem, stage: "ETC" }).success).toBe(false);
  });
  it("reviewInputSchema 는 짧은 사유와 공백 사유를 거절한다", () => {
    expect(reviewInputSchema.safeParse({ decision: "BID", reason: "짧음" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ decision: "BID", reason: "          " }).success).toBe(
      false,
    );
  });
  it("roleSchema 는 organization 의 SolRole 과 같은 타입이다", () => {
    expectTypeOf<z.infer<typeof roleSchema>>().toEqualTypeOf<SolRole>();
    expect(roleSchema.options).toEqual(["ADMIN", "SALES", "ANALYST", "VIEWER"]);
  });
  it("reviewer.role 은 조직을 떠난 검토자라면 null 이다", () => {
    const review = {
      id: "r1",
      bidId: "b1",
      revisionId: "rev1",
      scoreRunId: null,
      reviewer: { id: "u1", name: "퇴사자", role: null },
      decision: "BID",
      reason: "사유",
      decidedAt: "2026-10-19T00:00:00Z",
      assignee: null,
      systemRecommendationAtDecision: null,
      disagreementFlag: false,
    };
    expect(reviewSchema.safeParse(review).success).toBe(true);
    expect(
      reviewSchema.safeParse({ ...review, reviewer: { id: "u1", name: "x", role: "BOSS" } })
        .success,
    ).toBe(false);
  });
});

describe("isUuid", () => {
  it("UUID 만 통과한다", () => {
    expect(isUuid("3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c")).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c-x")).toBe(false);
  });
});

describe("effectiveStatus (B14)", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  it("마감이 지난 OPEN·AMENDED 는 CLOSED 다", () => {
    expect(effectiveStatus("OPEN", "2026-10-18T23:59:59Z", now)).toBe("CLOSED");
    expect(effectiveStatus("AMENDED", "2026-10-01T00:00:00Z", now)).toBe("CLOSED");
  });
  it("마감 전이거나 마감이 없으면 저장 값이다", () => {
    expect(effectiveStatus("OPEN", "2026-10-19T00:00:00Z", now)).toBe("OPEN");
    expect(effectiveStatus("AMENDED", "2026-11-01T00:00:00Z", now)).toBe("AMENDED");
    expect(effectiveStatus("OPEN", null, now)).toBe("OPEN");
  });
  it("CANCELLED 는 마감이 지나도 CANCELLED 다", () => {
    expect(effectiveStatus("CANCELLED", "2026-10-01T00:00:00Z", now)).toBe("CANCELLED");
  });
});
