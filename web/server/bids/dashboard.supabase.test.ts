import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSource } from "./bids.repo";
import { createDashboardRepo } from "./dashboard.supabase";
import { callsOf, fakeDb, type FakeQuery } from "./supabase-fake.test-data";

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const AI: DashboardSource["ai"] = {
  provider: "mock",
  kevEnabled: true,
  lastGatewayCheckAt: "2026-10-19T00:00:00Z",
  healthy: true,
};
const repo = createDashboardRepo({ aiStatus: async () => AI });

const summary = {
  created: 19,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 1,
  retried: 0,
};

const only = (target: string): FakeQuery => {
  const found = fakeDb.queries(target);
  expect(found).toHaveLength(1);
  return found[0] as FakeQuery;
};

const respond = (ingest: unknown[]) => {
  fakeDb.on("bid_notices", fakeDb.rows([]));
  fakeDb.on("rpc:latest_ingest_run", { data: ingest });
  fakeDb.on("notifications", { data: null, count: 3 });
};

beforeEach(() => fakeDb.reset());

describe("dashboard.load", () => {
  it('rpc("latest_ingest_run",{p_origin:"demo"}) 를 부르고 요약을 옮긴다', async () => {
    respond([
      {
        status: "PARTIAL",
        started_at: "2026-10-19T00:00:00+00:00",
        finished_at: "2026-10-19T00:01:00+00:00",
        summary,
      },
    ]);
    const source = await repo.load(ORG, "demo");
    expect(only("rpc:latest_ingest_run").calls[0]).toEqual({
      method: "rpc",
      args: ["latest_ingest_run", { p_origin: "demo" }],
    });
    expect(source.dataFreshness.lastIngestSummary?.created).toBe(19);
    expect(source.dataFreshness).toEqual({
      lastIngestAt: "2026-10-19T00:01:00+00:00",
      lastIngestStatus: "PARTIAL",
      lastIngestSummary: summary,
    });
  });

  it("RUNNING 이라 finished_at 이 null 이면 시작 시각을 싣고 던지지 않는다", async () => {
    respond([
      {
        status: "RUNNING",
        started_at: "2026-10-19T00:00:00+00:00",
        finished_at: null,
        summary: { created: 2 },
      },
    ]);
    const source = await repo.load(ORG, "live");
    expect(source.dataFreshness.lastIngestAt).toBe("2026-10-19T00:00:00+00:00");
    expect(source.dataFreshness.lastIngestStatus).toBe("RUNNING");
    // 요약에 없는 수는 0 이다
    expect(source.dataFreshness.lastIngestSummary).toEqual({
      ...summary,
      created: 2,
      quarantined: 0,
    });
  });

  it("수집 기록이 없으면 신선도가 모두 null 이다", async () => {
    respond([]);
    const source = await repo.load(ORG, "all");
    expect(source.dataFreshness).toEqual({
      lastIngestAt: null,
      lastIngestStatus: null,
      lastIngestSummary: null,
    });
  });

  it("공고에 이 조직의 분석·결정을 붙여 읽고 마감 지난 OPEN 은 CLOSED 로 바꾼다", async () => {
    fakeDb.on(
      "bid_notices",
      fakeDb.rows([
        {
          id: "bid-1",
          title: "공고",
          stage: "NOTICE",
          status: "OPEN",
          deadline_at: "2020-01-01T00:00:00+00:00",
          score_runs: [
            {
              id: "run-1",
              status: "COMPLETED",
              recommendation: "BID",
              review_flags: ["KEV_NEEDS_REVIEW", "CITATION_FAILED"],
              created_at: "2026-10-18T00:00:00+00:00",
            },
          ],
          bid_reviews: [
            { decision: "WATCH", disagreement_flag: true, decided_at: "2026-10-18T01:00:00+00:00" },
          ],
        },
      ]),
    );
    fakeDb.on("rpc:latest_ingest_run", { data: [] });
    fakeDb.on("notifications", { data: null, count: 3 });
    const source = await repo.load(ORG, "demo");
    expect(source.bids).toEqual([
      {
        bidId: "bid-1",
        title: "공고",
        stage: "NOTICE",
        status: "CLOSED",
        deadlineAt: "2020-01-01T00:00:00+00:00",
        analyses: [
          {
            id: "run-1",
            status: "COMPLETED",
            recommendation: "BID",
            reviewFlagCount: 2,
            createdAt: "2026-10-18T00:00:00+00:00",
          },
        ],
        reviews: [
          { decision: "WATCH", disagreementFlag: true, decidedAt: "2026-10-18T01:00:00+00:00" },
        ],
      },
    ]);
    const bids = only("bid_notices");
    expect(callsOf(bids, "eq")).toEqual(
      expect.arrayContaining([
        ["score_runs.org_id", ORG],
        ["bid_reviews.org_id", ORG],
        ["is_demo", true],
      ]),
    );
    const select = String(callsOf(bids, "select")[0]?.[0]);
    expect(select).toContain(
      "score_runs!score_runs_bid_id_fkey(id,status,recommendation,review_flags,created_at)",
    );
    expect(select).toContain(
      "bid_reviews!bid_reviews_bid_id_fkey(decision,disagreement_flag,decided_at)",
    );
  });

  it("안 읽은 알림 수는 head count 로 세고, ai 는 주입한 상태다", async () => {
    respond([]);
    const source = await repo.load(ORG, "all");
    expect(source.unreadNotifications).toBe(3);
    expect(source.ai).toEqual(AI);
    const q = only("notifications");
    expect(callsOf(q, "select")).toEqual([["id", { count: "exact", head: true }]]);
    expect(callsOf(q, "is")).toEqual([["read_at", null]]);
    expect(callsOf(q, "eq")).toEqual([["channel", "IN_APP"]]);
    expect(callsOf(only("bid_notices"), "eq").some(([column]) => column === "is_demo")).toBe(false);
  });

  it("DB 오류는 던진다", async () => {
    fakeDb.on("bid_notices", { error: new Error("db down") });
    fakeDb.on("rpc:latest_ingest_run", { data: [] });
    fakeDb.on("notifications", { count: 0 });
    await expect(repo.load(ORG, "all")).rejects.toThrow("db down");
  });
});

