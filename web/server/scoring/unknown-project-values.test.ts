import { describe, expect, it } from "vitest";
import { companyProfileSchema, type CompanyProfile } from "./analysis-input.model";
import { pastPerformance, scaleFit } from "./factors";
import { loadBid, loadProfile } from "./test-support";

// 공개 자료로 만든 회사 프로필은 실적의 금액·완료일을 모를 수 있다. 모르는 값은 0 이 아니라 중립으로 다룬다.

const TODAY = "2026-10-16";

type Project = CompanyProfile["pastProjects"][number];

const project = (patch: Partial<Project>): Project => ({
  id: "P-X",
  name: "시험 사업",
  domain: "민원",
  amountKrw: "1000000000",
  completedAt: "2025-01-01",
  evidenceRef: null,
  ...patch,
});

const profileWith = (pastProjects: Project[]): CompanyProfile => ({
  ...loadProfile(),
  pastProjects,
});

const candidatesOf = (projects: Project[], budget: number | null = 1_000_000_000) => {
  const outcome = pastPerformance("민원", budget, profileWith(projects), TODAY, []);
  return outcome.rawValue as {
    candidates: { amountRatio: number; years: number | null; recency: number }[];
  };
};

describe("금액·완료일을 모르는 실적", () => {
  it("금액이 null 인 실적은 금액비 0.5", () => {
    const { candidates } = candidatesOf([project({ amountKrw: null })]);
    expect(candidates[0].amountRatio).toBe(0.5);
  });

  it("완료일이 null 인 실적은 최근성 0.2 이고 years 는 null", () => {
    const { candidates } = candidatesOf([project({ completedAt: null })]);
    expect(candidates[0].recency).toBe(0.2);
    expect(candidates[0].years).toBeNull();
  });

  it("규모 적합성은 null 금액을 최대 실적에서 뺀다", () => {
    const profile = profileWith([
      project({ id: "A", amountKrw: null }),
      project({ id: "B", amountKrw: "1000000000" }),
    ]);
    const outcome = scaleFit(loadBid("FX-01"), null, profile);
    expect((outcome.rawValue as { largestPastKrw: string | null }).largestPastKrw).toBe(
      "1000000000",
    );
  });

  it("모든 금액이 null 이면 규모 적합성은 중립 0.5", () => {
    const profile = profileWith([project({ amountKrw: null })]);
    const outcome = scaleFit(loadBid("FX-01"), null, profile);
    expect(outcome.normalized).toBe(0.5);
    expect(outcome.missingReason).toBe("PROFILE_PROJECTS_EMPTY");
  });

  it("sourceIds·note 가 붙은 프로필도 파싱되고 기존 fixture 파싱 결과는 바뀌지 않는다", () => {
    const fixture = loadProfile();
    const base = companyProfileSchema.parse(fixture);
    expect(companyProfileSchema.parse(base)).toEqual(base);
    expect(JSON.stringify(base)).not.toMatch(/sourceIds|"note"/);
    const enriched = {
      ...fixture,
      technologies: fixture.technologies.map((entry) => ({ ...entry, sourceIds: ["S1"] })),
      pastProjects: [
        {
          id: "P-N",
          name: "공개 실적",
          domain: "민원",
          amountKrw: null,
          completedAt: null,
          note: "공개 자료에 금액 없음",
          sourceIds: ["S1"],
        },
      ],
      financials: { fiscalYear: 2025, note: "추정", sourceIds: ["S2"] },
    };
    const parsed = companyProfileSchema.parse(enriched);
    expect(parsed.pastProjects[0].note).toBe("공개 자료에 금액 없음");
    expect(parsed.financials?.sourceIds).toEqual(["S2"]);
  });
});
