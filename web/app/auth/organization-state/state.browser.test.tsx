import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
const { profile, organization, refresh, replace, signOut, toastError } = vi.hoisted(() => ({
  profile: vi.fn(),
  organization: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
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
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({ getCurrentOrganization: organization }));
vi.mock("@/server/auth", () => ({
  safeNextPath: (value: string | null) => value ?? "/auth/login",
}));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowser: () => ({ auth: { signOut } }) }));
import OrganizationStatePage from "./page";
import Loading from "./loading";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  signOut.mockResolvedValue({ error: null });
  host = document.createElement("div");
  host.className = "flex min-h-screen flex-col";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});
for (const width of [1440, 1280]) {
  for (const status of ["no-org", "multiple-orgs", "error", "loading"]) {
    it(`${width}px ${status}: readable actions, fixed desktop width and no overflow`, async () => {
      await page.viewport(width, 900);
      if (status === "error") organization.mockRejectedValue(new Error("database read"));
      else organization.mockResolvedValue({ status, userId: "me" });
      root.render(
        status === "loading" ? (
          <Loading />
        ) : (
          await OrganizationStatePage({ searchParams: Promise.resolve({}) })
        ),
      );
      await expect
        .element(page.getByRole("heading", { level: 1 }))
        .toHaveTextContent(status === "no-org" ? "조직 초대가 필요합니다" : "계정 상태 확인");
      await expect
        .element(page.getByRole("link", { name: "계정 관리" }))
        .toHaveAttribute("href", "/auth/account");
      await expect
        .element(page.getByRole("button", { name: "로그아웃", exact: true }))
        .toBeVisible();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const main = document.querySelector("main > div");
      expect(main?.getBoundingClientRect().width).toBeLessThanOrEqual(432);
      if (status === "no-org")
        await expect
          .element(page.getByRole("link", { name: "받은 초대 보기" }))
          .toHaveAttribute("href", "/invitations");
      if (status === "multiple-orgs")
        await expect
          .element(
            page.getByText("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요", { exact: true }),
          )
          .toBeVisible();
      if (status === "error")
        await expect
          .element(page.getByRole("alert"))
          .toHaveTextContent("계정 상태를 불러오지 못했습니다");
      if (status !== "loading") {
        await page
          .getByRole("button", { name: status === "error" ? "다시 시도" : "다시 확인" })
          .click();
        expect(refresh).toHaveBeenCalledOnce();
      }
      await page.screenshot({ path: `../../../test-results/task8-${width}-${status}.png` });
    });
  }
}
it("logout failure preserves the state and retry actions", async () => {
  organization.mockResolvedValue({ status: "no-org", userId: "me" });
  signOut.mockResolvedValue({ error: { message: "일시적인 오류" } });
  root.render(await OrganizationStatePage({ searchParams: Promise.resolve({}) }));
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  expect(toastError).toHaveBeenCalledWith("로그아웃하지 못했습니다: 일시적인 오류");
  await expect.element(page.getByRole("button", { name: "다시 확인" })).toBeEnabled();
  expect(replace).not.toHaveBeenCalled();
});
