import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { insightPayloadSchema, type InsightPayload, type InsightRef } from "@/server/insight";
import {
  FACTOR_KEYS,
  analysisInputSchema,
  companySkillSet,
  matchSkill,
  staffAvailabilityInput,
  type AnalysisInput,
  type CompanyProfile,
  type Recommendation,
  type RequirementExtraction,
} from "@/server/scoring";
import { FACTOR_LABEL } from "@/server/shared";
import { toKstDate } from "./analysis.model";
import type {
  InsightGatewayRequest,
  InsightGatewayResponse,
  QualificationStatus,
} from "./gateway.model";

// ── 추천 분석(ADR-066) gateway 요청 조립: 저장된 분석 run → POST /insight 본문과 근거 목록 ──
// 판정(점수·권고·자격)은 run 값을 그대로 옮긴다. 근거 번호는 B = 공고 원문 인용, C = 회사 자료다.
// 순수 함수다. 저장·호출은 worker 의 insight job 이 한다.

/** worker 가 recommendation_insights 행의 run 에서 읽어 오는 값. 요소 rawValue 는 score_factors.raw_value 다. */
export type InsightRunSource = {
  scoreRunId: string;
  orgId: string;
  /** score_runs.input_snapshot. */
  input: AnalysisInput;
  score: number;
  recommendation: Recommendation;
  recommendationBasis: string;
  reviewFlags: string[];
  missingFactors: string[];
  kevEnabled: boolean;
  kevReviewFlags: string[];
  /** 추출·run 에 인젝션 의심이 있다. 공고 원문 인용을 모델에 넘기지 않는다. */
  injectionSuspected: boolean;
  factors: {
    factor: string;
    points: number;
    maxPoints: number;
    reason: string;
    rawValue: unknown;
  }[];
  checks: { label: string; status: QualificationStatus; reason: string }[];
};

// 계획 C3 상한. gateway 도 같은 상한으로 거절한다.
const MAX_FACTORS = 8;
const MAX_CHECKS = 20;
const MAX_TECHNOLOGIES = 10;
const MAX_BID_REFS = 12;
const MAX_PROJECT_REFS = 5;
const MAX_TECHNOLOGY_REFS = 5;
const MAX_LABEL = 80;
const MAX_QUOTE = 300;

type ExtractedKey = Exclude<
  keyof RequirementExtraction,
  "schemaVersion" | "bidId" | "revisionId" | "model" | "injectionSuspected" | "warnings"
>;

// 공고 인용을 고르는 순서. 판단 이유에 자주 쓰이는 자격·기술·실적·인력·규모가 앞이다.
const BID_QUOTE_FIELDS = [
  ["qualifications", "참가 자격"],
  ["requiredSkills", "필수 기술"],
  ["preferredSkills", "우대 기술"],
  ["pastPerformance", "실적 요건"],
  ["staffing", "투입 인력"],
  ["budgetKrw", "사업 예산"],
  ["deadlineAt", "입찰 마감"],
  ["domain", "사업 분야"],
  ["summary", "사업 개요"],
  ["restrictions", "참가 제한"],
  ["contractMethod", "계약 방법"],
  ["submission", "제출 방법"],
  ["projectType", "사업 유형"],
] as const satisfies readonly (readonly [ExtractedKey, string])[];

const FACTOR_NAMES: ReadonlyMap<string, string> = new Map(Object.entries(FACTOR_LABEL));

// 요소 rawValue 에서 근거 고르기에 쓰는 값만 읽는다. 모양이 다르면 그 근거를 빼고 요청은 그대로 만든다.
const pastPerformanceRawSchema = z.object({
  candidates: z.array(z.object({ projectId: z.string(), similarity: z.number() })),
});
const skillMatchRawSchema = z.object({ matchedNames: z.array(z.string()) });

const clip = (text: string, max: number): string => text.slice(0, max);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** "YYYY-MM-DD" 는 그대로, 시각은 KST 날짜로. */
const toDateString = (value: string): string =>
  isoDate.test(value) ? value : toKstDate(new Date(value));
