import { SourceBadge } from "@/components/bids/source-badge";
import { DemoBadge } from "@/components/bids/status-badge";
import type { OpportunityItem } from "@/server/opportunities";

// 사업기회 행의 출처 자리(공고 표·대시보드 우선 검토 줄). 출처가 없는 데모 공고는 "미확인" 대신 DEMO 배지를 둔다
// (사업 공고 표 program-table.tsx 와 같다). 출처가 있는 데모 공고는 출처 배지를 두고 DEMO 는 제목 쪽(TitleDemoBadge)에 둔다.
// 어느 쪽이든 행마다 DEMO 는 한 번이다(2026-11-03 사용자 지시, ADR-081).
const demoInSourceCell = (item: OpportunityItem) => item.isDemo && item.sourceFamily === null;

export function OpportunitySourceCell({ item }: { item: OpportunityItem }) {
  return demoInSourceCell(item) ? <DemoBadge dense /> : <SourceBadge family={item.sourceFamily} />;
}

/** 출처 자리가 DEMO 를 보이지 않는 데모 공고에만 제목 쪽 DEMO 배지를 그린다. */
export function TitleDemoBadge({ item }: { item: OpportunityItem }) {
  return item.isDemo && !demoInSourceCell(item) ? <DemoBadge dense /> : null;
}
