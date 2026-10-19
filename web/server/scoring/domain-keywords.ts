import "server-only";

// 사업 분야 값 집합과 키워드 표(08 §1 파생값 bid.domain). 정본 08 은 web/server/scoring/domain-keywords.yaml 을 적었지만
// 규칙 엔진이 런타임에 파일을 읽지 않도록 TS 상수로 둔다. 값은 08 §1 표와 같다.
//
// > 미검증 가정: 값 집합·키워드는 v0.1 가정이다(16 미결정 7번). fixture 20건의 사람 분류와 비교해 틀리면 표를 고친다.

export const DOMAINS = [
  "민원",
  "데이터 플랫폼",
  "교육",
  "AX",
  "스마트시티",
  "국방",
  "기타",
] as const;
export type Domain = (typeof DOMAINS)[number];

// 순서가 규칙의 일부다: 같은 수의 키워드가 맞으면 먼저 선언한 분야가 이긴다.
export const DOMAIN_KEYWORDS: ReadonlyArray<{ domain: Domain; keywords: readonly string[] }> = [
  { domain: "민원", keywords: ["민원", "행정정보"] },
  {
    domain: "데이터 플랫폼",
    keywords: ["데이터 플랫폼", "데이터플랫폼", "데이터허브", "데이터 허브"],
  },
  { domain: "교육", keywords: ["LMS", "교육"] },
  { domain: "AX", keywords: ["AI", "챗봇", "지능형", "인공지능"] },
  { domain: "스마트시티", keywords: ["CCTV", "관제", "스마트시티"] },
  // "군" 한 글자는 군산·군포 같은 지명에 걸리므로 두 글자 이상으로 둔다.
  { domain: "국방", keywords: ["국방", "국군", "군사", "방위사업"] },
];

export function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

// 제목·요약 텍스트를 키워드 표로 분류한다. 맞는 키워드 수가 가장 많은 분야, 동률이면 표 순서. 없으면 null(UNKNOWN).
export function classifyDomain(text: string): Domain | null {
  const scored = DOMAIN_KEYWORDS.map(({ domain, keywords }) => ({
    domain,
    hits: keywords.filter((keyword) => text.includes(keyword)).length,
  })).filter((entry) => entry.hits > 0);
  if (scored.length === 0) return null;
  return scored.reduce((best, entry) => (entry.hits > best.hits ? entry : best)).domain;
}

// 값이 분야 집합의 값이면 그대로, 아니면 텍스트로 분류한다(실적 domain 과 추출 domain 의 별칭 흡수: "CCTV 관제" ≈ 스마트시티).
export function canonicalDomain(value: string | null | undefined): Domain | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isDomain(trimmed) ? trimmed : classifyDomain(trimmed);
}

export type AgencyType = "지자체" | "교육청" | "중앙부처" | "공공기관";

// 08 §3.5: 이름 끝이 시·도·군·구·특별자치시·특별자치도 → 지자체, "교육청" 포함 → 교육청, 부·처·청(중앙) → 중앙부처, 그 외 → 공공기관.
export function agencyType(agency: string | null): AgencyType {
  if (!agency) return "공공기관";
  const name = agency.trim();
  if (name.includes("교육청")) return "교육청";
  if (/(특별자치시|특별자치도|특별시|광역시|시|도|군|구)$/.test(name)) return "지자체";
  if (/(부|처|청)$/.test(name)) return "중앙부처";
  return "공공기관";
}
