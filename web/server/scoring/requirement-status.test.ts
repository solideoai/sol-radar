import { describe, expect, it } from "vitest";
import type { AnalysisInput } from "./analysis-input.model";
import { analyze } from "./analyze";
import { assessQualifications } from "./qualification";
import { assessSkillRequirements } from "./requirement-assessment";
import { buildInput, withPatch } from "./test-support";

// V2-05: 정보 부족 ≠ 미충족 (08 §5.1, ADR-020 P0-5).
// 공고 쪽 UNKNOWN·CONFLICTED → NEEDS_REVIEW + NOTICE_INFO_MISSING·NOTICE_CONFLICTED.
// 회사 기록 없음·technologiesComplete=false → NEEDS_REVIEW + COMPANY_EVIDENCE_MISSING.
// NOT_SATISFIED 에는 공고 근거 1건 이상과 회사 쪽 명시적 부정 근거 1건 이상. NEEDS_REVIEW 에는 사유 코드가 반드시 있다.

const assess = (input: AnalysisInput) =>
  assessQualifications({
    bid: input.bid,
    extraction: input.extraction,
    profile: input.profile,
    today: input.config.today,
  });

describe("V2-05 · 공고 쪽 정보 부족", () => {
  it("qualifications UNKNOWN → NEEDS_REVIEW(NOTICE_INFO_MISSING), NOT_SATISFIED 아님", () => {
    const { status, checks } = assess(buildInput("FX-04"));
    expect(status).toBe("NEEDS_REVIEW");
    expect(checks.map((check) => check.outcome)).not.toContain("NOT_SATISFIED");
    expect(checks[0].reasonCode).toBe("NOTICE_INFO_MISSING");
  });

  it("qualifications CONFLICTED → NEEDS_REVIEW(NOTICE_CONFLICTED), 상충한 인용은 근거로 남긴다", () => {
    const input = withPatch(buildInput("FX-01"), (draft) => {
      const field = draft.extraction!.qualifications;
      draft.extraction!.qualifications = {
        value: null,
        state: "CONFLICTED",
        evidence: field.evidence.slice(0, 2),
        note: "본문과 첨부의 자격 요건이 다름",
      };
    });
    const { status, checks } = assess(input);
    expect(status).toBe("NEEDS_REVIEW");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ outcome: "NEEDS_REVIEW", reasonCode: "NOTICE_CONFLICTED" });
    expect(checks[0].evidence).toHaveLength(2);
    expect(analyze(input).recommendation).toBe("WATCH");
  });

  it("KNOWN 인데 인용이 항목과 짝지어지지 않으면 그 항목은 NOTICE_INFO_MISSING", () => {
    const input = withPatch(buildInput("FX-01"), (draft) => {
      const field = draft.extraction!.qualifications;
      field.value!.push({
        name: "방산업체 지정",
        kind: "REGISTRATION",
        mandatory: true,
        code: null,
      });
      field.note = "[0]→evidence[0], [1]→evidence[1], [2]→evidence[2]";
    });
    const { checks } = assess(input);
    expect(checks[3]).toMatchObject({
      requirementCode: "DEFENSE_CONTRACTOR",
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
    });
  });

  it("발주계획(stage=PLAN, FX-17) → 모든 항목 NEEDS_REVIEW(STAGE_NOT_APPLICABLE), 권고 WATCH", () => {
    const result = analyze(buildInput("FX-17"));
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(
      result.qualificationChecks.every(
        (check) => check.outcome === "NEEDS_REVIEW" && check.reasonCode === "STAGE_NOT_APPLICABLE",
      ),
    ).toBe(true);
    expect(result.recommendation).toBe("WATCH");
  });

  it("stage=PLAN 은 추출된 자격 항목이 있어도 전부 STAGE_NOT_APPLICABLE 로 둔다(NOT_SATISFIED 를 내지 않는다)", () => {
    const input = withPatch(buildInput("FX-03"), (draft) => void (draft.bid.stage = "PLAN"));
    const { status, checks } = assess(input);
    expect(status).toBe("NEEDS_REVIEW");
    expect(checks.map((check) => [check.requirementCode, check.outcome, check.reasonCode])).toEqual(
      [
        ["SW_BUSINESS_REG", "NEEDS_REVIEW", "STAGE_NOT_APPLICABLE"],
        ["ICT_CONSTRUCTION", "NEEDS_REVIEW", "STAGE_NOT_APPLICABLE"],
      ],
    );
  });

  it("injectionSuspected=true 면 자격 종합은 NEEDS_REVIEW 이고 INJECTION_SUSPECTED 플래그가 붙는다", () => {
    const result = analyze(
      withPatch(buildInput("FX-01"), (draft) => void (draft.extraction!.injectionSuspected = true)),
    );
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.recommendation).toBe("WATCH");
    expect(result.reviewFlags).toContain("INJECTION_SUSPECTED");
    expect(result.injectionSuspected).toBe(true);
  });
});

