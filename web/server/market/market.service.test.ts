import { describe, expect, it, vi } from "vitest";
import type { MarketRow } from "./market.model";
import { aggregateMarket, marketWindow } from "./market.service";

// 나눠 읽기 시험용 가짜 Supabase. 요청마다 받은 id 하한(gt)을 적고, 정해 둔 쪽을 차례로 돌려준다.
const { pages, lowerBounds } = vi.hoisted(() => ({
  pages: [] as { id: string }[][],
  lowerBounds: [] as (string | null)[],
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: () => {
      let after: string | null = null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        lte: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        gt: (_column: string, value: string) => {
          after = value;
          return builder;
        },
        then: (resolve: (value: unknown) => void) => {
          lowerBounds.push(after);
          resolve({ data: pages.shift() ?? [], error: null });
        },
      };
      return builder;
    },
  }),
}));

// 2026-10-28(수) 00:30 KST. UTC 로는 아직 10-27 이라 UTC 날짜로 자르면 경계가 하루 어긋난다.
const NOW = new Date("2026-10-27T15:30:00.000Z");
let seq = 0;
const row = (patch: Partial<MarketRow>): MarketRow => {
  seq += 1;
  return {
    bidId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    title: `공고 ${seq}`,
    agency: "조달청",
    status: "OPEN",
    budgetKrw: "100000000",
    sourceConflict: false,
    publishedAt: "2026-10-20T01:00:00.000Z",
    deadlineAt: "2026-11-05T01:00:00.000Z",
    categories: ["SI_SW"],
    relevanceState: "RELEVANT",
    ...patch,
  };
};

describe("발주 현황 기간·주 경계(KST)", () => {
  it("30일은 오늘(KST) 포함 30일째 00:00 KST부터이고, 주별 추이는 월요일 시작 13주다", () => {
    const window = marketWindow(NOW, 30);
    expect(window.readFrom).toBe("2026-08-02T15:00:00.000Z");
    const overview = aggregateMarket(
      [
        // 09-29 00:00 KST 정각 → 기간 안
        row({ publishedAt: "2026-09-28T15:00:00.000Z" }),
        // 09-28 23:59:59 KST → 기간 밖(UTC 날짜는 같은 09-28 이라 UTC 로 자르면 구분하지 못한다)
        row({ publishedAt: "2026-09-28T14:59:59.999Z" }),
        // 10-26(월) 00:30 KST → 이번 주
        row({ publishedAt: "2026-10-25T15:30:00.000Z" }),
        // 10-25(일) 23:30 KST → 지난주
        row({ publishedAt: "2026-10-25T14:30:00.000Z" }),
        // 08-02(일) 23:00 KST → 13주 밖
        row({ publishedAt: "2026-08-02T14:00:00.000Z" }),
      ],
      { period: 30, relevance: "relevant" },
      NOW,
    );
    expect(overview.periodStartDate).toBe("2026-09-29");
    expect(overview.totals.notices).toBe(3);
    expect(overview.weekly).toHaveLength(13);
    expect(overview.weekly[0]).toEqual({ weekStart: "2026-08-03", count: 0 });
    expect(overview.weekly.at(-1)).toEqual({ weekStart: "2026-10-26", count: 1 });
    expect(overview.weekly.at(-2)).toEqual({ weekStart: "2026-10-19", count: 1 });
    expect(overview.weekly.reduce((sum, week) => sum + week.count, 0)).toBe(4);
  });
});

