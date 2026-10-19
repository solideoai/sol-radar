import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidListQuery } from "./bid-query";
import { createBidsRepo } from "./bids.supabase";
import { callsOf, fakeDb, listRow } from "./supabase-fake.test-data";

// 11 G8: demo 출처 목록에는 가상(isDemo) 공고만 나온다.

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const query: BidListQuery = {
  q: null,
  stage: [],
  status: ["OPEN", "AMENDED"],
  deadlineFrom: null,
  deadlineTo: null,
  recommendation: [],
  decision: [],
  origin: "demo",
  sort: "publishedAt:desc",
  cursor: null,
  limit: 20,
};

// 가상·실제 공고가 섞인 표. 가짜 DB 가 기록된 is_demo 조건대로 거른다.
const table = [
  listRow({ id: "aaaaaaaa-0000-4000-8000-000000000001", is_demo: true }),
  listRow({ id: "aaaaaaaa-0000-4000-8000-000000000002", is_demo: false }),
  listRow({ id: "aaaaaaaa-0000-4000-8000-000000000003", is_demo: true }),
  listRow({ id: "aaaaaaaa-0000-4000-8000-000000000004", is_demo: false }),
];

beforeEach(() => {
  fakeDb.reset();
  fakeDb.on("bid_list_items", (q) => {
    const demo = callsOf(q, "eq").find(([column]) => column === "is_demo");
    return { data: demo === undefined ? table : table.filter((row) => row.is_demo === demo[1]) };
  });
});

describe("demo 플래그(G8)", () => {
  it("origin=demo 목록의 모든 항목이 isDemo === true 이고 demo 출처다", async () => {
    const page = await createBidsRepo({ runMode: "fixture", algorithmVersion: "v" }).listBids(
      ORG,
      query,
      null,
    );
    expect(page.items).toHaveLength(2);
    expect(page.items.every((item) => item.isDemo === true)).toBe(true);
    expect(page.items.every((item) => item.origin === "demo")).toBe(true);
  });

  it("origin=live 목록에는 가상 공고가 없다", async () => {
    const page = await createBidsRepo({ runMode: "live", algorithmVersion: "v" }).listBids(
      ORG,
      { ...query, origin: "live" },
      null,
    );
    expect(page.items).toHaveLength(2);
    expect(page.items.some((item) => item.isDemo)).toBe(false);
  });
});
