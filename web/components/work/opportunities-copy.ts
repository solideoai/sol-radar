import { STAGE_LABEL } from "@/components/bids/labels";

export const OPPORTUNITY_STAGES: Record<string, string> = STAGE_LABEL;

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
