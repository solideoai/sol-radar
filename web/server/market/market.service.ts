import "server-only";
import {
  MARKET_BUDGET_BANDS,
  MARKET_TOP_AGENCIES,
  MARKET_TREND_WEEKS,
  MARKET_UPCOMING_DAYS,
  MARKET_UPCOMING_LIMIT,
  RELEVANT_STATES,
  type MarketBucket,
  type MarketBudgetBandKey,
  type MarketOverview,
  type MarketPeriod,
  type MarketQuery,
  type MarketRow,
} from "./market.model";
import { marketRepo, type MarketRepo } from "./market.repo";

// 발주 현황 집계. DB·시각에 기대지 않는 순수 함수다(now 는 인자로 받는다).
// 날짜 경계는 모두 KST(UTC+9, 일광 절약 없음) 자정이다.

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ZERO = BigInt(0);

/** 1970-01-01(KST)부터 센 KST 날짜 번호 */
const kstDay = (ms: number) => Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
/** KST 날짜 번호의 00:00 KST(UTC ms) */
const kstMidnight = (day: number) => day * DAY_MS - KST_OFFSET_MS;
/** 1970-01-01 은 목요일이다. 월요일 0 ~ 일요일 6 */
const weekdayOf = (day: number) => (day + 3) % 7;
const kstDateText = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export type MarketWindow = {
  /** 기간 첫날(KST 날짜 번호). 오늘 포함 최근 period 일 */
  periodStartDay: number;
  /** 주별 추이 첫 주 월요일(KST 날짜 번호) */
  trendStartDay: number;
  /** 읽는 범위 첫날(KST 날짜 번호). 기간과 13주 중 이른 쪽 */
  readFromDay: number;
  /** DB 에서 읽기 시작할 게시 시각(readFromDay 00:00 KST) */
  readFrom: string;
};

export function marketWindow(now: Date, period: MarketPeriod): MarketWindow {
  const today = kstDay(now.getTime());
  const periodStartDay = today - (period - 1);
  const trendStartDay = today - weekdayOf(today) - 7 * (MARKET_TREND_WEEKS - 1);
  const readFromDay = Math.min(periodStartDay, trendStartDay);
  return {
    periodStartDay,
    trendStartDay,
    readFromDay,
    readFrom: new Date(kstMidnight(readFromDay)).toISOString(),
  };
}

/** 확정할 수 있는 예산(원). 없거나 정수가 아니거나 출처 사본끼리 다르면 null */
const budgetOf = (row: MarketRow): bigint | null =>
  !row.sourceConflict && row.budgetKrw !== null && /^\d+$/.test(row.budgetKrw)
    ? BigInt(row.budgetKrw)
    : null;

const isOpen = (row: MarketRow, nowMs: number) =>
  (row.status === "OPEN" || row.status === "AMENDED") &&
  row.deadlineAt !== null &&
  Date.parse(row.deadlineAt) > nowMs;

type Tally = { count: number; budget: bigint };
const add = (map: Map<string, Tally>, key: string, budget: bigint | null) => {
  const tally = map.get(key) ?? { count: 0, budget: ZERO };
  map.set(key, { count: tally.count + 1, budget: tally.budget + (budget ?? ZERO) });
};
const bucketOf = (tally: Tally | undefined): MarketBucket => ({
  count: tally?.count ?? 0,
  knownBudgetKrw: (tally?.budget ?? ZERO).toString(),
});
// 건수 많은 순, 같으면 예산 큰 순, 그다음 이름 순.
const byCountThenBudget = (a: [string, Tally], b: [string, Tally]) =>
  b[1].count - a[1].count ||
  (b[1].budget > a[1].budget ? 1 : b[1].budget < a[1].budget ? -1 : 0) ||
  a[0].localeCompare(b[0], "ko");

const bandOf = (budget: bigint | null): MarketBudgetBandKey =>
  budget === null
    ? "UNKNOWN"
    : (MARKET_BUDGET_BANDS.find(
        (band) => budget >= band.minKrw && (band.maxKrw === null || budget < band.maxKrw),
      )?.key ?? "UNKNOWN");