const formatKrw = (amount: string): string => amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function rawValueOf(source: InsightRunSource, factor: string): unknown {
  return source.factors.find((entry) => entry.factor === factor)?.rawValue;
}

/** 추출 KNOWN 필드마다 첫 근거 하나. 같은 인용은 한 번만. */
function bidQuotes(extraction: RequirementExtraction | null): { label: string; quote: string }[] {
  if (extraction === null) return [];
  const quotes: { label: string; quote: string }[] = [];
  for (const [key, label] of BID_QUOTE_FIELDS) {
    const field = extraction[key];
    const quote = field.state === "KNOWN" ? field.evidence[0]?.quotedText : undefined;
    if (quote && !quotes.some((entry) => entry.quote === quote)) quotes.push({ label, quote });
  }
  return quotes.slice(0, MAX_BID_REFS);
}

/** 유사 실적 요소가 비교한 실적. 유사도가 높은 순(같으면 프로필 순)이고 고른 실적이 맨 앞이다. */
function usedProjects(source: InsightRunSource): CompanyProfile["pastProjects"] {
  const raw = pastPerformanceRawSchema.safeParse(rawValueOf(source, "pastPerformance"));
  if (!raw.success) return [];
  const ranked = raw.data.candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((a, b) => b.similarity - a.similarity || a.index - b.index);
  return ranked
    .map((candidate) =>
      source.input.profile.pastProjects.find((project) => project.id === candidate.projectId),
    )
    .filter((project) => project !== undefined)
    .slice(0, MAX_PROJECT_REFS);
}

/** 기술 요소가 맞춘 회사 기술. 공고 요구 기술 순이다(별칭으로 맞춘 기술 포함). */
function matchedTechnologies(source: InsightRunSource): CompanyProfile["technologies"] {
  const raw = skillMatchRawSchema.safeParse(rawValueOf(source, "skillMatch"));
  if (!raw.success) return [];
  const technologies = source.input.profile.technologies;
  const used = raw.data.matchedNames.flatMap((name) =>
    technologies.filter((tech) => matchSkill(name, companySkillSet([tech.name])) !== null),
  );
  return used.filter((tech, index) => used.indexOf(tech) === index);
}

