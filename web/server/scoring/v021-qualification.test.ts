import { describe, expect, it } from "vitest";
import {
  ALGORITHM_VERSION,
  analysisInputSchema,
  type StructuredRequirement,
} from "./analysis-input.model";
import { analyze } from "./analyze";
import { resolveQualificationCode } from "./qualification-codes";
import { buildInput, withPatch } from "./test-support";
import { whatIf } from "./what-if";

// sol-v0.2.1(ADR-071 개정): 점수는 그대로이고 자격 판정만 바뀐다.
// 운영 공고 표기 별칭(2026-10-30 실측)과, 면허제한 여러 행을 모두 보유한 경우.

const license = (seq: number, code: string, name: string): StructuredRequirement => ({
  kind: "LICENSE_LIMIT",
  seq,
  code,
  name,
  value: {},
  sourceOperation: "test",
});

const withLicenseRows = (rows: StructuredRequirement[]) =>
  withPatch(buildInput("FX-01"), (draft) => {
    draft.bid.structuredQualifications = rows;
    draft.bid.auxLookup = { status: "OK", failed: [] };
  });

const structuredOf = (rows: StructuredRequirement[]) =>
  analyze(withLicenseRows(rows))
    .qualificationChecks.filter((check) => check.id.startsWith("structured:"))
    .map((check) => [check.requirementCode, check.outcome, check.reasonCode]);

const SW_SERVICE = license(1, "1468", "소프트웨어사업자(컴퓨터관련서비스사업)");
const SW_PACKAGE = license(2, "1426", "소프트웨어사업자(패키지소프트웨어개발.공급사업)");
const ICT = license(2, "0036", "정보통신공사업");

describe("sol-v0.2.1 자격 판정", () => {
  it("중소기업·소상공인 확인서 표기는 중소기업확인서로 읽고, 소기업·소상공인 확인서는 사람이 본다", () => {
    for (const name of [
      "중소기업·소상공인 확인서",
      "중·소기업·소상공인 확인서 소지",
      "중소기업ᆞ소상공인 확인서",
      "중소기업/소상공인확인서",
      "중·소기업 또는 소상공인 확인서",
    ])
      expect(resolveQualificationCode(null, name), name).toBe("SME_CONFIRMATION");
    expect(resolveQualificationCode(null, "직접생산증명서")).toBe("DIRECT_PRODUCTION");
    for (const name of ["소기업·소상공인 확인서", "소기업 또는 소상공인 확인서"])
      expect(resolveQualificationCode(null, name), name).toBeNull();
  });

  it("면허제한 여러 행을 모두 보유하면 충족이고, 같은 코드의 추출 자격은 그 행에 합친다", () => {
    expect(structuredOf([SW_SERVICE, SW_PACKAGE])).toEqual([
      ["SW_BUSINESS_REG", "SATISFIED", null],
      ["SW_BUSINESS_REG", "SATISFIED", null],
    ]);
    const ids = analyze(withLicenseRows([SW_SERVICE, SW_PACKAGE])).qualificationChecks.map(
      (check) => check.requirementCode,
    );
    expect(ids.filter((code) => code === "SW_BUSINESS_REG")).toHaveLength(2);
  });

  it("면허제한 여러 행 가운데 회사 기록이 없는 행이 있으면 AND/OR 를 모르니 사람 확인이다", () => {
    // 시험 회사 프로필에는 정보통신공사업 기록이 없다.
    expect(structuredOf([SW_SERVICE, ICT])).toEqual([
      ["SW_BUSINESS_REG", "NEEDS_REVIEW", "AMBIGUOUS_MATCH"],
      ["ICT_CONSTRUCTION", "NEEDS_REVIEW", "AMBIGUOUS_MATCH"],
    ]);
  });

  it("sol-v0.2.0 으로 저장된 스냅샷도 읽고 현재 규칙으로 계산한다", () => {
    const input = buildInput("FX-01");
    const stored = JSON.parse(
      JSON.stringify({ ...input, config: { ...input.config, algorithmVersion: "sol-v0.2.0" } }),
    ) as unknown;
    expect(whatIf(stored, [])?.ok).toBe(true);
    expect(analyze(analysisInputSchema.parse(stored)).algorithmVersion).toBe(ALGORITHM_VERSION);
  });
});
