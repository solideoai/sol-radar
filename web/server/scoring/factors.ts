import "server-only";
import type {
  CompanyProfile,
  EvidenceRef,
  NormalizedBidSummary,
  RequirementExtraction,
  ScoringTeamInput,
} from "./analysis-input.model";
import {
  MAX_POINTS,
  type FactorKey,
  type MissingFactor,
  type MissingReason,
  type ReviewFlag,
  type ScoreFactor,
} from "./analysis-result.model";
import {
  businessDaysBetween,
  defaultProjectPeriod,
  kstDate,
  parseDate,
  yearsBetween,
} from "./calendar";
import { agencyType, canonicalDomain, classifyDomain, type Domain } from "./domain-keywords";
import { availableFte } from "./scoring.model";
import { companySkillSet, matchSkill, type SkillMatch } from "./skill-aliases";

// 08 §3 정규화 함수 5개를 1:1 로 옮긴 것. 모두 0.0~1.0 을 돌려주고, 입력이 없으면 §4 missing 정책(중립 0.5 또는 보수 0.0)을 따른다.
// 데이터가 없을 때 점수를 올리는 쪽으로 메우지 않는다.

export type FactorOutcome = ScoreFactor & { reviewFlags: ReviewFlag[] };

// 08 §3.3 예산 구간 → 필요 FTE (v0.1 가정). [예산 상한(KRW), FTE]
export const FTE_BY_BUDGET: ReadonlyArray<readonly [number, number]> = [
  [5e8, 3],
  [2e9, 8],
  [5e9, 20],
  [Infinity, 40],
];
export const SCHEDULE = (bizDays: number): number =>
  bizDays >= 10 ? 1.0 : bizDays >= 5 ? 0.7 : 0.4;

export const round1 = (value: number): number => Math.round(value * 10) / 10;
export const round3 = (value: number): number => Math.round(value * 1000) / 1000;
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// factor.points = clamp(round(maxPoints * normalized, 1), 0, maxPoints) — 08 §2. normalized 는 반올림 전 값으로 곱한다.
function build(
  factor: FactorKey,
  normalized: number,
  rawValue: Record<string, unknown>,
  options: {
    missing?: MissingReason;
    evidence?: EvidenceRef[];
    note?: string | null;
    reviewFlags?: ReviewFlag[];
  } = {},
): FactorOutcome {
  const maxPoints = MAX_POINTS[factor];
  return {
    factor,
    rawValue,
    normalized: round3(normalized),
    points: clamp(round1(maxPoints * normalized), 0, maxPoints),
    maxPoints,
    missing: options.missing !== undefined,
    missingReason: options.missing ?? null,
    evidence: options.evidence ?? [],
    note: options.note ?? null,
    reviewFlags: options.reviewFlags ?? [],
  };
}

const krw = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** 파생값 bid.domain(08 §1): 추출 domain 이 KNOWN 이면 그 값, 아니면 제목 + 요약을 키워드 표로 분류. 못 맞추면 null(UNKNOWN). */
export function deriveDomain(
  bid: NormalizedBidSummary,
  extraction: RequirementExtraction | null,
): {
  domain: Domain | null;
  source: "EXTRACTION" | "KEYWORDS" | "UNKNOWN";
  evidence: EvidenceRef[];
} {
  const field = extraction?.domain;
  if (field && field.state === "KNOWN" && field.value !== null) {
    const domain = canonicalDomain(field.value);
    if (domain !== null) return { domain, source: "EXTRACTION", evidence: field.evidence };
  }
  const summary =
    extraction?.summary.state === "KNOWN" && extraction.summary.value !== null
      ? extraction.summary.value
      : "";
  const domain = classifyDomain(`${bid.title} ${summary}`);
  return domain === null
    ? { domain: null, source: "UNKNOWN", evidence: [] }
    : { domain, source: "KEYWORDS", evidence: [] };
}

