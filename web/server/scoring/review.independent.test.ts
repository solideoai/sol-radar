import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SCORING_CONFIG_V0_1,
  analysisInputSchema,
  companyEvidenceRefSchema,
  evidenceRefSchema,
  type AnalysisInput,
  type KevMockResponse,
  type Recommendation,
  type ScoringTeamInput,
} from "./analysis-input.model";
import {
  FACTOR_KEYS,
  KEV_DISCLAIMER,
  MAX_POINTS,
  SOL_SCORE_DISCLAIMER,
  type AnalysisResult,
  type FactorKey,
} from "./analysis-result.model";
import { analyze } from "./analyze";
import { decideRecommendation, mergeKev } from "./decision";
import { clamp, round1, solScore, type FactorOutcome } from "./factors";
import { canonicalJson, snapshotHash } from "./snapshot-hash";
import { buildInput, loadBid, loadExtraction, withPatch } from "./test-support";

// 독립 검증(test-server). 구현 보고를 믿지 않고 정본(08 §3~§6, 11 §3 G4·V2-05·V2-06, 04 §4 review_flag, 17 절대 규칙)에서
// 출발해 기존 시험이 빠뜨린 자리를 본다. 기존 시험 파일은 고치지 않는다.
// 골든 수치는 FX-01·02·03 만 확정이라(08 §8) 나머지 fixture 는 규칙에서 바로 따라오는 것(자격 사유·플래그·missing 행·권고 경로)만 단언한다.

const thresholds = SCORING_CONFIG_V0_1.thresholds;

// 04 §4 review_flag 값 집합 17개. 규칙 엔진이 내는 플래그는 이 안에만 있어야 한다.
const REVIEW_FLAGS = [
  "MODEL_RULE_DISAGREEMENT",
  "KEV_MANDATORY_RISK",
  "KEV_NEEDS_REVIEW",
  "KEV_REQUIREMENT_DISAGREEMENT",
  "KEV_DELIVERY_RISK",
  "CITATION_FAILED",
  "EXTRACTION_FAILED",
  "EXTRACTION_LOW_CONFIDENCE",
  "AI_UNAVAILABLE",
  "QWEN_UNAVAILABLE",
  "KEV_UNAVAILABLE",
  "MOCK_FALLBACK",
  "PARSE_UNSUPPORTED",
  "DOCUMENT_DOWNLOAD_FAILED",
  "INSUFFICIENT_DATA",
  "INJECTION_SUSPECTED",
  "SCALE_LIMIT_EXCEEDED",
] as const;

// ── 결과 계약(zod). 05 §4.5 AnalysisResult 가운데 규칙 엔진이 내는 부분 + 04 의 값 집합. 저장 식별자·시각은 파이프라인 몫이라 없다.
const unit = z.number().min(0).max(1);
const recommendationSchema = z.enum(["BID", "WATCH", "NO_BID"]);
const outcomeSchema = z.enum(["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"]);
const reasonSchema = z.enum([
  "NOTICE_INFO_MISSING",
  "NOTICE_CONFLICTED",
  "COMPANY_EVIDENCE_MISSING",
  "AMBIGUOUS_MATCH",
  "PARSE_UNSUPPORTED",
  "STAGE_NOT_APPLICABLE",
]);
const missingReasonSchema = z.enum([
  "NO_REQUIREMENTS_EXTRACTED",
  "PROFILE_TECHNOLOGIES_EMPTY",
  "BID_DOMAIN_UNKNOWN",
  "PROFILE_PROJECTS_EMPTY",
  "REQUIRED_FTE_UNKNOWN",
  "TEAM_EMPTY",
  "BUDGET_UNKNOWN",
  "PREFERENCES_NOT_SET",
]);
const reviewFlagSchema = z.enum(REVIEW_FLAGS);
const basisSchema = z.enum(["API_FIELD", "EXTRACTION"]);

const scoreFactorSchema = z
  .strictObject({
    factor: z.enum(FACTOR_KEYS),
    rawValue: z.record(z.string(), z.unknown()),
    normalized: unit,
    points: z.number().min(0),
    maxPoints: z.number().positive(),
    missing: z.boolean(),
    missingReason: missingReasonSchema.nullable(),
    evidence: z.array(evidenceRefSchema),
    note: z.string().nullable(),
  })
  .refine((factor) => factor.maxPoints === MAX_POINTS[factor.factor], "maxPoints 는 08 §2 점수표")
  .refine((factor) => factor.points <= factor.maxPoints, "points ≤ maxPoints")
  .refine(
    (factor) => factor.missing === (factor.missingReason !== null),
    "missing ⇔ missingReason",
  );

const qualificationCheckSchema = z
  .strictObject({
    id: z.string().min(1),
    requirementCode: z.string().nullable(),
    requirementName: z.string().min(1),
    mandatory: z.boolean(),
    outcome: outcomeSchema,
    reason: z.string().min(1),
    reasonCode: reasonSchema.nullable(),
    basis: basisSchema,
    evidence: z.array(evidenceRefSchema),
    profileEvidence: z.array(
      z.strictObject({
        type: z.enum(["LICENSE", "INDUSTRY_CODE", "TECHNOLOGY", "PAST_PROJECT", "FINANCIAL"]),
        ref: z.string(),
        label: z.string(),
      }),
    ),
    companyEvidence: z.array(companyEvidenceRefSchema),
  })
  .refine(
    (check) => (check.outcome === "NEEDS_REVIEW") === (check.reasonCode !== null),
    "NEEDS_REVIEW ⇔ reasonCode (04 §3.4)",
  )
  .refine(
    (check) =>
      check.outcome !== "NOT_SATISFIED" ||
      (check.evidence.length > 0 && check.companyEvidence.length > 0),
    "NOT_SATISFIED 는 양쪽 근거 필수 (08 §5.1)",
  );

