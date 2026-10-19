import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { profile, business, workspace, summary } = vi.hoisted(() => ({
  profile: vi.fn(),
  business: vi.fn(),
  workspace: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({
  getMyBusinessAccess: business,
  getMyWorkspace: workspace,
}));
vi.mock("@/app/_lib/work-data", () => ({ loadStatusSummary: summary }));
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

import WorkLayout from "./layout";
import { requireWork } from "./work";

const BID = "6f1b7f0e-4a52-4c1e-9a43-0d2f6f6a9b11";
const current = {
  id: "org-1",
  slug: "solideo",
  name: "솔리데오",
  isPersonal: false,
  myRole: "member",
};
const originalMode = process.env.SOL_RUN_MODE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SOL_RUN_MODE;
  profile.mockResolvedValue({
    status: "ready",
    profile: {
      displayName: "영업",
      email: null,
      avatarUrl: null,
      isAdmin: false,
      profileComplete: true,
    },
  });
  business.mockResolvedValue({
    status: "ready",
    userId: "user-1",
    current: { ...current, solRole: "SALES" },
  });
  workspace.mockResolvedValue({ status: "ready", current, orgs: [], pendingInvitationCount: 0 });
  summary.mockResolvedValue({ dataFreshness: { status: "NEVER" }, unreadNotifications: 3 });
});
afterEach(() => {
  if (originalMode === undefined) delete process.env.SOL_RUN_MODE;
  else process.env.SOL_RUN_MODE = originalMode;
});

describe("requireWork", () => {
  it.each(["signed-out", "suspended", "missing"])(
    "%s 프로필이면 로그인으로 보낸다",
    async (status) => {
      profile.mockResolvedValue({ status });
      await expect(requireWork("/dashboard")).rejects.toThrow("redirect:/auth/login");
    },
  );

  it("가입 미완료면 돌아올 곳을 달아 프로필 완성으로 보낸다", async () => {
    profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
    await expect(requireWork(`/bids/${BID}`)).rejects.toThrow(
      `redirect:/auth/complete-profile?next=${encodeURIComponent(`/bids/${BID}`)}`,
    );
  });

  it.each(["no-org", "multiple-orgs", "forbidden"])(
    "업무 조직 상태 %s 면 조직 상태 화면으로 보낸다",
    async (status) => {
      business.mockResolvedValue({ status, userId: "user-1" });
      await expect(requireWork("/notifications")).rejects.toThrow(
        "redirect:/auth/organization-state?next=%2Fnotifications",
      );
    },
  );

  it("업무 조직 확인 중 로그아웃이면 로그인으로 보낸다", async () => {
    business.mockResolvedValue({ status: "signed-out" });
    await expect(requireWork("/bids")).rejects.toThrow("redirect:/auth/login");
  });

  it("DB 가 없으면 던진다(error.tsx 몫)", async () => {
    profile.mockResolvedValue({ status: "no-database" });
    await expect(requireWork("/dashboard")).rejects.toThrow("no-database");
  });

  it("SALES + live 이면 맥락을 돌려준다", async () => {
    process.env.SOL_RUN_MODE = "live";
    const context = await requireWork("/dashboard");
    expect(context).toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      role: "SALES",
      runMode: "live",
    });
    expect(context.org.slug).toBe("solideo");
  });

  it("SOL_RUN_MODE 가 없으면 mock 이다", async () => {
    expect((await requireWork("/dashboard")).runMode).toBe("mock");
  });
});

describe("(work) layout", () => {
  it("셸에 실행 모드와 첫 요약을 싣는다", async () => {
    const result = await WorkLayout({ children: "본문" });
    expect(summary).toHaveBeenCalledWith("demo");
    expect(result.props.status).toEqual({
      runMode: "mock",
      initialSummary: { dataFreshness: { status: "NEVER" }, unreadNotifications: 3 },
      initialAi: null,
    });
    expect(result.props.children).toBe("본문");
  });

  it("요약이 실패해도 셸은 남긴다", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    summary.mockRejectedValue(new Error("down"));
    const result = await WorkLayout({ children: "본문" });
    expect(result.props.status.initialSummary).toBeNull();
    expect(result.props.children).toBe("본문");
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("로그아웃이면 로그인으로 보낸다", async () => {
    business.mockResolvedValue({ status: "signed-out" });
    await expect(WorkLayout({ children: "x" })).rejects.toThrow("redirect:/auth/login");
  });
});