/** 파생값 requiredFte(08 §1): staffing KNOWN 이면 Σ minCount(없는 항목은 1), 아니면 예산 구간 표. 둘 다 없으면 null. */
export function deriveRequiredFte(
  extraction: RequirementExtraction | null,
  budgetKrw: number | null,
): { requiredFte: number; source: "STAFFING" | "BUDGET_TIER" } | null {
  const staffing = extraction?.staffing;
  if (
    staffing &&
    staffing.state === "KNOWN" &&
    staffing.value !== null &&
    staffing.value.length > 0
  ) {
    const total = staffing.value.reduce((sum, item) => sum + (item.minCount ?? 1), 0);
    if (total > 0) return { requiredFte: total, source: "STAFFING" };
  }
  if (budgetKrw === null) return null;
  const tier = FTE_BY_BUDGET.find(([limit]) => budgetKrw <= limit);
  return tier ? { requiredFte: tier[1], source: "BUDGET_TIER" } : null;
}

const knownList = (field: { state: string; value: string[] | null } | undefined): string[] =>
  field && field.state === "KNOWN" && field.value !== null ? field.value : [];

/** 08 §3.1 기술 스택 적합. */
export function skillMatch(
  extraction: RequirementExtraction | null,
  profile: CompanyProfile,
): FactorOutcome {
  const required = knownList(extraction?.requiredSkills);
  const preferred = knownList(extraction?.preferredSkills);
  const evidence = [
    ...(extraction?.requiredSkills.state === "KNOWN" ? extraction.requiredSkills.evidence : []),
    ...(extraction?.preferredSkills.state === "KNOWN" ? extraction.preferredSkills.evidence : []),
  ];
  if (required.length === 0 && preferred.length === 0)
    return build(
      "skillMatch",
      0.5,
      { required: 0, preferred: 0 },
      { missing: "NO_REQUIREMENTS_EXTRACTED" },
    );
  const company = companySkillSet(profile.technologies.map((technology) => technology.name));
  if (company.size === 0)
    return build(
      "skillMatch",
      0.0,
      { required: required.length, preferred: preferred.length, companyTechnologies: 0 },
      { missing: "PROFILE_TECHNOLOGIES_EMPTY", evidence },
    );
  const matches = (names: string[]) =>
    names.map((name) => ({ requested: name, match: matchSkill(name, company) }));
  const requiredMatches = matches(required);
  const preferredMatches = matches(preferred);
  const rate = (list: typeof requiredMatches) =>
    list.length === 0 ? null : list.filter((entry) => entry.match !== null).length / list.length;
  const requiredRate = rate(requiredMatches);
  const preferredRate = rate(preferredMatches);
  const normalized =
    requiredRate === null
      ? (preferredRate as number)
      : preferredRate === null
        ? requiredRate
        : 0.8 * requiredRate + 0.2 * preferredRate;
  const names = (list: typeof requiredMatches, matched: boolean) =>
    list.filter((entry) => (entry.match !== null) === matched).map((entry) => entry.requested);
  const aliasMatched: SkillMatch[] = [...requiredMatches, ...preferredMatches]
    .map((entry) => entry.match)
    .filter((match): match is SkillMatch => match !== null && match.matchedVia === "alias");
  return build(
    "skillMatch",
    normalized,
    {
      required: required.length,
      matched: names(requiredMatches, true).length,
      matchedNames: names(requiredMatches, true),
      missingNames: names(requiredMatches, false),
      requiredRate,
      preferred: preferred.length,
      preferredMatched: names(preferredMatches, true).length,
      preferredMatchedNames: names(preferredMatches, true),
      preferredRate,
      aliasMatched,
    },
    { evidence },
  );
}

