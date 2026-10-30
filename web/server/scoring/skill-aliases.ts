import "server-only";
import { resolveQualificationCode } from "./qualification-codes";

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
  html: "html5",
};

export function normalizeSkill(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

// sol-v0.2.0(ADR-071): 기술 스택 적합은 기술만 센다. 추출이 요구 기술에 함께 넣은 자격·인증(자격 판정이 따로 본다)과
// 업무 범위 문구("시스템 유지관리"·"장애 대응 및 복구")는 매칭에서 뺀다. 영문 기술명이 든 항목("VMS 연동")은 기술로 둔다.
// > 미검증 가정: 낱말 표는 2026-10-29 운영 실공고 추출 표기를 보고 정했다. 한글로만 쓴 기술이 이 낱말로 끝나면 함께 빠진다.
const QUALIFICATION_WORDS =
  /(사업자|확인서|증명서|등록증|신고|면허|공사업|업종|직접생산|중소기업|소상공인|벤처기업|여성기업|인증서)/;
const DUTY_SUFFIX =
  /(유지관리|유지보수|운영|관리|대응|복구|개선|개발|구축|지원|디자인|이관|연동|점검|감리|컨설팅|서비스|사업)$/;

export function isNonTechnicalSkill(name: string): boolean {
  const compact = name.replace(/\s+/g, "");
  return (
    resolveQualificationCode(null, name) !== null ||
    QUALIFICATION_WORDS.test(compact) ||
    (!/[A-Za-z]/.test(compact) && DUTY_SUFFIX.test(compact))
  );
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
