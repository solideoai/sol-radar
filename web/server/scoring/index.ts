import "server-only";
export { availableFte, toPeopleProfile, toScoringTeam } from "./scoring.model";
export type {
  AvailabilityWindow,
  CapacityPeriod,
  ScoringAssignment,
  ScoringMember,
  ScoringPerson,
  ScoringTeam,
} from "./scoring.model";

// 규칙 엔진(08). 계산은 전부 순수 함수이고 저장·큐·AI 호출은 파이프라인 도메인이 한다.
export { analyze } from "./analyze";
export {
  ALGORITHM_VERSION,
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  analysisInputSchema,
  companyProfileSchema,
  evidenceRefSchema,
  companyEvidenceRefSchema,
  extractedFieldSchema,
  fieldStateSchema,
  kevMockResponseSchema,
  normalizedBidSummarySchema,
  requirementExtractionSchema,
  scoringConfigSchema,
  scoringTeamSchema,
  structuredRequirementSchema,
} from "./analysis-input.model";
export type {
  AiUnavailableReason,
  AnalysisInput,
  CompanyEvidenceRef,
  CompanyProfile,
  EvidenceRef,
  ExtractedField,
  FieldState,
  KevMockResponse,
  NormalizedBidSummary,
  QualificationRequirement,
  Recommendation,
  RequirementExtraction,
  ScoringConfig,
  ScoringTeamInput,
  StructuredRequirement,
  StructuredRequirementKind,
} from "./analysis-input.model";
export {
  FACTOR_KEYS,
  KEV_DISCLAIMER,
  MAX_POINTS,
  SOL_SCORE_DISCLAIMER,
} from "./analysis-result.model";
export type {
  AnalysisResult,
  AnalysisStatus,
  FactorKey,
  KevAssist,
  MissingFactor,
  MissingReason,
  NeedsReviewReason,
  QualificationCheck,
  QualificationOutcome,
  RecommendationBasis,
  RequirementAssessment,
  RequirementBasis,
  ReviewFlag,
  ScoreFactor,
} from "./analysis-result.model";
export { assessQualifications, hasParseFailure } from "./qualification";
export { assessSkillRequirements } from "./requirement-assessment";
export type { QualificationAssessment, QualificationContext } from "./qualification";
export {
  FTE_BY_BUDGET,
  SCHEDULE,
  collectMissingFactors,
  deriveDomain,
  deriveRequiredFte,
  pastPerformance,
  scaleFit,
  skillMatch,
  solScore,
  staffAvailability,
  strategicPreference,
} from "./factors";
export type { FactorOutcome } from "./factors";
export { decideRecommendation, mergeKev, toKevAssist } from "./decision";
export type { KevMerge, RuleDecision, RulePath } from "./decision";
export { canonicalJson, sha256Hex, snapshotHash } from "./snapshot-hash";
export { QUALIFICATION_CODES, resolveQualificationCode } from "./qualification-codes";
export type { QualificationCode } from "./qualification-codes";
export {
  DOMAINS,
  DOMAIN_KEYWORDS,
  agencyType,
  canonicalDomain,
  classifyDomain,
} from "./domain-keywords";
export type { AgencyType, Domain } from "./domain-keywords";
export { businessDaysBetween, defaultProjectPeriod, kstDate } from "./calendar";
export { whatIf } from "./what-if";
export type { Assumption, WhatIfOutcome, WhatIfSummary } from "./what-if";