const requirementAssessmentSchema = z
  .strictObject({
    itemId: z.string().min(1),
    itemKind: z.enum(["SKILL", "PAST_PERFORMANCE", "STAFFING", "QUALIFICATION"]),
    ruleStatus: outcomeSchema,
    ruleReason: reasonSchema.nullable(),
    basis: basisSchema,
    noticeEvidence: z.array(evidenceRefSchema),
    companyEvidence: z.array(companyEvidenceRefSchema),
    kev: z.null(),
    flags: z.array(reviewFlagSchema),
  })
  .refine((item) => (item.ruleStatus === "NEEDS_REVIEW") === (item.ruleReason !== null));

const kevAssistSchema = z
  .strictObject({
    enabled: z.boolean(),
    provider: z.enum(["mock", "local", "hosted"]).nullable(),
    model: z.string().nullable(),
    questionSetVersion: z.enum(["kev-qs/v0.1", "kev-qs/v0.2"]).nullable(),
    suggestedOption: recommendationSchema.nullable(),
    probabilities: z.strictObject({ BID: unit, WATCH: unit, NO_BID: unit }).nullable(),
    confidence: unit.nullable(),
    mandatoryRisk: unit.nullable(),
    needsHumanReview: unit.nullable(),
    fit: z
      .strictObject({ score: z.number().min(0).max(4), legend: z.record(z.string(), z.string()) })
      .nullable(),
    scores: z.null(),
    risks: z.null(),
    calibration: z.null(),
    stateTrace: z.null(),
    latencyMs: z.number().nonnegative().nullable(),
    requestId: z.string().nullable(),
    disclaimer: z.literal(KEV_DISCLAIMER),
  })
  .refine(
    (kev) =>
      kev.enabled
        ? kev.provider !== null && kev.suggestedOption !== null
        : kev.provider === null && kev.suggestedOption === null,
    "enabled ⇔ 참고 지표 존재",
  );

const analysisResultSchema = z.strictObject({
  schemaVersion: z.literal("analysis-result/v0.1"),
  algorithmVersion: z.literal("sol-v0.1.0"),
  inputSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["COMPLETED", "PARTIAL"]),
  errorCode: z.enum(["AI_UNAVAILABLE", "EXTRACTION_FAILED", "QWEN_UNAVAILABLE"]).nullable(),
  score: z.number().int().min(0).max(100),
  factors: z.array(scoreFactorSchema).length(5),
  qualificationStatus: outcomeSchema,
  qualificationChecks: z.array(qualificationCheckSchema).min(1),
  requirementAssessments: z.array(requirementAssessmentSchema),
  recommendation: recommendationSchema,
  recommendationBasis: z.enum(["RULES_ONLY", "RULES_WITH_KEV_ASSIST"]),
  reviewFlags: z.array(reviewFlagSchema),
  missingFactors: z.array(
    z.strictObject({ factor: z.enum(FACTOR_KEYS), reason: missingReasonSchema }),
  ),
  injectionSuspected: z.boolean(),
  kev: kevAssistSchema,
  explanation: z.string().min(1),
  disclaimer: z.literal(SOL_SCORE_DISCLAIMER),
});

// ── 입력 묶음
type Case = { label: string; input: AnalysisInput };

// extraction fixture 가 있는 19건(FX-12 는 격리라 없다).
const FIXTURE_IDS = [
  "FX-01",
  "FX-02",
  "FX-03",
  "FX-04",
  "FX-05",
  "FX-06",
  "FX-07",
  "FX-08",
  "FX-09",
  "FX-10",
  "FX-11",
  "FX-13",
  "FX-14",
  "FX-15",
  "FX-16",
  "FX-17",
  "FX-18",
  "FX-19",
  "FX-20",
];

// FX-13 의 bid.budgetKrw 는 금액 텍스트 "1,500백만원"(07 §6.2 정규화 fixture). 정규화는 수집 도메인 몫이고 규칙 엔진 입력 계약은
// KRW 정수 문자열이라, 여기서는 07 §6.2 의 정규화 값을 넣는다. 원문 그대로는 계약이 거절해야 한다(아래 시험).
const FX13_BUDGET_KRW = "1500000000";
const baseInput = (id: string): AnalysisInput =>
  id === "FX-13"
    ? buildInput(id, { bid: { ...loadBid(id), budgetKrw: FX13_BUDGET_KRW } })
    : buildInput(id);

const FIXTURE_CASES: Case[] = [
  ...FIXTURE_IDS.map((id) => ({ label: id, input: baseInput(id) })),
  // 정정 fixture 4건은 추출이 r2(#02) 기준이라 r2 공고 레코드와 짝지은 변형도 돌린다(07 §6.2).
  ...["FX-06", "FX-07", "FX-08", "FX-10"].map((id) => ({
    label: `${id} r2`,
    input: buildInput(id, { bid: loadBid(id, 1) }),
  })),
  { label: "FX-07 r1", input: buildInput("FX-07", { extraction: loadExtraction("FX-07.r01") }) },
];

