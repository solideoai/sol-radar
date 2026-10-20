import { describe, expect, it } from "vitest";
import {
  CompanyProfileDataError,
  toCompanyProfile,
  toCompanyProfileSummary,
} from "./company-profile.model";
import { AUTHOR_ID, ORG_ID, PROFILE_ROW, SUMMARY_ROWS } from "./company-profile.test-data";

describe("toCompanyProfile", () => {
  it("DB 행을 05 §4.4 모양으로 옮기고 JSONB 는 점수 엔진 모양 그대로 둔다", () => {
    const profile = toCompanyProfile(PROFILE_ROW);
    expect(profile).toMatchObject({
      id: PROFILE_ROW.id,
      orgId: ORG_ID,
      revision: 2,
      name: "솔리데오",
      isDemo: true,
      technologiesComplete: true,
      industryCodes: [],
      effectiveAt: PROFILE_ROW.effective_at,
      createdBy: { id: AUTHOR_ID, name: "관리자" },
      note: PROFILE_ROW.note,
    });
    expect(profile.technologies.map((technology) => technology.name)).toEqual([
      "Java",
      "Spring Boot",
      "Kubernetes",
    ]);
    expect(profile.licenses[1]).toEqual({ code: "ISMS_P", name: "ISMS-P", status: "NOT_HELD" });
    expect(profile.pastProjects[0]).toMatchObject({ id: "P1", completedAt: "2024-11-30" });
    expect(profile.financials?.maxContractKrw).toBe("5000000000");
    expect(profile.preferences?.excludedDomains).toEqual(["국방"]);
  });

  it("이름 없는 작성자는 이메일 앞부분, 지워진 작성자는 null 이다", () => {
    expect(
      toCompanyProfile({
        ...PROFILE_ROW,
        creator: { display_name: null, email: "sales@soltech.invalid" },
      }).createdBy,
    ).toEqual({ id: AUTHOR_ID, name: "sales" });
    expect(toCompanyProfile({ ...PROFILE_ROW, created_by: null, creator: null }).createdBy).toBe(
      null,
    );
  });

  it("빈 프로필(org-02 격리 조직)도 읽는다", () => {
    const profile = toCompanyProfile({
      ...PROFILE_ROW,
      technologies: [],
      technologies_complete: false,
      licenses: [],
      past_projects: [],
      financials: null,
      preferences: null,
    });
    expect(profile).toMatchObject({
      technologies: [],
      licenses: [],
      pastProjects: [],
      financials: null,
      preferences: null,
    });
  });

  it.each([
    ["자격 상태가 HELD·NOT_HELD 밖", { licenses: [{ code: "X", name: "X", status: "MAYBE" }] }],
    ["실적 금액이 숫자 문자열이 아님", { past_projects: [{ ...pastProject(), amountKrw: 12 }] }],
    ["기술 목록이 배열이 아님", { technologies: { name: "Java" } }],
  ])("저장 값이 점수 엔진 스키마와 다르면(%s) 던진다", (_, override) => {
    expect(() => toCompanyProfile({ ...PROFILE_ROW, ...override })).toThrow(
      CompanyProfileDataError,
    );
  });
});

function pastProject() {
  const [first] = PROFILE_ROW.past_projects as Record<string, unknown>[];
  return first;
}

describe("toCompanyProfileSummary", () => {
  it("revision 이력 행을 요약으로 옮긴다", () => {
    expect(SUMMARY_ROWS.map(toCompanyProfileSummary)).toEqual([
      {
        id: SUMMARY_ROWS[0].id,
        revision: 2,
        effectiveAt: SUMMARY_ROWS[0].effective_at,
        createdBy: { id: AUTHOR_ID, name: "관리자" },
        createdAt: SUMMARY_ROWS[0].created_at,
        note: SUMMARY_ROWS[0].note,
      },
      {
        id: SUMMARY_ROWS[1].id,
        revision: 1,
        effectiveAt: SUMMARY_ROWS[1].effective_at,
        createdBy: null,
        createdAt: SUMMARY_ROWS[1].created_at,
        note: SUMMARY_ROWS[1].note,
      },
    ]);
  });
});
