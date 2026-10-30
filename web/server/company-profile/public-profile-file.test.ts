import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileSourceSchema, publicHistoryEntrySchema } from "@/server/company-profile";
import { companyProfileSchema, DOMAINS } from "@/server/scoring";
import { z } from "zod";

// 저장소 루트 기준 경로. 이 파일은 web/server/company-profile/ 에 있으므로 import.meta.dirname 에서 세 단계 위가 루트다.
const FILE = path.resolve(
  import.meta.dirname,
  "../../../docs/evidence/company-public-profile/20261030/profile.json",
);

const documentSchema = z.object({
  note: z.string().min(1),
  profile: companyProfileSchema,
  sources: z.array(profileSourceSchema),
  publicHistory: z.array(publicHistoryEntrySchema),
});

const load = () => documentSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));

type ProfileDocument = z.infer<typeof documentSchema>;

// 출처 규칙: 모든 항목에 존재하는 sourceIds 가 있고, HELD 자격·업종은 근거 있는 출처를 가리키며, 실적 domain 은 DOMAINS 값이다.
// CLI(scripts/ops/company-profile.mjs 의 findSourceProblems)와 같은 규칙에 domain 검사를 더한다.
const sourceProblems = ({ profile, sources, publicHistory }: ProfileDocument): string[] => {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const domains: readonly string[] = DOMAINS;
  const items: { label: string; ids: string[] | undefined; held?: boolean }[] = [
    ...profile.technologies.map((item) => ({ label: `기술 ${item.name}`, ids: item.sourceIds })),
    ...profile.licenses.map((item) => ({
      label: `자격 ${item.name}`,
      ids: item.sourceIds,
      held: item.status === "HELD",
    })),
    ...profile.industryCodes.map((item) => ({
      label: `업종 ${item.name}`,
      ids: item.sourceIds,
      held: item.status === "HELD",
    })),
    ...profile.pastProjects.map((item) => ({ label: `실적 ${item.name}`, ids: item.sourceIds })),
    ...(profile.financials ? [{ label: "재무", ids: profile.financials.sourceIds }] : []),
  ];
  const problems: string[] = [];
  for (const source of sources) {
    if (source.url !== null && !/^https?:$/.test(new URL(source.url).protocol))
      problems.push(`출처 ${source.id}: url 스킴은 http·https 만`);
  }
  for (const entry of publicHistory) {
    const label = `이력 ${entry.year} ${entry.name}`;
    if (entry.sourceIds.length === 0) {
      problems.push(`${label}: sourceIds 없음`);
      continue;
    }
    for (const id of entry.sourceIds) if (!byId.has(id)) problems.push(`${label}: 없는 출처 ${id}`);
  }
  for (const { label, ids, held } of items) {
    if (!ids || ids.length === 0) {
      problems.push(`${label}: sourceIds 없음`);
      continue;
    }
    for (const id of ids) if (!byId.has(id)) problems.push(`${label}: 없는 출처 ${id}`);
    const backed = ids.some((id) => {
      const source = byId.get(id);
      if (!source) return false;
      return source.kind === "PUBLIC" ? Boolean(source.quote) : Boolean(source.confirmedBy);
    });
    if (held && !backed) problems.push(`${label}: HELD 근거 없음`);
  }
  for (const project of profile.pastProjects)
    if (!domains.includes(project.domain))
      problems.push(`실적 ${project.name}: domain ${project.domain} 은 DOMAINS 값이 아님`);
  const preferenceDomains = [
    ...(profile.preferences?.domains ?? []),
    ...(profile.preferences?.excludedDomains ?? []),
  ];
  for (const domain of preferenceDomains)
    if (!domains.includes(domain)) problems.push(`선호 domain ${domain} 은 DOMAINS 값이 아님`);
  return problems;
};

const minimalDocument = (): ProfileDocument =>
  documentSchema.parse({
    note: "시험용",
    profile: {
      revision: 1,
      isDemo: false,
      technologies: [{ name: "HTML5", sourceIds: ["s1"] }],
      technologiesComplete: false,
      licenses: [],
      industryCodes: [],
      pastProjects: [
        {
          id: "pp-1",
          name: "정부24",
          domain: "민원",
          amountKrw: null,
          completedAt: null,
          sourceIds: ["s1"],
        },
      ],
      financials: null,
      preferences: null,
    },
    sources: [
      {
        id: "s1",
        kind: "PUBLIC",
        title: "홈페이지",
        url: "https://example.com",
        retrievedAt: "2026-10-27",
      },
    ],
    publicHistory: [],
  });

const heldLicenseDocument = (source: Record<string, unknown>): ProfileDocument => {
  const base = minimalDocument();
  return documentSchema.parse({
    ...base,
    profile: {
      ...base.profile,
      licenses: [{ code: "L1", name: "SW사업자", status: "HELD", sourceIds: ["s2"] }],
    },
    sources: [
      ...base.sources,
      { id: "s2", title: "근거", url: null, retrievedAt: "2026-10-27", ...source },
    ],
  });
};

describe("공개 회사 프로필 파일", () => {
  it("companyProfileSchema 로 파싱되고 isDemo=false", () => {
    const { profile } = load();
    expect(profile.isDemo).toBe(false);
  });

  it("기술 이름에 괄호가 없다(별칭표는 괄호 덧붙임을 맞추지 못한다)", () => {
    const withParens = load().profile.technologies.filter((item) => /[()]/.test(item.name));
    expect(withParens.map((item) => item.name)).toEqual([]);
  });

  it("출처 규칙(sourceIds·HELD 근거·domain)을 지킨다", () => {
    expect(sourceProblems(load())).toEqual([]);
  });
});

describe("sourceProblems 음성 시험", () => {
  it("최소 문서는 문제가 없다", () => {
    expect(sourceProblems(minimalDocument())).toEqual([]);
  });

  it("sourceIds 가 빈 기술", () => {
    const document = minimalDocument();
    document.profile.technologies = [{ name: "HTML5", sourceIds: [] }];
    expect(sourceProblems(document)).toEqual(["기술 HTML5: sourceIds 없음"]);
  });

  it("없는 출처를 가리키는 항목", () => {
    const document = minimalDocument();
    document.profile.technologies = [{ name: "HTML5", sourceIds: ["s9"] }];
    expect(sourceProblems(document)).toEqual(["기술 HTML5: 없는 출처 s9"]);
  });

  it("HELD 자격이 quote 없는 PUBLIC 출처만 가리킴", () => {
    expect(sourceProblems(heldLicenseDocument({ kind: "PUBLIC" }))).toEqual([
      "자격 SW사업자: HELD 근거 없음",
    ]);
  });

  it("HELD 자격이 confirmedBy 있는 COMPANY_CONFIRMED 출처를 가리킴", () => {
    expect(
      sourceProblems(heldLicenseDocument({ kind: "COMPANY_CONFIRMED", confirmedBy: "대표" })),
    ).toEqual([]);
  });

  it("domain 이 DOMAINS 값이 아님", () => {
    const document = minimalDocument();
    document.profile.pastProjects[0].domain = "없는분야";
    expect(sourceProblems(document)).toHaveLength(1);
  });

  it("선호 domain 이 DOMAINS 값이 아님", () => {
    const document = minimalDocument();
    document.profile.preferences = {
      agencies: [],
      agencyTypes: [],
      domains: ["민원", "없는분야"],
      excludedDomains: [],
      excludedKeywords: [],
    };
    expect(sourceProblems(document)).toEqual(["선호 domain 없는분야 은 DOMAINS 값이 아님"]);
  });
});
