import { describe, expect, it, vi } from "vitest";
import type { GapBucket, GapBucketsView } from "@/server/gaps";
import type { MarketRow } from "./market.model";
import type { MarketRepo } from "./market.repo";
import { aggregateMarket, getMarketOverview, marketWindow, overlayGaps } from "./market.service";

// 나눠 읽기 시험용 가짜 Supabase. 요청마다 받은 (메서드, 열, 값)을 적고, 정해 둔 쪽을 차례로 돌려준다.
const { pages, requests } = vi.hoisted(() => ({
  pages: [] as { id: string }[][],
  requests: [] as unknown[][][],
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: (table: string) => {
      const calls: unknown[][] = [["from", table]];
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      const builder = {
        select: record("select"),
        eq: record("eq"),
        neq: record("neq"),
        lte: record("lte"),
        gte: record("gte"),
        contains: record("contains"),
        order: record("order"),
        limit: record("limit"),
        gt: record("gt"),
        then: (resolve: (value: unknown) => void) => {
          requests.push(calls);
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
  const rows = [
    // 09-29 00:00 KST 정각 → 30일 기간 안
    row({ publishedAt: "2026-09-28T15:00:00.000Z" }),
    // 09-28 23:59:59 KST → 30일 기간 밖(UTC 날짜는 같은 09-28 이라 UTC 로 자르면 구분하지 못한다)
    row({ publishedAt: "2026-09-28T14:59:59.999Z" }),
    // 10-26(월) 00:30 KST → 이번 주
    row({ publishedAt: "2026-10-25T15:30:00.000Z" }),
    // 10-25(일) 23:30 KST → 지난주
    row({ publishedAt: "2026-10-25T14:30:00.000Z" }),
    // 08-02(일) 23:00 KST → 13주 밖, 90일 기간 안
    row({ publishedAt: "2026-08-02T14:00:00.000Z" }),
    // 08-01(토) 10:00 KST → 13주 밖, 90일 기간 안
    row({ publishedAt: "2026-08-01T01:00:00.000Z" }),
  ];

  it("30일은 오늘(KST) 포함 30일째 00:00 KST부터이고, 주별 추이는 월요일 시작 13주다", () => {
    expect(marketWindow(NOW, 30).readFrom).toBe("2026-08-02T15:00:00.000Z");
    const overview = aggregateMarket(rows, { period: 30, relevance: "relevant" }, NOW);
    expect(overview.periodStartDate).toBe("2026-09-29");
    expect(overview.totals.notices).toBe(3);
    expect(overview.weekly).toHaveLength(13);
    expect(overview.weekly[0]).toEqual({ weekStart: "2026-08-03", count: 0 });
    expect(overview.weekly.at(-1)).toEqual({ weekStart: "2026-10-26", count: 1 });
    expect(overview.weekly.at(-2)).toEqual({ weekStart: "2026-10-19", count: 1 });
    expect(overview.weekly.reduce((sum, week) => sum + week.count, 0)).toBe(4);
  });

  it("마감 다가오는 큰 사업은 기간 선택과 무관하게 13주 첫 월요일(08-03 00:00 KST) 이후 게시분에서 고른다", () => {
    // 90일은 07-31 부터 읽지만(readFrom), 08-03 앞 게시분은 큰 사업 목록에 넣지 않는다.
    expect(marketWindow(NOW, 90).readFrom).toBe("2026-07-30T15:00:00.000Z");
    for (const period of [30, 90] as const) {
      const overview = aggregateMarket(rows, { period, relevance: "relevant" }, NOW);
      expect(overview.upcomingFromDate).toBe("2026-08-03");
      expect(overview.upcoming.map((item) => item.bidId)).toEqual(
        rows.slice(0, 4).map((item) => item.bidId),
      );
    }
    expect(aggregateMarket(rows, { period: 90, relevance: "relevant" }, NOW).totals.notices).toBe(
      6,
    );
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
  const READ_FROM = "2026-07-30T15:00:00.000Z";

  it("live 나라장터 입찰공고 거르기로 1,000건씩 id 순으로 이어 읽는다", async () => {
    const { marketRepo } = await import("./market.repo");
    requests.length = 0;
    pages.push(
      Array.from({ length: 1000 }, (_, i) => make(i + 1)),
      Array.from({ length: 285 }, (_, i) => make(i + 1001)),
    );
    const rows = await marketRepo.listLiveNotices("org-1", READ_FROM, NOW.toISOString());
    expect(rows).toHaveLength(1285);
    expect(requests).toHaveLength(2);
    const filters = [
      ["from", "opportunity_list_items"],
      ["select", expect.any(String)],
      ["eq", "org_id", "org-1"],
      ["eq", "is_demo", false],
      ["neq", "source", "fixture"],
      ["contains", "source_families", ["G2B"]],
      ["eq", "stage", "NOTICE"],
      ["lte", "first_seen_at", NOW.toISOString()],
      ["gte", "published_at", READ_FROM],
      ["order", "id", { ascending: true }],
      ["limit", 1000],
    ];
    expect(requests[0]).toEqual(filters);
    expect(requests[1]).toEqual([...filters, ["gt", "id", make(1000).id]]);
  });

  it("1,000건짜리 쪽이 20번 이어지면 덜 세지 않도록 읽기 실패로 둔다", async () => {
    const { marketRepo } = await import("./market.repo");
    requests.length = 0;
    const full = Array.from({ length: 1000 }, (_, i) => make(i + 1));
    pages.push(...Array.from({ length: 21 }, () => full));
    await expect(marketRepo.listLiveNotices("org-1", READ_FROM, NOW.toISOString())).rejects.toThrow(
      "발주 현황 대상 공고가 너무 많아 집계하지 못했습니다",
    );
    expect(requests).toHaveLength(20);
    pages.length = 0;
  });
});

describe("발주 현황 판정 묶음 겹쳐 보기(§6 B2)", () => {
  const QUERY = { period: 30, relevance: "relevant" } as const;
  const named = (label: string, patch: Partial<MarketRow>) => ({ label, row: row(patch) });
  const cases = [
    // 앞뒤 빈칸이 있는 기관 이름은 집계(topAgencies)와 같이 다듬어 같은 기관으로 센다
    named("open-a", { agency: " 조달청 ", categories: ["SI_SW", "DATA", "SI_SW"] }),
    named("open-b", { agency: "조달청", categories: [] }),
    // 30분 전에 마감한 공고(뷰가 아직 CLOSED 로 바꾸기 전)
    named("passed", { agency: "조달청", deadlineAt: "2026-10-27T15:00:00.000Z" }),
    named("closed", { agency: "조달청", status: "CLOSED", deadlineAt: "2026-10-26T01:00:00.000Z" }),
    named("no-deadline", { agency: "조달청", status: "AMENDED", deadlineAt: null }),
    named("cancelled", { agency: "조달청", status: "CANCELLED" }),
    named("old", { agency: "조달청", publishedAt: "2026-07-01T01:00:00.000Z" }),
    named("low", { agency: "조달청", relevanceState: "LOW_RELEVANCE" }),
    named("unmatched", { agency: "행정안전부" }),
    named("no-agency", { agency: null, categories: ["AI_AX"] }),
  ];
  const rows = cases.map((entry) => entry.row);
  const idOf = (label: string) => cases.find((entry) => entry.label === label)?.row.bidId ?? "";
  // /gaps 판정. 마감이 지난 공고에도 묶음을 줘서, 겹쳐 보기가 market 쪽 마감 전 거르기로 빼는지 본다.
  const ready = (pairs: [string, GapBucket][]): GapBucketsView => ({
    kind: "READY",
    profile: { revision: 9, isDemo: true, name: "가상 회사" },
    buckets: new Map(pairs.map(([label, bucket]) => [idOf(label), bucket])),
  });
  const GAPS = ready([
    ["open-a", "ELIGIBLE"],
    ["open-b", "NOT_HELD"],
    ["passed", "ELIGIBLE"],
    ["closed", "MISSING_RECORD"],
    ["no-deadline", "MISSING_RECORD"],
    ["cancelled", "ELIGIBLE"],
    ["old", "ELIGIBLE"],
    ["low", "ELIGIBLE"],
    ["no-agency", "NEEDS_REVIEW"],
  ]);
  const zero = { ELIGIBLE: 0, MISSING_RECORD: 0, NOT_HELD: 0, NEEDS_REVIEW: 0 };

  it("기간·관련성 안 마감 전 공고만 기관·분야 키로 세고, 마감이 지난 공고는 묶음에 넣지 않는다", () => {
    const overlay = overlayGaps(rows, QUERY, NOW, GAPS);
    expect(overlay).toEqual({
      status: "READY",
      profile: { revision: 9, isDemo: true, name: "가상 회사" },
      openNotices: 4,
      unmatched: 1,
      agencies: {
        조달청: { open: 2, buckets: { ...zero, ELIGIBLE: 1, NOT_HELD: 1 } },
        행정안전부: { open: 1, buckets: zero },
      },
      categories: {
        SI_SW: { open: 2, buckets: { ...zero, ELIGIBLE: 1 } },
        DATA: { open: 1, buckets: { ...zero, ELIGIBLE: 1 } },
        NONE: { open: 1, buckets: { ...zero, NOT_HELD: 1 } },
        AI_AX: { open: 1, buckets: { ...zero, NEEDS_REVIEW: 1 } },
      },
    });
    // 기관·분야 키가 화면 행(topAgencies.name·categories.key)과 그대로 맞는다
    const aggregate = aggregateMarket(rows, QUERY, NOW);
    if (overlay.status !== "READY") throw new Error("READY 가 아니다");
    expect(Object.keys(overlay.agencies).sort()).toEqual(
      aggregate.topAgencies.map((agency) => agency.name).sort(),
    );
    for (const key of Object.keys(overlay.categories))
      expect(aggregate.categories.map((category) => category.key)).toContain(key);
  });

  it("회사 프로필이 없으면 NO_PROFILE, 판정을 읽지 못하면 FAILED 만 돌려준다", () => {
    expect(overlayGaps(rows, QUERY, NOW, { kind: "NO_PROFILE" })).toEqual({ status: "NO_PROFILE" });
    expect(overlayGaps(rows, QUERY, NOW, "FAILED")).toEqual({ status: "FAILED" });
  });

  it("공고 읽기와 판정 읽기를 함께 시작하고, 판정 읽기가 실패해도 1단계 집계는 그대로 돌려준다", async () => {
    // company-profile.repo 처럼 PostgREST 오류 일반 객체를 그대로 던지는 경우
    // 판정 읽기가 시작돼야 공고 읽기가 끝난다. 차례로 기다리면 이 시험은 끝나지 않는다.
    let gapsStarted = () => {};
    const started = new Promise<void>((resolve) => {
      gapsStarted = resolve;
    });
    const repo: MarketRepo = {
      listLiveNotices: async () => {
        await started;
        return rows;
      },
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const postgrest = {
      message: "permission denied for table company_profiles",
      details: null,
      hint: null,
      code: "42501",
    };
    const overview = await getMarketOverview("org-1", QUERY, NOW, repo, async () => {
      gapsStarted();
      throw postgrest;
    });
    expect(overview.gapOverlay).toEqual({ status: "FAILED" });
    expect(overview).toMatchObject(aggregateMarket(rows, QUERY, NOW));
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      event: "market_gap_overlay_failed",
      ...postgrest,
    });

    // gaps.repo 처럼 Error 로 감싸 cause 에 둔 경우
    await getMarketOverview("org-1", QUERY, NOW, { listLiveNotices: async () => rows }, () =>
      Promise.reject(new Error("자격 갭 레이더 공고를 읽지 못했습니다", { cause: postgrest })),
    );
    expect(JSON.parse(String(error.mock.calls[1]?.[0]))).toEqual({
      event: "market_gap_overlay_failed",
      message: "자격 갭 레이더 공고를 읽지 못했습니다",
      cause: postgrest,
    });
    error.mockRestore();
  });
});