function kevOf(choice: Recommendation, mandatoryRisk: number, needsHumanReview: number) {
  const probabilities: Record<Recommendation, number> = { BID: 0.1, WATCH: 0.1, NO_BID: 0.1 };
  probabilities[choice] = 0.8;
  const kev: KevMockResponse = {
    provider: "mock",
    questionSetVersion: "kev-qs/v0.1",
    responses: {
      recommendation: { choice, confidence: 0.8, probabilities },
      mandatoryRisk: { noul: mandatoryRisk },
      needsHumanReview: { noul: needsHumanReview },
      fit: { score: 2, legend: { "2": "Moderate" }, probabilities: { "2": 1 }, confidence: 1 },
    },
  };
  return kev;
}

const teamOf = (count: number, fte: number): ScoringTeamInput => ({
  members: Array.from({ length: count }, (_, index) => ({
    personId: `p${index}`,
    role: "DEVELOPER",
    grade: null,
    skills: [],
    availability: [{ startsAt: "2026-01-01", endsAt: "2028-01-01", fte }],
  })),
  assignments: [],
  asOf: "2026-10-16T00:00:00.000Z",
});

const VARIANT_CASES: Case[] = [
  {
    label: "FX-01 extraction=null AI_UNAVAILABLE",
    input: buildInput("FX-01", {
      extraction: null,
      kev: null,
      aiUnavailableReason: "AI_UNAVAILABLE",
    }),
  },
  {
    label: "FX-01 extraction=null QWEN_UNAVAILABLE",
    input: buildInput("FX-01", {
      extraction: null,
      kev: null,
      aiUnavailableReason: "QWEN_UNAVAILABLE",
    }),
  },
  { label: "FX-01 extraction=null 사유 없음", input: buildInput("FX-01", { extraction: null }) },
  {
    label: "FX-01 injectionSuspected",
    input: withPatch(
      buildInput("FX-01"),
      (draft) => void (draft.extraction!.injectionSuspected = true),
    ),
  },
  {
    label: "FX-01 Kev NO_BID 상충 + 위험 1.0",
    input: buildInput("FX-01", { kev: kevOf("NO_BID", 1, 1) }),
  },
  {
    label: "FX-03 Kev BID 승격 시도",
    input: buildInput("FX-03", { kev: kevOf("BID", 0, 0) }),
  },
  {
    label: "FX-01 missing 2개(TEAM_EMPTY·PREFERENCES_NOT_SET)",
    input: withPatch(buildInput("FX-01"), (draft) => {
      draft.team = { members: [], assignments: [], asOf: draft.team.asOf };
      draft.profile.preferences = null;
    }),
  },
  {
    label: "FX-05 attachmentsIncomplete",
    input: withPatch(buildInput("FX-05"), (draft) => void (draft.bid.attachmentsIncomplete = true)),
  },
];

const ALL_CASES = [...FIXTURE_CASES, ...VARIANT_CASES];
const RESULTS = ALL_CASES.map((entry) => ({ ...entry, result: analyze(entry.input) }));

// ── 도우미
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

function stringLeaves(value: unknown, path = "$"): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((entry, index) => stringLeaves(entry, `${path}[${index}]`));
  if (value !== null && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      stringLeaves(entry, `${path}.${key}`),
    );
  return [];
}

// "수주 확률"·"충족 확률"·"낙찰 확률"이 같은 문장 안에 부정(아니·아닙·아님·않)이 없이 단독으로 등장하면 잡는다(11 §3 G4·V2-06).
function unqualifiedProbabilityMentions(text: string): string[] {
  return text
    .split(/[.。!?\n]/)
    .filter(
      (sentence) =>
        /(수주 ?확률|충족 ?확률|낙찰 ?확률)/.test(sentence) &&
        !/(아니|아닙|아님|않)/.test(sentence),
    );
}

const outcomeOf = (factor: FactorKey, points: number): FactorOutcome => ({
  factor,
  rawValue: {},
  normalized: clamp(points / MAX_POINTS[factor], 0, 1),
  points,
  maxPoints: MAX_POINTS[factor],
  missing: false,
  missingReason: null,
  evidence: [],
  note: null,
  reviewFlags: [],
});
const scoreOf = (points: number[]) =>
  solScore(FACTOR_KEYS.map((factor, index) => outcomeOf(factor, points[index])));

const factorOf = (result: AnalysisResult, factor: FactorKey) =>
  result.factors.find((entry) => entry.factor === factor)!;

// ── 시험
describe("전수 실행 · extraction fixture 19건(+정정 r1/r2 변형)이 예외 없이 끝나고 결과 계약(zod)을 통과한다", () => {
  for (const entry of ALL_CASES) {
    it(`${entry.label}: analyze 가 예외 없이 끝나고 결과가 계약과 맞다`, () => {
      expect(analysisInputSchema.safeParse(entry.input).success).toBe(true);
      const result = analyze(entry.input);
      const parsed = analysisResultSchema.safeParse(result);
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 1)).toBe(true);
    });
  }

  it('FX-13 의 금액 텍스트 원문("1,500백만원")은 입력 계약이 bid.budgetKrw 에서 거절한다 — 정규화는 수집 도메인 몫', () => {
    const raw = buildInput("FX-13");
    expect(raw.bid.budgetKrw).toBe("1,500백만원");
    const parsed = analysisInputSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["bid.budgetKrw"]);
    expect(() => analyze(raw)).toThrow();
  });
});

