import "server-only";
import { getGapBuckets, type GapBucketsView } from "@/server/gaps";
import {
  MARKET_BUDGET_BANDS,
  MARKET_TOP_AGENCIES,
  MARKET_TREND_WEEKS,
  MARKET_UPCOMING_DAYS,
  MARKET_UPCOMING_LIMIT,
  type MarketAggregate,
  type MarketBucket,
  type MarketBudgetBandKey,
  type MarketGapCounts,
  type MarketGapOverlay,
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

/** 기관 행의 키. 이름이 비면 기관 집계에 넣지 않는다 */
const agencyOf = (row: MarketRow) => row.agency?.trim() || null;
/** 분야 행의 키. 공고 하나가 여러 카테고리에 들 수 있고, 없으면 NONE 이다 */
const categoriesOf = (row: MarketRow) => {
  const keys = [...new Set(row.categories)];
  return keys.length ? keys : ["NONE"];
};

/**
 * 집계와 겹쳐 보기가 함께 쓰는 거르기. 기간·취소 규칙은 이곳 하나다.
 * IT 범위(ADR-069)는 저장(market.repo)이 이미 거른 행이다.
 */
function selectRows(rows: MarketRow[], query: MarketQuery, now: Date) {
  const window = marketWindow(now, query.period);
  const periodStartMs = kstMidnight(window.periodStartDay);
  // 게시일이 없는 공고는 기간·주에 놓을 수 없어 뺀다(Date.parse 가 NaN 이면 비교가 거짓이다).
  const inPeriod = (row: MarketRow) => Date.parse(row.publishedAt ?? "") >= periodStartMs;
  // 취소 공고는 모든 집계에서 뺀다.
  const live = rows.filter((row) => row.publishedAt !== null && row.status !== "CANCELLED");
  return { window, inPeriod, live, period: live.filter(inPeriod) };
}

export function aggregateMarket(rows: MarketRow[], query: MarketQuery, now: Date): MarketAggregate {
  const nowMs = now.getTime();
  const { window, inPeriod, live, period } = selectRows(rows, query, now);
  const upcomingFromMs = kstMidnight(window.trendStartDay);

  const agencies = new Map<string, Tally>();
  const categories = new Map<string, Tally>();
  const bands = new Map<string, Tally>();
  let knownBudget = ZERO;
  let unknownBudgetCount = 0;
  for (const row of period) {
    const budget = budgetOf(row);
    if (budget === null) unknownBudgetCount += 1;
    else knownBudget += budget;
    const agency = agencyOf(row);
    if (agency) add(agencies, agency, budget);
    for (const key of categoriesOf(row)) add(categories, key, budget);
    add(bands, bandOf(budget), budget);
  }

  const weekly = Array.from({ length: MARKET_TREND_WEEKS }, (_, index) => ({
    weekStart: kstDateText(window.trendStartDay + index * 7),
    count: 0,
  }));
  for (const row of live) {
    const index = Math.floor(
      (kstDay(Date.parse(row.publishedAt ?? "")) - window.trendStartDay) / 7,
    );
    const week = weekly[index];
    if (index >= 0 && week) week.count += 1;
  }

  // 마감 다가오는 큰 사업은 기간 선택과 무관하게 주별 추이와 같은 13주(첫 주 월요일 00:00 KST 이후 게시)에서 고른다.
  // 읽는 범위(readFrom)는 90일 기간이 13주보다 길 때 더 이르지만, 그 앞쪽은 쓰지 않아 화면 날짜가 기간에 따라 바뀌지 않는다.
  const upcomingUntil = nowMs + MARKET_UPCOMING_DAYS * DAY_MS;
  const upcoming = live
    .filter((row) => Date.parse(row.publishedAt ?? "") >= upcomingFromMs)
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
    upcomingFromDate: kstDateText(window.trendStartDay),
    totals: {
      notices: period.length,
      knownBudgetKrw: knownBudget.toString(),
      unknownBudgetCount,
      openNotices: period.filter((row) => isOpen(row, nowMs)).length,
      cancelledNotices: rows.filter((row) => row.status === "CANCELLED" && inPeriod(row)).length,
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

const emptyCounts = (): MarketGapCounts => ({
  open: 0,
  buckets: { ELIGIBLE: 0, MISSING_RECORD: 0, NOT_HELD: 0, NEEDS_REVIEW: 0 },
});

/**
 * /gaps 판정 묶음 겹쳐 보기(§6 B2). 집계와 같은 기간·관련성 거르기 뒤, 마감 전 공고만 기관·분야 키로 센다.
 * 공고는 bidId(대표 공고 id = /gaps 공고 id)로 맞춘다. 마감이 지난 공고는 /gaps 대상이 아니라 넣지 않는다.
 */
export function overlayGaps(
  rows: MarketRow[],
  query: MarketQuery,
  now: Date,
  gaps: GapBucketsView | "FAILED",
): MarketGapOverlay {
  if (gaps === "FAILED") return { status: "FAILED" };
  if (gaps.kind === "NO_PROFILE") return { status: "NO_PROFILE" };
  const nowMs = now.getTime();
  const open = selectRows(rows, query, now).period.filter((row) => isOpen(row, nowMs));
  const agencies: Record<string, MarketGapCounts> = {};
  const categories: Record<string, MarketGapCounts> = {};
  let unmatched = 0;
  for (const row of open) {
    const bucket = gaps.buckets.get(row.bidId);
    if (bucket === undefined) unmatched += 1;
    const agency = agencyOf(row);
    const targets = [
      ...(agency ? [(agencies[agency] ??= emptyCounts())] : []),
      ...categoriesOf(row).map((key) => (categories[key] ??= emptyCounts())),
    ];
    for (const counts of targets) {
      counts.open += 1;
      if (bucket !== undefined) counts.buckets[bucket] += 1;
    }
  }
  return {
    status: "READY",
    profile: gaps.profile,
    openNotices: open.length,
    unmatched,
    agencies,
    categories,
  };
}

type ErrorFields = Partial<Record<"code" | "message" | "details" | "hint", unknown>>;
// PostgREST 오류는 Error 가 아닌 일반 객체({message,details,hint,code})로 던져지기도 한다(company-profile.repo).
// Error 든 일반 객체든 같은 칸으로 풀어 로그에 원인을 남긴다.
function errorFields(error: unknown): ErrorFields {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  const { code, message, details, hint } = error as ErrorFields;
  return { code, message, details, hint };
}

/**
 * live 나라장터 입찰공고를 나눠 읽어 집계하고, /gaps 판정 묶음을 같은 요청에서 나란히 읽어 겹친다.
 * 누가 무엇을 읽는지는 RLS 가 정한다(anon 키 + 세션). 판정을 읽지 못해도 1단계 집계는 그린다.
 */
export async function getMarketOverview(
  orgId: string,
  query: MarketQuery,
  now: Date,
  repo: MarketRepo = marketRepo,
  gapBuckets: typeof getGapBuckets = getGapBuckets,
): Promise<MarketOverview> {
  const [rows, gaps] = await Promise.all([
    repo.listLiveNotices(orgId, marketWindow(now, query.period).readFrom, now.toISOString()),
    gapBuckets(orgId, now).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "market_gap_overlay_failed",
          ...errorFields(error),
          // gaps.repo 는 PostgREST 오류를 cause 로 감싸 던진다
          cause:
            error instanceof Error && error.cause !== undefined
              ? errorFields(error.cause)
              : undefined,
        }),
      );
      return "FAILED" as const;
    }),
  ]);
  return { ...aggregateMarket(rows, query, now), gapOverlay: overlayGaps(rows, query, now, gaps) };
}
