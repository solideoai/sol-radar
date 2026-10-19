import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { businessAccessRepo } from "./business-access.repo";

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: vi.fn(async () => query),
}));

beforeEach(() => {
  vi.resetAllMocks();
  query.from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
});

describe("businessAccessRepo.findSolRole", () => {
  it("reads only the current organization and session user's business role", async () => {
    query.maybeSingle.mockResolvedValue({ data: { sol_role: "ANALYST" }, error: null });
    await expect(businessAccessRepo.findSolRole("current-org", "session-user")).resolves.toBe(
      "ANALYST",
    );
    expect(query.from).toHaveBeenCalledExactlyOnceWith("memberships");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("sol_role");
    expect(query.eq.mock.calls).toEqual([
      ["org_id", "current-org"],
      ["user_id", "session-user"],
    ]);
  });
  it("returns null for a membership that disappeared or was filtered by RLS", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(businessAccessRepo.findSolRole("current-org", "session-user")).resolves.toBeNull();
  });
  it("does not swallow a database error", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: new Error("connection failed") });
    await expect(businessAccessRepo.findSolRole("current-org", "session-user")).rejects.toThrow(
      "connection failed",
    );
  });
});