export function aggregateMarket(rows: MarketRow[], query: MarketQuery, now: Date): MarketOverview {
  const nowMs = now.getTime();
  const window = marketWindow(now, query.period);
  const periodStartMs = kstMidnight(window.periodStartDay);
  const readFromMs = kstMidnight(window.readFromDay);
  const relevant = (row: MarketRow) =>
    query.relevance === "all" || RELEVANT_STATES.has(row.relevanceState);
  // 게시일이 없는 공고는 기간·주에 놓을 수 없어 뺀다(Date.parse 가 NaN 이면 비교가 거짓이다).
  const inPeriod = (row: MarketRow) => Date.parse(row.publishedAt ?? "") >= periodStartMs;
  // 취소 공고는 모든 집계에서 뺀다.
  const live = rows.filter((row) => row.publishedAt !== null && row.status !== "CANCELLED");
  const scoped = live.filter(relevant);
  const period = scoped.filter(inPeriod);

  const agencies = new Map<string, Tally>();
  const categories = new Map<string, Tally>();
  const bands = new Map<string, Tally>();
  let knownBudget = ZERO;
  let unknownBudgetCount = 0;
  for (const row of period) {
    const budget = budgetOf(row);
    if (budget === null) unknownBudgetCount += 1;
    else knownBudget += budget;
    const agency = row.agency?.trim();
    if (agency) add(agencies, agency, budget);
    const keys = [...new Set(row.categories)];
    for (const key of keys.length ? keys : ["NONE"]) add(categories, key, budget);
    add(bands, bandOf(budget), budget);
  }

  const weekly = Array.from({ length: MARKET_TREND_WEEKS }, (_, index) => ({
    weekStart: kstDateText(window.trendStartDay + index * 7),
    count: 0,
  }));
  for (const row of scoped) {
    const index = Math.floor(
      (kstDay(Date.parse(row.publishedAt ?? "")) - window.trendStartDay) / 7,
    );
    const week = weekly[index];
    if (index >= 0 && week) week.count += 1;
  }

  // 마감 다가오는 큰 사업은 기간 선택과 별개로 읽은 범위 전체(기간과 13주 중 이른 쪽부터 게시)에서 고른다.
  const upcomingUntil = nowMs + MARKET_UPCOMING_DAYS * DAY_MS;
  const upcoming = scoped
    .filter((row) => Date.parse(row.publishedAt ?? "") >= readFromMs)
    .flatMap((row) => {
      const budget = budgetOf(row);
      const deadline = row.deadlineAt === null ? NaN : Date.parse(row.deadlineAt);
      return isOpen(row, nowMs) && deadline <= upcomingUntil && budget !== null
        ? [{ row, budget, deadline }]
        : [];
    })
    .sort(
      (a, b) =>
        (b.budget > a.budget ? 1 : b.budget < a.budget ? -1 : 0) ||
        a.deadline - b.deadline ||
        a.row.bidId.localeCompare(b.row.bidId),
    )
    .slice(0, MARKET_UPCOMING_LIMIT)
    .map(({ row, budget }) => ({
      bidId: row.bidId,
      title: row.title,
      agency: row.agency,
      deadlineAt: row.deadlineAt ?? "",
      budgetKrw: budget.toString(),
    }));

  return {
    asOf: now.toISOString(),
    query,
    periodStartDate: kstDateText(window.periodStartDay),
    readFromDate: kstDateText(window.readFromDay),
    totals: {
      notices: period.length,
      knownBudgetKrw: knownBudget.toString(),
      unknownBudgetCount,
      openNotices: period.filter((row) => isOpen(row, nowMs)).length,
      allIndustryNotices: live.filter(inPeriod).length,
      cancelledNotices: rows.filter(
        (row) => row.status === "CANCELLED" && relevant(row) && inPeriod(row),
      ).length,
    },
    agencyCount: agencies.size,
    topAgencies: [...agencies]
      .sort(byCountThenBudget)
      .slice(0, MARKET_TOP_AGENCIES)
      .map(([name, tally]) => ({ name, ...bucketOf(tally) })),
    categories: [...categories]
      .sort(byCountThenBudget)
      .map(([key, tally]) => ({ key, ...bucketOf(tally) })),
    budgetBands: [
      ...MARKET_BUDGET_BANDS.map((band) => ({
        key: band.key,
        minKrw: band.minKrw.toString(),
        maxKrw: band.maxKrw === null ? null : band.maxKrw.toString(),
        ...bucketOf(bands.get(band.key)),
      })),
      { key: "UNKNOWN" as const, minKrw: null, maxKrw: null, ...bucketOf(bands.get("UNKNOWN")) },
    ],
    weekly,
    upcomingDays: MARKET_UPCOMING_DAYS,
    upcoming,
  };
}

/** live 나라장터 입찰공고를 나눠 읽어 집계한다. 누가 무엇을 읽는지는 RLS 가 정한다(anon 키 + 세션) */
export async function getMarketOverview(
  orgId: string,
  query: MarketQuery,
  now: Date,
  repo: MarketRepo = marketRepo,
): Promise<MarketOverview> {
  const rows = await repo.listLiveNotices(
    orgId,
    marketWindow(now, query.period).readFrom,
    now.toISOString(),
  );
  return aggregateMarket(rows, query, now);
}