/** 08 §3.2 유사 수행 실적: 분야·금액·최근성이 가장 비슷한 실적 1건의 유사도. */
export function pastPerformance(
  bidDomain: Domain | null,
  bidBudgetKrw: number | null,
  profile: CompanyProfile,
  today: string,
  evidence: EvidenceRef[],
): FactorOutcome {
  if (profile.pastProjects.length === 0)
    return build("pastPerformance", 0.0, { projects: 0 }, { missing: "PROFILE_PROJECTS_EMPTY" });
  if (bidDomain === null)
    return build(
      "pastPerformance",
      0.5,
      { projects: profile.pastProjects.length, bidDomain: null },
      { missing: "BID_DOMAIN_UNKNOWN" },
    );
  const todayDate = parseDate(today);
  const candidates = profile.pastProjects.map((project) => {
    const amountKrw = Number(project.amountKrw);
    const domainMatch = canonicalDomain(project.domain) === bidDomain ? 1 : 0;
    const amountRatio =
      bidBudgetKrw !== null && bidBudgetKrw > 0 && amountKrw > 0
        ? Math.min(amountKrw, bidBudgetKrw) / Math.max(amountKrw, bidBudgetKrw)
        : 0.5;
    const years = yearsBetween(parseDate(project.completedAt), todayDate);
    const recency = years <= 3 ? 1.0 : years <= 5 ? 0.6 : 0.2;
    const evidenceFactor = project.evidenceRef ? 1.0 : 0.5;
    return {
      projectId: project.id,
      domain: project.domain,
      domainMatch,
      amountRatio: round3(amountRatio),
      years: round3(years),
      recency,
      evidenceFactor,
      similarity: (0.4 * domainMatch + 0.3 * amountRatio + 0.3 * recency) * evidenceFactor,
    };
  });
  const best = candidates.reduce((top, entry) => (entry.similarity > top.similarity ? entry : top));
  return build(
    "pastPerformance",
    best.similarity,
    {
      bidDomain,
      bidBudgetKrw,
      selectedProjectId: best.projectId,
      candidates: candidates.map((entry) => ({ ...entry, similarity: round3(entry.similarity) })),
    },
    { evidence },
  );
}

/** 08 §3.3 인력 가용성: 필요 FTE 대비 가용 FTE × 제안 준비 일정 계수. */
export function staffAvailability(
  bid: NormalizedBidSummary,
  extraction: RequirementExtraction | null,
  team: ScoringTeamInput,
  today: string,
): FactorOutcome {
  const evidence = extraction?.staffing.state === "KNOWN" ? extraction.staffing.evidence : [];
  const required = deriveRequiredFte(extraction, krw(bid.budgetKrw));
  if (required === null)
    return build(
      "staffAvailability",
      0.5,
      { requiredFte: null },
      { missing: "REQUIRED_FTE_UNKNOWN" },
    );
  if (team.members.length === 0)
    return build(
      "staffAvailability",
      0.5,
      { requiredFte: required.requiredFte, requiredFteSource: required.source, teamMembers: 0 },
      { missing: "TEAM_EMPTY", evidence },
    );
  const todayDate = parseDate(today);
  const period =
    bid.projectPeriod ?? defaultProjectPeriod(bid.deadlineAt ? kstDate(bid.deadlineAt) : todayDate);
  const available = availableFte(team, period);
  const availableRatio = Math.min(1, available / required.requiredFte);
  const businessDays = bid.deadlineAt
    ? businessDaysBetween(todayDate, kstDate(bid.deadlineAt))
    : null;
  const scheduleFactor = businessDays === null ? 1.0 : SCHEDULE(businessDays);
  const notes = [
    required.source === "BUDGET_TIER" ? "필요 인력 미추출: 예산 구간으로 추정" : null,
    scheduleFactor < 1 ? `마감 촉박 일정 계수 ${scheduleFactor}` : null,
  ].filter((note): note is string => note !== null);
  return build(
    "staffAvailability",
    availableRatio * scheduleFactor,
    {
      requiredFte: required.requiredFte,
      requiredFteSource: required.source,
      ...(required.source === "BUDGET_TIER" ? { estimatedFrom: "budgetTier" } : {}),
      period,
      periodSource: bid.projectPeriod ? "BID" : "DEFAULT",
      availableFte: available,
      teamMembers: team.members.length,
      availableRatio: round3(availableRatio),
      businessDays,
      scheduleFactor,
    },
    { evidence, note: notes.length > 0 ? notes.join(". ") : null },
  );
}

