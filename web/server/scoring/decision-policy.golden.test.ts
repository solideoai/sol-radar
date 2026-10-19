import { describe, expect, it } from "vitest";
import { SCORING_CONFIG_V0_1 } from "./analysis-input.model";
import { analyze } from "./analyze";
import { decideRecommendation } from "./decision";
import { buildInput } from "./test-support";

// 08 §5.2 결정 정책 v0.1. 입력은 규칙 결과(자격·missingFactors·점수)뿐이고 Kev 는 들어오지 않는다.
const thresholds = SCORING_CONFIG_V0_1.thresholds;
const decide = (
  qualificationStatus: "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW",
  score: number,
  missingFactorCount = 0,
) => decideRecommendation({ qualificationStatus, missingFactorCount, score, thresholds });

describe("G3 · 08 §5.2 결정 정책 — 자격이 점수를 이긴다", () => {
  it("명확히 미충족이면 점수와 무관하게 NO_BID", () => {
    expect(decide("NOT_SATISFIED", 100)).toEqual({
      recommendation: "NO_BID",
      rulePath: "MANDATORY_NOT_SATISFIED",
    });
    expect(decide("NOT_SATISFIED", 0).recommendation).toBe("NO_BID");
  });
  it("확인 필요면 점수와 무관하게 WATCH (BID 로 올라가지 않는다)", () => {
    expect(decide("NEEDS_REVIEW", 100)).toEqual({
      recommendation: "WATCH",
      rulePath: "QUALIFICATION_NEEDS_REVIEW",
    });
    expect(decide("NEEDS_REVIEW", 10).recommendation).toBe("WATCH");
  });
  it("missingFactors 2개 이상이면 점수가 높아도 WATCH, 1개면 점수대로", () => {
    expect(decide("SATISFIED", 100, 2)).toEqual({
      recommendation: "WATCH",
      rulePath: "MISSING_FACTORS",
    });
    expect(decide("SATISFIED", 100, 1).recommendation).toBe("BID");
  });
  it("경계값: 75 → BID, 74 → WATCH, 50 → WATCH, 49 → NO_BID", () => {
    expect(decide("SATISFIED", 75)).toEqual({ recommendation: "BID", rulePath: "SCORE_BID" });
    expect(decide("SATISFIED", 74)).toEqual({ recommendation: "WATCH", rulePath: "SCORE_WATCH" });
    expect(decide("SATISFIED", 50).recommendation).toBe("WATCH");
    expect(decide("SATISFIED", 49)).toEqual({ recommendation: "NO_BID", rulePath: "SCORE_NO_BID" });
    expect(decide("SATISFIED", 100).recommendation).toBe("BID");
    expect(decide("SATISFIED", 0).recommendation).toBe("NO_BID");
  });
  it("임계값은 config 에서 온다(v0.1 = 75/50)", () => {
    expect(thresholds).toEqual({ bid: 75, watch: 50, kevTau: 0.7 });
  });
});

describe("G3 · FX-03 필수 업종 자격 부족 → NO-BID, Kev BID 무시 (+FX-16 일치 사례)", () => {
  it("FX-03: 점수 68(WATCH 구간)이지만 자격 1건 미충족으로 NO_BID, MODEL_RULE_DISAGREEMENT", () => {
    const result = analyze(buildInput("FX-03"));
    expect(result.score).toBe(68);
    expect(result.score).toBeGreaterThanOrEqual(thresholds.watch);
    expect(result.recommendation).toBe("NO_BID");
    expect(result.reviewFlags).toEqual(["MODEL_RULE_DISAGREEMENT"]);
    expect(result.kev.suggestedOption).toBe("BID");
  });
  it("FX-16: 방산업체 지정 NOT_HELD → NO_BID, 국방 제외 분야 → strategicPreference 0, Kev NO_BID 일치라 상이 플래그 없음", () => {
    const result = analyze(buildInput("FX-16"));
    expect(result.qualificationStatus).toBe("NOT_SATISFIED");
    expect(result.qualificationChecks[0]).toMatchObject({
      requirementCode: "DEFENSE_CONTRACTOR",
      outcome: "NOT_SATISFIED",
    });
    expect(result.recommendation).toBe("NO_BID");
    expect(result.factors[4]).toMatchObject({
      factor: "strategicPreference",
      normalized: 0,
      points: 0,
      note: "제외 분야(국방)",
    });
    expect(result.reviewFlags).toEqual([]);
    // mandatoryRisk 0.90 ≥ 0.70 이지만 규칙이 모두 SATISFIED 가 아니므로 KEV_MANDATORY_RISK 는 붙지 않는다(08 §5.3).
    expect(result.kev.mandatoryRisk).toBe(0.9);
  });
});
