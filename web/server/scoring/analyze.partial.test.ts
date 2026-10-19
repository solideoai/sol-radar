import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { buildInput } from "./test-support";

// G6 규칙 쪽 몫: 추출이 없으면(AI 불가·추출 실패) 모든 필드 UNKNOWN 취급 → status=PARTIAL, RULES_ONLY, 사유 플래그.
// 점수는 missing 정책으로 계산하고 자격은 확인 필요다. 호출자가 사유(aiUnavailableReason)를 준다.

describe("analyze · extraction=null → PARTIAL (규칙만)", () => {
  it("추출 없음 + 사유 AI_UNAVAILABLE → PARTIAL·RULES_ONLY·AI_UNAVAILABLE 플래그·errorCode, Kev 비활성", () => {
    const result = analyze(
      buildInput("FX-01", { extraction: null, kev: null, aiUnavailableReason: "AI_UNAVAILABLE" }),
    );
    expect(result).toMatchObject({
      status: "PARTIAL",
      errorCode: "AI_UNAVAILABLE",
      recommendationBasis: "RULES_ONLY",
      kev: { enabled: false },
      injectionSuspected: false,
    });
    expect(result.reviewFlags).toEqual(["AI_UNAVAILABLE"]);
    expect(result.explanation).toContain("AI 서비스를 사용할 수 없어 규칙 기반 결과만 제공합니다.");
  });

  it("사유를 주지 않으면 EXTRACTION_FAILED 로 기록한다", () => {
    const result = analyze(buildInput("FX-01", { extraction: null, kev: null }));
    expect(result.status).toBe("PARTIAL");
    expect(result.errorCode).toBe("EXTRACTION_FAILED");
    expect(result.reviewFlags).toEqual(["EXTRACTION_FAILED"]);
  });

  it("점수는 missing 정책으로 계산한다: 요구기술 미확인 15, 제목 키워드로 분야 민원 → P1 25, 예산 구간 8 FTE → 20, 규모 15, 선호 10 = 85", () => {
    const result = analyze(
      buildInput("FX-01", { extraction: null, kev: null, aiUnavailableReason: "AI_UNAVAILABLE" }),
    );
    expect(result.factors.map((factor) => factor.points)).toEqual([15, 25, 20, 15, 10]);
    expect(result.score).toBe(85);
    expect(result.missingFactors).toEqual([
      { factor: "skillMatch", reason: "NO_REQUIREMENTS_EXTRACTED" },
    ]);
    expect(result.factors[1].rawValue).toMatchObject({
      bidDomain: "민원",
      selectedProjectId: "P1",
    });
    expect(result.factors[2].rawValue).toMatchObject({
      requiredFte: 8,
      requiredFteSource: "BUDGET_TIER",
    });
    expect(result.factors.flatMap((factor) => factor.evidence)).toEqual([]);
  });

  it("추출이 없으면 자격은 확인 필요(NOTICE_INFO_MISSING)라 점수 85 여도 WATCH 다", () => {
    const result = analyze(
      buildInput("FX-01", { extraction: null, kev: null, aiUnavailableReason: "AI_UNAVAILABLE" }),
    );
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.qualificationChecks).toEqual([
      expect.objectContaining({
        id: "qualifications",
        outcome: "NEEDS_REVIEW",
        reasonCode: "NOTICE_INFO_MISSING",
        evidence: [],
      }),
    ]);
    expect(result.recommendation).toBe("WATCH");
    expect(result.requirementAssessments).toEqual([]);
  });

  it("캐시된 추출은 있고 gateway 만 죽은 경우(사유 있음) → PARTIAL 이지만 추출값으로 계산한다", () => {
    const result = analyze(
      buildInput("FX-01", { kev: null, aiUnavailableReason: "AI_UNAVAILABLE" }),
    );
    expect(result.status).toBe("PARTIAL");
    expect(result.recommendationBasis).toBe("RULES_ONLY");
    expect(result.score).toBe(94);
    expect(result.recommendation).toBe("BID");
    expect(result.reviewFlags).toEqual(["AI_UNAVAILABLE"]);
  });

  it("Kev 만 없으면 PARTIAL 이 아니라 COMPLETED·RULES_ONLY 다(03 §8)", () => {
    const result = analyze(buildInput("FX-01", { kev: null }));
    expect(result.status).toBe("COMPLETED");
    expect(result.errorCode).toBeNull();
    expect(result.recommendationBasis).toBe("RULES_ONLY");
  });
});
