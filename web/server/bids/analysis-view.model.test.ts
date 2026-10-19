import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisResult, MissingReason, ScoreFactor } from "@/server/scoring";
import { analysisViewSchema, toAnalysisView } from "./index";
import type { AnalysisRunMeta } from "./index";

type Golden = {
  factors: {
    factor: ScoreFactor["factor"];
    normalized: number;
    points: number;
    maxPoints: number;
  }[];
  score: number;
  recommendation: "BID" | "WATCH" | "NO_BID";
  reviewFlags: string[];
};
const golden = JSON.parse(
  readFileSync(resolve(process.cwd(), "../fixtures/goldens/FX-01.json"), "utf8"),
) as Golden;

const fetchedAt = "2026-10-16T00:00:00Z";
const reason: MissingReason = "BID_DOMAIN_UNKNOWN";

const result: AnalysisResult = {
  schemaVersion: "analysis-result/v0.1",
  algorithmVersion: "sol-v0.1.0",
  inputSnapshotHash: "h",
  status: "COMPLETED",
  errorCode: null,
  score: golden.score,
  factors: golden.factors.map((f) => ({
    ...f,
    rawValue: {},
    missing: false,
    missingReason: null,
    evidence: [],
    note: null,
  })),
  qualificationStatus: "SATISFIED",
  qualificationChecks: [
    {
      id: "qualifications[0]",
      requirementCode: "1426",
      requirementName: "소프트웨어사업자",
      mandatory: true,
      outcome: "SATISFIED",
      reason: "보유",
      reasonCode: null,
      basis: "EXTRACTION",
      evidence: [{ documentId: null, revisionId: "r1", quotedText: "소프트웨어사업자", fetchedAt }],
      profileEvidence: [
        { type: "INDUSTRY_CODE", ref: "industryCodes[0]", label: "소프트웨어사업자" },
      ],
      companyEvidence: [],
    },
  ],
  requirementAssessments: [],
  recommendation: golden.recommendation,
  recommendationBasis: "RULES_ONLY",
  reviewFlags: ["KEV_NEEDS_REVIEW"],
  missingFactors: [{ factor: "scaleFit", reason }],
  injectionSuspected: false,
  kev: {
    enabled: false,
    provider: null,
    model: null,
    questionSetVersion: null,
    suggestedOption: null,
    probabilities: null,
    confidence: null,
    mandatoryRisk: null,
    needsHumanReview: null,
    fit: null,
    scores: null,
    risks: null,
    calibration: null,
    stateTrace: null,
    latencyMs: null,
    requestId: null,
    disclaimer: "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.",
  },
  explanation: "C4 설명(쓰지 않는다)",
  disclaimer: "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.",
};

const meta: AnalysisRunMeta = {
  id: "run-1",
  bidId: "bid-1",
  revisionId: "r1",
  revision: 1,
  profileRevision: 3,
  runMode: "fixture",
  status: "COMPLETED",
  model: { provider: "mock", qwen: null, kev: null, algorithmVersion: "sol-v0.1.0" },
  fallbackReason: null,
  evidence: [],
  errorCode: null,
  queuedAt: "2026-10-16T00:00:00Z",
  startedAt: "2026-10-16T00:00:01Z",
  finishedAt: "2026-10-16T00:00:02Z",
  checkedAt: "2026-10-16T00:00:02Z",
  extraReviewFlags: ["KEV_NEEDS_REVIEW", "CITATION_FAILED"],
  explanation: { text: "메타 설명", source: "TEMPLATE" },
};

describe("toAnalysisView", () => {
  const view = toAnalysisView(result, meta);

  it("score 를 solScore 로 옮긴다", () => {
    expect(view.solScore).toBe(94);
    expect(view.recommendation).toBe(golden.recommendation);
  });
  it("factors 를 scoreBreakdown 으로 옮기고 골든 points 와 같다", () => {
    expect(view.scoreBreakdown.map((f) => f.points)).toEqual(golden.factors.map((f) => f.points));
    expect(view.scoreBreakdown.map((f) => f.points)).toEqual([24, 25, 20, 15, 10]);
  });
  it("qualification 으로 묶고 행마다 checkedAt 을 붙인다", () => {
    expect(view.qualification.status).toBe("SATISFIED");
    expect(view.qualification.checks[0]?.checkedAt).toBe(meta.checkedAt);
  });
  it("missingFactors 를 {factor, reason} 으로 옮긴다", () => {
    expect(view.missingFactors).toEqual([{ factor: "scaleFit", reason }]);
  });
  it("explanation 은 meta 의 것을 쓴다", () => {
    expect(view.explanation).toBe("메타 설명");
  });
  it("extraReviewFlags 는 C4 뒤에 중복 없이 붙는다", () => {
    expect(view.reviewFlags).toEqual(["KEV_NEEDS_REVIEW", "CITATION_FAILED"]);
  });
  it("meta 의 식별·시각·모델 필드를 싣는다", () => {
    expect(view.id).toBe("run-1");
    expect(view.profileRevision).toBe(3);
    expect(view.runMode).toBe("fixture");
    expect(view.queuedAt).toBe(meta.queuedAt);
  });
  it("analysisViewSchema 를 통과한다", () => {
    expect(analysisViewSchema.parse(view).solScore).toBe(94);
  });
  it("점수 범위를 벗어나면 스키마가 거절한다", () => {
    expect(analysisViewSchema.safeParse({ ...view, solScore: 101 }).success).toBe(false);
  });
});
