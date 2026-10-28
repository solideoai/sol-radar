import "server-only";
import {
  analysisInputSchema,
  type AnalysisInput,
  type CompanyProfile,
  type Recommendation,
} from "./analysis-input.model";
import type { FactorKey, QualificationOutcome } from "./analysis-result.model";
import { analyze } from "./analyze";
import {
  QUALIFICATION_CODES,
  isQualificationCode,
  type QualificationCode,
} from "./qualification-codes";

// 가정 재계산(BOOST-2). "이 자격이 있다면?"을 규칙 엔진에 다시 물어 본다. 저장·AI 호출 없이 순수 계산만 한다.
// 결정 모델(kev) 플래그가 섞이지 않도록 before·after 모두 kev=null 로 계산한다. analyze() 는 고치지 않는다.

export type Assumption = { kind: "QUALIFICATION"; code: string };

export type WhatIfSummary = {
  score: number;
  recommendation: Recommendation;
  qualificationStatus: QualificationOutcome;
  factors: { factor: FactorKey; points: number; maxPoints: number }[];
  checks: {
    id: string;
    requirementName: string;
    requirementCode: string | null;
    outcome: QualificationOutcome;
    reasonCode: string | null;
  }[];
};

export type WhatIfOutcome =
  | { ok: true; assumable: string[]; before: WhatIfSummary; after: WhatIfSummary }
  | { ok: false; rejected: Assumption[] };

function summarize(input: AnalysisInput): {
  summary: WhatIfSummary;
  assumable: string[];
} {
  const result = analyze(input);
  const assumable = result.qualificationChecks
    .filter(
      (check) =>
        check.mandatory &&
        check.requirementCode !== null &&
        Object.hasOwn(QUALIFICATION_CODES, check.requirementCode) &&
        (check.outcome === "NOT_SATISFIED" ||
          (check.outcome === "NEEDS_REVIEW" && check.reasonCode === "COMPANY_EVIDENCE_MISSING")),
    )
    .map((check) => check.requirementCode as string);
  return {
    assumable: [...new Set(assumable)],
    summary: {
      score: result.score,
      recommendation: result.recommendation,
      qualificationStatus: result.qualificationStatus,
      factors: result.factors.map(({ factor, points, maxPoints }) => ({
        factor,
        points,
        maxPoints,
      })),
      checks: result.qualificationChecks.map((check) => ({
        id: check.id,
        requirementName: check.requirementName,
        requirementCode: check.requirementCode,
        outcome: check.outcome,
        reasonCode: check.reasonCode,
      })),
    },
  };
}

// 가정한 자격을 회사 프로필에 "보유"로 반영한 사본을 만든다. 원본 프로필은 건드리지 않는다.
export function assumeHeldLicenses(
  profile: CompanyProfile,
  codes: QualificationCode[],
): CompanyProfile {
  const licenses = profile.licenses.map((license) =>
    codes.some((code) => code === license.code)
      ? { code: license.code, name: license.name, status: "HELD" as const }
      : license,
  );
  const added = codes
    .filter((code) => !profile.licenses.some((license) => license.code === code))
    .map((code) => ({
      code,
      name: QUALIFICATION_CODES[code].name,
      status: "HELD" as const,
    }));
  return { ...profile, licenses: [...licenses, ...added] };
}

function applyAssumptions(input: AnalysisInput, codes: QualificationCode[]): AnalysisInput {
  return { ...input, profile: assumeHeldLicenses(input.profile, codes) };
}

// 스냅샷이 스키마에 안 맞으면 null. 가정 가능 여부의 유일한 판정자다.
export function whatIf(rawSnapshot: unknown, assumptions: Assumption[]): WhatIfOutcome | null {
  const parsed = analysisInputSchema.safeParse(structuredClone(rawSnapshot));
  if (!parsed.success) return null;
  const base: AnalysisInput = { ...parsed.data, kev: null };
  const { summary: before, assumable } = summarize(base);

  const rejected = assumptions.filter(
    (assumption) => assumption.kind !== "QUALIFICATION" || !assumable.includes(assumption.code),
  );
  if (rejected.length > 0) return { ok: false, rejected };

  // rejected 가 비었으니 모두 assumable(사전 코드)이다. 타입을 좁히려고 한 번 더 거른다(가정 순서는 그대로).
  const codes = [...new Set(assumptions.map((assumption) => assumption.code))].filter(
    isQualificationCode,
  );
  const after = codes.length === 0 ? before : summarize(applyAssumptions(base, codes)).summary;
  return { ok: true, assumable, before, after };
}