describe("V2-05 · 회사 쪽 정보 부족", () => {
  it("면허 기록이 아예 없으면(NOT_HELD 도 HELD 도 아님) NEEDS_REVIEW(COMPANY_EVIDENCE_MISSING) → FX-03 이 WATCH 가 된다", () => {
    const input = withPatch(buildInput("FX-03"), (draft) => {
      draft.profile.licenses = draft.profile.licenses.filter(
        (license) => license.code !== "ICT_CONSTRUCTION",
      );
    });
    const result = analyze(input);
    const ict = result.qualificationChecks.find(
      (check) => check.requirementCode === "ICT_CONSTRUCTION",
    );
    expect(ict).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "COMPANY_EVIDENCE_MISSING",
      companyEvidence: [],
    });
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.recommendation).toBe("WATCH");
    expect(result.score).toBe(68);
  });

  it("유효기간이 지난 HELD 면허는 미충족이 아니라 확인 필요다", () => {
    const input = withPatch(buildInput("FX-01"), (draft) => {
      draft.profile.licenses[0].validUntil = "2026-10-15";
    });
    const { checks } = assess(input);
    expect(checks[0]).toMatchObject({
      requirementCode: "SW_BUSINESS_REG",
      outcome: "NEEDS_REVIEW",
      reasonCode: "COMPANY_EVIDENCE_MISSING",
    });
    const valid = withPatch(
      input,
      (draft) => void (draft.profile.licenses[0].validUntil = "2026-10-16"),
    );
    expect(assess(valid).checks[0].outcome).toBe("SATISFIED");
  });

  it("사전 밖 자격(code=null, 별칭 없음) → NEEDS_REVIEW(AMBIGUOUS_MATCH), requirementCode null", () => {
    const input = withPatch(buildInput("FX-01"), (draft) => {
      draft.extraction!.qualifications.value![0] = {
        name: "우주산업 참여기업 확인서",
        kind: "CERTIFICATION",
        mandatory: true,
        code: null,
      };
    });
    const { checks } = assess(input);
    expect(checks[0]).toMatchObject({
      requirementCode: null,
      outcome: "NEEDS_REVIEW",
      reasonCode: "AMBIGUOUS_MATCH",
    });
  });

  it("기술 항목: 별칭으로 맞으면 SATISFIED, technologiesComplete=true 목록에 없으면 NOT_SATISFIED(양쪽 근거), false 면 COMPANY_EVIDENCE_MISSING", () => {
    const input = buildInput("FX-02");
    const complete = assessSkillRequirements(input.extraction, input.profile);
    expect(complete.map((item) => [item.itemId, item.ruleStatus, item.ruleReason])).toEqual([
      ["requiredSkills[0]", "SATISFIED", null],
      ["requiredSkills[1]", "SATISFIED", null],
      ["requiredSkills[2]", "SATISFIED", null],
      ["requiredSkills[3]", "NOT_SATISFIED", null],
      ["requiredSkills[4]", "NOT_SATISFIED", null],
      ["requiredSkills[5]", "NOT_SATISFIED", null],
    ]);
    for (const item of complete.filter((entry) => entry.ruleStatus === "NOT_SATISFIED")) {
      expect(item.noticeEvidence.length).toBeGreaterThan(0);
      expect(item.companyEvidence.length).toBeGreaterThan(0);
      expect(item.companyEvidence[0]).toMatchObject({
        kind: "TECHNOLOGY",
        recordKey: "technologiesComplete",
      });
    }
    const incomplete = assessSkillRequirements(input.extraction, {
      ...input.profile,
      technologiesComplete: false,
    });
    expect(incomplete[3]).toMatchObject({
      ruleStatus: "NEEDS_REVIEW",
      ruleReason: "COMPANY_EVIDENCE_MISSING",
      companyEvidence: [],
    });
    const alias = assessSkillRequirements(
      withPatch(input.extraction!, (draft) => void (draft.requiredSkills.value![2] = "Postgres")),
      input.profile,
    );
    expect(alias[2]).toMatchObject({
      ruleStatus: "SATISFIED",
      companyEvidence: [{ kind: "TECHNOLOGY", recordKey: "technologies[5]" }],
    });
  });

  it("기술 항목 판정은 점수(skillMatch)·권고를 바꾸지 않는다", () => {
    const input = buildInput("FX-02");
    const complete = analyze(input);
    const incomplete = analyze({
      ...input,
      profile: { ...input.profile, technologiesComplete: false },
    });
    expect(incomplete.score).toBe(complete.score);
    expect(incomplete.factors).toEqual(complete.factors);
    expect(incomplete.recommendation).toBe(complete.recommendation);
    expect(incomplete.requirementAssessments).not.toEqual(complete.requirementAssessments);
  });
});

