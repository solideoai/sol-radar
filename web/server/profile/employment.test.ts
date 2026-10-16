import { describe, expect, it, vi } from "vitest";
import { employmentStateSchema } from "@/server/shared";
import { toEmploymentState, type ProfileRow } from "./profile.model";
import type { ProfileRepo } from "./profile.repo";
import { getMyEmployment, saveMyEmployment } from "./profile.service";

const employment = {
  companyName: "솔리데오" as const,
  departmentId: "SOL-D001",
  departmentName: "AX사업본부 AI플랫폼운영팀",
  jobTitleId: "SOL-J007",
  jobTitleLabel: "팀장",
};
const row = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  email: "a@example.com",
  is_admin: false,
  display_name: "홍길동",
  avatar_url: null,
  status: "active",
  created_at: "2026-10-16T00:00:00Z",
  employment,
  ...overrides,
});
const repoOf = (overrides: Partial<ProfileRepo> = {}): ProfileRepo => ({
  isConfigured: () => true,
  currentUserId: async () => "user-a",
  findById: async () => row(),
  updateDisplayName: async () => true,
  updateEmployment: async () => true,
  deleteAccount: async () => "deleted",
  ...overrides,
});
const input = { name: " 홍길동 ", departmentId: "SOL-D001", jobTitleId: "SOL-J007" };

describe("employment state", () => {
  it("requires a current valid name and both resolved selections for completeness", () => {
    expect(toEmploymentState(row())).toEqual({ name: "홍길동", employment, profileComplete: true });
    expect(toEmploymentState(row({ display_name: null }))).toEqual({
      name: null,
      employment,
      profileComplete: false,
    });
    expect(toEmploymentState(row({ employment: null })).profileComplete).toBe(false);
    expect(toEmploymentState(row({ display_name: " " })).profileComplete).toBe(false);
    expect(employmentStateSchema.safeParse(toEmploymentState(row())).success).toBe(true);
  });
});

describe("my employment service", () => {
  it("gets only the authenticated person's row", async () => {
    const findById = vi.fn(async () => row());
    expect(await getMyEmployment(repoOf({ findById }))).toMatchObject({
      status: "ready",
      state: { profileComplete: true },
    });
    expect(findById).toHaveBeenCalledWith("user-a");
  });
  it("atomically saves only the session identity and returns persisted state", async () => {
    let persisted = row({ employment: null });
    const updateEmployment = vi.fn(async (_id: string, value: { name: string }) => {
      persisted = row({ display_name: value.name });
      return true;
    });
    expect(
      await saveMyEmployment(input, repoOf({ updateEmployment, findById: async () => persisted })),
    ).toEqual({
      status: "ready",
      state: { name: "홍길동", employment, profileComplete: true },
    });
    expect(updateEmployment).toHaveBeenCalledWith("user-a", { ...input, name: "홍길동" });
  });
  it("returns field errors for invalid/unknown codes without writing", async () => {
    const updateEmployment = vi.fn(async () => true);
    for (const value of [
      { ...input, departmentId: "missing" },
      { ...input, jobTitleId: "missing" },
      { ...input, userId: "user-b" },
    ]) {
      expect(await saveMyEmployment(value, repoOf({ updateEmployment }))).toMatchObject({
        status: "invalid",
      });
    }
    expect(updateEmployment).not.toHaveBeenCalled();
  });
  it.each(["signed-out", "suspended", "missing", "no-database"] as const)(
    "does not write for %s",
    async (status) => {
      const updateEmployment = vi.fn(async () => true);
      const repo = repoOf({
        isConfigured: () => status !== "no-database",
        currentUserId: async () => (status === "signed-out" ? null : "user-a"),
        findById: async () =>
          status === "missing"
            ? null
            : row({ status: status === "suspended" ? "suspended" : "active" }),
        updateEmployment,
      });
      expect(await getMyEmployment(repo)).toEqual({ status });
      expect(await saveMyEmployment(input, repo)).toEqual({ status });
      expect(updateEmployment).not.toHaveBeenCalled();
    },
  );
  it("propagates arbitrary DB failures and does not claim success for a zero-row update", async () => {
    await expect(
      saveMyEmployment(
        input,
        repoOf({
          updateEmployment: async () => {
            throw new Error("db down");
          },
        }),
      ),
    ).rejects.toThrow("db down");
    await expect(
      saveMyEmployment(input, repoOf({ updateEmployment: async () => false })),
    ).rejects.toThrow();
  });
});
