import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import {
  clearEmployment,
  createTestAccount,
  createOwnedTeam,
  findTestAccount,
  readOwnPeopleAccess,
  removeTestAccounts,
  signInByApi,
} from "./support/account-admin";
import {
  fillSignInForm,
  horizontalOverflow,
  sectionOf,
  signInThroughForm,
  signInWithoutOrganization,
} from "./support/account-page";
import { deleteMailsTo, readMail, waitForMailsTo } from "./support/mailbox";
import { SEED_EMPLOYMENT, uniqueTag } from "./support/seed";

// These tests only create their own disposable accounts. They run in chromium-write
// because Auth counts must not race the read-stage admin/account inventory.
const selection = async (page: Page) => {
  await page.getByRole("combobox", { name: "부서 (필수)" }).click();
  await page.getByRole("option", { name: SEED_EMPLOYMENT.departmentName, exact: true }).click();
  await page.getByRole("combobox", { name: "직급/직책 (필수)" }).click();
  await page.getByRole("option", { name: SEED_EMPLOYMENT.jobTitleLabel, exact: true }).click();
};
const expectEmployment = async (page: Page, name: string) => {
  const response = await page.request.get("/api/v1/me/employment");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    name,
    profileComplete: true,
    employment: SEED_EMPLOYMENT,
  });
};
const signOut = async (page: Page) => {
  await page.goto("/auth/account");
  await sectionOf(page, "세션")
    .getByRole("button", { name: "이 기기에서 로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\/login$/);
};
const stateSchema = z.object({
  name: z.string().nullable(),
  profileComplete: z.boolean(),
  employment: z.unknown(),
});

test("이메일 가입은 필수 신고 정보로 확인 메일을 보내고, 확인·재로그인 뒤에도 그대로 유지한다", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("로컬 시험 서버 주소가 없습니다");
  // Next's local production confirm redirect canonicalizes to localhost. Keep
  // signup, OTP cookies, redirect and re-login on that one origin from the start.
  const origin = new URL(baseURL);
  origin.hostname = "localhost";
  const context = await browser.newContext({
    baseURL: origin.origin,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  const email = `e2e-signup-${uniqueTag()}@example.test`;
  const password = `local-signup-${uniqueTag()}`;
  const name = "이메일 가입 이름";
  try {
    await page.goto("/auth/sign-up");
    await page.getByRole("textbox", { name: "이름 (필수)" }).fill(name);
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
    for (const label of [
      "이용약관 동의 (필수)",
      "개인정보 수집·이용 동의 (필수)",
      "만 14세 이상입니다 (필수)",
    ])
      await page.getByRole("checkbox", { name: label, exact: true }).check();
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "부서 (필수)" })).toBeFocused();
    await expect(page.getByText("부서를 선택해 주세요", { exact: true }).last()).toBeVisible();
    await selection(page);
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("확인 메일을 보냈습니다");
    const [mailId] = await waitForMailsTo(email, 1);
    const mail = await readMail(mailId);
    const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(mail.HTML)?.[1];
    if (!href) throw new Error("로컬 가입 확인 링크가 없습니다");
    const link = new URL(href.replaceAll("&amp;", "&"));
    expect(link.pathname).toBe("/auth/confirm");
    // The local template SiteURL may use another port; keep its real token/query
    // and open the exact production route in this test checkout's server.
    await page.goto(new URL(`${link.pathname}${link.search}`, origin).href);
    await expect(page).toHaveURL(/\/auth\/organization-state$/);
    await expectEmployment(page, name);
    await signOut(page);
    await signInWithoutOrganization(page, { email, password });
    await expectEmployment(page, name);
    const account = await findTestAccount(email, password);
    if (!account) throw new Error("가입한 로컬 시험 계정이 없습니다");
    expect(await readOwnPeopleAccess(await signInByApi(account))).toEqual({
      organizations: [],
      people: [],
      memberships: [],
    });
  } finally {
    await context.close();
    const account = await findTestAccount(email, password);
    if (account) await removeTestAccounts([account]);
    await deleteMailsTo(email);
  }
});