describe("권고는 규칙 입력 3개(자격·missingFactors 수·점수)만으로 재계산된다 — Kev 는 입력이 아니다(08 §5.2·§5.3, 17 절대 규칙)", () => {
  it("모든 경우에서 recommendation === decideRecommendation(결과 자신의 자격·missing·점수)", () => {
    for (const { label, result } of RESULTS) {
      const recomputed = decideRecommendation({
        qualificationStatus: result.qualificationStatus,
        missingFactorCount: result.missingFactors.length,
        score: result.score,
        thresholds,
      });
      expect(result.recommendation, label).toBe(recomputed.recommendation);
    }
  });

  it("mergeKev 반환값에는 권고 필드가 없다 — 호출자가 Kev 로 권고를 덮어쓸 통로가 구조적으로 없다", () => {
    const withoutKev = mergeKev({
      recommendation: "NO_BID",
      qualificationStatus: "NOT_SATISFIED",
      kev: null,
      tau: thresholds.kevTau,
    });
    const withKev = mergeKev({
      recommendation: "NO_BID",
      qualificationStatus: "NOT_SATISFIED",
      kev: kevOf("BID", 0, 0),
      tau: thresholds.kevTau,
    });
    expect(Object.keys(withoutKev).toSorted()).toEqual([
      "kev",
      "recommendationBasis",
      "reviewFlags",
    ]);
    expect(Object.keys(withKev).toSorted()).toEqual(["kev", "recommendationBasis", "reviewFlags"]);
    expect(withKev.reviewFlags).toEqual(["MODEL_RULE_DISAGREEMENT"]);
  });

  it("fixture 전부에 Kev 최상위 BID(1.0 확신)를 넣어도 권고·점수·자격·요소가 Kev 없는 결과와 같다", () => {
    for (const entry of FIXTURE_CASES) {
      const withoutKev = analyze({ ...entry.input, kev: null });
      const promoted = analyze({ ...entry.input, kev: kevOf("BID", 0, 0) });
      const signature = (result: AnalysisResult) =>
        canonicalJson({
          recommendation: result.recommendation,
          score: result.score,
          qualificationStatus: result.qualificationStatus,
          qualificationChecks: result.qualificationChecks,
          factors: result.factors,
          missingFactors: result.missingFactors,
        });
      expect(signature(promoted), entry.label).toBe(signature(withoutKev));
      expect(promoted.recommendationBasis, entry.label).toBe("RULES_WITH_KEV_ASSIST");
      expect(withoutKev.recommendationBasis, entry.label).toBe("RULES_ONLY");
      if (withoutKev.recommendation !== "BID")
        expect(promoted.reviewFlags, entry.label).toContain("MODEL_RULE_DISAGREEMENT");
    }
  });
});

describe("경계값 · analyze 수준에서 점수 75/74·50/49, Kev τ 0.70 등호", () => {
  it("FX-01 인력 가용 0.6 FTE → staff 1.0점 → 합계 75 → BID. 0.2 FTE → 0.3점 → 74 → WATCH", () => {
    const at75 = analyze(
      withPatch(buildInput("FX-01"), (draft) => void (draft.team = teamOf(1, 0.6))),
    );
    expect(at75.factors.map((factor) => factor.points)).toEqual([24, 25, 1, 15, 10]);
    expect(at75.missingFactors).toEqual([]);
    expect(at75.score).toBe(75);
    expect(at75.recommendation).toBe("BID");
    expect(at75.explanation).toContain("참여 권고 구간(75 이상)");

    const at74 = analyze(
      withPatch(buildInput("FX-01"), (draft) => void (draft.team = teamOf(1, 0.2))),
    );
    expect(at74.factors.map((factor) => factor.points)).toEqual([24, 25, 0.3, 15, 10]);
    expect(at74.score).toBe(74);
    expect(at74.recommendation).toBe("WATCH");
    expect(at74.explanation).toContain("사람 검토 구간(50~75)");
  });

  it("FX-01 기술 목록 비움(missing 1) + 실적 증빙 없음 + 8명×0.9 FTE → 49.5 → 50 → WATCH. 8명×0.89 → 49.4 → 49 → NO_BID", () => {
    const build = (fte: number) =>
      analyze(
        withPatch(buildInput("FX-01"), (draft) => {
          draft.profile.technologies = [];
          for (const project of draft.profile.pastProjects) project.evidenceRef = null;
          draft.team = teamOf(8, fte);
        }),
      );
    const at50 = build(0.9);
    expect(at50.factors.map((factor) => factor.points)).toEqual([0, 12.5, 12, 15, 10]);
    expect(at50.missingFactors).toEqual([
      { factor: "skillMatch", reason: "PROFILE_TECHNOLOGIES_EMPTY" },
    ]);
    expect(at50.score).toBe(50);
    expect(at50.recommendation).toBe("WATCH");

    const at49 = build(0.89);
    expect(at49.factors.map((factor) => factor.points)).toEqual([0, 12.5, 11.9, 15, 10]);
    expect(at49.score).toBe(49);
    expect(at49.recommendation).toBe("NO_BID");
    expect(at49.explanation).toContain("참여 비권고 구간(50 미만)");
  });

  it("solScore 반올림·clamp: 74.5 → 75, 74.4 → 74, 49.5 → 50, 49.4 → 49, 110 → 100, 음수 → 0 (08 §2)", () => {
    expect(scoreOf([30, 25, 19.5, 0, 0])).toBe(75);
    expect(scoreOf([30, 25, 19.4, 0, 0])).toBe(74);
    expect(scoreOf([30, 19.5, 0, 0, 0])).toBe(50);
    expect(scoreOf([30, 19.4, 0, 0, 0])).toBe(49);
    expect(scoreOf([60, 50, 0, 0, 0])).toBe(100);
    expect(scoreOf([-5, 0, 0, 0, 0])).toBe(0);
    expect(
      decideRecommendation({
        qualificationStatus: "SATISFIED",
        missingFactorCount: 0,
        score: 75,
        thresholds,
      }).recommendation,
    ).toBe("BID");
    expect(
      decideRecommendation({
        qualificationStatus: "SATISFIED",
        missingFactorCount: 0,
        score: 50,
        thresholds,
      }).recommendation,
    ).toBe("WATCH");
  });

  it("mandatoryRisk 0.70 은 KEV_MANDATORY_RISK(자격 SATISFIED), 0.699 는 아님. needsHumanReview 도 0.70 등호", () => {
    const at = analyze(buildInput("FX-01", { kev: kevOf("BID", 0.7, 0.7) }));
    expect(at.reviewFlags).toEqual(["KEV_MANDATORY_RISK", "KEV_NEEDS_REVIEW"]);
    expect(at.recommendation).toBe("BID");
    expect(at.explanation).toContain("모델 참고 지표가 사람 검토를 권장합니다.");
    const below = analyze(buildInput("FX-01", { kev: kevOf("BID", 0.699, 0.699) }));
    expect(below.reviewFlags).toEqual([]);
  });

  it("자격이 NEEDS_REVIEW 면 mandatoryRisk 1.0 이어도 KEV_MANDATORY_RISK 는 붙지 않는다(08 §5.3 '규칙이 모든 자격을 SATISFIED 로 봤으면')", () => {
    const result = analyze(buildInput("FX-04", { kev: kevOf("WATCH", 1, 0.7) }));
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.reviewFlags).toEqual(["KEV_NEEDS_REVIEW"]);
    expect(result.recommendation).toBe("WATCH");
    expect(result.kev.mandatoryRisk).toBe(1);
  });
});

