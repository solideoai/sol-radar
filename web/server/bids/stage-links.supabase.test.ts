import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageLinkRow } from "./stage-links.repo";
import { stageLinksRepo } from "./stage-links.supabase";
import { callsOf, fakeDb, type FakeQuery } from "./supabase-fake.test-data";

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

beforeEach(() => fakeDb.reset());

const stored = (id: string, patch: Partial<StageLinkRow> = {}) => ({
  id,
  stage: "NOTICE",
  notice_id: `N-${id}`,
  plan_ref: null,
  pre_spec_ref: null,
  title: `공고 ${id}`,
  agency: null,
  status: "OPEN",
  deadline_at: null,
  is_demo: true,
  ...patch,
});

const anchorOf = (patch: Partial<StageLinkRow> = {}): StageLinkRow => ({
  id: "anchor",
  stage: "PRE_SPEC",
  notice_id: "PS-1",
  plan_ref: "P-1",
  pre_spec_ref: null,
  title: "사전규격",
  agency: null,
  status: "OPEN",
  deadline_at: null,
  is_demo: true,
  ...patch,
});

// eq 호출을 [열, 값] 으로 모은다.
const eqsOf = (query: FakeQuery): unknown[][] => callsOf(query, "eq");
// 후보 풀은 단계를 neq 로 거르는 질의 하나다.
const isPool = (query: FakeQuery): boolean =>
  callsOf(query, "neq").some(([column]) => column === "stage");
const LIMITS = { pool: 300, identifier: 50 };
const NEWEST_FIRST = [
  ["published_at", { ascending: false, nullsFirst: false }],
  ["id", { ascending: false }],
];

describe("stageLinksRepo.findAnchor", () => {
  it("id 로 한 줄을 읽어 단계·상태를 값 집합으로 확인한다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([stored("b1", { stage: "PLAN", plan_ref: "P-1" })]));
    const anchor = await stageLinksRepo.findAnchor("b1");
    expect(anchor).toMatchObject({ id: "b1", stage: "PLAN", plan_ref: "P-1", status: "OPEN" });
    const [query] = fakeDb.queries("bid_notices");
    expect(eqsOf(query)).toEqual([["id", "b1"]]);
    expect(callsOf(query, "maybeSingle")).toHaveLength(1);
  });

  it("없으면 null 이다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    expect(await stageLinksRepo.findAnchor("none")).toBeNull();
  });

  it("값 집합 밖의 단계는 던진다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ ...stored("b1"), stage: "CONTRACT" }]));
    await expect(stageLinksRepo.findAnchor("b1")).rejects.toThrow();
  });

  it("DB 오류는 던진다", async () => {
    fakeDb.on("bid_notices", { error: new Error("db down") });
    await expect(stageLinksRepo.findAnchor("b1")).rejects.toThrow("db down");
  });
});

describe("stageLinksRepo.findRelated", () => {
  it("질의마다 같은 is_demo·자기 제외를 걸고, 식별자 질의와 후보 풀을 나눈다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    await stageLinksRepo.findRelated(anchorOf({ pre_spec_ref: "PS-0" }), LIMITS);
    const queries = fakeDb.queries("bid_notices");
    // plan_ref · 지금 공고가 가리키는 사전규격 · 이 사전규격을 가리키는 공고 · 후보 풀
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(eqsOf(query)).toContainEqual(["is_demo", true]);
      expect(callsOf(query, "neq")).toContainEqual(["id", "anchor"]);
    }
    const withEq = (column: string, value: unknown) =>
      queries.filter((query) =>
        eqsOf(query).some(([name, given]) => name === column && given === value),
      );
    expect(withEq("plan_ref", "P-1")).toHaveLength(1);
    const [preSpecOfAnchor] = withEq("notice_id", "PS-0");
    expect(eqsOf(preSpecOfAnchor)).toContainEqual(["stage", "PRE_SPEC"]);
    expect(withEq("pre_spec_ref", "PS-1")).toHaveLength(1);
    const pools = queries.filter(isPool);
    expect(pools).toHaveLength(1);
    const [pool] = pools;
    expect(callsOf(pool, "neq")).toContainEqual(["stage", "PRE_SPEC"]);
    expect(callsOf(pool, "order")).toEqual(NEWEST_FIRST);
    expect(callsOf(pool, "limit")).toEqual([[300]]);
  });

  it("식별자 질의도 최근 게시일 순으로 identifier 건만 읽는다(같은 plan_ref 가 많을 때 상한)", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    await stageLinksRepo.findRelated(anchorOf({ pre_spec_ref: "PS-0" }), LIMITS);
    const identifiers = fakeDb.queries("bid_notices").filter((query) => !isPool(query));
    expect(identifiers).toHaveLength(3);
    for (const query of identifiers) {
      expect(callsOf(query, "order")).toEqual(NEWEST_FIRST);
      expect(callsOf(query, "limit")).toEqual([[50]]);
    }
  });

  it("식별자가 없는 입찰공고는 후보 풀만 읽는다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    await stageLinksRepo.findRelated(anchorOf({ stage: "NOTICE", plan_ref: null }), LIMITS);
    const queries = fakeDb.queries("bid_notices");
    expect(queries).toHaveLength(1);
    expect(callsOf(queries[0], "limit")).toEqual([[300]]);
  });

  it("빈 문자열 식별자로는 잇지 않는다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    await stageLinksRepo.findRelated(
      anchorOf({ stage: "NOTICE", plan_ref: "  ", pre_spec_ref: "" }),
      LIMITS,
    );
    expect(fakeDb.queries("bid_notices")).toHaveLength(1);
  });

  it("실공고면 is_demo false 로 거른다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    await stageLinksRepo.findRelated(anchorOf({ is_demo: false }), LIMITS);
    for (const query of fakeDb.queries("bid_notices")) {
      expect(eqsOf(query)).toContainEqual(["is_demo", false]);
    }
  });

  it("여러 질의에 같은 행이 와도 한 번만 돌려준다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([stored("plan", { stage: "PLAN", plan_ref: "P-1" })]));
    const rows = await stageLinksRepo.findRelated(anchorOf(), LIMITS);
    expect(rows.map(({ id }) => id)).toEqual(["plan"]);
  });

  it("질의 하나라도 오류면 던진다", async () => {
    fakeDb.on("bid_notices", (query) =>
      isPool(query) ? { error: new Error("pool failed") } : { data: [] },
    );
    await expect(stageLinksRepo.findRelated(anchorOf(), LIMITS)).rejects.toThrow("pool failed");
  });
});
