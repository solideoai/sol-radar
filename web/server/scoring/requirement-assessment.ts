import "server-only";
import type {
  CompanyEvidenceRef,
  CompanyProfile,
  RequirementExtraction,
} from "./analysis-input.model";
import type { RequirementAssessment } from "./analysis-result.model";
import { companySkillSet, matchSkill } from "./skill-aliases";

// 요구사항 항목별 규칙 판정(08 §5.1 "규칙 담당과 Kev 담당", 04 requirement_assessments). v0.1 은 기술 항목(requiredSkills[i])만 낸다.
// 별칭표로 맞으면 SATISFIED, technologiesComplete=true 인 목록에 없으면 NOT_SATISFIED(명시적 부정), complete=false 면 NEEDS_REVIEW(COMPANY_EVIDENCE_MISSING).
// 이 판정은 화면 근거·평가용이고 점수(skillMatch)와 권고 경로를 바꾸지 않는다. Kev 분포(kev)는 파이프라인이 v0.2 에서 붙인다.

export function assessSkillRequirements(
  extraction: RequirementExtraction | null,
  profile: CompanyProfile,
): RequirementAssessment[] {
  const field = extraction?.requiredSkills;
  if (!field || field.state !== "KNOWN" || field.value === null) return [];
  const company = companySkillSet(profile.technologies.map((technology) => technology.name));
  return field.value.map((skill, index) => {
    const itemId = `requiredSkills[${index}]`;
    const base = {
      itemId,
      itemKind: "SKILL" as const,
      basis: "EXTRACTION" as const,
      noticeEvidence: field.evidence,
      kev: null,
      flags: [],
    };
    if (field.evidence.length === 0)
      return {
        ...base,
        ruleStatus: "NEEDS_REVIEW",
        ruleReason: "NOTICE_INFO_MISSING",
        companyEvidence: [],
      };
    const match = matchSkill(skill, company);
    if (match !== null) {
      const recordIndex = profile.technologies.findIndex((technology) =>
        companySkillSet([technology.name]).has(match.canonical),
      );
      const companyEvidence: CompanyEvidenceRef[] = [
        {
          profileRevision: profile.revision,
          kind: "TECHNOLOGY",
          recordKey: `technologies[${recordIndex}]`,
          documentId: null,
          quotedText: profile.technologies[recordIndex]?.name ?? match.canonical,
        },
      ];
      return { ...base, ruleStatus: "SATISFIED", ruleReason: null, companyEvidence };
    }
    if (profile.technologiesComplete)
      return {
        ...base,
        ruleStatus: "NOT_SATISFIED",
        ruleReason: null,
        companyEvidence: [
          {
            profileRevision: profile.revision,
            kind: "TECHNOLOGY",
            recordKey: "technologiesComplete",
            documentId: null,
            quotedText: `technologiesComplete=true 목록(${profile.technologies.length}개)에 ${skill} 없음`,
          },
        ],
      };
    return {
      ...base,
      ruleStatus: "NEEDS_REVIEW",
      ruleReason: "COMPANY_EVIDENCE_MISSING",
      companyEvidence: [],
    };
  });
}