function projectQuote(project: CompanyProfile["pastProjects"][number]): string {
  return [
    project.name,
    project.domain,
    project.completedAt === null ? null : `${project.completedAt} 완료`,
    project.amountKrw === null ? null : `${formatKrw(project.amountKrw)}원`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function technologyQuote(tech: CompanyProfile["technologies"][number]): string {
  return tech.yearsOfExperience === undefined
    ? tech.name
    : `${tech.name} · 경력 ${tech.yearsOfExperience}년`;
}

/** 저장된 run → POST /insight 본문과 근거 목록(B·C). refs 는 결과 payload 에 가리킨 것만 남긴다. */
export function toInsightRequest(
  source: InsightRunSource,
  requestId: string,
): { request: InsightGatewayRequest; refs: InsightRef[] } {
  const { input } = source;
  const staffInput = staffAvailabilityInput(
    input.bid,
    input.extraction,
    input.team,
    input.config.today,
  );
  const staff =
    staffInput === null
      ? null
      : { ...staffInput, from: toDateString(staffInput.from), to: toDateString(staffInput.to) };

  const projects = usedProjects(source);
  const matched = matchedTechnologies(source);
  const companyQuotes = [
    ...projects.map((project) => ({ label: "과거 수행 사업", quote: projectQuote(project) })),
    ...matched
      .slice(0, MAX_TECHNOLOGY_REFS)
      .map((tech) => ({ label: "보유 기술", quote: technologyQuote(tech) })),
    ...(staff === null
      ? []
      : [
          {
            label: "투입 가능 인력",
            quote: `사업 기간 ${staff.from}~${staff.to} 가용 ${staff.availableFte} FTE · 대상 인원 ${staff.eligibleStaff}명`,
          },
        ]),
  ];

  // 인젝션 의심 run 은 공고 인용을 보내지 않는다. 회사 자료(C)는 남긴다(보안 리뷰 중-2).
  const quotes = source.injectionSuspected ? [] : bidQuotes(input.extraction);
  const refs: InsightRef[] = [
    ...quotes.map(({ label, quote }, index) => ({
      id: `B${index + 1}`,
      kind: "BID" as const,
      label: clip(label, MAX_LABEL),
      quotedText: clip(quote, MAX_QUOTE),
    })),
    ...companyQuotes.map(({ label, quote }, index) => ({
      id: `C${index + 1}`,
      kind: "COMPANY" as const,
      label: clip(label, MAX_LABEL),
      quotedText: clip(quote, MAX_QUOTE),
    })),
  ];

  const technologyNames = [...matched, ...input.profile.technologies].map((tech) => tech.name);
  const request: InsightGatewayRequest = {
    requestId,
    bid: {
      title: input.bid.title,
      agency: input.bid.agency,
      budgetKrw: input.bid.budgetKrw,
      deadline: input.bid.deadlineAt === null ? null : toDateString(input.bid.deadlineAt),
    },
    rules: {
      score: source.score,
      recommendation: source.recommendation,
      recommendationBasis: source.recommendationBasis,
      factors: source.factors.slice(0, MAX_FACTORS).map((factor) => ({
        factor: factor.factor,
        label: clip(FACTOR_NAMES.get(factor.factor) ?? factor.factor, MAX_LABEL),
        points: factor.points,
        maxPoints: factor.maxPoints,
        reason: factor.reason,
      })),
      qualificationChecks: source.checks.slice(0, MAX_CHECKS).map((check) => ({
        ...check,
        label: clip(check.label, MAX_LABEL),
      })),
      reviewFlags: source.reviewFlags,
      // 요소 키 대신 화면 이름을 보낸다. 모델 문장에 영문 키가 섞이지 않게 한다.
      missingFactors: source.missingFactors.map((factor) => FACTOR_NAMES.get(factor) ?? factor),
    },
    bosun: source.kevEnabled ? { reviewFlags: source.kevReviewFlags } : null,
    company: {
      name: input.profile.name ?? null,
      technologies: technologyNames
        .filter((name, index) => technologyNames.indexOf(name) === index)
        .slice(0, MAX_TECHNOLOGIES),
      staff,
    },
    refs,
    injectionSuspected: source.injectionSuspected,
  };
  return { request, refs };
}

/**
 * gateway 응답과 보낸 요청 → recommendation_insights.payload. 항목이 가리킨 근거만 남긴다.
 * v0.2 새 칸(요소 해설·자격 해설·확인할 것)은 응답에 키가 있을 때만 옮긴다. 옛 gateway 응답이면 키를 넣지 않는다.
 * staffing(인력 가용)은 모델 문장이 아니라 요청 company.staff 와 같은 규칙 값이다(ADR-078).
 * 요청에 없던 근거 번호·상한 위반은 insightPayloadSchema 가 던진다(worker 는 GATEWAY_INVALID 로 닫는다).
 */
export function toInsightPayload(
  response: InsightGatewayResponse,
  request: InsightGatewayRequest,
): InsightPayload {
  const { factorNotes, checkNotes, nextSteps } = response;
  const cited = new Set(
    [
      ...response.strengths,
      ...response.improvements,
      ...(factorNotes ?? []),
      ...(checkNotes ?? []),
      ...(nextSteps ?? []),
    ].flatMap((item) => item.refIds),
  );
  return insightPayloadSchema.parse({
    summary: response.summary,
    strengths: response.strengths,
    improvements: response.improvements,
    ...(factorNotes === undefined ? {} : { factorNotes }),
    ...(checkNotes === undefined ? {} : { checkNotes }),
    ...(nextSteps === undefined ? {} : { nextSteps }),
    staffing: request.company.staff,
    refs: request.refs.filter((ref) => cited.has(ref.id)),
  });
}

// ── 저장된 run 행 → InsightRunSource. 저장 port(insight-store)가 읽은 행을 넘긴다 ──

type Tables = Database["public"]["Tables"];
export type InsightRunRows = {
  run: Pick<
    Tables["score_runs"]["Row"],
    | "id"
    | "org_id"
    | "status"
    | "input_snapshot"
    | "score"
    | "recommendation"
    | "recommendation_basis"
    | "review_flags"
    | "missing_factors"
    | "kev_assist"
    | "injection_suspected"
  >;
  factors: Pick<
    Tables["score_factors"]["Row"],
    "factor" | "points" | "max_points" | "note" | "raw_value"
  >[];
  checks: Pick<Tables["qualification_checks"]["Row"], "requirement_name" | "outcome" | "reason">[];
};

// 끝난 run 만 설명한다. 점수·권고가 비어 있으면 읽지 못한 것으로 본다.
const finishedRunSchema = z.object({
  status: z.enum(["COMPLETED", "PARTIAL"]),
  score: z.number(),
  recommendation: z.enum(["BID", "WATCH", "NO_BID"]),
  recommendation_basis: z.string().min(1),
  kev_assist: z.looseObject({ enabled: z.boolean() }).nullable(),
});
const checkStatusSchema = z.enum(["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW", "NOT_APPLICABLE"]);

/** 규칙 엔진이 추출의 인젝션 의심에 붙이는 플래그(scoring/analyze.ts). */
const INJECTION_FLAG = "INJECTION_SUSPECTED";

/** Bosun(결정 모델)이 낸 검토 플래그. 규칙 엔진 플래그와 함께 run 의 review_flags 에 저장된다. */
const isBosunFlag = (flag: string): boolean =>
  flag.startsWith("KEV_") || flag === "MODEL_RULE_DISAGREEMENT";

/**
 * score_runs·score_factors·qualification_checks 행 → InsightRunSource. 요소는 점수표 순이다.
 * 끝나지 않은 run·input_snapshot 이 입력 계약과 다름·모르는 판정 값이면 null(worker 는 SOURCE_INVALID 로 닫는다).
 */
export function toInsightRunSource(rows: InsightRunRows): InsightRunSource | null {
  const run = finishedRunSchema.safeParse(rows.run);
  const input = analysisInputSchema.safeParse(rows.run.input_snapshot);
  if (!run.success || !input.success) return null;
  const statuses = rows.checks.map((check) => checkStatusSchema.safeParse(check.outcome));
  const checks = rows.checks.flatMap((check, index) => {
    const status = statuses[index];
    return status.success
      ? [{ label: check.requirement_name, status: status.data, reason: check.reason }]
      : [];
  });
  if (checks.length !== rows.checks.length) return null;
  const order = (factor: string) => FACTOR_KEYS.findIndex((key) => key === factor);
  return {
    scoreRunId: rows.run.id,
    orgId: rows.run.org_id,
    input: input.data,
    score: run.data.score,
    recommendation: run.data.recommendation,
    recommendationBasis: run.data.recommendation_basis,
    reviewFlags: rows.run.review_flags,
    missingFactors: rows.run.missing_factors,
    kevEnabled: run.data.kev_assist?.enabled === true,
    kevReviewFlags: rows.run.review_flags.filter(isBosunFlag),
    // 플래그·열·스냅샷 추출 가운데 하나라도 의심이면 의심으로 본다.
    injectionSuspected:
      rows.run.review_flags.includes(INJECTION_FLAG) ||
      rows.run.injection_suspected ||
      input.data.extraction?.injectionSuspected === true,
    factors: rows.factors
      .toSorted((a, b) => order(a.factor) - order(b.factor))
      .map((factor) => ({
        factor: factor.factor,
        points: factor.points,
        maxPoints: factor.max_points,
        reason: factor.note ?? "",
        rawValue: factor.raw_value,
      })),
    checks,
  };
}
