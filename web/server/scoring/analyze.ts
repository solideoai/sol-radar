import "server-only";
import { ALGORITHM_VERSION, analysisInputSchema, type AnalysisInput } from "./analysis-input.model";
import {
  SOL_SCORE_DISCLAIMER,
  type AnalysisResult,
  type ReviewFlag,
  type ScoreFactor,
} from "./analysis-result.model";
import { decideRecommendation, mergeKev } from "./decision";
import { buildExplanation } from "./explanation";
import {
  collectMissingFactors,
  deriveDomain,
  pastPerformance,
  scaleFit,
  skillMatch,
  solScore,
  staffAvailability,
  strategicPreference,
  type FactorOutcome,
} from "./factors";
import { assessQualifications, hasParseFailure } from "./qualification";
import { assessSkillRequirements } from "./requirement-assessment";
import { snapshotHash } from "./snapshot-hash";

// 분석 1건의 순수 계산(08 전체). DB·네트워크·시각·난수·환경 변수에 닿지 않는다.
// 같은 AnalysisInput → 같은 inputSnapshotHash → 같은 AnalysisResult(byte-동일). 저장·큐·화면은 파이프라인 몫.
//
// 순서: 입력 검증 → 파생값(domain) → 자격 판정 → 요소 5개 → missing 정책 → 점수 → 결정 정책(규칙만) → Kev 병합(플래그·표시만) → 설명.

function toScoreFactor(outcome: FactorOutcome): ScoreFactor {
  return {
    factor: outcome.factor,
    rawValue: outcome.rawValue,
    normalized: outcome.normalized,
    points: outcome.points,
    maxPoints: outcome.maxPoints,
    missing: outcome.missing,
    missingReason: outcome.missingReason,
    evidence: outcome.evidence,
    note: outcome.note,
  };
}

export function analyze(rawInput: AnalysisInput): AnalysisResult {
  const input = analysisInputSchema.parse(rawInput);
  const { bid, extraction, profile, team, config } = input;
  const today = config.today;
  const inputSnapshotHash = snapshotHash(input);

  const domain = deriveDomain(bid, extraction);
  const qualification = assessQualifications({ bid, extraction, profile, today });
  const requirementAssessments = assessSkillRequirements(extraction, profile);

  const outcomes: FactorOutcome[] = [
    skillMatch(extraction, profile),
    pastPerformance(
      domain.domain,
      bid.budgetKrw === null ? null : Number(bid.budgetKrw),
      profile,
      today,
      domain.evidence,
    ),
    staffAvailability(bid, extraction, team, today),
    scaleFit(bid, extraction, profile),
    strategicPreference(bid, domain.domain, profile),
  ];
  const factors = outcomes.map(toScoreFactor);
  const missingFactors = collectMissingFactors(outcomes);
  const score = solScore(outcomes);

  const decision = decideRecommendation({
    qualificationStatus: qualification.status,
    missingFactorCount: missingFactors.length,
    score,
    thresholds: config.thresholds,
  });

  // 규칙 쪽 플래그. 어느 것도 점수 계산식·권고를 바꾸지 않는다(08 §5.4).
  const partial = extraction === null || (input.aiUnavailableReason ?? null) !== null;
  const status = partial ? "PARTIAL" : "COMPLETED";
  const errorCode = partial ? (input.aiUnavailableReason ?? "EXTRACTION_FAILED") : null;
  const ruleFlags: ReviewFlag[] = [
    ...(errorCode !== null ? [errorCode] : []),
    ...(hasParseFailure(bid, extraction) ? (["PARSE_UNSUPPORTED"] as const) : []),
    ...(extraction?.injectionSuspected ? (["INJECTION_SUSPECTED"] as const) : []),
    ...outcomes.flatMap((outcome) => outcome.reviewFlags),
  ];

  const kev = mergeKev({
    recommendation: decision.recommendation,
    qualificationStatus: qualification.status,
    kev: input.kev,
    tau: config.thresholds.kevTau,
  });
  const reviewFlags = [...new Set<ReviewFlag>([...ruleFlags, ...kev.reviewFlags])];

  const explanation = buildExplanation({
    status,
    score,
    recommendation: decision.recommendation,
    rulePath: decision.rulePath,
    qualificationStatus: qualification.status,
    checks: qualification.checks,
    factors,
    missingFactors,
    reviewFlags,
    kevSuggestedOption: kev.kev.suggestedOption,
  });

  return {
    schemaVersion: "analysis-result/v0.1",
    algorithmVersion: ALGORITHM_VERSION,
    inputSnapshotHash,
    status,
    errorCode,
    score,
    factors,
    qualificationStatus: qualification.status,
    qualificationChecks: qualification.checks,
    requirementAssessments,
    recommendation: decision.recommendation,
    recommendationBasis: kev.recommendationBasis,
    reviewFlags,
    missingFactors,
    injectionSuspected: extraction?.injectionSuspected ?? false,
    kev: kev.kev,
    explanation,
    disclaimer: SOL_SCORE_DISCLAIMER,
  };
}
