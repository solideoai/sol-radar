import { describe, expect, it } from "vitest";
import type { AnalysisInput, StructuredRequirement } from "./analysis-input.model";
import { analyze } from "./analyze";
import { assessQualifications } from "./qualification";
import { buildInput, withPatch } from "./test-support";

// 08 §5.1 "API 구조화 필드 우선"(ADR-020). 같은 조건을 API 가 주면 basis=API_FIELD, 다르면 NEEDS_REVIEW(NOTICE_CONFLICTED),
// 면허제한 여러 행이면 AMBIGUOUS_MATCH(AND/OR 미확인, 15 §3 미검증 가정).

const row = (
  partial: Partial<StructuredRequirement> & Pick<StructuredRequirement, "kind">,
): StructuredRequirement => ({
  seq: 0,
  code: null,
  name: null,
  value: {},
  sourceOperation: "getBidPblancListInfoLicenseLimit",
  ...partial,
});
const assess = (input: AnalysisInput) =>
  assessQualifications({
    bid: input.bid,
    extraction: input.extraction,
    profile: input.profile,
    today: input.config.today,
  });
const withRows = (id: string, rows: StructuredRequirement[]) =>
  withPatch(buildInput(id), (draft) => void (draft.bid.structuredQualifications = rows));

describe("V2-05 · API 구조화 필드 우선", () => {
  it("API 면허제한과 추출이 같은 코드를 주면 판정 1건, basis=API_FIELD, 근거는 API_FIELD + 추출 인용", () => {
    const input = withRows("FX-01", [
      row({
        kind: "LICENSE_LIMIT",
        code: "SW_BUSINESS_REG",
        name: "소프트웨어사업자",
        value: { lcnsLmtNm: "소프트웨어사업자" },
      }),
    ]);
    const { status, checks } = assess(input);
    expect(status).toBe("SATISFIED");
    const sw = checks.filter((check) => check.requirementCode === "SW_BUSINESS_REG");
    expect(sw).toHaveLength(1);
    expect(sw[0]).toMatchObject({
      id: "structured:LICENSE_LIMIT[0]",
      basis: "API_FIELD",
      outcome: "SATISFIED",
    });
    expect(sw[0].evidence[0]).toMatchObject({
      kind: "API_FIELD",
      apiField: "lcnsLmtNm",
      apiSource: "g2b-bid-license-limit",
      documentId: null,
      quotedText: "소프트웨어사업자",
      revisionId: "FX-01#01",
    });
    expect(sw[0].evidence[1]).toMatchObject({
      quotedText: "소프트웨어사업자 신고확인서를 보유한 업체",
    });
    expect(checks.map((check) => check.requirementCode)).toEqual([
      "SW_BUSINESS_REG",
      "DIRECT_PRODUCTION",
      "SME_CONFIRMATION",
    ]);
    expect(checks.slice(1).every((check) => check.basis === "EXTRACTION")).toBe(true);
  });

  it("API 면허제한 이름만 있어도 사전 별칭으로 코드를 찾는다", () => {
    const input = withRows("FX-01", [
      row({ kind: "LICENSE_LIMIT", name: "소프트웨어사업자 신고확인서" }),
    ]);
    expect(assess(input).checks[0]).toMatchObject({
      requirementCode: "SW_BUSINESS_REG",
      basis: "API_FIELD",
      outcome: "SATISFIED",
    });
  });

  it("API 면허제한과 추출 자격이 다르면 CONFLICTED → NEEDS_REVIEW(NOTICE_CONFLICTED), 권고 WATCH", () => {
    const input = withRows("FX-01", [
      row({ kind: "LICENSE_LIMIT", code: "ICT_CONSTRUCTION", name: "정보통신공사업" }),
    ]);
    const { status, checks } = assess(input);
    expect(status).toBe("NEEDS_REVIEW");
    expect(checks[0]).toMatchObject({
      requirementCode: "ICT_CONSTRUCTION",
      basis: "API_FIELD",
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_CONFLICTED",
    });
    // 추출 쪽 면허·등록 항목도 같은 조건이라 함께 확인 필요가 된다. 인증(SME 확인서)은 영향 없다.
    expect(checks.find((check) => check.requirementCode === "SW_BUSINESS_REG")).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_CONFLICTED",
    });
    expect(checks.find((check) => check.requirementCode === "SME_CONFIRMATION")?.outcome).toBe(
      "SATISFIED",
    );
    expect(analyze(input).recommendation).toBe("WATCH");
    // 프로필에 NOT_HELD 가 있어도 상충한 조건으로 NOT_SATISFIED 를 내지 않는다.
    expect(checks.map((check) => check.outcome)).not.toContain("NOT_SATISFIED");
  });

  it("추출이 UNKNOWN 이면 API 행만으로 판정한다(basis=API_FIELD). 자격 전체는 추출 미확인으로 여전히 확인 필요", () => {
    const input = withRows("FX-04", [
      row({ kind: "LICENSE_LIMIT", code: "ICT_CONSTRUCTION", name: "정보통신공사업" }),
    ]);
    const { status, checks } = assess(input);
    expect(checks[0]).toMatchObject({ basis: "API_FIELD", outcome: "NOT_SATISFIED" });
    expect(checks[0].companyEvidence[0]).toMatchObject({
      kind: "LICENSE",
      recordKey: "licenses[5]",
    });
    expect(checks[1]).toMatchObject({
      id: "qualifications",
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
    });
    expect(status).toBe("NOT_SATISFIED");
  });

  it("면허제한 여러 행 → 각 행 NEEDS_REVIEW(AMBIGUOUS_MATCH), 추출 항목은 따로 판정", () => {
    const input = withRows("FX-01", [
      row({ kind: "LICENSE_LIMIT", seq: 0, code: "SW_BUSINESS_REG", name: "소프트웨어사업자" }),
      row({ kind: "LICENSE_LIMIT", seq: 1, code: "ICT_CONSTRUCTION", name: "정보통신공사업" }),
    ]);
    const { status, checks } = assess(input);
    expect(checks.slice(0, 2).map((check) => [check.id, check.outcome, check.reasonCode])).toEqual([
      ["structured:LICENSE_LIMIT[0]", "NEEDS_REVIEW", "AMBIGUOUS_MATCH"],
      ["structured:LICENSE_LIMIT[1]", "NEEDS_REVIEW", "AMBIGUOUS_MATCH"],
    ]);
    expect(checks).toHaveLength(5);
    expect(status).toBe("NEEDS_REVIEW");
  });

  it("사전에 없는 면허제한 값 → AMBIGUOUS_MATCH(requirementCode null)", () => {
    const input = withRows("FX-01", [row({ kind: "LICENSE_LIMIT", name: "전기공사업" })]);
    expect(assess(input).checks[0]).toMatchObject({
      requirementCode: null,
      outcome: "NEEDS_REVIEW",
      reasonCode: "AMBIGUOUS_MATCH",
    });
  });

  it("허용 업종: 회사 업종 코드 기록이 없으면 COMPANY_EVIDENCE_MISSING, NOT_HELD 면 NOT_SATISFIED, HELD 면 SATISFIED", () => {
    const base = withRows("FX-01", [
      row({
        kind: "PERMITTED_INDUSTRY",
        code: "1468",
        name: "소프트웨어사업",
        sourceOperation: "getBidPblancListInfoServc",
      }),
    ]);
    expect(assess(base).checks[0]).toMatchObject({
      basis: "API_FIELD",
      outcome: "NEEDS_REVIEW",
      reasonCode: "COMPANY_EVIDENCE_MISSING",
    });
    const held = withPatch(
      base,
      (draft) =>
        void (draft.profile.industryCodes = [
          { code: "1468", name: "소프트웨어사업", status: "HELD" },
        ]),
    );
    expect(assess(held).checks[0]).toMatchObject({
      outcome: "SATISFIED",
      companyEvidence: [{ kind: "INDUSTRY_CODE", recordKey: "industryCodes[0]" }],
    });
    const notHeld = withPatch(
      base,
      (draft) =>
        void (draft.profile.industryCodes = [
          { code: "1468", name: "소프트웨어사업", status: "NOT_HELD" },
        ]),
    );
    expect(assess(notHeld).checks[0]).toMatchObject({ outcome: "NOT_SATISFIED" });
    expect(analyze(notHeld).recommendation).toBe("NO_BID");
  });

  it("참가가능지역·지역의무공동도급은 회사 소재지 기록이 없어 COMPANY_EVIDENCE_MISSING(v0.1)", () => {
    const input = withRows("FX-01", [
      row({
        kind: "PARTICIPATION_REGION",
        name: "부산광역시",
        sourceOperation: "getBidPblancListInfoPrtcptPsblRgn",
      }),
      row({
        kind: "REGIONAL_JOINT_CONTRACT",
        name: "49%",
        sourceOperation: "getBidPblancListInfoPrtcptPsblRgn",
      }),
    ]);
    const { checks } = assess(input);
    expect(
      checks
        .slice(0, 2)
        .every(
          (check) =>
            check.outcome === "NEEDS_REVIEW" && check.reasonCode === "COMPANY_EVIDENCE_MISSING",
        ),
    ).toBe(true);
    expect(checks[0].evidence[0]).toMatchObject({
      kind: "API_FIELD",
      apiField: "prtcptPsblRgnNm",
      apiSource: "g2b-bid-region",
    });
  });
});
