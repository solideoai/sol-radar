import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analysisViewSchema,
  bidListItemSchema,
  notificationSchema,
  reviewSchema,
} from "@/server/bids";
import type { FactorKey, Recommendation, ReviewFlag } from "@/server/bids";
import {
  BID_LIST,
  FX01_PARTIAL_VIEW,
  FX01_VIEW,
  FX02_VIEW,
  FX03_VIEW,
  NOTIFICATIONS,
  REVIEWS_FX01,
} from "./test-data";

type Golden = {
  factors: { factor: FactorKey; points: number }[];
  score: number;
  recommendation: Recommendation;
  reviewFlags: ReviewFlag[];
};

// vitest 가 어디서 돌든 같도록 파일 기준 경로를 쓴다.
function golden(id: string): Golden {
  const url = new URL(`../../../fixtures/goldens/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Golden;
}

const cases = [
  ["FX-01", FX01_VIEW],
  ["FX-02", FX02_VIEW],
  ["FX-03", FX03_VIEW],
] as const;

describe.each(cases)("%s 뷰", (id, view) => {
  const g = golden(id);
  it("analysisViewSchema 를 통과한다", () => {
    expect(analysisViewSchema.parse(view)).toEqual(view);
  });
  it("요소 점수·총점·권고·플래그가 골든과 같다", () => {
    expect(view.scoreBreakdown.map((f) => [f.factor, f.points])).toEqual(
      g.factors.map((f) => [f.factor, f.points]),
    );
    expect(view.solScore).toBe(g.score);
    expect(view.recommendation).toBe(g.recommendation);
    expect(view.reviewFlags).toEqual(g.reviewFlags);
  });
});

describe.each(cases)("%s Kev 적합도", (id, view) => {
  it("fit.score 가 fixtures/kev 의 wire 값과 같다", () => {
    const url = new URL(`../../../fixtures/kev/${id}.json`, import.meta.url);
    const kev = JSON.parse(readFileSync(url, "utf8")) as {
      responses: { fit: { score: number } };
    };
    expect(view.kev.fit?.score).toBe(kev.responses.fit.score);
  });
});

describe("Kev 분포와 특성", () => {
  it("FX-01 은 0.71/0.24/0.05, v0.1, v0.2 필드 null, 항목 분포 1건 이상", () => {
    expect(FX01_VIEW.kev.enabled).toBe(true);
    expect(FX01_VIEW.kev.questionSetVersion).toBe("kev-qs/v0.1");
    expect(FX01_VIEW.kev.probabilities).toEqual({ BID: 0.71, WATCH: 0.24, NO_BID: 0.05 });
    expect(FX01_VIEW.kev.scores).toBeNull();
    expect(FX01_VIEW.kev.risks).toBeNull();
    expect(FX01_VIEW.kev.calibration).toBeNull();
    expect(FX01_VIEW.requirementAssessments.length).toBeGreaterThanOrEqual(1);
    expect(FX01_VIEW.requirementAssessments[0]?.kev?.distribution).toBeDefined();
  });
  it("FX-02 는 0.36/0.52/0.12, FX-03 은 0.55/0.30/0.15", () => {
    expect(FX02_VIEW.kev.probabilities).toEqual({ BID: 0.36, WATCH: 0.52, NO_BID: 0.12 });
    expect(FX03_VIEW.kev.probabilities).toEqual({ BID: 0.55, WATCH: 0.3, NO_BID: 0.15 });
    expect(FX03_VIEW.kev.mandatoryRisk).toBe(0.85);
    expect(FX02_VIEW.kev.needsHumanReview).toBe(0.74);
  });
  it("FX-03 은 NO_BID 이고 미충족 1건 INDUSTRY_CODE", () => {
    expect(FX03_VIEW.recommendation).toBe("NO_BID");
    const failed = FX03_VIEW.qualification.checks.filter((c) => c.outcome === "NOT_SATISFIED");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.profileEvidence[0]?.type).toBe("INDUSTRY_CODE");
  });
});

describe("PARTIAL 뷰", () => {
  it("규칙만, AI 불가, Kev 꺼짐", () => {
    expect(analysisViewSchema.parse(FX01_PARTIAL_VIEW).status).toBe("PARTIAL");
    expect(FX01_PARTIAL_VIEW.recommendationBasis).toBe("RULES_ONLY");
    expect(FX01_PARTIAL_VIEW.reviewFlags).toContain("AI_UNAVAILABLE");
    expect(FX01_PARTIAL_VIEW.kev.enabled).toBe(false);
  });
});

describe("목록·결정·알림", () => {
  it("BID_LIST 는 스키마를 통과하고 null 필드 1건과 120자 제목 1건을 가진다", () => {
    for (const item of BID_LIST) bidListItemSchema.parse(item);
    expect(BID_LIST.length).toBeGreaterThanOrEqual(5);
    expect(BID_LIST.some((b) => b.budgetKrw === null && b.deadlineAt === null)).toBe(true);
    expect(BID_LIST.some((b) => b.title.length === 120)).toBe(true);
  });
  it("REVIEWS_FX01·NOTIFICATIONS 는 스키마를 통과한다", () => {
    for (const r of REVIEWS_FX01) reviewSchema.parse(r);
    for (const n of NOTIFICATIONS) notificationSchema.parse(n);
    expect(REVIEWS_FX01.length).toBeGreaterThanOrEqual(1);
    expect(new Set(NOTIFICATIONS.map((n) => n.type)).size).toBe(5);
    expect(NOTIFICATIONS.some((n) => n.readAt === null)).toBe(true);
  });
});
