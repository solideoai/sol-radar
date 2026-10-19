import { describe, expect, it } from "vitest";
import type { AnalysisInput } from "./analysis-input.model";
import { analyze } from "./analyze";
import { buildInput, withPatch } from "./test-support";

// 08 §4 missing 데이터 정책 9행. 데이터가 없을 때 점수를 올리는 쪽으로 메우지 않는다(중립 0.5 또는 보수 0.0).
// 각 행마다 normalized·points·missingFactors 기록을 한 시험으로 고정한다.

const factorOf = (id: string, factor: string, patch?: (draft: AnalysisInput) => void) => {
  const input = patch ? withPatch(buildInput(id), patch) : buildInput(id);
  const result = analyze(input);
  return { result, factor: result.factors.find((entry) => entry.factor === factor)! };
};

describe("08 §4 missing 정책 — 요소별 9행", () => {
  it("1. skillMatch: 공고에 요구기술 없음(추출 UNKNOWN) → 0.5 / 15.0 / NO_REQUIREMENTS_EXTRACTED", () => {
    const { result, factor } = factorOf("FX-04", "skillMatch");
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 15,
      missing: true,
      missingReason: "NO_REQUIREMENTS_EXTRACTED",
    });
    expect(result.missingFactors).toContainEqual({
      factor: "skillMatch",
      reason: "NO_REQUIREMENTS_EXTRACTED",
    });
  });

  it("2. skillMatch: 회사 기술 목록 비어 있음 → 0.0 / 0.0 / PROFILE_TECHNOLOGIES_EMPTY", () => {
    const { result, factor } = factorOf(
      "FX-01",
      "skillMatch",
      (draft) => void (draft.profile.technologies = []),
    );
    expect(factor).toMatchObject({
      normalized: 0,
      points: 0,
      missing: true,
      missingReason: "PROFILE_TECHNOLOGIES_EMPTY",
    });
    expect(result.missingFactors).toEqual([
      { factor: "skillMatch", reason: "PROFILE_TECHNOLOGIES_EMPTY" },
    ]);
  });

  it("3. pastPerformance: 공고 분야 미확인 → 0.5 / 12.5 / BID_DOMAIN_UNKNOWN", () => {
    // FX-05: 추출 domain UNKNOWN 이고 제목 "대국민 포털 재구축"에 키워드가 없다.
    const { factor } = factorOf("FX-05", "pastPerformance");
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 12.5,
      missing: true,
      missingReason: "BID_DOMAIN_UNKNOWN",
    });
  });

  it("4. pastPerformance: 회사 실적 0건 → 0.0 / 0.0 / PROFILE_PROJECTS_EMPTY (보수)", () => {
    const { factor } = factorOf(
      "FX-01",
      "pastPerformance",
      (draft) => void (draft.profile.pastProjects = []),
    );
    expect(factor).toMatchObject({
      normalized: 0,
      points: 0,
      missing: true,
      missingReason: "PROFILE_PROJECTS_EMPTY",
    });
  });

  it("5. staffAvailability: 필요 FTE·예산 모두 없음 → 0.5 / 10.0 / REQUIRED_FTE_UNKNOWN", () => {
    const { factor } = factorOf("FX-11", "staffAvailability", (draft) => {
      draft.extraction!.staffing = { value: null, state: "UNKNOWN", evidence: [] };
    });
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 10,
      missing: true,
      missingReason: "REQUIRED_FTE_UNKNOWN",
    });
  });

  it("6. staffAvailability: 팀 데이터 없음 → 0.5 / 10.0 / TEAM_EMPTY", () => {
    const { factor } = factorOf("FX-01", "staffAvailability", (draft) => {
      draft.team = { members: [], assignments: [], asOf: draft.team.asOf };
    });
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 10,
      missing: true,
      missingReason: "TEAM_EMPTY",
    });
  });

  it("7. scaleFit: 예산 null(FX-11) → 0.5 / 7.5 / BUDGET_UNKNOWN, missingFactors 는 1건이라 점수대로 간다", () => {
    const { result, factor } = factorOf("FX-11", "scaleFit");
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 7.5,
      missing: true,
      missingReason: "BUDGET_UNKNOWN",
    });
    expect(result.missingFactors).toEqual([{ factor: "scaleFit", reason: "BUDGET_UNKNOWN" }]);
    // 필요 인력은 추출(8 FTE)에서, 마감이 없어 일정 계수는 적용하지 않는다(08 §3.3).
    expect(result.factors[2].rawValue).toMatchObject({
      requiredFte: 8,
      requiredFteSource: "STAFFING",
      businessDays: null,
      scheduleFactor: 1,
    });
    expect(result.factors[2].missing).toBe(false);
  });

  it("8. scaleFit: 회사 실적 0건(예산은 있음) → 0.5 / 7.5 / PROFILE_PROJECTS_EMPTY", () => {
    const { factor } = factorOf(
      "FX-01",
      "scaleFit",
      (draft) => void (draft.profile.pastProjects = []),
    );
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 7.5,
      missing: true,
      missingReason: "PROFILE_PROJECTS_EMPTY",
    });
  });

  it("9. strategicPreference: 조직 선호 미설정 → 0.5 / 5.0 / PREFERENCES_NOT_SET", () => {
    const { factor } = factorOf(
      "FX-01",
      "strategicPreference",
      (draft) => void (draft.profile.preferences = null),
    );
    expect(factor).toMatchObject({
      normalized: 0.5,
      points: 5,
      missing: true,
      missingReason: "PREFERENCES_NOT_SET",
    });
  });

  it("missingFactors 2개 이상이면 점수가 75 이상이어도 BID 를 막는다(WATCH), 1개면 점수대로", () => {
    const one = analyze(
      withPatch(buildInput("FX-01"), (draft) => void (draft.profile.preferences = null)),
    );
    expect(one.missingFactors).toHaveLength(1);
    expect(one.score).toBe(89);
    expect(one.recommendation).toBe("BID");
    // 예산 null + 선호 미설정: 24 + 21.3(금액 계수 0.5) + 20 + 7.5 + 5 = 77.8 → 78 ≥ 75 인데도 WATCH.
    const two = analyze(
      withPatch(buildInput("FX-01"), (draft) => {
        draft.profile.preferences = null;
        draft.bid.budgetKrw = null;
      }),
    );
    expect(two.missingFactors.map((entry) => entry.reason)).toEqual([
      "BUDGET_UNKNOWN",
      "PREFERENCES_NOT_SET",
    ]);
    expect(two.factors.map((factor) => factor.points)).toEqual([24, 21.3, 20, 7.5, 5]);
    expect(two.score).toBe(78);
    expect(two.recommendation).toBe("WATCH");
    expect(two.explanation).toContain("비어 있는 요소가 2개 이상");
  });

  it("missing 요소는 evidence 가 비어 있고 다른 요소의 근거를 빌리지 않는다", () => {
    const { factor } = factorOf("FX-04", "skillMatch");
    expect(factor.evidence).toEqual([]);
  });
});
