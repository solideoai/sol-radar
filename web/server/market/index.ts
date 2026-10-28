import "server-only";
// ── 배럴: 발주 현황(/market) 도메인의 공개 API ──
export {
  DEFAULT_MARKET_QUERY,
  MARKET_PERIODS,
  MARKET_TREND_WEEKS,
  MARKET_UPCOMING_DAYS,
  parseMarketQuery,
} from "./market.model";
export type {
  MarketAggregate,
  MarketBudgetBandKey,
  MarketGapCounts,
  MarketGapOverlay,
  MarketOverview,
  MarketPeriod,
  MarketQuery,
  MarketRelevance,
} from "./market.model";
export { marketRepo } from "./market.repo";
export type { MarketRepo } from "./market.repo";
export { aggregateMarket, getMarketOverview, marketWindow, overlayGaps } from "./market.service";
