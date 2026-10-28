import { describe, expect, it } from "vitest";
import type { AnalysisInput, KevMockResponse } from "./analysis-input.model";
import { analyze } from "./analyze";
import { snapshotHash, canonicalJson } from "./snapshot-hash";
import { buildInput, withPatch } from "./test-support";

// G3·V2-06: Kev 출력은 reviewFlags 와 참고 지표(kev)만 바꾼다. 분포를 극단값(1.0/0.0)·누락·오류로 바꿔도
// 자격 판정·요소별 points·점수·권고는 byte-동일해야 한다. 규칙상 NO-BID·확인 필요를 BID 로 승격하는 경로는 없다.

const ruleOutput = (input: AnalysisInput) => {
  const result = analyze(input);
  return canonicalJson({
    score: result.score,
    factors: result.factors,
    qualificationStatus: result.qualificationStatus,
    qualificationChecks: result.qualificationChecks,
    recommendation: result.recommendation,
    missingFactors: result.missingFactors,
  });
};

const kevVariant = (
  base: KevMockResponse,
  patch: (draft: KevMockResponse) => void,
): KevMockResponse => withPatch(base, patch);

function variants(input: AnalysisInput): { name: string; input: AnalysisInput }[] {
  const base = input.kev as KevMockResponse;
  return [
    { name: "원본 Kev", input },
    {
      name: "Kev BID 확신 1.0/0.0 (승격 시도)",
      input: {
        ...input,
        kev: kevVariant(base, (kev) => {
          kev.responses.recommendation = {
            choice: "BID",
            confidence: 1,
            probabilities: { BID: 1, WATCH: 0, NO_BID: 0 },
          };
          kev.responses.mandatoryRisk.noul = 0;
          kev.responses.needsHumanReview.noul = 0;
          kev.responses.fit.score = 4;
        }),
      },
    },
    {
      name: "Kev 모든 확률 1.0 (비정상 분포)",
      input: {
        ...input,
        kev: kevVariant(base, (kev) => {
          kev.responses.recommendation.probabilities = { BID: 1, WATCH: 1, NO_BID: 1 };
          kev.responses.mandatoryRisk.noul = 1;
          kev.responses.needsHumanReview.noul = 1;
        }),
      },
    },
    {
      name: "Kev 모든 확률 0.0",
      input: {
        ...input,
        kev: kevVariant(base, (kev) => {
          kev.responses.recommendation.probabilities = { BID: 0, WATCH: 0, NO_BID: 0 };
          kev.responses.recommendation.confidence = 0;
          kev.responses.mandatoryRisk.noul = 0;
          kev.responses.needsHumanReview.noul = 0;
          kev.responses.fit.score = 0;
        }),
      },
    },
    { name: "Kev 누락(장애·비활성)", input: { ...input, kev: null } },
  ];
}

describe("G3·V2-06 · Kev 는 규칙 판정·점수·권고를 바꾸지 못한다 (FX-03·FX-16)", () => {
  for (const id of ["FX-03", "FX-16"] as const) {
    it(`${id}: Kev 변형 5종에서 점수·요소 points·자격·권고가 byte-동일하고 reviewFlags 만 달라진다`, () => {
      const base = buildInput(id);
      const expected = ruleOutput(base);
      for (const variant of variants(base)) {
        expect(ruleOutput(variant.input), variant.name).toBe(expected);
        const result = analyze(variant.input);
        expect(result.recommendation, variant.name).toBe("NO_BID");
      }
      const flagsByVariant = variants(base).map((variant) => analyze(variant.input).reviewFlags);
      expect(flagsByVariant[1]).toEqual(["MODEL_RULE_DISAGREEMENT"]);
      expect(flagsByVariant[3]).not.toContain("KEV_NEEDS_REVIEW");
      expect(flagsByVariant[4]).toEqual([]);
    });

    it(`${id}: Kev 가 없으면 RULES_ONLY·COMPLETED, 있으면 RULES_WITH_KEV_ASSIST`, () => {
      const base = buildInput(id);
      const withKev = analyze(base);
      const withoutKev = analyze({ ...base, kev: null });
      expect(withKev.recommendationBasis).toBe("RULES_WITH_KEV_ASSIST");
      expect(withoutKev).toMatchObject({
        recommendationBasis: "RULES_ONLY",
        status: "COMPLETED",
        kev: { enabled: false, suggestedOption: null },
      });
      expect(withoutKev.recommendation).toBe(withKev.recommendation);
      expect(withoutKev.score).toBe(withKev.score);
    });
  }

  it("Kev 응답이 오류(범위 밖 확률·알 수 없는 선택지)면 입력 검증이 거절하고, 판정을 바꾸는 쪽으로 해석하지 않는다", () => {
    const base = buildInput("FX-03");
    const broken = withPatch(base, (draft) => {
      (draft.kev as KevMockResponse).responses.recommendation.probabilities.BID = 1.5;
    });
    expect(() => analyze(broken)).toThrow();
    const unknownChoice = withPatch(base, (draft) => {
      (
        draft.kev as { responses: { recommendation: { choice: string } } }
      ).responses.recommendation.choice = "STRONG_BID";
    });
    expect(() => analyze(unknownChoice)).toThrow();
  });

  it("규칙 BID 에서 Kev 가 WATCH/NO_BID 를 내도 BID 유지 + MODEL_RULE_DISAGREEMENT, mandatoryRisk ≥ 0.70 이면 KEV_MANDATORY_RISK 만 추가", () => {
    const base = buildInput("FX-01");
    const result = analyze({
      ...base,
      kev: kevVariant(base.kev as KevMockResponse, (kev) => {
        kev.responses.recommendation = {
          choice: "NO_BID",
          confidence: 0.9,
          probabilities: { BID: 0.05, WATCH: 0.05, NO_BID: 0.9 },
        };
        kev.responses.mandatoryRisk.noul = 0.7;
        kev.responses.needsHumanReview.noul = 0.69;
      }),
    });
    expect(result.recommendation).toBe("BID");
    expect(result.score).toBe(94);
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(result.reviewFlags).toEqual(["MODEL_RULE_DISAGREEMENT", "KEV_MANDATORY_RISK"]);
    expect(result.explanation).toContain("결정 모델은 비추천을 제시했지만 규칙 판정이 우선");
  });

  it("Kev 임계값 경계: needsHumanReview 0.70 은 플래그, 0.699 는 아님", () => {
    const base = buildInput("FX-01");
    const at = analyze({
      ...base,
      kev: kevVariant(
        base.kev as KevMockResponse,
        (kev) => void (kev.responses.needsHumanReview.noul = 0.7),
      ),
    });
    const below = analyze({
      ...base,
      kev: kevVariant(
        base.kev as KevMockResponse,
        (kev) => void (kev.responses.needsHumanReview.noul = 0.699),
      ),
    });
    expect(at.reviewFlags).toEqual(["KEV_NEEDS_REVIEW"]);
    expect(below.reviewFlags).toEqual([]);
  });

  it("Kev 변형은 입력 스냅샷 해시를 바꾸지만(입력의 일부) 규칙 출력은 바꾸지 않는다", () => {
    const base = buildInput("FX-03");
    const hashes = variants(base).map((variant) => snapshotHash(variant.input));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(new Set(variants(base).map((variant) => ruleOutput(variant.input))).size).toBe(1);
  });
});