// M3: 업무 틀(layout)의 상단바는 신선도·안 읽은 수만 읽는다. 공고 전체 집계와 AI 프로브를 부르지 않는다.
describe("dashboard.loadStatus", () => {
  it("수집 신선도와 안 읽은 수만 읽고, 공고·AI 상태는 읽지 않는다", async () => {
    const aiStatus = vi.fn(async () => AI);
    const light = createDashboardRepo({ aiStatus });
    fakeDb.on("rpc:latest_ingest_run", {
      data: [
        {
          status: "SUCCEEDED",
          started_at: "2026-10-19T00:00:00+00:00",
          finished_at: "2026-10-19T00:01:00+00:00",
          summary,
        },
      ],
    });
    fakeDb.on("notifications", { data: null, count: 4 });
    const status = await light.loadStatus("demo");
    expect(status).toEqual({
      dataFreshness: {
        lastIngestAt: "2026-10-19T00:01:00+00:00",
        lastIngestStatus: "SUCCEEDED",
        lastIngestSummary: summary,
      },
      unreadNotifications: 4,
    });
    expect(aiStatus).not.toHaveBeenCalled();
    expect(fakeDb.queries("bid_notices")).toHaveLength(0);
    expect(only("rpc:latest_ingest_run").calls[0]).toEqual({
      method: "rpc",
      args: ["latest_ingest_run", { p_origin: "demo" }],
    });
    const q = only("notifications");
    expect(callsOf(q, "select")).toEqual([["id", { count: "exact", head: true }]]);
    expect(callsOf(q, "is")).toEqual([["read_at", null]]);
    expect(callsOf(q, "eq")).toEqual([["channel", "IN_APP"]]);
  });

  it("DB 오류는 던진다", async () => {
    fakeDb.on("rpc:latest_ingest_run", { error: new Error("rpc down") });
    fakeDb.on("notifications", { count: 0 });
    await expect(repo.loadStatus("live")).rejects.toThrow("rpc down");
  });
});
