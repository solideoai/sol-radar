import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const { profile, organization } = vi.hoisted(() => ({ profile: vi.fn(), organization: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({ getCurrentOrganization: organization }));
vi.mock("@/app/account/sign-out-button", () => ({ SignOutButton: () => "로그아웃" }));
vi.mock("./state-retry", () => ({ StateRetry: () => "다시 확인" }));
import Page from "./page";
const page = (next?: string) => Page({ searchParams: Promise.resolve({ next }) });
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  organization.mockResolvedValue({ status: "no-org", userId: "me" });
});
it("fresh signup without memberships gets invitation/account/logout guidance", async () => {
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("조직 초대가 필요합니다");
  expect(html).toContain('href="/invitations"');
  expect(html).toContain('href="/auth/account"');
  expect(html).toContain("로그아웃");
  expect(html).not.toContain("프로필이 없습니다");
});
it("multiple businesses show the exact unsupported message with no workspace", async () => {
  organization.mockResolvedValue({ status: "multiple-orgs", userId: "me" });
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요");
  expect(html).not.toContain('href="/invitations"');
});
it.each(["missing", "suspended", "signed-out"])(
  "%s takes precedence without organization read",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(page()).rejects.toThrow("REDIRECT:/auth/login");
    expect(organization).not.toHaveBeenCalled();
  },
);
it("incomplete profile retains business next", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
  await expect(page("/alpha/tasks?q=1")).rejects.toThrow(
    "REDIRECT:/auth/complete-profile?next=%2Falpha%2Ftasks%3Fq%3D1",
  );
  expect(organization).not.toHaveBeenCalled();
});
it.each([undefined, "https://evil.test", "/auth/organization-state", "/unreleased"])(
  "ready resolves safe destination %s",
  async (next) => {
    organization.mockResolvedValue({ status: "ready", userId: "me", current: { slug: "alpha" } });
    await expect(page(next)).rejects.toThrow("REDIRECT:/dashboard");
  },
);
it("ready preserves legacy path for the workspace guard to validate", async () => {
  organization.mockResolvedValue({ status: "ready", userId: "me", current: { slug: "alpha" } });
  await expect(page("/other/tasks")).rejects.toThrow("REDIRECT:/other/tasks");
});
it("read errors are not interpreted as no memberships", async () => {
  organization.mockRejectedValue(new Error("db failure"));
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("계정 상태를 불러오지 못했습니다");
  expect(html).not.toContain("조직 초대가 필요합니다");
});

it("request after acceptance re-evaluates zero, sole and second memberships", async () => {
  expect(renderToStaticMarkup(await page())).toContain("조직 초대가 필요합니다");
  organization.mockResolvedValue({ status: "ready", userId: "me", current: { slug: "alpha" } });
  await expect(page()).rejects.toThrow("REDIRECT:/dashboard");
  organization.mockResolvedValue({ status: "multiple-orgs", userId: "me" });
  expect(renderToStaticMarkup(await page())).toContain(
    "지원되지 않는 계정 상태입니다. 관리자에게 문의하세요",
  );
  expect(profile).toHaveBeenCalledTimes(3);
  expect(organization).toHaveBeenCalledTimes(3);
});