/** 08 §3.4 규모 적합성: 최대 수행 실적 대비 예산 비율, 내부 수행 상한. */
export function scaleFit(
  bid: NormalizedBidSummary,
  extraction: RequirementExtraction | null,
  profile: CompanyProfile,
): FactorOutcome {
  const budget = krw(bid.budgetKrw);
  const evidence = extraction?.budgetKrw.state === "KNOWN" ? extraction.budgetKrw.evidence : [];
  if (budget === null)
    return build("scaleFit", 0.5, { budgetKrw: null }, { missing: "BUDGET_UNKNOWN" });
  const cap = krw(profile.financials?.maxContractKrw);
  const largestPast = Math.max(
    0,
    ...profile.pastProjects.map((project) => Number(project.amountKrw)),
  );
  const rawValue = {
    budgetKrw: bid.budgetKrw,
    maxContractKrw: profile.financials?.maxContractKrw ?? null,
    largestPastKrw: largestPast > 0 ? String(largestPast) : null,
  };
  if (cap !== null && budget > cap)
    return build(
      "scaleFit",
      0.0,
      { ...rawValue, limitExceeded: true },
      {
        evidence,
        note: "단일 사업 수행 상한 초과",
        reviewFlags: ["SCALE_LIMIT_EXCEEDED"],
      },
    );
  if (largestPast === 0)
    return build(
      "scaleFit",
      0.5,
      { ...rawValue, limitExceeded: false },
      { missing: "PROFILE_PROJECTS_EMPTY", evidence },
    );
  const ratio = budget / largestPast;
  return build(
    "scaleFit",
    ratio <= 1.5 ? 1.0 : ratio <= 3 ? 0.6 : 0.2,
    { ...rawValue, limitExceeded: false, ratio: round3(ratio) },
    { evidence },
  );
}

/** 08 §3.5 전략적 선호: 사업 분야·발주기관 선호 설정. */
export function strategicPreference(
  bid: NormalizedBidSummary,
  bidDomain: Domain | null,
  profile: CompanyProfile,
): FactorOutcome {
  const prefs = profile.preferences;
  if (!prefs)
    return build(
      "strategicPreference",
      0.5,
      { preferences: null },
      { missing: "PREFERENCES_NOT_SET" },
    );
  const agency = bid.agency ?? "";
  const type = agencyType(bid.agency);
  const text = `${bid.title} ${agency}`;
  const excludedKeywordHit =
    prefs.excludedKeywords.find((keyword) => keyword !== "" && text.includes(keyword)) ?? null;
  const excludedDomainHit = bidDomain !== null && prefs.excludedDomains.includes(bidDomain);
  const base = {
    domain: bidDomain,
    agency: bid.agency,
    agencyType: type,
    excludedDomainHit,
    excludedKeywordHit,
  };
  if (excludedDomainHit)
    return build("strategicPreference", 0.0, base, { note: `제외 분야(${bidDomain})` });
  if (excludedKeywordHit !== null)
    return build("strategicPreference", 0.0, base, { note: `제외 키워드(${excludedKeywordHit})` });
  const domainLevel = bidDomain === null ? 0.5 : prefs.domains.includes(bidDomain) ? 1.0 : 0.5;
  const agencyMatch = prefs.agencies.includes(agency);
  const agencyTypeMatch = prefs.agencyTypes.includes(type);
  const agencyLevel = agencyMatch || agencyTypeMatch ? 1.0 : 0.5;
  return build(
    "strategicPreference",
    0.6 * domainLevel + 0.4 * agencyLevel,
    {
      ...base,
      domainMatch: domainLevel === 1.0,
      domainLevel,
      agencyMatch,
      agencyTypeMatch,
      agencyLevel,
    },
    {
      note:
        domainLevel === 1.0 && agencyLevel === 1.0
          ? `${bidDomain} 분야·${agencyMatch ? agency : type} 선호 일치`
          : null,
    },
  );
}

export function collectMissingFactors(factors: readonly FactorOutcome[]): MissingFactor[] {
  return factors
    .filter((factor) => factor.missingReason !== null)
    .map((factor) => ({ factor: factor.factor, reason: factor.missingReason as MissingReason }));
}

// solScore = clamp(round(sum(points)), 0, 100) — 08 §2.
export function solScore(factors: readonly FactorOutcome[]): number {
  return clamp(Math.round(factors.reduce((sum, factor) => sum + factor.points, 0)), 0, 100);
}