describe("missingFactors 2개 이상이면 점수와 무관하게 WATCH (08 §4)", () => {
  it("decideRecommendation: 90점·missing 2 → WATCH(MISSING_FACTORS), 90점·missing 1 → BID, 100점·missing 5 → WATCH", () => {
    const decide = (score: number, missingFactorCount: number) =>
      decideRecommendation({
        qualificationStatus: "SATISFIED",
        missingFactorCount,
        score,
        thresholds,
      });
    expect(decide(90, 2)).toEqual({ recommendation: "WATCH", rulePath: "MISSING_FACTORS" });
    expect(decide(90, 1)).toEqual({ recommendation: "BID", rulePath: "SCORE_BID" });
    expect(decide(100, 5)).toEqual({ recommendation: "WATCH", rulePath: "MISSING_FACTORS" });
    // 미충족은 missing 보다 먼저다.
    expect(
      decideRecommendation({
        qualificationStatus: "NOT_SATISFIED",
        missingFactorCount: 2,
        score: 90,
        thresholds,
      }),
    ).toEqual({ recommendation: "NO_BID", rulePath: "MANDATORY_NOT_SATISFIED" });
  });

  it("analyze: FX-01 인력 없음 + 선호 미설정 → 79점(≥75)인데도 WATCH, 설명에 사유", () => {
    const { result } = RESULTS.find((entry) => entry.label.startsWith("FX-01 missing 2개"))!;
    expect(result.missingFactors).toEqual([
      { factor: "staffAvailability", reason: "TEAM_EMPTY" },
      { factor: "strategicPreference", reason: "PREFERENCES_NOT_SET" },
    ]);
    expect(result.score).toBe(79);
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(result.recommendation).toBe("WATCH");
    expect(result.explanation).toContain(
      "비어 있는 요소가 2개 이상이라 점수 79점과 무관하게 WATCH",
    );
  });
});

describe("입력 불변성 · deep-freeze 한 입력으로도 같은 결과", () => {
  for (const id of ["FX-01", "FX-03", "FX-05", "FX-13", "FX-16", "FX-17"]) {
    it(`${id}: 깊이 동결한 입력에서 예외 없이 끝나고, 입력과 결과가 동결 전과 byte-동일하다`, () => {
      const plain = baseInput(id);
      const expected = canonicalJson(analyze(plain));
      const frozen = deepFreeze(baseInput(id));
      const before = canonicalJson(frozen);
      let result: AnalysisResult | null = null;
      expect(() => void (result = analyze(frozen))).not.toThrow();
      expect(canonicalJson(frozen)).toBe(before);
      expect(canonicalJson(result)).toBe(expected);
    });
  }
});