describe("V2-05 · 판정 불변식 (fixture 전체)", () => {
  const ids = ["FX-01", "FX-02", "FX-03", "FX-04", "FX-05", "FX-11", "FX-15", "FX-16", "FX-17"];
  it("NOT_SATISFIED 는 공고 근거 ≥1 과 회사 쪽 명시적 부정 근거 ≥1 이 둘 다 있을 때만", () => {
    for (const id of ids) {
      const result = analyze(buildInput(id));
      for (const check of result.qualificationChecks.filter(
        (entry) => entry.outcome === "NOT_SATISFIED",
      )) {
        expect(check.evidence.length, `${id} ${check.id}`).toBeGreaterThan(0);
        expect(check.companyEvidence.length, `${id} ${check.id}`).toBeGreaterThan(0);
        expect(check.companyEvidence[0].quotedText, `${id} ${check.id}`).toContain("NOT_HELD");
      }
    }
  });
  it("NEEDS_REVIEW 에는 사유 코드가 반드시 있고, 다른 결과에는 없다", () => {
    for (const id of ids) {
      const result = analyze(buildInput(id));
      for (const check of result.qualificationChecks) {
        if (check.outcome === "NEEDS_REVIEW")
          expect(check.reasonCode, `${id} ${check.id}`).not.toBeNull();
        else expect(check.reasonCode, `${id} ${check.id}`).toBeNull();
      }
    }
  });
  it("NOT_SATISFIED 를 양쪽 근거 없이 만들려 하면 코드가 거부한다(불변식 가드)", () => {
    const input = withPatch(buildInput("FX-03"), (draft) => {
      // 회사 쪽 NOT_HELD 는 있지만 공고 쪽 인용을 비운다 → 미충족이 아니라 정보 부족
      draft.extraction!.qualifications.evidence = [draft.extraction!.qualifications.evidence[0]];
      draft.extraction!.qualifications.note = "[0]→evidence[0]";
    });
    const { checks } = assess(input);
    expect(checks[1]).toMatchObject({
      requirementCode: "ICT_CONSTRUCTION",
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
    });
  });
});
