import "server-only";
import { z } from "zod";

// 발주 현황(/market) 1단계. 스펙 polaris/specs/in-progress/2026-10-28-gaps-market-calendar.md §6 B1.
// 대상은 live 나라장터 입찰공고(is_demo=false, 데모 수집기 아님, G2B, NOTICE 단계)다. 낙찰·계약·발주계획·사전규격은 없다.

/** 기간 선택(게시일 기준, KST 날짜로 오늘 포함 최근 N일). 기본 90일 */
export const MARKET_PERIODS = [30, 90] as const;
export type MarketPeriod = (typeof MARKET_PERIODS)[number];
export const DEFAULT_MARKET_PERIOD: MarketPeriod = 90;

/** relevant: 관련성 판정 RELEVANT·CANDIDATE 만(기본), all: 거르지 않음 */
export const MARKET_RELEVANCE = ["relevant", "all"] as const;
export type MarketRelevance = (typeof MARKET_RELEVANCE)[number];
export const RELEVANT_STATES: ReadonlySet<string> = new Set(["RELEVANT", "CANDIDATE"]);

/** 주별 게시 추이는 기간 선택과 별개로 이번 주(월요일 시작)를 포함한 최근 13주다 */
export const MARKET_TREND_WEEKS = 13;
/** "마감 다가오는 큰 사업"은 지금부터 이 일수 안에 마감하는 진행 중 공고다 */
export const MARKET_UPCOMING_DAYS = 14;
export const MARKET_TOP_AGENCIES = 10;
export const MARKET_UPCOMING_LIMIT = 10;

// tsconfig target 이 ES2017 이라 BigInt 리터럴(10n) 대신 생성자를 쓴다.
const EOK = BigInt(100_000_000);
const eok = (n: number) => BigInt(n) * EOK;
/**
 * 예산 구간(원). minKrw 이상 maxKrw 미만이고 maxKrw 가 null 이면 상한이 없다.
 * 화면은 이 값으로 구간 이름을 만든다(정의는 이곳 하나).
 * 예산이 없거나 출처 사본끼리 금액이 달라 확정할 수 없는 공고는 UNKNOWN 이다.
 */
export const MARKET_BUDGET_BANDS = [
  { key: "UNDER_1", minKrw: BigInt(0), maxKrw: EOK },
  { key: "FROM_1_TO_5", minKrw: EOK, maxKrw: eok(5) },
  { key: "FROM_5_TO_20", minKrw: eok(5), maxKrw: eok(20) },
  { key: "FROM_20_TO_100", minKrw: eok(20), maxKrw: eok(100) },
  { key: "OVER_100", minKrw: eok(100), maxKrw: null },
] as const;
export type MarketBudgetBandKey = (typeof MARKET_BUDGET_BANDS)[number]["key"] | "UNKNOWN";

export type MarketQuery = { period: MarketPeriod; relevance: MarketRelevance };
export const DEFAULT_MARKET_QUERY: MarketQuery = {
  period: DEFAULT_MARKET_PERIOD,
  relevance: "relevant",
};

type RawSearch = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// ?period=30|90 · ?relevance=relevant|all. 없거나 틀린 값은 화면을 막지 않고 기본값으로 그린다.
export function parseMarketQuery(raw: RawSearch): MarketQuery {
  const period = MARKET_PERIODS.find((value) => String(value) === first(raw.period));
  const relevance = MARKET_RELEVANCE.find((value) => value === first(raw.relevance));
  return {
    period: period ?? DEFAULT_MARKET_QUERY.period,
    relevance: relevance ?? DEFAULT_MARKET_QUERY.relevance,
  };
}

/** 집계 입력 한 행. 사업기회 뷰(opportunity_list_items)의 대표 공고 값이다 */
export const marketRowSchema = z.object({
  bidId: z.uuid(),
  title: z.string(),
  agency: z.string().nullable(),
  // 뷰가 마감이 지난 진행 중 공고를 CLOSED 로 바꿔 준다.
  status: z.enum(["OPEN", "AMENDED", "CANCELLED", "CLOSED"]),
  budgetKrw: z.string().nullable(),
  // 출처 사본끼리 금액·마감·취소가 어긋난다. 금액을 확정하지 않는다(procurement_summary 의 knownBudgetKrw 와 같은 규칙).
  sourceConflict: z.boolean(),
  publishedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  categories: z.array(z.string()),
  relevanceState: z.string(),
});
export type MarketRow = z.infer<typeof marketRowSchema>;

/** 이름별 건수와 확인된 배정 예산 합(원, 정수 문자열) */
export type MarketBucket = { count: number; knownBudgetKrw: string };

export type MarketOverview = {
  /** 집계 기준 시각(요청 시각) */
  asOf: string;
  query: MarketQuery;
  /** 기간 첫날(KST, YYYY-MM-DD). 이 날 00:00 KST 이후 게시분이다 */
  periodStartDate: string;
  /** 읽은 범위 첫날(KST, YYYY-MM-DD). 기간과 13주 중 이른 쪽. 주별 추이·마감 다가오는 큰 사업이 이 범위를 쓴다 */
  readFromDate: string;
  totals: {
    /** 기간 안 게시·취소 제외·관련성 거르기 뒤 공고 수 */
    notices: number;
    knownBudgetKrw: string;
    /** 예산이 없거나 출처 사본끼리 금액이 달라 합에서 뺀 공고 수 */
    unknownBudgetCount: number;
    /** 지금 마감이 남은 진행 중(OPEN·AMENDED) 공고 수 */
    openNotices: number;
    /** 관련성 거르기 전(전체 업종) 공고 수. 취소 제외 */
    allIndustryNotices: number;
    /** 같은 거르기에서 기간 안 취소 공고 수(모든 집계에서 뺀다) */
    cancelledNotices: number;
  };
  /** 기관 이름이 있는 공고의 서로 다른 기관 수 */
  agencyCount: number;
  topAgencies: (MarketBucket & { name: string })[];
  /** 관련성 판정 카테고리. 공고 하나가 여러 카테고리에 들 수 있다. NONE 은 카테고리 없음 */
  categories: (MarketBucket & { key: string })[];
  /** 구간 경계(원, 정수 문자열). UNKNOWN 은 둘 다 null, 상한 없는 구간은 maxKrw 가 null */
  budgetBands: (MarketBucket & {
    key: MarketBudgetBandKey;
    minKrw: string | null;
    maxKrw: string | null;
  })[];
  /** 오래된 주부터 13칸. weekStart 는 그 주 월요일(KST) */
  weekly: { weekStart: string; count: number }[];
  /** upcoming 의 마감 범위(지금부터 일수). upcoming 은 기간 선택과 별개로 readFromDate 이후 게시분에서 고른다 */
  upcomingDays: number;
  upcoming: {
    bidId: string;
    title: string;
    agency: string | null;
    deadlineAt: string;
    budgetKrw: string;
  }[];
};
