import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { parseGapQuery } from "./gaps.model";
import { readLiveNotices } from "./gaps.repo";

vi.mock("@/server/supabase", () => ({ getSupabase: async () => null }));

// 가짜 Supabase. bid_notices 요청의 (메서드, 인자)를 적고 정해 둔 한 쪽을 돌려준다.
const recordingClient = (calls: unknown[][], data: unknown[]) => {
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
    in: record("in"),
    is: record("is"),
    gt: record("gt"),
    order: record("order"),
    limit: record("limit"),
    overrideTypes: () => Promise.resolve({ data, error: null }),
  };
  return { from: record("from") } as unknown as SupabaseClient<Database>;
};

const stored = (id: string, itScope: boolean | null) => ({
  id,
  title: `공고 ${id} (가상)`,
  agency: "가상 기관",
  stage: "NOTICE",
  budget_krw: null,
  deadline_at: "2026-11-20T09:00:00+00:00",
  latest_revision: 1,
  last_synced_at: "2026-10-28T00:00:00+00:00",
  it_scope: itScope,
  revisions: [],
});

describe("gapsRepo — IT 범위(ADR-069)", () => {
  it("scope=all 이어도 it_scope=false 공고는 빠진다", async () => {
    // 예전 주소(?scope=all)는 받아도 무시한다. 대상은 늘 IT 범위다.
    const params = { scope: "all", assume: "ISMS_P" };
    expect(parseGapQuery(params)).toEqual({ assume: ["ISMS_P"] });

    const calls: unknown[][] = [];
    const rows = await readLiveNotices(
      recordingClient(calls, [stored("it", true), stored("other", false), stored("unknown", null)]),
      "2026-10-29T00:00:00.000Z",
    );
    expect(rows.map((row) => row.id)).toEqual(["it"]);
    const select = String(calls.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("it_scope");
    // 관련성 평가는 더 읽지 않는다(IT 범위 판정이 대신한다).
    expect(select).not.toContain("bid_relevance_assessments");
  });
});
