import { beforeEach, expect, it, vi } from "vitest";
const { profile, home } = vi.hoisted(() => ({ profile: vi.fn(), home: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({ getCurrentOrganization: home }));
import LoginPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
  home.mockResolvedValue({ status: "ready", userId: "me", current: { slug: "mine" } });
});
it("next보다 먼저 현재 서버 완료 상태를 확인한다", async () => {
  await expect(
    LoginPage({ searchParams: Promise.resolve({ next: "/alpha/tasks" }) }),
  ).rejects.toThrow("REDIRECT:/auth/complete-profile?next=%2Falpha%2Ftasks");
  expect(home).not.toHaveBeenCalled();
});
it("완료자는 업무 대시보드로 이동한다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "REDIRECT:/dashboard",
  );
});

it.each(["no-org", "multiple-orgs"])(
  "%s routes through state rather than missing profile or forged next",
  async (status) => {
    profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
    home.mockResolvedValue({ status, userId: "me" });
    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "https://evil.test" }) }),
    ).rejects.toThrow("REDIRECT:/auth/organization-state");
  },
);
