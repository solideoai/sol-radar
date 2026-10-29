import { STAGE_LABEL } from "@/components/bids/labels";
import type { OpportunityKeyword, OpportunityQuery } from "@/server/opportunities";

export const OPPORTUNITY_STAGES: Record<string, string> = STAGE_LABEL;

// /bids 맨 위 분야 키워드 칩(ADR-069). 이 순서대로 보인다.
export const OPPORTUNITY_KEYWORD_LABELS: Record<OpportunityKeyword, string> = {
  AI_AX: "AI·AX",
  SI_SW: "SI·SW",
  CLOUD: "클라우드",
  DATA: "데이터",
  SECURITY: "보안",
  DIGITAL_TWIN: "디지털트윈·BIM",
  MAINTENANCE: "유지관리",
  ISP_ISMP: "ISP·ISMP",
};

// 정렬 선택지. 이 순서대로 보이고 맨 앞(추천순)이 기본이다.
export const OPPORTUNITY_SORT_LABELS: Record<OpportunityQuery["sort"], string> = {
  recommended: "추천순",
  "publishedAt:desc": "최신순",
  "deadlineAt:asc": "마감 임박순",
  "score:desc": "점수 높은 순",
  "budgetKrw:desc": "예산 큰 순",
};

export const OPPORTUNITY_CATEGORIES: Record<string, string> = {
  AI_AX: "AI·AX",
  SI_SW: "SI·SW",
  CLOUD: "클라우드",
  DATA: "데이터",
  SECURITY: "보안",
  DIGITAL_TWIN: "디지털트윈",
  OTHER: "기타",
};

export const EARLY_STAGES = ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC"];
export const ALL_STATUSES = ["OPEN", "AMENDED", "CLOSED", "CANCELLED"];

export const OPPORTUNITY_SERVICES: Record<string, string> = {
  "g2b-bid-notice": "나라장터 입찰공고",
  "g2b-pre-spec": "나라장터 사전규격",
  "g2b-order-plan": "나라장터 발주계획",
  "g2b-procurement-request": "나라장터 조달요청",
  "kwater-bid-notice": "K-water 입찰공고",
  "kwater-procurement-plan": "K-water 발주계획",
  "lh-bid-notice": "LH 입찰공고",
  "lh-pre-specification": "LH 사전규격",
  "kepco-ebid-contract": "KEPCO 전자입찰계약",
};

export function opportunityHref(bidId: string, query?: string): string {
  return query ? `/bids/${bidId}?list=${encodeURIComponent(query)}` : `/bids/${bidId}`;
}
