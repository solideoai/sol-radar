import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  accountExists,
  createTeamWithMember,
  createTestAccount,
  refreshSession,
  removeTestAccounts,
  type TestAccount,
} from "./support/account-admin";
import {
  authCookiesOf,
  fillSignInForm,
  sectionOf,
  signInThroughForm,
  storedSessionOf,
} from "./support/account-page";

// 마이페이지의 세션(이 기기·모든 기기 로그아웃)과 회원 탈퇴. 시드 계정에 하면 같은 실행의 다른 시험이 깨진다(auth.setup.ts) —
// 시험마다 계정을 따로 만들고(support/account-admin.ts) 끝나면 지운다. 시드 팀은 건드리지 않지만, 계정 수가 바뀌므로
// 계정을 세는 관리자 시험(1단계)이 끝난 뒤인 2단계에서 돈다.
// 다른 기기의 세션은 그 브라우저의 refresh token 으로 본다 — 이미 받은 access token 은 만료(기본 1시간)까지 남아서
// 다른 쪽이 바로 로그아웃되는지는 단언하지 않는다(스펙 5장).
// 스펙: polaris/specs/done/social-auth-and-account.md 3·4.4·5장

const settingsOf = (slug: string) => `/${slug}/settings`;

// 같은 계정으로 로그인한 두 번째 브라우저(다른 기기). 손으로 연 컨텍스트에는 설정의 use 가 붙지 않아 주소·언어·시간대를 넘긴다.
const signInElsewhere = async (
  context: BrowserContext,
  account: TestAccount,
): Promise<{ page: Page; refreshToken: string }> => {
  const page = await context.newPage();
  await signInThroughForm(page, account);
  const session = await storedSessionOf(context);
  // 엉뚱한 쿠키를 읽어 갱신이 "실패"하는 헛시험이 되지 않게, 읽은 세션의 주인을 먼저 본다.
  expect(session.userId).toBe(account.id);
  return { page, refreshToken: session.refreshToken };
};

const expectSignedOutHere = async (page: Page, slug: string) => {
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("로그인");
  await expect.poll(async () => (await authCookiesOf(page.context())).length).toBe(0);
  // 저장된 효과: 앱 화면을 다시 열면 로그인 안내다.
  await page.goto(settingsOf(slug));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("로그인이 필요합니다");
};

test.describe("모든 기기에서 로그아웃", () => {
  test("같은 계정의 두 브라우저 중 한쪽에서 하면 그쪽은 로그인 화면으로 가고, 다른 쪽 세션은 서버에서 끊겨 갱신되지 않는다", async ({
    page,
    browser,
    baseURL,
    locale,
    timezoneId,
  }) => {
    const account = await createTestAccount();
    const other = await browser.newContext({ baseURL, locale, timezoneId });
    try {
      const slug = await signInThroughForm(page, account);
      const here = await storedSessionOf(page.context());
      const elsewhere = await signInElsewhere(other, account);

      await page.goto(settingsOf(slug));
      await sectionOf(page, "세션").getByRole("button", { name: "모든 기기에서 로그아웃" }).click();
      const dialog = page.getByRole("dialog", { name: "모든 기기에서 로그아웃할까요?" });
      await expect(
        dialog.getByText(
          "이 브라우저를 포함해 로그인한 모든 브라우저와 앱에서 로그아웃합니다. 다른 기기는 길게는 1시간 안에 로그아웃됩니다.",
        ),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "모든 기기에서 로그아웃" }).click();

      await expect(page.getByText("모든 기기에서 로그아웃했습니다")).toBeVisible();
      await expectSignedOutHere(page, slug);

      // 두 브라우저의 세션이 모두 서버에서 지워졌다.
      for (const refreshToken of [here.refreshToken, elsewhere.refreshToken]) {
        expect(await refreshSession(refreshToken)).toMatchObject({
          status: 400,
          errorCode: "refresh_token_not_found",
        });
      }
    } finally {
      await other.close();
      await removeTestAccounts([account]);
    }
  });

  test("확인 대화상자에서 취소하면 로그아웃하지 않는다", async ({ page }) => {
    const account = await createTestAccount();
    try {
      const slug = await signInThroughForm(page, account);
      const here = await storedSessionOf(page.context());
      await page.goto(settingsOf(slug));
      await sectionOf(page, "세션").getByRole("button", { name: "모든 기기에서 로그아웃" }).click();
      const dialog = page.getByRole("dialog", { name: "모든 기기에서 로그아웃할까요?" });
      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(dialog).toHaveCount(0);

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("설정");
      expect(await refreshSession(here.refreshToken)).toMatchObject({
        status: 200,
        userId: account.id,
      });
    } finally {
      await removeTestAccounts([account]);
    }
  });
});

// 로그아웃은 이 기기만 끊는다(scope local). 지금까지는 기본값(global)이라 모든 기기가 끊겼다(스펙 4.4).
const LOCAL_SIGN_OUTS = [
  {
    via: "마이페이지의 ‘이 기기에서 로그아웃’",
    run: async (page: Page, slug: string) => {
      await page.goto(settingsOf(slug));
      await sectionOf(page, "세션").getByRole("button", { name: "이 기기에서 로그아웃" }).click();
    },
  },
  {
    via: "사용자 메뉴의 ‘로그아웃’",
    run: async (page: Page) => {
      await page.getByRole("button", { name: "사용자 메뉴" }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "로그아웃" }).click();
    },
  },
] as const;

