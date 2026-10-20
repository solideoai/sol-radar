import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidListOrigin, BidListQuery } from "./bid-query";
import { createBidsRepo } from "./bids.supabase";
import { callsOf, fakeDb, type FakeQuery } from "./supabase-fake.test-data";

// 11 V2-02: 출처 필터는 is_demo 조건 하나로만 옮긴다. all 은 조건이 없다.

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const repo = createBidsRepo({ runMode: "fixture", algorithmVersion: "v" });
const query = (origin: BidListOrigin): BidListQuery => ({
  q: null,
  stage: [],
  status: ["OPEN", "AMENDED"],
  deadlineFrom: null,
  deadlineTo: null,
  recommendation: [],
  decision: [],
  origin,
  sort: "publishedAt:desc",
  cursor: null,
  limit: 20,
});

const isDemoConditions = (q: FakeQuery) =>
  q.calls.filter((call) => call.args[0] === "is_demo" || String(call.args[0]).includes("is_demo"));

beforeEach(() => {
  fakeDb.reset();
  fakeDb.on("bid_list_items", fakeDb.rows([]));
});

describe("출처 필터(V2-02)", () => {
  it.each([
    ["demo", true],
    ["live", false],
  ] as const)("%s → eq is_demo %s", async (origin, value) => {
    await repo.listBids(ORG, query(origin), null);
    const [q] = fakeDb.queries("bid_list_items");
    expect(q).toBeDefined();
    expect(isDemoConditions(q as FakeQuery)).toEqual([{ method: "eq", args: ["is_demo", value] }]);
  });

  it("all → is_demo 조건이 없다", async () => {
    await repo.listBids(ORG, query("all"), null);
    const [q] = fakeDb.queries("bid_list_items");
    expect(isDemoConditions(q as FakeQuery)).toEqual([]);
    expect(callsOf(q as FakeQuery, "eq")).toEqual([]);
  });
});
