import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { staffAvailabilityInput } from "./factors";
import { buildInput, loadGolden } from "./test-support";

// docs/08 §6 worked example 3건과 fixtures/goldens 를 그대로 대조한다(11 §3.1). 골든 수치는 mock 모드의 고정 입력에서만 단언한다.
// 요소별 points·normalized·합계·권고·reviewFlags 가 전부 같아야 한다. 가중치·골든은 바꾸지 않는다.

const EXPECTED = {
  "FX-01": { points: [24.0, 25.0, 20.0, 15.0, 10.0], score: 94, recommendation: "BID", flags: [] },
  "FX-02": {
    points: [15.0, 18.3, 14.0, 15.0, 10.0],
    score: 72,
    recommendation: "WATCH",
    flags: ["KEV_NEEDS_REVIEW"],
  },
  "FX-03": {
    points: [20.0, 12.2, 20.0, 9.0, 7.0],
    score: 68,
    recommendation: "NO_BID",
    flags: ["MODEL_RULE_DISAGREEMENT"],
  },
} as const;

describe("G3 · 08 §6 worked examples (FX-01 94 BID · FX-02 72 WATCH · FX-03 68 NO-BID)", () => {
  for (const [id, expected] of Object.entries(EXPECTED)) {
    it(`${id}: 요소별 points·점수·권고·플래그가 08 §6 과 같다`, () => {
      const input = buildInput(id);
      expect(input.team.members).toHaveLength(200);
      const result = analyze(input);
      expect(result.factors.map((factor) => factor.factor)).toEqual([
        "skillMatch",
        "pastPerformance",
        "staffAvailability",
        "scaleFit",
        "strategicPreference",
      ]);
      expect(result.factors.map((factor) => factor.points)).toEqual([...expected.points]);
      expect(result.score).toBe(expected.score);
      expect(result.recommendation).toBe(expected.recommendation);
      expect(result.reviewFlags).toEqual([...expected.flags]);
      expect(result.status).toBe("COMPLETED");
      expect(result.recommendationBasis).toBe("RULES_WITH_KEV_ASSIST");
      expect(result.missingFactors).toEqual([]);
    });

    it(`${id}: fixtures/goldens/${id}.json 과 같다`, () => {
      const golden = loadGolden(id);
      const input = buildInput(id);
      expect(input.team.members).toHaveLength(200);
      const result = analyze(input);
      expect(
        result.factors.map(({ factor, normalized, points, maxPoints }) => ({
          factor,
          normalized,
          points,
          maxPoints,
        })),
      ).toEqual(golden.factors);
      expect(result.factors.reduce((sum, factor) => sum + factor.points, 0)).toBeCloseTo(
        golden.total,
        6,
      );
      expect(result.score).toBe(golden.score);
      expect(result.recommendation).toBe(golden.recommendation);
      expect(result.reviewFlags).toEqual(golden.reviewFlags);
    });
  }

  it("FX-01: 중간값 — 필수 5/5·우대 0/2, P1 선택, 12 FTE/가용 95.5, 영업일 15, 자격 3건 모두 SATISFIED", () => {
    const result = analyze(buildInput("FX-01"));
    const [skill, past, staff, scale, strategic] = result.factors;
    expect(skill.rawValue).toMatchObject({
      required: 5,
      matched: 5,
      preferred: 2,
      preferredMatched: 0,
    });
    expect(skill.normalized).toBe(0.8);
    expect(past.rawValue).toMatchObject({ bidDomain: "민원", selectedProjectId: "P1" });
    expect(staff.rawValue).toMatchObject({
      requiredFte: 12,
      requiredFteSource: "STAFFING",
      availableFte: 95.5,
      availableRatio: 1,
      businessDays: 15,
      scheduleFactor: 1,
    });
    expect(scale.rawValue).toMatchObject({
      budgetKrw: "1200000000",
      maxContractKrw: "5000000000",
      largestPastKrw: "2800000000",
      limitExceeded: false,
    });
    expect(strategic.rawValue).toMatchObject({
      agencyType: "지자체",
      domainLevel: 1,
      agencyLevel: 1,
    });
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(
      result.qualificationChecks.map((check) => [check.requirementCode, check.outcome]),
    ).toEqual([
      ["SW_BUSINESS_REG", "SATISFIED"],
      ["DIRECT_PRODUCTION", "SATISFIED"],
      ["SME_CONFIRMATION", "SATISFIED"],
    ]);
    expect(result.kev).toMatchObject({
      enabled: true,
      suggestedOption: "BID",
      probabilities: { BID: 0.71, WATCH: 0.24, NO_BID: 0.05 },
    });
  });

  it("FX-02: 중간값 — 필수 3/6·우대 1/2, P3 0.732, 예산 구간 20 FTE(estimatedFrom budgetTier), 일정 계수 0.7", () => {
    const result = analyze(buildInput("FX-02"));
    const [skill, past, staff] = result.factors;
    expect(skill.rawValue).toMatchObject({
      required: 6,
      matched: 3,
      matchedNames: ["Java", "Spring Boot", "PostgreSQL"],
      missingNames: ["Vue.js", "SCORM 연동", "WebRTC"],
      preferred: 2,
      preferredMatched: 1,
    });
    expect(past.rawValue).toMatchObject({ bidDomain: "교육", selectedProjectId: "P3" });
    expect(past.normalized).toBe(0.732);
    expect(staff.rawValue).toMatchObject({
      requiredFte: 20,
      requiredFteSource: "BUDGET_TIER",
      estimatedFrom: "budgetTier",
      availableFte: 95.5,
      scheduleFactor: 0.7,
    });
    expect(staff.note).toContain("0.7");
    // 08 §6.3 의 "영업일 7" 은 달력일 10 × 5/7 근사값이다. 실제 월~금 수는 6이고 일정 계수 구간(≥5)은 같다.
    expect(staff.rawValue).toMatchObject({ businessDays: 6 });
    expect(result.explanation).toContain("6개 중 3개");
  });

  it("FX-03: 정보통신공사업 등록 NOT_SATISFIED 에 공고 근거와 회사 NOT_HELD 근거가 둘 다 있고, 점수 68 은 참고 표시다", () => {
    const result = analyze(buildInput("FX-03"));
    expect(result.qualificationStatus).toBe("NOT_SATISFIED");
    const ict = result.qualificationChecks.find(
      (check) => check.requirementCode === "ICT_CONSTRUCTION",
    );
    expect(ict).toMatchObject({
      outcome: "NOT_SATISFIED",
      reasonCode: null,
      basis: "EXTRACTION",
      mandatory: true,
    });
    expect(ict?.evidence.map((entry) => entry.quotedText)).toEqual([
      "정보통신공사업법에 따른 정보통신공사업 등록업체",
    ]);
    expect(ict?.companyEvidence).toEqual([
      {
        profileRevision: 2,
        kind: "LICENSE",
        recordKey: "licenses[5]",
        documentId: null,
        quotedText: "정보통신공사업 등록 (NOT_HELD)",
      },
    ]);
    expect(
      result.qualificationChecks.find((check) => check.requirementCode === "SW_BUSINESS_REG")
        ?.outcome,
    ).toBe("SATISFIED");
    const [skill, past, staff, scale, strategic] = result.factors;
    expect(skill.rawValue).toMatchObject({
      required: 4 + 2,
      matched: 4,
      missingNames: ["영상분석 AI", "VMS 연동"],
    });
    expect(past.rawValue).toMatchObject({ bidDomain: "스마트시티", selectedProjectId: "P2" });
    expect(staff.rawValue).toMatchObject({
      requiredFte: 20,
      availableFte: 95.5,
      businessDays: 11,
      scheduleFactor: 1,
    });
    expect(scale.rawValue).toMatchObject({ ratio: 1.607, limitExceeded: false });
    expect(strategic.rawValue).toMatchObject({
      domainLevel: 0.5,
      agencyType: "지자체",
      agencyLevel: 1,
    });
    expect(result.score).toBe(68);
    expect(result.recommendation).toBe("NO_BID");
    expect(result.explanation).toContain("68점은 참고용");
    expect(result.explanation).toContain("결정 모델은 추천을 제시했지만 규칙 판정이 우선");
  });
});