describe("확률 문구 · 결과의 모든 문자열 필드에 수주·충족·낙찰 확률이 부정 없이 단독 등장 0회 (11 §3 G4·V2-06)", () => {
  it("fixture 19건 + 변형 8건의 문자열 잎 전부", () => {
    for (const { label, result } of RESULTS) {
      const leaves = stringLeaves(result);
      expect(leaves.length, label).toBeGreaterThan(10);
      const offenders = leaves.flatMap((leaf) =>
        unqualifiedProbabilityMentions(leaf.text).map((sentence) => `${leaf.path}: ${sentence}`),
      );
      expect(offenders, label).toEqual([]);
      expect(result.explanation, label).toMatch(/최종 참여 결정은 사람이 합니다\.$/);
    }
  });

  it("검사 함수 자기 검증: 단독 등장은 잡고, 부정이 붙은 고지 문구 2종은 통과한다", () => {
    expect(unqualifiedProbabilityMentions("낙찰 확률 80%")).toHaveLength(1);
    expect(unqualifiedProbabilityMentions("충족확률은 높다. 수주 확률도 높다")).toHaveLength(2);
    expect(unqualifiedProbabilityMentions(SOL_SCORE_DISCLAIMER)).toEqual([]);
    expect(unqualifiedProbabilityMentions(KEV_DISCLAIMER)).toEqual([]);
  });
});

describe("reviewFlags · 04 §4 review_flag 값 집합 안에만 있고 중복이 없다", () => {
  it("fixture 19건 + 변형 8건", () => {
    for (const { label, result } of RESULTS) {
      for (const flag of result.reviewFlags)
        expect(REVIEW_FLAGS, `${label}: ${flag}`).toContain(flag);
      expect(new Set(result.reviewFlags).size, label).toBe(result.reviewFlags.length);
      for (const item of result.requirementAssessments)
        for (const flag of item.flags)
          expect(REVIEW_FLAGS, `${label}: ${item.itemId}`).toContain(flag);
    }
  });

  it("상태 불변식: PARTIAL ⇔ errorCode, errorCode 는 reviewFlags 에 있고, 인젝션 의심은 플래그 + 자격 NEEDS_REVIEW, Kev 유무 ⇔ recommendationBasis", () => {
    for (const { label, input, result } of RESULTS) {
      expect(result.status === "PARTIAL", label).toBe(result.errorCode !== null);
      // 추출이 없으면 규칙만 계산한 결과라 반드시 PARTIAL 이고, 사유가 없으면 EXTRACTION_FAILED 로 기록한다(03 §8).
      if (input.extraction === null) {
        expect(result.status, label).toBe("PARTIAL");
        expect(result.errorCode, label).toBe(input.aiUnavailableReason ?? "EXTRACTION_FAILED");
      }
      if (result.errorCode !== null) expect(result.reviewFlags, label).toContain(result.errorCode);
      if (result.injectionSuspected) {
        expect(result.reviewFlags, label).toContain("INJECTION_SUSPECTED");
        expect(result.qualificationStatus, label).toBe("NEEDS_REVIEW");
      }
      expect(result.recommendationBasis, label).toBe(
        result.kev.enabled ? "RULES_WITH_KEV_ASSIST" : "RULES_ONLY",
      );
      if (result.reviewFlags.includes("KEV_MANDATORY_RISK"))
        expect(result.qualificationStatus, label).toBe("SATISFIED");
    }
  });
});

describe("요소 ↔ 점수 · points 반올림·clamp 와 합계 규칙 (08 §2)", () => {
  it("fixture 19건 + 변형 8건: 5요소 고정 순서, Σ maxPoints 100, points = clamp(round1(max × normalized)), score = clamp(round(Σ points))", () => {
    expect(Object.values(MAX_POINTS).reduce((sum, value) => sum + value, 0)).toBe(100);
    for (const { label, result } of RESULTS) {
      expect(
        result.factors.map((factor) => factor.factor),
        label,
      ).toEqual([...FACTOR_KEYS]);
      for (const factor of result.factors) {
        const tag = `${label} ${factor.factor}`;
        expect(Math.round(factor.points * 10) / 10, tag).toBe(factor.points);
        expect(factor.points, tag).toBeGreaterThanOrEqual(0);
        expect(factor.points, tag).toBeLessThanOrEqual(factor.maxPoints);
        // normalized 는 소수 3자리로 반올림된 표시값이고 points 는 반올림 전 값으로 계산한다(08 §2). 둘을 다시 맞추면
        // 반올림 경계에서 최대 0.1 차이가 난다(FX-09 pastPerformance 0.8175 → 표시 0.818). 부동소수 오차만큼 여유를 둔다.
        expect(
          Math.abs(
            factor.points -
              clamp(round1(factor.maxPoints * factor.normalized), 0, factor.maxPoints),
          ),
          tag,
        ).toBeLessThanOrEqual(0.1 + 1e-9);
      }
      const total = result.factors.reduce((sum, factor) => sum + factor.points, 0);
      expect(result.score, label).toBe(clamp(Math.round(total), 0, 100));
      expect(result.missingFactors, label).toEqual(
        result.factors
          .filter((factor) => factor.missing)
          .map((factor) => ({ factor: factor.factor, reason: factor.missingReason })),
      );
    }
  });
});

