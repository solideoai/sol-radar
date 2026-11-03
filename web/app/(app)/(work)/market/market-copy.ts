import type { MarketQuery } from "@/server/market";

// 발주 현황(/market) 화면 문구. 스펙 §6 B1. 낙찰 분석 서비스와 비교를 부르는 이름·표현은 쓰지 않는다(§8-5).
export const MARKET_TITLE = "발주 현황";
export const MARKET_DESCRIPTION = "수집한 입찰공고로 수요기관·분야·예산 규모별 발주 흐름을 봅니다.";
// 고정 배지(스펙 §6 B1). 문구를 바꾸지 않는다. 2026-11-02 "낙찰·계약 데이터 미포함"으로 한 번 고쳤다(ADR-077, 낙찰 이력 표가 생겨서).
// 2026-11-03 "수집분"을 빼고 미포함 범위를 한 묶음으로 줄였다(ADR-081). 자격 갭 출처 표시(server/gaps GAPS_SOURCE_NOTICE)와 같은 글자다.
export const MARKET_SOURCE_BADGE = "나라장터 입찰공고 기준 · 낙찰·계약·발주계획·사전규격 미포함";

/** 기간을 든 /market 주소. 로그인 뒤 돌아올 주소와 거르기 링크가 같이 쓴다 */
export const marketHref = (query: MarketQuery): string => `/market?period=${query.period}`;

/** 공고 상세. 이 화면은 live 공고만 보여 준다 */
export const marketBidHref = (bidId: string): string => `/bids/${bidId}?origin=live`;