for (const { via, run } of LOCAL_SIGN_OUTS) {
  test(`${via}은 이 브라우저만 로그아웃하고, 같은 계정의 다른 브라우저는 로그인된 채로 세션이 갱신된다`, async ({
    page,
    browser,
    baseURL,
    locale,
    timezoneId,
  }) => {
    const account = await createTestAccount();
    const other = await browser.newContext({ baseURL, locale, timezoneId });
    try {
      const slug = await signInThroughForm(page, account);
      const here = await storedSessionOf(page.context());
      const elsewhere = await signInElsewhere(other, account);

      await run(page, slug);
      await expectSignedOutHere(page, slug);
      // 이 브라우저의 세션은 서버에서도 지워졌다.
      expect(await refreshSession(here.refreshToken)).toMatchObject({
        status: 400,
        errorCode: "refresh_token_not_found",
      });

      // 다른 브라우저는 그대로다.
      await elsewhere.page.goto(settingsOf(slug));
      await expect(elsewhere.page.getByRole("heading", { level: 1 })).toHaveText("설정");
      expect(await refreshSession(elsewhere.refreshToken)).toMatchObject({
        status: 200,
        userId: account.id,
      });
    } finally {
      await other.close();
      await removeTestAccounts([account]);
    }
  });
}

test.describe("회원 탈퇴", () => {
  const CONFIRM_LABEL = "확인하려면 ‘탈퇴’를 입력해 주세요";
  const SOLE_OWNER =
    "다른 멤버가 있는 팀의 유일한 소유자라 탈퇴할 수 없습니다. 그 팀 설정의 멤버 화면에서 다른 멤버를 소유자로 바꾸거나 팀을 나간 뒤 다시 시도해 주세요.";

  const openDeleteDialog = async (page: Page, slug: string) => {
    await page.goto(settingsOf(slug));
    await sectionOf(page, "회원 탈퇴").getByRole("button", { name: "회원 탈퇴" }).click();
    const dialog = page.getByRole("dialog", { name: "회원 탈퇴할까요?" });
    await expect(dialog.getByText("탈퇴하면 바로 지워지고 되돌릴 수 없습니다.")).toBeVisible();
    return dialog;
  };

  test("확인 낱말을 틀리게 입력하면 탈퇴하지 않고, 이유를 보이고 입력칸에 초점을 돌린다", async ({
    page,
  }) => {
    const account = await createTestAccount();
    try {
      const slug = await signInThroughForm(page, account);
      const dialog = await openDeleteDialog(page, slug);
      const input = dialog.getByLabel(CONFIRM_LABEL);

      for (const typed of ["", "탈퇴하기", "회원 탈퇴"]) {
        await input.fill(typed);
        await dialog.getByRole("button", { name: "탈퇴", exact: true }).click();
        await expect(
          dialog.getByText("‘탈퇴’를 그대로 입력해 주세요", { exact: true }),
        ).toBeVisible();
        await expect(input, typed).toBeFocused();
        await expect(input).toHaveAttribute("aria-invalid", "true");
      }

      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(dialog).toHaveCount(0);
      // 저장된 효과: 계정이 그대로 있고 이 브라우저는 로그인된 채다.
      expect(await accountExists(account)).toBe(true);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("설정");
    } finally {
      await removeTestAccounts([account]);
    }
  });

  test("‘탈퇴’를 입력해 탈퇴하면 첫 화면으로 가서 인사하고, 로그인 쿠키가 지워지며, 같은 비밀번호로 다시 로그인하지 못한다", async ({
    page,
  }) => {
    const account = await createTestAccount();
    try {
      const slug = await signInThroughForm(page, account);
      const here = await storedSessionOf(page.context());
      const dialog = await openDeleteDialog(page, slug);
      await dialog.getByLabel(CONFIRM_LABEL).fill("탈퇴");
      await dialog.getByRole("button", { name: "탈퇴", exact: true }).click();

      await expect(page.getByText("탈퇴했습니다. 그동안 이용해 주셔서 감사합니다")).toBeVisible();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/");
      await expect.poll(async () => (await authCookiesOf(page.context())).length).toBe(0);

      // 저장된 효과: 계정과 세션이 지워졌고, 앱 화면은 로그인 안내이며, 같은 이메일·비밀번호로 로그인하지 못한다.
      expect(await accountExists(account)).toBe(false);
      expect(await refreshSession(here.refreshToken)).toMatchObject({ status: 400 });
      await page.goto(settingsOf(slug));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("로그인이 필요합니다");
      await fillSignInForm(page, account);
      await expect(page.getByText("이메일 또는 비밀번호가 맞지 않습니다")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/login$/);
    } finally {
      await removeTestAccounts([account]);
    }
  });

  test("다른 멤버가 있는 팀의 유일한 소유자는 탈퇴하지 못하고, 대화상자 안에 이유를 보인다", async ({
    page,
  }) => {
    const owner = await createTestAccount();
    const member = await createTestAccount();
    try {
      const team = await createTeamWithMember(owner, member);
      const slug = await signInThroughForm(page, owner);
      const dialog = await openDeleteDialog(page, slug);
      await dialog.getByLabel(CONFIRM_LABEL).fill("탈퇴");
      await dialog.getByRole("button", { name: "탈퇴", exact: true }).click();

      await expect(dialog.getByRole("alert").filter({ hasText: "유일한 소유자" })).toHaveText(
        SOLE_OWNER,
      );
      // 대화상자는 열린 채이고 다시 누를 수 있다. 화면을 옮기지 않는다.
      await expect(dialog.getByRole("button", { name: "탈퇴", exact: true })).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe(settingsOf(slug));

      // 저장된 효과: 계정과 팀이 그대로다.
      expect(await accountExists(owner)).toBe(true);
      await page.goto(`/${team.slug}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("대시보드");
      await expect(page.getByRole("button", { name: "조직 전환" })).toContainText(team.name);
    } finally {
      await removeTestAccounts([owner, member]);
    }
  });
});