describe("fixture 별 규칙에서 바로 따라오는 기대 (07 §6.2 · 08 §3.4·§4·§5.1)", () => {
  it("FX-16: 방산업체 지정 NOT_HELD → NOT_SATISFIED(양쪽 근거) → NO_BID. 국방 제외 분야 → 선호 0점. Kev NO_BID 일치라 플래그 없음", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-16")!;
    expect(result.recommendation).toBe("NO_BID");
    expect(result.qualificationStatus).toBe("NOT_SATISFIED");
    const defense = result.qualificationChecks.find(
      (check) => check.requirementCode === "DEFENSE_CONTRACTOR",
    );
    expect(defense).toMatchObject({ outcome: "NOT_SATISFIED", reasonCode: null, mandatory: true });
    expect(defense?.evidence.length).toBeGreaterThan(0);
    expect(defense?.companyEvidence[0]).toMatchObject({
      kind: "LICENSE",
      quotedText: "방산업체 지정 (NOT_HELD)",
    });
    expect(factorOf(result, "strategicPreference")).toMatchObject({
      points: 0,
      missing: false,
      note: "제외 분야(국방)",
    });
    expect(result.kev).toMatchObject({
      enabled: true,
      suggestedOption: "NO_BID",
      mandatoryRisk: 0.9,
    });
    expect(result.reviewFlags).toEqual([]);
    expect(result.explanation).toContain(
      "점은 참고용으로만 표시하며 권고는 NO-BID(참여 비권고)입니다",
    );
  });

  it("FX-15: 80억 > 상한 50억 → scaleFit 0점(missing 아님) + SCALE_LIMIT_EXCEEDED, 자격 SATISFIED, 58 WATCH", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-15")!;
    expect(factorOf(result, "scaleFit")).toMatchObject({
      normalized: 0,
      points: 0,
      missing: false,
    });
    expect(result.reviewFlags).toEqual(["SCALE_LIMIT_EXCEEDED"]);
    expect(result.missingFactors).toEqual([]);
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(result.score).toBe(58);
    expect(result.recommendation).toBe("WATCH");
  });

  it("FX-11: 예산·마감 null → scaleFit BUDGET_UNKNOWN 7.5(missing 1건), 일정 계수 미적용, 자격 UNKNOWN 은 NEEDS_REVIEW → WATCH", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-11")!;
    expect(factorOf(result, "scaleFit")).toMatchObject({
      normalized: 0.5,
      points: 7.5,
      missingReason: "BUDGET_UNKNOWN",
    });
    expect(result.missingFactors).toEqual([{ factor: "scaleFit", reason: "BUDGET_UNKNOWN" }]);
    expect(factorOf(result, "staffAvailability").rawValue).toMatchObject({
      businessDays: null,
      scheduleFactor: 1,
    });
    expect(result.qualificationChecks).toHaveLength(1);
    expect(result.qualificationChecks[0]).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
    });
    expect(result.recommendation).toBe("WATCH");
  });

  it("FX-04: 자격 문장 미추출 → NEEDS_REVIEW(NOTICE_INFO_MISSING), 근거 0건, 권고 WATCH, Kev 참고 → RULES_WITH_KEV_ASSIST", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-04")!;
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.qualificationChecks.map((check) => check.reasonCode)).toEqual([
      "NOTICE_INFO_MISSING",
    ]);
    expect(result.qualificationChecks.flatMap((check) => check.evidence)).toEqual([]);
    expect(result.recommendation).toBe("WATCH");
    expect(result.recommendationBasis).toBe("RULES_WITH_KEV_ASSIST");
    expect(result.explanation).toContain("정보 부족은 미충족이 아니며 사람이 확인합니다");
  });

  it("FX-17·FX-20(발주계획): 모든 자격 항목 STAGE_NOT_APPLICABLE, NOT_SATISFIED 0건, 권고 WATCH(조기 추적)", () => {
    for (const id of ["FX-17", "FX-20"]) {
      const { result } = RESULTS.find((entry) => entry.label === id)!;
      expect(result.qualificationChecks.length, id).toBeGreaterThan(0);
      expect(
        result.qualificationChecks.every(
          (check) =>
            check.outcome === "NEEDS_REVIEW" && check.reasonCode === "STAGE_NOT_APPLICABLE",
        ),
        id,
      ).toBe(true);
      expect(result.qualificationStatus, id).toBe("NEEDS_REVIEW");
      expect(result.recommendation, id).toBe("WATCH");
      expect(result.explanation, id).toContain("STAGE_NOT_APPLICABLE");
    }
  });

  it("FX-05: 첨부 파싱 실패 경고 → PARSE_UNSUPPORTED 사유·플래그, 본문 추출값(Java·Spring Boot)만 점수에 쓴다", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-05")!;
    expect(result.qualificationChecks[0]).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "PARSE_UNSUPPORTED",
    });
    expect(result.reviewFlags).toEqual(["PARSE_UNSUPPORTED", "KEV_NEEDS_REVIEW"]);
    expect(factorOf(result, "skillMatch").rawValue).toMatchObject({
      required: 2,
      matched: 2,
      preferred: 0,
    });
    expect(result.recommendation).toBe("WATCH");
  });
});

