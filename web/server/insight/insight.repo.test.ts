import { beforeEach, describe, expect, it, vi } from "vitest";
import { insightRepo } from "./insight.repo";

// 가짜 Supabase. eq 로 거르고 order·limit 을 받은 대로 적용한다. insert 는 insertError 가 있으면 그 오류를 돌려준다.
const { rows, insertError } = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  insertError: { current: null as { code: string; message: string } | null },
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: () => {
      const filters: [string, unknown][] = [];
      const orders: [string, boolean][] = [];
      let limit = Infinity;
      let inserting = false;
      const selected = () =>
        rows
          .filter((row) => filters.every(([key, value]) => row[key] === value))
          .sort((a, b) => {
            for (const [key, ascending] of orders) {
              const order = String(a[key]).localeCompare(String(b[key]));
              if (order !== 0) return ascending ? order : -order;
            }
            return 0;
          })
          .slice(0, limit);
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        order: (key: string, options: { ascending: boolean }) => {
          orders.push([key, options.ascending]);
          return builder;
        },
        limit: (count: number) => {
          limit = count;
          return builder;
        },
        insert: () => {
          inserting = true;
          return builder;
        },
        maybeSingle: async () => ({ data: selected()[0] ?? null, error: null }),
        single: async () =>
          inserting && insertError.current !== null
            ? { data: null, error: insertError.current }
            : { data: { id: "new-insight" }, error: null },
      };
      return builder;
    },
  }),
}));

const ORG = "0f000000-0000-4000-8000-000000000001";
const RUN = "c1000000-0000-4000-8000-000000000001";
const row = (id: string, runId: string, createdAt: string, status = "FAILED") => ({
  id,
  org_id: ORG,
  score_run_id: runId,
  status,
  source: null,
  payload: null,
  fallback_reason: null,
  model_name: null,
  error_code: status === "FAILED" ? "STALE" : null,
  created_at: createdAt,
  finished_at: status === "FAILED" ? createdAt : null,
});

beforeEach(() => {
  rows.length = 0;
  insertError.current = null;
});

describe("insightRepo", () => {
  it("latestInsight 는 그 run 의 최신 1건만 본다 — 다른 run 의 더 새 행은 무시한다", async () => {
    rows.push(
      row("old", RUN, "2026-10-29T01:00:00.000Z"),
      row("latest", RUN, "2026-10-29T02:00:00.000Z", "PENDING"),
      row("other-run", "c1000000-0000-4000-8000-000000000002", "2026-10-29T03:00:00.000Z"),
    );
    expect(await insightRepo.latestInsight(ORG, RUN)).toEqual({
      id: "latest",
      scoreRunId: RUN,
      status: "PENDING",
      source: null,
      payload: null,
      fallbackReason: null,
      modelName: null,
      errorCode: null,
      createdAt: "2026-10-29T02:00:00.000Z",
      finishedAt: null,
    });
    expect(await insightRepo.latestInsight("0f000000-0000-4000-8000-000000000002", RUN)).toBeNull();
  });

  it("insertPending 은 같은 run 의 PENDING 유일 위반만 null 로 바꾸고, 다른 오류는 던진다", async () => {
    expect(await insightRepo.insertPending(ORG, RUN)).toBe("new-insight");
    insertError.current = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "recommendation_insights_one_pending"',
    };
    expect(await insightRepo.insertPending(ORG, RUN)).toBeNull();
    insertError.current = {
      code: "42501",
      message: 'new row violates row-level security policy for table "recommendation_insights"',
    };
    await expect(insightRepo.insertPending(ORG, RUN)).rejects.toMatchObject({ code: "42501" });
  });
});
