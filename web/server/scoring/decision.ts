import "server-only";
import type { KevMockResponse, Recommendation, ScoringConfig } from "./analysis-input.model";
import {
  KEV_DISCLAIMER,
  type KevAssist,
  type QualificationOutcome,
  type RecommendationBasis,
  type ReviewFlag,
} from "./analysis-result.model";

// 08 §5.2 결정 정책 v0.1 과 §5.3 Kev 처리.
// 결정 정책의 입력은 규칙 결과(자격·missingFactors·점수)뿐이다. Kev 출력은 이 함수에 들어오지 않는다.
// Kev 가 할 수 있는 일은 reviewFlags 추가와 참고 지표(KevAssist) 표시뿐이고, 권고·점수·자격을 바꾸는 코드 경로는 없다(17 절대 규칙, ADR-004·020).

export type RulePath =
  | "MANDATORY_NOT_SATISFIED"
  | "QUALIFICATION_NEEDS_REVIEW"
  | "MISSING_FACTORS"
  | "SCORE_BID"
  | "SCORE_WATCH"
  | "SCORE_NO_BID";

export type RuleDecision = { recommendation: Recommendation; rulePath: RulePath };

export function decideRecommendation(args: {
  qualificationStatus: QualificationOutcome;
  missingFactorCount: number;
  score: number;
  thresholds: ScoringConfig["thresholds"];
}): RuleDecision {
  const { qualificationStatus, missingFactorCount, score, thresholds } = args;
  if (qualificationStatus === "NOT_SATISFIED")
    return { recommendation: "NO_BID", rulePath: "MANDATORY_NOT_SATISFIED" };
  if (qualificationStatus === "NEEDS_REVIEW")
    return { recommendation: "WATCH", rulePath: "QUALIFICATION_NEEDS_REVIEW" };
  if (missingFactorCount >= 2) return { recommendation: "WATCH", rulePath: "MISSING_FACTORS" };
  if (score >= thresholds.bid) return { recommendation: "BID", rulePath: "SCORE_BID" };
  if (score >= thresholds.watch) return { recommendation: "WATCH", rulePath: "SCORE_WATCH" };
  return { recommendation: "NO_BID", rulePath: "SCORE_NO_BID" };
}

export const KEV_DISABLED: KevAssist = {
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
  disclaimer: KEV_DISCLAIMER,
};

/** Kev wire 응답 → KevAssist(03 §5.7). 표시용이며 점수·권고 입력이 아니다. v0.2 필드는 v0.1 run 에서 null. */
export function toKevAssist(kev: KevMockResponse | null): KevAssist {
  if (kev === null) return KEV_DISABLED;
  const { recommendation, mandatoryRisk, needsHumanReview, fit } = kev.responses;
  return {
    ...KEV_DISABLED,
    enabled: true,
    provider: kev.provider,
    model: kev.model ?? null,
    questionSetVersion: kev.questionSetVersion,
    suggestedOption: recommendation.choice,
    probabilities: { ...recommendation.probabilities },
    confidence: recommendation.confidence,
    mandatoryRisk: mandatoryRisk.noul,
    needsHumanReview: needsHumanReview.noul,
    fit: { score: fit.score, legend: { ...fit.legend } },
    latencyMs: kev.latency_ms ?? null,
    requestId: kev.requestId ?? null,
  };
}

export type KevMerge = {
  recommendationBasis: RecommendationBasis;
  reviewFlags: ReviewFlag[];
  kev: KevAssist;
};

/**
 * 08 §5.3 처리 표. 규칙 권고는 인자로 받아 그대로 돌려주지 않는다 — 이 함수는 권고를 반환하지 않으므로
 * 호출자가 Kev 로 권고를 덮어쓸 길이 없다. 비교 기준은 wire 의 choice(모델 최상위 선택지)다.
 */
export function mergeKev(args: {
  recommendation: Recommendation;
  qualificationStatus: QualificationOutcome;
  kev: KevMockResponse | null;
  tau: number;
}): KevMerge {
  const { recommendation, qualificationStatus, kev, tau } = args;
  if (kev === null)
    return { recommendationBasis: "RULES_ONLY", reviewFlags: [], kev: KEV_DISABLED };
  const { responses } = kev;
  const flags: ReviewFlag[] = [];
  if (responses.recommendation.choice !== recommendation) flags.push("MODEL_RULE_DISAGREEMENT");
  if (responses.mandatoryRisk.noul >= tau && qualificationStatus === "SATISFIED")
    flags.push("KEV_MANDATORY_RISK");
  if (responses.needsHumanReview.noul >= tau) flags.push("KEV_NEEDS_REVIEW");
  return {
    recommendationBasis: "RULES_WITH_KEV_ASSIST",
    reviewFlags: flags,
    kev: toKevAssist(kev),
  };
}
