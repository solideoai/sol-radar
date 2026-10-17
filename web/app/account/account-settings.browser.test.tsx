import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AccountCard, AccountHeader } from "@/app/auth/account-card";
import type { ProfileView } from "@/server/profile";
import { AccountSettings } from "./account-settings";

const { router, saveDisplayName, linkIdentity } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  saveDisplayName: vi.fn(),
  linkIdentity: vi.fn(),
}));
vi.mock("next/image", () => ({ __esModule: true, default: () => null }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: () => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    />
  ),
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => router,
  usePathname: () => "/auth/account",
}));
vi.mock("@/server/profile", () => ({ getMyProfile: vi.fn() }));
vi.mock("@/server/auth", () => ({ getMyLoginMethods: vi.fn() }));
vi.mock("@/lib/auth-providers", () => ({
  enabledSocialProviders: ["google"],
  socialProviderOf: (provider: string) => (provider === "google" ? "google" : null),
  SUPABASE_PROVIDER_ID: { google: "google" },
}));
vi.mock("./actions", () => ({
  saveDisplayName,
  unlinkLoginMethod: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { linkIdentity, signOut: vi.fn() } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const profile: ProfileView = {
  displayName: "긴이름".repeat(10),
  email: `${"long".repeat(30)}@example.test`,
  avatarUrl: null,
  role: "회원",
  isAdmin: false,
  joinedAt: "2026-10-16",
  employment: null,
  profileComplete: false,
};
const login = {
  status: "ready" as const,
  methods: [
    {
      identityId: "email-id",
      provider: "email",
      label: "이메일",
      email: profile.email,
      linkedAt: null,
      lastSignInAt: null,
    },
  ],
  canUnlink: false,
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  saveDisplayName.mockResolvedValue({ status: "saved" });
  linkIdentity.mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});
const render = () =>
  root.render(
    <AccountCard>
      <AccountHeader title="계정 관리">프로필과 로그인 정보를 관리합니다.</AccountHeader>
      <AccountSettings profile={profile} login={login} settingsPath="/auth/account" />
    </AccountCard>,
  );
it.each([1440, 1280])(
  "%s 폭에서 미완료 계정의 기존 다섯 구역과 긴 값이 인증 단폭 안에 있고 기존 저장을 쓴다",
  async (width) => {
    await page.viewport(width, 900);
    render();
    await expect.element(page.getByRole("heading", { name: "계정 관리" })).toBeVisible();
    expect(page.getByRole("heading", { level: 2 }).elements()).toHaveLength(5);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const input = page.getByRole("textbox", { name: "표시 이름" });
    await input.fill("수정한 이름");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => saveDisplayName.mock.calls).toEqual([["수정한 이름"]]);
    await page.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "회원 탈퇴", exact: true }))
      .toHaveFocus();
  },
);
it("계정 연결의 복귀 목적지는 조직 대신 같은 계정 관리 경로다", async () => {
  render();
  await page.getByRole("button", { name: "구글 연결", exact: true }).click();
  await expect.poll(() => linkIdentity.mock.calls.length).toBe(1);
  expect(linkIdentity.mock.calls[0][0]).toEqual({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Faccount&flow=link`,
    },
  });
});
