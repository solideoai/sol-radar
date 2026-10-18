import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { peopleRepo } from "./people.repo";
const state = vi.hoisted(() => ({
  table: "",
  columns: "",
  filters: [] as [string, string][],
  rows: [] as unknown[],
  error: null as Error | null,
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: (table: string) => {
      state.table = table;
      const query = {
        select: (columns: string) => {
          state.columns = columns;
          return query;
        },
        eq: (column: string, value: string) => {
          state.filters.push([column, value]);
          return query;
        },
        order: () => query,
        maybeSingle: async () => ({ data: state.rows[0] ?? null, error: state.error }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: state.rows, error: state.error }).then(resolve),
      };
      return query;
    },
  }),
}));
beforeEach(() => {
  state.filters = [];
  state.rows = [];
  state.error = null;
});
describe("user RLS read repositories", () => {
  it.each([
    ["listDepartments", "departments"],
    ["listJobTitles", "job_titles"],
    ["listMembers", "team_members"],
    ["listScoring", "team_member_scoring"],
  ] as const)("%s reads only current organization", async (method, table) => {
    const row = { id: "row" };
    state.rows = [row];
    expect(await peopleRepo[method]("org-current")).toEqual([row]);
    expect(state.table).toBe(table);
    expect(state.filters).toEqual([["org_id", "org-current"]]);
    expect(state.columns).not.toContain("*");
    expect(state.columns).not.toMatch(/gender|email|phone|user_id|employment_status/);
  });
  it.each([
    ["findMember", "team_members", "id"],
    ["findScoring", "team_member_scoring", "member_id"],
  ] as const)("%s requires org and member id", async (method, table, column) => {
    state.rows = [{ id: "row" }];
    expect(await peopleRepo[method]("org-current", "member-uuid")).toEqual({ id: "row" });
    expect(state.table).toBe(table);
    expect(state.filters).toEqual([
      ["org_id", "org-current"],
      [column, "member-uuid"],
    ]);
  });
  it("does not replace database errors with empty success", async () => {
    state.error = new Error("database failure");
    for (const method of [
      "listDepartments",
      "listJobTitles",
      "listMembers",
      "listScoring",
    ] as const)
      await expect(peopleRepo[method]("org")).rejects.toThrow("database failure");
    for (const method of ["findMember", "findScoring"] as const)
      await expect(peopleRepo[method]("org", "id")).rejects.toThrow("database failure");
  });
});
