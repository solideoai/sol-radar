import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { directory, profile, business, workspace, access } = vi.hoisted(() => ({
  directory: vi.fn(),
  profile: vi.fn(),
  business: vi.fn(),
  workspace: vi.fn(),
  access: { authenticate: vi.fn(), getMyEmployment: vi.fn(), getMyBusinessAccess: vi.fn() },
}));
vi.mock("@/app/_lib/people-access", () => ({ peopleAccess: access }));
vi.mock("@/server/people", () => ({ getPeopleDirectory: directory }));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({
  getMyBusinessAccess: business,
  getMyWorkspace: workspace,
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(callback: T) => callback,
}));
import PeopleLayout from "./layout";
const current = {
  id: "org",
  slug: "solideo",
  name: "솔리데오",
  isPersonal: false,
  myRole: "member",
};
beforeEach(() => {
  vi.clearAllMocks();
  directory.mockResolvedValue({
    status: "ready",
    data: {
      departments: [],
      jobTitles: [],
      members: [],
      summary: { totalCount: 0, scoringCount: 0 },
    },
  });
  profile.mockResolvedValue({
    status: "ready",
    profile: { displayName: "조회 사용자", email: null, avatarUrl: null, isAdmin: false },
  });
  business.mockResolvedValue({
    status: "ready",
    userId: "user",
    current: { ...current, solRole: "VIEWER" },
  });
  workspace.mockResolvedValue({ status: "ready", current, orgs: [], pendingInvitationCount: 0 });
});
describe("scoped people layout", () => {
  it("uses guarded service and existing shell with sidebar open", async () => {
    const result = await PeopleLayout({ children: "인력 내용" });
    expect(directory).toHaveBeenCalledWith(access);
    expect(workspace).toHaveBeenCalledWith("solideo");
    expect(result.props.defaultSidebarOpen).toBe(true);
    expect(result.props.children).toBe("인력 내용");
  });
  it("denies invalid role without shell or profile data requests", async () => {
    directory.mockResolvedValue({ status: "error", error: { code: "FORBIDDEN", details: {} } });
    const result = await PeopleLayout({ children: "비공개 인력" });
    expect(renderToStaticMarkup(result)).toContain("조회 권한이 없습니다");
    expect(renderToStaticMarkup(result)).not.toContain("비공개 인력");
    expect(workspace).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalled();
  });
  it("redirects organization required before shell requests", async () => {
    directory.mockResolvedValue({
      status: "error",
      error: { code: "FORBIDDEN", details: { reason: "ORGANIZATION_REQUIRED" } },
    });
    await expect(PeopleLayout({ children: "비공개" })).rejects.toThrow(
      "redirect:/auth/organization-state",
    );
    expect(workspace).not.toHaveBeenCalled();
  });
});
