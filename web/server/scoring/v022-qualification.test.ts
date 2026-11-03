import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { buildInput, withPatch } from "./test-support";

// sol-v0.2.2(ADR-071 개정): 공고 인용을 찾지 못한 추출 자격이라도 회사가 보유(HELD)하면 충족이다.
// 요건이 실제로 있든 없든 회사가 이미 가졌으니 권고를 막을 이유가 없다(2026-11-03 운영 점검, 75점 이상 보류 54건).
// 회사가 보유하지 않았거나 기록이 없으면 공고 근거가 없으므로 지금처럼 확인 필요다(미충족은 양쪽 근거가 있을 때만).

const withoutCitations = (extraNames: { name: string; kind: "REGISTRATION" }[] = []) =>
  withPatch(buildInput("FX-01"), (draft) => {
    const field = draft.extraction?.qualifications;
    if (!field?.value) throw new Error("FX-01 추출에 자격 목록이 없음");
    field.value.push(...extraNames.map((entry) => ({ ...entry, mandatory: true, code: null })));
    // 운영에서 본 모양: 인용은 있지만 항목 이름이 인용 문장에 없고 항목 수와 인용 수가 달라 항목에 붙지 않는다.
    field.evidence = [{ ...field.evidence[0], quotedText: "입찰 참가 자격은 입찰공고문에 따른다" }];
    field.note = "";
  });

const extractionOutcomes = (result: ReturnType<typeof analyze>) =>
  result.qualificationChecks
    .filter((check) => check.basis === "EXTRACTION")
    .map((check) => [check.requirementCode, check.outcome, check.reasonCode]);

describe("sol-v0.2.2 인용 없는 자격", () => {
  it("회사가 보유한 자격은 공고 인용이 없어도 충족이고 점수대로 추천이다", () => {
    const result = analyze(withoutCitations());
    expect(extractionOutcomes(result)).toEqual([
      ["SW_BUSINESS_REG", "SATISFIED", null],
      ["DIRECT_PRODUCTION", "SATISFIED", null],
      ["SME_CONFIRMATION", "SATISFIED", null],
    ]);
    expect(result.recommendation).toBe("BID");
  });

  it("회사가 보유하지 않은 자격은 공고 근거가 없으니 미충족이 아니라 확인 필요다", () => {
    const result = analyze(
      withoutCitations([{ name: "정보통신공사업 등록", kind: "REGISTRATION" }]),
    );
    expect(extractionOutcomes(result).at(-1)).toEqual([
      "ICT_CONSTRUCTION",
      "NEEDS_REVIEW",
      "NOTICE_INFO_MISSING",
    ]);
    expect(result.recommendation).toBe("WATCH");
  });
});
