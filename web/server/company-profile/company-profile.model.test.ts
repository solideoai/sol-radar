import { describe, expect, it } from "vitest";
import {
  CompanyProfileDataError,
  latestRetrievedAt,
  sortProjectsForDisplay,
  toCompanyProfile,
  type CompanyProfileRow,
} from "./company-profile.model";
import type { ProfileSource } from "./company-profile.model";
import { PROFILE_ROW } from "./company-profile.test-data";
import { profileSourceSchema } from "./company-profile.model";

const SOURCE: ProfileSource = {
  id: "S1",
  kind: "PUBLIC",
  title: "나라장터 계약 정보",
  url: "https://www.g2b.go.kr",
  retrievedAt: "2026-10-20",
};

const rowWith = (patch: Partial<CompanyProfileRow>): CompanyProfileRow => ({
  ...PROFILE_ROW,
  ...patch,
});

const project = (id: string, name: string, completedAt: string | null) => ({
  id,
  name,
  domain: "민원",
  amountKrw: null,
  completedAt,
});

describe("toCompanyProfile 출처·공개 이력", () => {
  it("sources·public_history 를 파싱해 CompanyProfile 에 싣는다", () => {
    const history = [{ year: 2024, kind: "CERTIFICATION", name: "ISO 27001", sourceIds: ["S1"] }];
    const profile = toCompanyProfile(rowWith({ sources: [SOURCE], public_history: history }));
    expect(profile.sources).toEqual([SOURCE]);
    expect(profile.publicHistory).toEqual(history);
  });

  it("sources 모양이 틀리면 CompanyProfileDataError", () => {
    const broken = [{ ...SOURCE, kind: "UNKNOWN" }];
    expect(() => toCompanyProfile(rowWith({ sources: broken }))).toThrow(CompanyProfileDataError);
    expect(() => toCompanyProfile(rowWith({ public_history: [{ year: "2024" }] }))).toThrow(
      CompanyProfileDataError,
    );
  });
});

describe("sortProjectsForDisplay", () => {
  it("완료일 null 을 맨 아래로, null 끼리는 이름순", () => {
    const sorted = sortProjectsForDisplay([
      project("a", "다", null),
      project("b", "나", "2023-01-01"),
      project("c", "가", null),
      project("d", "라", "2025-05-05"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["d", "b", "c", "a"]);
  });
});

describe("latestRetrievedAt", () => {
  it("가장 늦은 확인일, 출처가 없으면 null", () => {
    expect(latestRetrievedAt([])).toBeNull();
    expect(
      latestRetrievedAt([
        { ...SOURCE, retrievedAt: "2026-10-01" },
        { ...SOURCE, id: "S2", retrievedAt: "2026-10-25" },
        { ...SOURCE, id: "S3", retrievedAt: "2026-09-30" },
      ]),
    ).toBe("2026-10-25");
  });
});

describe("profileSourceSchema url", () => {
  it.each(["javascript:alert(1)", "data:text/html,x"])("%s 를 거부한다", (url) => {
    expect(profileSourceSchema.safeParse({ ...SOURCE, url }).success).toBe(false);
  });

  it.each(["not a url", "", "www.g2b.go.kr"])("%j 는 예외 없이 실패를 돌려준다", (url) => {
    expect(() => profileSourceSchema.safeParse({ ...SOURCE, url })).not.toThrow();
    expect(profileSourceSchema.safeParse({ ...SOURCE, url }).success).toBe(false);
  });

  it.each(["https://example.com/a", null])("%s 를 받는다", (url) => {
    expect(profileSourceSchema.safeParse({ ...SOURCE, url }).success).toBe(true);
  });
});
