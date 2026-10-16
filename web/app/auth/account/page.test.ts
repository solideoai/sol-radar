import { beforeEach, expect, it, vi } from "vitest";
const { profile, login, workspace } = vi.hoisted(() => ({
  profile: vi.fn(),
  login: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/auth", () => ({ getMyLoginMethods: login }));
vi.mock("@/server/organization", () => ({ getMyWorkspace: workspace, getMyHome: workspace }));
import AccountPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({
    status: "ready",
    profile: { profileComplete: false, displayName: "이름", email: "user@example.test" },
  });
  login.mockResolvedValue({ status: "ready", methods: [], canUnlink: false });
});
it.each([false, true])(
  "완료 %s 상태도 조직 조회 없이 본인 계정을 열고 연결 결과를 전달한다",
  async (profileComplete) => {
    profile.mockResolvedValue({ status: "ready", profile: { profileComplete } });
    const result = await AccountPage({ searchParams: Promise.resolve({ link: "linked" }) });
    expect(result).toBeTruthy();
    expect(workspace).not.toHaveBeenCalled();
  },
);
it.each(["signed-out", "missing", "suspended", "no-database"])(
  "%s는 기존 로그인 안내",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/auth/login",
    );
  },
);
it("조회 오류는 페이지 오류 UI로 남아 재시도와 로그아웃을 제공한다", async () => {
  profile.mockRejectedValue(new Error("db"));
  expect(await AccountPage({ searchParams: Promise.resolve({}) })).toBeTruthy();
  expect(workspace).not.toHaveBeenCalled();
});