// Bosun 요청(profileSummary.staffAvailability)과 추천 분석 요청(company.staff)이 인력 요소와 다른 기간·FTE 를 쓰지 않게 한다.
describe("Bosun 인력 입력 — 인력 요소(K6)와 같은 기간·가용 FTE", () => {
  it("FX-01: staffAvailabilityInput 이 인력 요소 rawValue 의 기간·가용 FTE·인원과 같다", () => {
    const input = buildInput("FX-01");
    const staff = staffAvailabilityInput(
      input.bid,
      input.extraction,
      input.team,
      input.config.today,
    );
    const factor = analyze(input).factors.find((entry) => entry.factor === "staffAvailability");
    expect(staff).toEqual({
      from: expect.any(String),
      to: expect.any(String),
      availableFte: 95.5,
      eligibleStaff: 200,
    });
    expect(factor?.rawValue).toMatchObject({
      period: { startsAt: staff?.from, endsAt: staff?.to },
      availableFte: staff?.availableFte,
      teamMembers: staff?.eligibleStaff,
    });
  });

  it("인력 요소가 기간을 정하지 않으면(필요 FTE 모름·명부 없음) null 이다", () => {
    const input = buildInput("FX-01");
    const { today } = input.config;
    expect(
      staffAvailabilityInput(input.bid, input.extraction, { ...input.team, members: [] }, today),
    ).toBeNull();
    expect(
      staffAvailabilityInput({ ...input.bid, budgetKrw: null }, null, input.team, today),
    ).toBeNull();
  });
});