for (const width of [1440, 1280]) {
  test(`간편 가입과 같은 미완료 DB 상태 ${width}px: 계정 관리·로그아웃 허용, 보완 후 업무 진입과 재로그인 유지`, async ({
    page,
  }) => {
    const account = await createTestAccount({ incomplete: true });
    const name = "보완 이름은 세 글자 제한 없음";
    try {
      await page.setViewportSize({ width, height: 1000 });
      await fillSignInForm(page, account);
      await expect(page).toHaveURL(/\/auth\/complete-profile$/);
      const state = stateSchema.parse(
        await (await page.request.get("/api/v1/me/employment")).json(),
      );
      expect(state).toMatchObject({ profileComplete: false, employment: null });
      await page.getByRole("link", { name: "계정 관리", exact: true }).click();
      await expect(page).toHaveURL(/\/auth\/account$/);
      await expect(page.getByRole("heading", { level: 1, name: "계정 관리" })).toBeVisible();
      for (const section of ["프로필", "로그인 수단", "비밀번호", "세션", "회원 탈퇴"] as const)
        await expect(sectionOf(page, section)).toBeVisible();
      await page.getByRole("link", { name: "서비스로 돌아가기" }).click();
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await expect(page).toHaveURL(/\/auth\/login$/);
      await fillSignInForm(page, account);
      await expect(page).toHaveURL(/\/auth\/complete-profile$/);
      await page.getByRole("button", { name: "저장하고 계속" }).click();
      await expect(page.getByRole("combobox", { name: "부서 (필수)" })).toBeFocused();
      await page.getByRole("textbox", { name: "이름 (필수)" }).fill(name);
      await selection(page);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.screenshot({
        path: test.info().outputPath(`completion-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "저장하고 계속" }).click();
      await expect(page).toHaveURL(/\/auth\/organization-state$/);
      await expectEmployment(page, name);
      await signOut(page);
      await signInWithoutOrganization(page, account);
      await expectEmployment(page, name);
      expect(await readOwnPeopleAccess(await signInByApi(account))).toEqual({
        organizations: [],
        people: [],
        memberships: [],
      });
      await page.goto("/org-01/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("조직 초대가 필요합니다");
      await expect(page.getByRole("heading", { name: "대시보드", exact: true })).toHaveCount(0);
      await expect(page).not.toHaveURL(/\/auth\/complete-profile/);
    } finally {
      await removeTestAccounts([account]);
    }
  });
}

test("기존 계정 선언이 지워지면 열린 작업 폼의 직접 서버 액션과 업무 URL이 차단되고 저장되지 않는다", async ({
  page,
}) => {
  const account = await createTestAccount();
  const title = `보완 전 저장 금지 ${uniqueTag()}`;
  try {
    await createOwnedTeam(account);
    const slug = await signInThroughForm(page, account);
    await expectEmployment(page, "시험 계정");
    const session = await signInByApi(account);
    await page.goto(`/${slug}/tasks`);
    await page.getByRole("button", { name: "첫 작업 추가", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "작업 추가" });
    await dialog.getByLabel("제목").fill(title);
    await clearEmployment(session);
    await dialog.getByRole("button", { name: "추가", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/complete-profile\?next=%2Fmemos$/);
    for (const path of [`/${slug}/tasks`, `/${slug}/settings`, "/teams/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/complete-profile(?:\?|$)/);
    }
    // Account API remains intentionally compatible and completion stays accessible.
    const me = await page.request.get("/api/users/me", {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(me.status()).toBe(200);
    await page.goto(`/auth/complete-profile?next=${encodeURIComponent(`/${slug}/tasks`)}`);
    await selection(page);
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/tasks$`));
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
    await expect(page.getByText("아직 작업이 없습니다", { exact: false })).toBeVisible();
  } finally {
    await removeTestAccounts([account]);
  }
});
