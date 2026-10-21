import "server-only";
import type { Recommendation } from "./analysis-input.model";
import type {
  AnalysisStatus,
  MissingFactor,
  QualificationCheck,
  QualificationOutcome,
  ReviewFlag,
  ScoreFactor,
} from "./analysis-result.model";
import type { RulePath } from "./decision";

// 템플릿 설명 문장(05 AnalysisResult.explanation 의 "Qwen 불가 시 템플릿 문장"). 입력에 있는 숫자만 쓴다.
// 수주 확률·충족 확률·낙찰 확률을 뜻하는 표현을 만들지 않는다(09 책임 있는 AI, G4).

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  BID: "BID(참여 권고)",
  WATCH: "WATCH(사람 검토)",
  NO_BID: "NO-BID(참여 비권고)",
};

const MISSING_LABEL: Record<MissingFactor["reason"], string> = {
  NO_REQUIREMENTS_EXTRACTED: "공고 요구기술 미확인",
  PROFILE_TECHNOLOGIES_EMPTY: "회사 기술 목록 없음",
  BID_DOMAIN_UNKNOWN: "공고 분야 미확인",
  PROFILE_PROJECTS_EMPTY: "회사 실적 없음",
  REQUIRED_FTE_UNKNOWN: "필요 인력·예산 미확인",
  TEAM_EMPTY: "인력 정보 없음",
  BUDGET_UNKNOWN: "예산 미기재",
  PREFERENCES_NOT_SET: "조직 선호 미설정",
};

function qualificationSentence(status: QualificationOutcome, checks: QualificationCheck[]): string {
  const mandatory = checks.filter((check) => check.mandatory);
  if (status === "NOT_SATISFIED") {
    const names = mandatory
      .filter((check) => check.outcome === "NOT_SATISFIED")
      .map((check) => check.requirementName)
      .join(", ");
    return `필수자격 미충족: ${names}. 공고 근거와 회사 프로필의 미보유 기록이 모두 있어 규칙 판정이 우선합니다.`;
  }
  if (status === "NEEDS_REVIEW") {
    const reasons = [
      ...new Set(
        mandatory
          .filter((check) => check.outcome === "NEEDS_REVIEW")
          .map((check) => check.reasonCode ?? "")
          .filter((code) => code !== ""),
      ),
    ].join(", ");
    return `필수자격 확인 필요(${reasons}). 정보 부족은 미충족이 아니며 사람이 확인합니다.`;
  }
  return mandatory.length === 0
    ? "공고에 필수자격 항목이 없습니다."
    : `필수자격 ${mandatory.length}건을 모두 충족했습니다.`;
}

function skillSentence(factors: ScoreFactor[]): string | null {
  const skill = factors.find((factor) => factor.factor === "skillMatch");
  if (!skill || skill.missing) return null;
  const raw = skill.rawValue as {
    required?: number;
    matchedNames?: string[];
    missingNames?: string[];
  };
  if (!raw.required) return null;
  const matched = raw.matchedNames ?? [];
  const missing = raw.missingNames ?? [];
  return `요구기술 ${raw.required}개 중 ${matched.length}개 보유${matched.length > 0 ? `(${matched.join(", ")})` : ""}${missing.length > 0 ? `. ${missing.join("·")} 경험 없음` : ""}.`;
}

function staffSentence(factors: ScoreFactor[]): string | null {
  const staff = factors.find((factor) => factor.factor === "staffAvailability");
  if (!staff || staff.missing) return null;
  const raw = staff.rawValue as { businessDays?: number | null; scheduleFactor?: number };
  if (
    raw.scheduleFactor !== undefined &&
    raw.scheduleFactor < 1 &&
    typeof raw.businessDays === "number"
  )
    return `제안 준비 기간 ${raw.businessDays}영업일로 촉박해 인력 가용 계수를 ${raw.scheduleFactor}로 낮췄습니다.`;
  return null;
}

function decisionSentence(
  score: number,
  recommendation: Recommendation,
  rulePath: RulePath,
): string {
  const label = RECOMMENDATION_LABEL[recommendation];
  switch (rulePath) {
    case "MANDATORY_NOT_SATISFIED":
      return `점수 ${score}점은 참고용으로만 표시하며 권고는 ${label}입니다.`;
    case "QUALIFICATION_NEEDS_REVIEW":
      return `자격 확인이 끝나기 전에는 점수 ${score}점과 무관하게 ${label}입니다.`;
    case "MISSING_FACTORS":
      return `비어 있는 요소가 2개 이상이라 점수 ${score}점과 무관하게 ${label}입니다.`;
    case "SCORE_BID":
      return `SOL Score ${score}점으로 참여 권고 구간(75 이상)입니다. 권고: ${label}.`;
    case "SCORE_WATCH":
      return `SOL Score ${score}점으로 사람 검토 구간(50~75)입니다. 권고: ${label}.`;
    case "SCORE_NO_BID":
      return `SOL Score ${score}점으로 참여 비권고 구간(50 미만)입니다. 권고: ${label}.`;
  }
}

export function buildExplanation(args: {
  status: AnalysisStatus;
  score: number;
  recommendation: Recommendation;
  rulePath: RulePath;
  qualificationStatus: QualificationOutcome;
  checks: QualificationCheck[];
  factors: ScoreFactor[];
  missingFactors: MissingFactor[];
  reviewFlags: ReviewFlag[];
  kevSuggestedOption: Recommendation | null;
}): string {
  const sentences: (string | null)[] = [
    args.status === "PARTIAL" ? "AI 서비스를 사용할 수 없어 규칙 기반 결과만 제공합니다." : null,
    args.reviewFlags.includes("PARSE_UNSUPPORTED")
      ? "첨부 문서를 읽지 못해 첨부에만 있는 요구사항은 반영되지 않았습니다."
      : null,
    qualificationSentence(args.qualificationStatus, args.checks),
    skillSentence(args.factors),
    staffSentence(args.factors),
    args.reviewFlags.includes("SCALE_LIMIT_EXCEEDED")
      ? "사업 예산이 단일 사업 수행 상한을 넘어 규모 적합 요소는 0점입니다."
      : null,
    args.missingFactors.length > 0
      ? `미확인 요소: ${args.missingFactors.map((entry) => MISSING_LABEL[entry.reason]).join(", ")}.`
      : null,
    decisionSentence(args.score, args.recommendation, args.rulePath),
    args.reviewFlags.includes("MODEL_RULE_DISAGREEMENT") && args.kevSuggestedOption !== null
      ? `결정 모델은 ${args.kevSuggestedOption}를 제시했지만 규칙 판정이 우선합니다. 결정 모델 분포는 모델 참고 지표이며 점수에 반영하지 않습니다.`
      : null,
    args.reviewFlags.includes("KEV_NEEDS_REVIEW") || args.reviewFlags.includes("KEV_MANDATORY_RISK")
      ? "모델 참고 지표가 사람 검토를 권장합니다."
      : null,
    "최종 참여 결정은 사람이 합니다.",
  ];
  return sentences.filter((sentence): sentence is string => sentence !== null).join(" ");
}
