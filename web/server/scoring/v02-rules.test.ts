import { describe, expect, it } from "vitest";
import { skillMatch, strategicPreference } from "./factors";
import { buildInput, loadBid, loadProfile, withPatch } from "./test-support";

// sol-v0.2.0(ADR-071): 자격·업무 범위 문구는 기술 매칭에서 빠지고, 기관 선호를 정하지 않으면 분야만 본다.

describe("sol-v0.2.0 규칙", () => {
  it("요구 기술에 섞인 자격·업무 문구는 기술 매칭에서 뺀다", () => {
    const input = withPatch(buildInput("FX-01"), (draft) => {
      const field = draft.extraction?.requiredSkills;
      if (field?.value) {
        field.value = [
          "Java",
          "소프트웨어사업자(컴퓨터관련서비스사업)",
          "직접생산확인증명서(정보시스템유지관리서비스)",
          "시스템 유지관리",
          "장애 대응 및 복구",
          "VMS 연동",
        ];
      }
      if (draft.extraction) draft.extraction.preferredSkills.value = [];
    });
    const outcome = skillMatch(input.extraction, input.profile);
    expect(outcome.rawValue).toMatchObject({
      required: 2,
      matchedNames: ["Java"],
      missingNames: ["VMS 연동"],
      excludedNames: [
        "소프트웨어사업자(컴퓨터관련서비스사업)",
        "직접생산확인증명서(정보시스템유지관리서비스)",
        "시스템 유지관리",
        "장애 대응 및 복구",
      ],
    });
  });

  it("기관 선호(agencies·agencyTypes)가 비어 있으면 분야 선호만으로 계산한다", () => {
    const profile = loadProfile();
    const unset = {
      ...profile,
      preferences: { ...profile.preferences!, agencies: [], agencyTypes: [] },
    };
    const bid = loadBid("FX-01");
    const preferred = strategicPreference(bid, "민원", unset);
    const other = strategicPreference(bid, "국방", {
      ...unset,
      preferences: { ...unset.preferences, excludedDomains: [] },
    });
    expect([preferred.normalized, other.normalized]).toEqual([1, 0.5]);
    expect((preferred.rawValue as { agencyLevel: number | null }).agencyLevel).toBeNull();
  });
});
