import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidListQuery } from "./bid-query";
import { createBidsRepo } from "./bids.supabase";
import { callsOf, fakeDb, listRow, type FakeQuery } from "./supabase-fake.test-data";

// ADR-069: 공고 고르기 목록(/workforce·/analysis·GET /api/v1/bids)은 IT 범위 공고만, 관심 목록은 범위 밖도 보인다.

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
  origin: "live",
  sort: "publishedAt:desc",
  cursor: null,
  limit: 20,
};
const IT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const table = [
  listRow({ id: IT, is_demo: false, it_scope: true }),
  listRow({ id: OTHER, is_demo: false, it_scope: false }),
];

// 가짜 DB 가 기록된 it_scope 조건대로 거른다. 건수 질의(head)에는 거른 행 수를 준다.
const respond = (q: FakeQuery) => {
  const scope = callsOf(q, "eq").find(([column]) => column === "it_scope");
  const rows = scope === undefined ? table : table.filter((row) => row.it_scope === scope[1]);
  return { data: rows, count: rows.length };
};
const scopeCalls = (target: string) =>
  fakeDb.queries(target).map((q) => callsOf(q, "eq").filter(([column]) => column === "it_scope"));

beforeEach(() => {
  fakeDb.reset();
  fakeDb.on("bid_list_items", respond);
  fakeDb.on("watched_bid_list_items", respond);
});

describe("공고 고르기 목록의 IT 범위(ADR-069)", () => {
  it("목록과 건수는 it_scope=true 를 걸고, watched=me 는 걸지 않는다", async () => {
    const repo = createBidsRepo({ runMode: "live", algorithmVersion: "v" });
    const page = await repo.listBids(ORG, query, null);
    expect(page.items.map((item) => item.id)).toEqual([IT]);
    expect(await repo.countBids(ORG, query)).toBe(1);
    expect(scopeCalls("bid_list_items")).toEqual([[["it_scope", true]], [["it_scope", true]]]);

    const watched = await repo.listBids(ORG, { ...query, watched: "me" }, null);
    expect(watched.items.map((item) => item.id)).toEqual([IT, OTHER]);
    expect(scopeCalls("watched_bid_list_items")).toEqual([[]]);
  });
});