describe("발주 현황 관련성 거르기", () => {
  const rows = [
    row({ relevanceState: "RELEVANT" }),
    row({ relevanceState: "CANDIDATE", categories: ["AI_AX", "AI_AX", "DATA"] }),
    row({ relevanceState: "LOW_RELEVANCE", categories: [] }),
    row({ relevanceState: "NEEDS_REVIEW" }),
    row({ relevanceState: "UNCLASSIFIED" }),
    row({ relevanceState: "RELEVANT", status: "CANCELLED" }),
  ];

  it("기본은 RELEVANT·CANDIDATE 만 세고, 취소 공고는 빼서 따로 센다", () => {
    const overview = aggregateMarket(rows, { period: 90, relevance: "relevant" }, NOW);
    expect(overview.totals).toMatchObject({
      notices: 2,
      allIndustryNotices: 5,
      cancelledNotices: 1,
    });
    expect(overview.categories).toEqual([
      { key: "AI_AX", count: 1, knownBudgetKrw: "100000000" },
      { key: "DATA", count: 1, knownBudgetKrw: "100000000" },
      { key: "SI_SW", count: 1, knownBudgetKrw: "100000000" },
    ]);
  });

  it("거르기를 끄면 전체 업종을 세고 카테고리가 없는 공고는 NONE 이다", () => {
    const overview = aggregateMarket(rows, { period: 90, relevance: "all" }, NOW);
    expect(overview.totals.notices).toBe(5);
    expect(overview.categories.find((c) => c.key === "NONE")?.count).toBe(1);
    expect(overview.categories.find((c) => c.key === "SI_SW")?.count).toBe(3);
  });
});

describe("발주 현황 예산", () => {
  it("예산 없음·출처 간 금액 불일치는 합·순위에서 빼고 UNKNOWN 구간으로 센다", () => {
    const overview = aggregateMarket(
      [
        row({ agency: "A기관", budgetKrw: "9007199254740993", deadlineAt: "2026-11-01T00:00:00Z" }),
        row({ agency: "A기관", budgetKrw: null, deadlineAt: "2026-10-30T00:00:00Z" }),
        row({ agency: "B기관", budgetKrw: "500000000", sourceConflict: true }),
        row({ agency: "B기관", budgetKrw: "50000000", deadlineAt: "2026-10-29T00:00:00Z" }),
        row({ agency: "C기관", budgetKrw: "2000000000", status: "CLOSED" }),
        // 14일 뒤 마감은 "마감 다가오는" 목록에서 빠진다
        row({ agency: " ", budgetKrw: "700000000", deadlineAt: "2026-11-11T00:00:00Z" }),
      ],
      { period: 90, relevance: "relevant" },
      NOW,
    );
    expect(overview.totals).toMatchObject({
      notices: 6,
      knownBudgetKrw: "9007202004740993",
      unknownBudgetCount: 2,
      openNotices: 5,
    });
    expect(overview.agencyCount).toBe(3);
    expect(overview.topAgencies).toEqual([
      { name: "A기관", count: 2, knownBudgetKrw: "9007199254740993" },
      { name: "B기관", count: 2, knownBudgetKrw: "50000000" },
      { name: "C기관", count: 1, knownBudgetKrw: "2000000000" },
    ]);
    const band = (key: string) => overview.budgetBands.find((b) => b.key === key)?.count;
    expect(band("UNKNOWN")).toBe(2);
    expect(band("UNDER_1")).toBe(1);
    expect(band("FROM_5_TO_20")).toBe(1);
    expect(band("FROM_20_TO_100")).toBe(1);
    expect(band("OVER_100")).toBe(1);
    expect(overview.upcoming.map((item) => item.budgetKrw)).toEqual([
      "9007199254740993",
      "50000000",
    ]);
  });
});

describe("발주 현황 나눠 읽기", () => {
  it("1,000건씩 id 순으로 이어 읽어 PostgREST 응답 상한에 걸리지 않는다", async () => {
    const { marketRepo } = await import("./market.repo");
    const make = (n: number) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      bid_id: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
      title: `공고 ${n}`,
      agency: null,
      status: "OPEN",
      budget_krw: null,
      source_conflict: false,
      published_at: "2026-10-20T01:00:00.000Z",
      deadline_at: null,
      categories: [],
      relevance_state: "RELEVANT",
    });
    pages.push(
      Array.from({ length: 1000 }, (_, i) => make(i + 1)),
      Array.from({ length: 285 }, (_, i) => make(i + 1001)),
    );
    const rows = await marketRepo.listLiveNotices("org", "2026-07-30T15:00:00Z", NOW.toISOString());
    expect(rows).toHaveLength(1285);
    expect(lowerBounds).toEqual([null, make(1000).id]);
  });
});
