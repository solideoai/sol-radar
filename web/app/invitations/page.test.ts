import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { profile, received } = vi.hoisted(() => ({ profile: vi.fn(), received: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({ getReceivedInvitations: received }));
vi.mock("@/app/account/sign-out-button", () => ({ SignOutButton: () => "로그아웃" }));
vi.mock("@/app/auth/organization-state/state-retry", () => ({ StateRetry: () => "다시 시도" }));
vi.mock("./invitation-list", () => ({ InvitationList: () => "받은 초대가 없습니다" }));
import InvitationsPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({
    status: "ready",
    profile: { profileComplete: false, email: "user@example.test" },
  });
  received.mockResolvedValue({ status: "ready", invitations: [] });
});
it("incomplete no-org account can read invitations with service/account/logout links", async () => {
  const html = renderToStaticMarkup(await InvitationsPage());
  expect(html).toContain("받은 초대가 없습니다");
  expect(html).toContain('href="/auth/organization-state"');
  expect(html).toContain('href="/auth/account"');
  expect(html).toContain("로그아웃");
});
it.each(["suspended", "missing"])("%s profile precedes invitations", async (status) => {
  profile.mockResolvedValue({ status });
  await expect(InvitationsPage()).rejects.toThrow("REDIRECT:/auth/login");
  expect(received).not.toHaveBeenCalled();
});
it.each(["profile", "invitation"])("%s read failure retains retry and exits", async (source) => {
  (source === "profile" ? profile : received).mockRejectedValue(new Error("read failed"));
  const html = renderToStaticMarkup(await InvitationsPage());
  expect(html).toContain("받은 초대를 불러오지 못했습니다. 다시 시도해 주세요.");
  expect(html).not.toContain("받은 초대가 없습니다");
  expect(html).toContain("다시 시도");
  expect(html).toContain('href="/auth/account"');
});
