import "server-only";
import type { CompanyEvidenceRef, EvidenceRef, Recommendation } from "./analysis-input.model";

// 규칙 엔진의 출력 계약. 모양은 docs/05 §4.5 AnalysisResult 를 따르되 저장·식별자·시각(id·queuedAt 등)은
// 파이프라인이 붙인다. 여기에는 순수 계산 결과만 있다.

export const FACTOR_KEYS = [
  "skillMatch",
  "pastPerformance",
  "staffAvailability",
  "scaleFit",
  "strategicPreference",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

// 08 §2 v0.1 점수표. algorithm_version 별 불변.
export const MAX_POINTS: Record<FactorKey, number> = {
  skillMatch: 30,
  pastPerformance: 25,
  staffAvailability: 20,
  scaleFit: 15,
  strategicPreference: 10,
};

// 08 §4 missing 정책의 사유 코드(9행).
export type MissingReason =
  | "NO_REQUIREMENTS_EXTRACTED"
  | "PROFILE_TECHNOLOGIES_EMPTY"
  | "BID_DOMAIN_UNKNOWN"
  | "PROFILE_PROJECTS_EMPTY"
  | "REQUIRED_FTE_UNKNOWN"
  | "TEAM_EMPTY"
  | "BUDGET_UNKNOWN"
  | "PREFERENCES_NOT_SET";
export type MissingFactor = { factor: FactorKey; reason: MissingReason };

// 04 review_flag 값 집합 가운데 규칙 엔진이 낼 수 있는 것.
export type ReviewFlag =
  | "MODEL_RULE_DISAGREEMENT"
  | "KEV_MANDATORY_RISK"
  | "KEV_NEEDS_REVIEW"
  | "EXTRACTION_FAILED"
  | "AI_UNAVAILABLE"
  | "QWEN_UNAVAILABLE"
  | "PARSE_UNSUPPORTED"
  | "INJECTION_SUSPECTED"
  | "SCALE_LIMIT_EXCEEDED";

export type QualificationOutcome = "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW";
export type NeedsReviewReason =
  | "NOTICE_INFO_MISSING"
  | "NOTICE_CONFLICTED"
  | "COMPANY_EVIDENCE_MISSING"
  | "AMBIGUOUS_MATCH"
  | "PARSE_UNSUPPORTED"
  | "STAGE_NOT_APPLICABLE";
export type RequirementBasis = "API_FIELD" | "EXTRACTION";
export type RecommendationBasis = "RULES_ONLY" | "RULES_WITH_KEV_ASSIST";
export type AnalysisStatus = "COMPLETED" | "PARTIAL";

export type ScoreFactor = {
  factor: FactorKey;
  rawValue: Record<string, unknown>;
  normalized: number; // 소수 3자리(표시용). points 는 반올림 전 값으로 계산한다
  points: number; // 소수 1자리
  maxPoints: number;
  missing: boolean;
  missingReason: MissingReason | null;
  evidence: EvidenceRef[];
  note: string | null;
};

export type ProfileEvidence = {
  type: "LICENSE" | "INDUSTRY_CODE" | "TECHNOLOGY" | "PAST_PROJECT" | "FINANCIAL";
  ref: string;
  label: string;
};

export type QualificationCheck = {
  id: string; // 추출 필드 경로("qualifications[0]") 또는 구조화 행("structured:LICENSE_LIMIT[0]")
  requirementCode: string | null;
  requirementName: string;
  mandatory: boolean;
  outcome: QualificationOutcome;
  reason: string;
  reasonCode: NeedsReviewReason | null; // NEEDS_REVIEW 일 때만 값이 있다
  basis: RequirementBasis;
  evidence: EvidenceRef[]; // 공고 쪽 근거
  profileEvidence: ProfileEvidence[];
  companyEvidence: CompanyEvidenceRef[]; // NOT_SATISFIED 면 명시적 부정 근거 1개 이상
};

// 05 RequirementAssessment(04 requirement_assessments 한 행). v0.1 규칙 엔진은 SKILL 항목만 낸다. kev 는 파이프라인이 v0.2 에서 채운다.
export type RequirementAssessment = {
  itemId: string; // 추출 필드 경로. 예: "requiredSkills[2]"
  itemKind: "SKILL" | "PAST_PERFORMANCE" | "STAFFING" | "QUALIFICATION";
  ruleStatus: QualificationOutcome;
  ruleReason: NeedsReviewReason | null;
  basis: RequirementBasis;
  noticeEvidence: EvidenceRef[];
  companyEvidence: CompanyEvidenceRef[];
  kev: null;
  flags: ReviewFlag[];
};

export const KEV_DISCLAIMER =
  "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다." as const;
export const SOL_SCORE_DISCLAIMER =
  "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다." as const;

// 03 §5.7 KevAssist. v0.2 필드는 kev-qs/v0.1 run 에서 null 이다.
export type KevAssist = {
  enabled: boolean;
  provider: "mock" | "local" | "hosted" | null;
  model: string | null;
  questionSetVersion: "kev-qs/v0.1" | "kev-qs/v0.2" | null;
  suggestedOption: Recommendation | null;
  probabilities: Record<Recommendation, number> | null;
  confidence: number | null;
  mandatoryRisk: number | null;
  needsHumanReview: number | null;
  fit: { score: number; legend: Record<string, string> } | null;
  scores: null;
  risks: null;
  calibration: null;
  stateTrace: null;
  latencyMs: number | null;
  requestId: string | null;
  disclaimer: typeof KEV_DISCLAIMER;
};

export type AnalysisResult = {
  schemaVersion: "analysis-result/v0.1";
  algorithmVersion: "sol-v0.2.0";
  inputSnapshotHash: string;
  status: AnalysisStatus;
  errorCode: string | null;
  score: number;
  factors: ScoreFactor[];
  qualificationStatus: QualificationOutcome;
  qualificationChecks: QualificationCheck[];
  requirementAssessments: RequirementAssessment[];
  recommendation: Recommendation;
  recommendationBasis: RecommendationBasis;
  reviewFlags: ReviewFlag[];
  missingFactors: MissingFactor[];
  injectionSuspected: boolean;
  kev: KevAssist;
  explanation: string;
  disclaimer: typeof SOL_SCORE_DISCLAIMER;
};
