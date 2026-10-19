import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationRepo } from "./organization.repo";
import { businessAccessRepo } from "./business-access.repo";
import { getMyBusinessAccess } from "./business-access.service";

vi.mock("./organization.repo", () => ({
  organizationRepo: {
    isConfigured: vi.fn(),
    currentUser: vi.fn(),
    listMyOrgs: vi.fn(),
  },
}));
vi.mock("./business-access.repo", () => ({
  businessAccessRepo: { findSolRole: vi.fn() },
}));

const business = {
  orgId: "org-current",
  slug: "current-team",
  name: "현재 조직",
  isPersonal: false,
  role: "owner" as const,
};
const personal = { ...business, orgId: "personal", isPersonal: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationRepo.isConfigured).mockReturnValue(true);
  vi.mocked(organizationRepo.currentUser).mockResolvedValue({
    id: "session-user",
    email: "me@example.invalid",
  });
  vi.mocked(organizationRepo.listMyOrgs).mockResolvedValue([personal, business]);
  vi.mocked(businessAccessRepo.findSolRole).mockResolvedValue("VIEWER");
});

describe("getMyBusinessAccess", () => {
  it.each(["VIEWER", "ANALYST", "SALES", "ADMIN"])(
    "returns %s independently of organization ownership",
    async (solRole) => {
      vi.mocked(businessAccessRepo.findSolRole).mockResolvedValue(solRole);
      await expect(getMyBusinessAccess()).resolves.toEqual({
        status: "ready",
        userId: "session-user",
        current: {
          id: "org-current",
          slug: "current-team",
          name: "현재 조직",
          isPersonal: false,
          myRole: "owner",
          solRole,
        },
      });
      expect(businessAccessRepo.findSolRole).toHaveBeenCalledExactlyOnceWith(
        "org-current",
        "session-user",
      );
    },
  );
  it.each([
    { rows: [], status: "no-org" },
    { rows: [personal], status: "no-org" },
    { rows: [business, { ...business, orgId: "second" }], status: "multiple-orgs" },
  ])("propagates $status without reading a role", async ({ rows, status }) => {
    vi.mocked(organizationRepo.listMyOrgs).mockResolvedValue(rows);
    await expect(getMyBusinessAccess()).resolves.toEqual({ status, userId: "session-user" });
    expect(businessAccessRepo.findSolRole).not.toHaveBeenCalled();
  });
  it("does not read a role without database configuration or session", async () => {
    vi.mocked(organizationRepo.isConfigured).mockReturnValue(false);
    await expect(getMyBusinessAccess()).resolves.toEqual({ status: "no-database" });
    vi.mocked(organizationRepo.isConfigured).mockReturnValue(true);
    vi.mocked(organizationRepo.currentUser).mockResolvedValue(null);
    await expect(getMyBusinessAccess()).resolves.toEqual({ status: "signed-out" });
    expect(businessAccessRepo.findSolRole).not.toHaveBeenCalled();
  });
  it.each([null, "", "owner", "admin", "SUPER_ADMIN", " VIEWER"])(
    "rejects missing or invalid runtime role %s",
    async (role) => {
      vi.mocked(businessAccessRepo.findSolRole).mockResolvedValue(role);
      await expect(getMyBusinessAccess()).resolves.toEqual({ status: "forbidden" });
    },
  );
  it("propagates database failures rather than treating them as forbidden", async () => {
    vi.mocked(businessAccessRepo.findSolRole).mockRejectedValue(new Error("db unavailable"));
    await expect(getMyBusinessAccess()).rejects.toThrow("db unavailable");
  });
});