describe("기존 시험이 비워 둔 규칙", () => {
  it("비필수(mandatory=false) 항목의 NOT_SATISFIED 는 자격 종합·권고를 막지 않는다(08 §5.1 '필수 항목만 본다')", () => {
    const result = analyze(
      withPatch(buildInput("FX-03"), (draft) => {
        draft.extraction!.qualifications.value![1].mandatory = false;
      }),
    );
    expect(
      result.qualificationChecks.map((check) => [
        check.requirementCode,
        check.mandatory,
        check.outcome,
      ]),
    ).toEqual([
      ["SW_BUSINESS_REG", true, "SATISFIED"],
      ["ICT_CONSTRUCTION", false, "NOT_SATISFIED"],
    ]);
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(result.score).toBe(68);
    expect(result.recommendation).toBe("WATCH");
  });

  it("제외 키워드(무기체계)가 제목에 있으면 strategicPreference 0점이고 missing 이 아니다(08 §3.5)", () => {
    const result = analyze(
      withPatch(
        buildInput("FX-01"),
        (draft) => void (draft.bid.title = `${draft.bid.title} 무기체계 연계`),
      ),
    );
    expect(factorOf(result, "strategicPreference")).toMatchObject({
      normalized: 0,
      points: 0,
      missing: false,
      note: "제외 키워드(무기체계)",
    });
    expect(result.missingFactors).toEqual([]);
    expect(result.score).toBe(84);
  });

  it("마감이 기준일 이전이면 영업일 0 → 일정 계수 0.4 (08 §3.3 SCHEDULE)", () => {
    const result = analyze(
      withPatch(
        buildInput("FX-01"),
        (draft) => void (draft.bid.deadlineAt = "2026-10-15T09:00:00Z"),
      ),
    );
    expect(factorOf(result, "staffAvailability")).toMatchObject({ points: 8 });
    expect(factorOf(result, "staffAvailability").rawValue).toMatchObject({
      businessDays: 0,
      scheduleFactor: 0.4,
    });
    expect(result.explanation).toContain(
      "제안 준비 기간 0영업일로 촉박해 인력 가용 계수를 0.4로 낮췄습니다.",
    );
  });

  it("Kev 참고 지표는 wire 값을 그대로 옮기고 v0.2 필드는 null 이다(03 §5.7, 08 §5.4)", () => {
    const { result } = RESULTS.find((entry) => entry.label === "FX-02")!;
    expect(result.kev).toMatchObject({
      enabled: true,
      provider: "mock",
      questionSetVersion: "kev-qs/v0.1",
      suggestedOption: "WATCH",
      probabilities: { BID: 0.36, WATCH: 0.52, NO_BID: 0.12 },
      needsHumanReview: 0.74,
      scores: null,
      risks: null,
      calibration: null,
      stateTrace: null,
      disclaimer: KEV_DISCLAIMER,
    });
  });

  it("회사 프로필에 그 면허 기록이 아예 없으면 미충족이 아니라 확인 필요다 — FX-16 방산업체 기록 제거 → COMPANY_EVIDENCE_MISSING → WATCH (17 절대 규칙)", () => {
    const result = analyze(
      withPatch(buildInput("FX-16"), (draft) => {
        draft.profile.licenses = draft.profile.licenses.filter(
          (license) => license.code !== "DEFENSE_CONTRACTOR",
        );
      }),
    );
    expect(result.qualificationChecks.map((check) => check.outcome)).not.toContain("NOT_SATISFIED");
    expect(
      result.qualificationChecks.find((check) => check.requirementCode === "DEFENSE_CONTRACTOR"),
    ).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "COMPANY_EVIDENCE_MISSING",
      companyEvidence: [],
    });
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.recommendation).toBe("WATCH");
  });

  it("missing 요소의 normalized·points 는 08 §4 표의 값(중립 0.5 또는 보수 0.0)과 정확히 같다 — fixture 19건 + 변형 8건", () => {
    const NORMALIZED_BY_MISSING: Record<string, number> = {
      "skillMatch:NO_REQUIREMENTS_EXTRACTED": 0.5,
      "skillMatch:PROFILE_TECHNOLOGIES_EMPTY": 0,
      "pastPerformance:BID_DOMAIN_UNKNOWN": 0.5,
      "pastPerformance:PROFILE_PROJECTS_EMPTY": 0,
      "staffAvailability:REQUIRED_FTE_UNKNOWN": 0.5,
      "staffAvailability:TEAM_EMPTY": 0.5,
      "scaleFit:BUDGET_UNKNOWN": 0.5,
      "scaleFit:PROFILE_PROJECTS_EMPTY": 0.5,
      "strategicPreference:PREFERENCES_NOT_SET": 0.5,
    };
    let seen = 0;
    for (const { label, result } of RESULTS)
      for (const factor of result.factors.filter((entry) => entry.missing)) {
        const key = `${factor.factor}:${factor.missingReason}`;
        const normalized = NORMALIZED_BY_MISSING[key];
        expect(normalized, `${label} ${key}`).toBeDefined();
        expect(factor, `${label} ${key}`).toMatchObject({
          normalized,
          points: round1(factor.maxPoints * normalized),
        });
        seen += 1;
      }
    expect(seen).toBeGreaterThanOrEqual(10);
  });

  it("입력 객체의 키 순서를 전부 뒤집어도 canonical JSON 과 input_snapshot_hash 는 같다(08 §7)", () => {
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .toReversed()
            .map(([key, entry]) => [key, reverseKeys(entry)]),
        );
      return value;
    };
    const input = buildInput("FX-01");
    const reversed = reverseKeys(input) as AnalysisInput;
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(input));
    expect(canonicalJson(reversed)).toBe(canonicalJson(input));
    expect(snapshotHash(reversed)).toBe(snapshotHash(input));
    expect(analyze(reversed).inputSnapshotHash).toBe(analyze(input).inputSnapshotHash);
  });
});
