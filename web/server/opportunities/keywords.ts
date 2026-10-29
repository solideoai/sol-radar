import "server-only";

// /bids 분야 키워드 칩 8개(스펙 2026-10-29-it-bid-scope §5.1, ADR-069). 칩은 고정이고 사용자가 고치지 않는다.
// 칩 하나는 목록 뷰의 유효 분류(categories)나 태그(tags) 중 하나라도 겹치면 맞는다. 여러 칩은 "하나라도 해당"(OR)이다.
export const OPPORTUNITY_KEYWORD_IDS = [
  "AI_AX",
  "SI_SW",
  "CLOUD",
  "DATA",
  "SECURITY",
  "DIGITAL_TWIN",
  "MAINTENANCE",
  "ISP_ISMP",
] as const;
export type OpportunityKeyword = (typeof OPPORTUNITY_KEYWORD_IDS)[number];

export const OPPORTUNITY_KEYWORDS: Record<
  OpportunityKeyword,
  { categories: string[]; tags: string[] }
> = {
  AI_AX: { categories: ["AI_AX"], tags: [] },
  SI_SW: { categories: ["SI_SW"], tags: [] },
  CLOUD: { categories: ["CLOUD"], tags: [] },
  DATA: { categories: ["DATA"], tags: [] },
  SECURITY: { categories: ["SECURITY"], tags: [] },
  DIGITAL_TWIN: { categories: ["DIGITAL_TWIN"], tags: ["BIM", "smartcity"] },
  MAINTENANCE: { categories: [], tags: ["maintenance"] },
  ISP_ISMP: { categories: [], tags: ["ISP", "ISMP"] },
};

const unique = (values: string[]) => [...new Set(values)];

// PostgREST or 식. 값은 위 고정 식별자뿐이라 인용하지 않는다. 고른 칩이 없으면 null(조건 없음)이다.
export function keywordFilterOf(ids: readonly OpportunityKeyword[]): string | null {
  const categories = unique(ids.flatMap((id) => OPPORTUNITY_KEYWORDS[id].categories));
  const tags = unique(ids.flatMap((id) => OPPORTUNITY_KEYWORDS[id].tags));
  const parts = [
    ...(categories.length ? [`categories.ov.{${categories.join(",")}}`] : []),
    ...(tags.length ? [`tags.ov.{${tags.join(",")}}`] : []),
  ];
  return parts.length ? parts.join(",") : null;
}
