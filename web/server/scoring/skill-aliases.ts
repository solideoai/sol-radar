import "server-only";

// 기술 별칭표(08 §3.1). 정확 일치 + 별칭표만 쓴다. 임베딩 유사도는 P1.
// 키·값 모두 canonicalSkill 의 정규화(소문자·공백 제거) 기준이다.
//
// > 미검증 가정: v0.1 표다. fixture 20건과 실공고 표기를 보고 늘린다.
const SKILL_ALIASES: Record<string, string> = {
  springframework: "springboot",
  spring: "springboot",
  k8s: "kubernetes",
  postgres: "postgresql",
  egov: "전자정부표준프레임워크",
  전자정부프레임워크: "전자정부표준프레임워크",
  표준프레임워크: "전자정부표준프레임워크",
  egovframe: "전자정부표준프레임워크",
  "nest.js": "nestjs",
  nextjs: "next.js",
  rag: "rag/llm적용",
  llm: "rag/llm적용",
  "rag/llm": "rag/llm적용",
};

export function normalizeSkill(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

export type SkillMatch = { requested: string; canonical: string; matchedVia: "exact" | "alias" };

// 회사 기술 집합(정규화)에 대해 요구 기술이 맞는지. 별칭으로 맞춘 항목은 matchedVia:"alias".
export function matchSkill(requested: string, company: ReadonlySet<string>): SkillMatch | null {
  const normalized = normalizeSkill(requested);
  if (company.has(normalized)) return { requested, canonical: normalized, matchedVia: "exact" };
  const alias = SKILL_ALIASES[normalized];
  if (alias && company.has(alias)) return { requested, canonical: alias, matchedVia: "alias" };
  return null;
}

// 회사 기술 목록을 정규화 집합으로. 회사 쪽 표기가 별칭이면 정식 이름으로 올린다.
export function companySkillSet(names: readonly string[]): Set<string> {
  return new Set(
    names.map((name) => {
      const normalized = normalizeSkill(name);
      return SKILL_ALIASES[normalized] ?? normalized;
    }),
  );
}
