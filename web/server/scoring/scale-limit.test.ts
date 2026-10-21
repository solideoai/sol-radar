import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { buildInput, withPatch } from "./test-support";

// FX-15: 예산 80억 > 단일 사업 수행 상한 50억 → scaleFit 0 + SCALE_LIMIT_EXCEEDED, 68 WATCH (08 §3.4, 11 §3.1).

describe("FX-15 · 수행 상한 초과 → scaleFit 0점 + SCALE_LIMIT_EXCEEDED", () => {
  it("상한 초과면 normalized 0·points 0·플래그, 점수 68, WATCH. 플래그가 권고를 직접 바꾸지 않는다", () => {
    const result = analyze(buildInput("FX-15"));
    const scale = result.factors[3];
    expect(scale).toMatchObject({
      factor: "scaleFit",
      normalized: 0,
      points: 0,
      missing: false,
      note: "단일 사업 수행 상한 초과",
    });
    expect(scale.rawValue).toMatchObject({
      budgetKrw: "8000000000",
      maxContractKrw: "5000000000",
      limitExceeded: true,
    });
    expect(result.reviewFlags).toContain("SCALE_LIMIT_EXCEEDED");
    expect(result.factors.map((factor) => factor.points)).toEqual([20, 20.1, 20, 0, 8]);
    expect(result.score).toBe(68);
    expect(result.recommendation).toBe("WATCH");
    expect(result.qualificationStatus).toBe("SATISFIED");
    expect(result.explanation).toContain("수행 상한을 넘어");
  });

  it("상한이 없으면 플래그 없이 비율만 계산한다(80억/28억 = 2.86 → 0.6)", () => {
    const result = analyze(
      withPatch(
        buildInput("FX-15"),
        (draft) => void delete draft.profile.financials!.maxContractKrw,
      ),
    );
    expect(result.factors[3]).toMatchObject({ normalized: 0.6, points: 9, missing: false });
    expect(result.reviewFlags).not.toContain("SCALE_LIMIT_EXCEEDED");
  });

  it("상한과 같은 금액은 초과가 아니다(경계)", () => {
    const result = analyze(
      withPatch(buildInput("FX-15"), (draft) => void (draft.bid.budgetKrw = "5000000000")),
    );
    expect(result.reviewFlags).not.toContain("SCALE_LIMIT_EXCEEDED");
    expect(result.factors[3].rawValue).toMatchObject({ limitExceeded: false });
  });

  it("비율 구간: ≤1.5 → 1.0, ≤3 → 0.6, >3 → 0.2", () => {
    const at = (budgetKrw: string) =>
      analyze(withPatch(buildInput("FX-01"), (draft) => void (draft.bid.budgetKrw = budgetKrw)))
        .factors[3].normalized;
    expect(at("4200000000")).toBe(1); // 28억 × 1.5
    expect(at("4200000001")).toBe(0.6);
    expect(at("5000000000")).toBe(0.6); // 상한과 같음
  });
});
