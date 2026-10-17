import { expect, test } from "@playwright/test";
import {
  createTestAccount,
  createOwnedTeam,
  removeTestAccounts,
  signInByApi,
} from "./support/account-admin";
import {
  signInThroughForm,
  signInWithoutOrganization,
  horizontalOverflow,
} from "./support/account-page";
import { createInvitation } from "./support/local-supabase";

test("sole business rejects a foreign slug and a second membership cannot select either workspace", async ({
  page,
}) => {
  const owner = await createTestAccount();
  const stranger = await createTestAccount();
  try {
    const current = await createOwnedTeam(owner, "내 업무 조직");
    const foreign = await createOwnedTeam(stranger, "다른 업무 조직");
    await signInThroughForm(page, owner);
    const response = await page.goto(`/${foreign.slug}/tasks`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(foreign.name, { exact: true })).toHaveCount(0);
    const second = await createOwnedTeam(owner, "두 번째 업무 조직");
    for (const slug of [current.slug, second.slug]) {
      await page.goto(`/${slug}/tasks`);
      await expect(
        page.getByText("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "작업", exact: true })).toHaveCount(0);
    }
    await page.goto("/auth/account");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("계정 관리");
  } finally {
    await removeTestAccounts([owner, stranger]);
  }
});

for (const width of [1440, 1280])
  test(`no-org invitation acceptance re-evaluates one then multiple memberships at ${width}px`, async ({
    page,
  }) => {
    const invitee = await createTestAccount();
    const firstOwner = await createTestAccount();
    const secondOwner = await createTestAccount();
    try {
      const first = await createOwnedTeam(firstOwner, "첫 업무 조직");
      const second = await createOwnedTeam(secondOwner, "둘째 업무 조직");
      for (const [owner, team] of [
        [firstOwner, first],
        [secondOwner, second],
      ] as const) {
        await createInvitation(await signInByApi(owner), { orgId: team.id, email: invitee.email });
      }
      await page.setViewportSize({ width, height: 900 });
      await signInWithoutOrganization(page, invitee);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.getByRole("link", { name: "받은 초대 보기" }).click();
      await page.getByRole("button", { name: `수락 ${first.name} 초대`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${first.slug}/dashboard$`));
      await page.goto("/invitations");
      await page.getByRole("button", { name: `수락 ${second.name} 초대`, exact: true }).click();
      await expect(
        page.getByText("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.getByRole("button", { name: "다시 확인" }).click();
      await expect(
        page.getByText("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요", { exact: true }),
      ).toBeVisible();
    } finally {
      await removeTestAccounts([invitee, firstOwner, secondOwner]);
    }
  });
