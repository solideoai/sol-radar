import { describe, expect, it } from "vitest";
import { companyProfileSchema, type CompanyProfile } from "./analysis-input.model";
import { pastPerformance, scaleFit } from "./factors";
import { loadBid, loadProfile } from "./test-support";

// 공개 자료로 만든 회사 프로필은 실적의 금액·완료일을 모를 수 있다. 모르는 값은 0 이 아니라 중립으로 다룬다(sol-v0.2.0, ADR-071).

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
    candidates: {
      amountRatio: number | null;
      years: number | null;
      recency: number | null;
      evidenceFactor: number;
      similarity: number;
    }[];
  };
};

describe("금액·완료일을 모르는 실적", () => {
  it("금액·완료일을 모르면 그 항목을 빼고 아는 항목 가중치로 유사도를 낸다", () => {
    const known = candidatesOf([project({})]).candidates[0];
    const noAmount = candidatesOf([project({ amountKrw: null })]).candidates[0];
    const noDate = candidatesOf([project({ completedAt: null })]).candidates[0];
    const domainOnly = candidatesOf([project({ amountKrw: null, completedAt: null })])
      .candidates[0];
    expect(known.similarity).toBeCloseTo(((0.4 + 0.3 + 0.3) * 0.5) / 1);
    expect(noAmount.amountRatio).toBeNull();
    expect(noAmount.similarity).toBeCloseTo(((0.4 + 0.3) / 0.7) * 0.5);
    expect([noDate.recency, noDate.years]).toEqual([null, null]);
    expect(domainOnly.similarity).toBeCloseTo(0.5);
    const otherDomain = pastPerformance(
      "교육",
      1_000_000_000,
      profileWith([project({ amountKrw: null, completedAt: null })]),
      TODAY,
      [],
    );
    expect(otherDomain.normalized).toBe(0);
  });

  it("evidenceRef 가 없어도 공개 출처(sourceIds)가 있으면 증빙으로 인정한다", () => {
    const { candidates } = candidatesOf([
      project({ id: "A" }),
      project({ id: "B", sourceIds: ["S1"] }),
    ]);
    expect(candidates.map((entry) => entry.evidenceFactor)).toEqual([0.5, 1.0]);
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

  it("모든 금액이 null 이면 규모 적합성은 연 매출 대비 예산으로 본다", () => {
    const bid = { ...loadBid("FX-01"), budgetKrw: "3000000000" };
    const revenueOf = (annualRevenueKrw: string) => ({
      ...profileWith([project({ amountKrw: null })]),
      financials: { fiscalYear: 2025, annualRevenueKrw },
    });
    const ratios = ["30000000000", "10000000000", "5000000000"].map((revenue) => {
      const outcome = scaleFit(bid, null, revenueOf(revenue));
      return [outcome.normalized, outcome.missingReason];
    });
    expect(ratios).toEqual([
      [1.0, null],
      [0.6, null],
      [0.2, null],
    ]);
  });

  it("금액 아는 실적도 매출도 없으면 규모 적합성은 중립 0.5", () => {
    const profile = { ...profileWith([project({ amountKrw: null })]), financials: null };
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
