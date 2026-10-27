import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { z } from "zod";
import { createTestAccount, removeTestAccounts, type TestAccount } from "./support/account-admin";
import { escapeRegExp, uniqueTag } from "./support/seed";
import { assertNoAxe, localAdmin } from "./support/work-fixtures";

// 프로필 사진·가입 신청 시연 흐름(설계 polaris/specs/done/2026-10-24-profile-photo-member-link.md).
// 간편 로그인 첫 진입(부서 신고 없음) → 가입 정보 → 사진 → 가입 신청 → 관리자 승인 → 조직도 사진 → 관리자가 가상 직원 사진 변경.
// 명부 연결·신청·사진 포인터는 globalTeardown 의 demo:reset 이 되돌린다. 시험 계정은 끝에 지운다.

const WEB_ROOT = path.resolve(__dirname, "..");
const SHOT_DIR = path.join(WEB_ROOT, "..", "docs", "evidence", "profile-photo", "e2e");
// 올릴 사진. 관리자가 바꾸는 가상 직원(명부 첫 사람, SOL-P0001)과 다른 정장 사진을 써야 바뀐 것이 화면에 보인다.
const portrait = (code: string) => path.join(WEB_ROOT, "public", "demo", "people", `${code}.png`);
const ADMIN_EMAIL = "admin@admin.com";
const USER_PHOTO = "/storage/v1/object/sign/profile-photos/users/";
const MEMBER_PHOTO = "/storage/v1/object/sign/profile-photos/members/";

const linkSchema = z.object({ hashed_token: z.string().min(1) });
const demoMemberSchema = z.array(
  z.object({ name: z.string(), department: z.object({ name: z.string() }) }),
);

// work-setup.ts 와 같은 magiclink 로그인. 비밀번호를 쓰지 않는다.
async function signIn(browser: Browser, email: string): Promise<Page> {
  const link = linkSchema.parse(
    await localAdmin().call("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email }),
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  await page.goto(
    `/auth/confirm?type=email&next=%2Fdashboard&token_hash=${encodeURIComponent(link.hashed_token)}`,
  );
  return page;
}

// 1440 에서 axe 를 돌리고, 같은 상태를 1440·1280 두 폭으로 찍는다.
// 사라지는 중인 토스트는 반투명이라 axe 가 대비 위반으로 잡는다. 토스트가 모두 닫힌 뒤 본다.
async function capture(page: Page, name: string) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await assertNoAxe(page, `profile-photo-${name}`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: path.join(SHOT_DIR, `${name}-${width}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

// 열린 목록의 첫 항목을 고르고, 목록이 닫힐 때까지 기다린다(닫히는 목록의 항목을 다음 선택이 잡지 않게).
async function pickFirst(page: Page, label: string): Promise<string> {
  await page.getByRole("combobox", { name: label }).click();
  const option = page.getByRole("listbox").getByRole("option").first();
  const text = (await option.innerText()).trim();
  await option.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: label })).toContainText(text);
  return text;
}

async function uploadPhoto(page: Page, button: ReturnType<Page["getByRole"]>, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles(file);
}

async function openPerson(page: Page, team: string, name: string) {
  await page.goto("/org-chart");
  await page
    .getByRole("button", { name: new RegExp(escapeRegExp(team)) })
    .first()
    .click();
  await page.getByRole("button", { name: `${name} 상세 보기` }).click();
  // 서랍이 들어오는 중에는 글자가 반투명이다. 상세가 뜨고 애니메이션이 끝난 뒤 돌려준다.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("기본 정보")).toBeVisible();
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  return dialog;
}

test("간편 로그인 신규 입사자: 가입 신청 → 사진 → 관리자 승인 → 조직도 사진 → 관리자 사진 변경", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const name = `신입${uniqueTag().slice(-6)}`;
  const accounts: TestAccount[] = [];
  try {
    // 1. 부서 신고 없는 계정 = 간편 로그인 첫 진입.
    accounts.push(await createTestAccount({ incomplete: true }));
    const hire = await signIn(browser, accounts[0].email);
    await hire.waitForURL(/\/auth\/complete-profile/);

    // 2. 가입 정보 → 조직 없음 화면 → 사진 → 가입 신청.
    await hire.getByLabel("이름 (필수)").fill(name);
    const department = await pickFirst(hire, "부서 (필수)");
    await pickFirst(hire, "직급/직책 (필수)");
    await hire.getByRole("button", { name: "저장하고 계속" }).click();
    await hire.waitForURL(/\/auth\/organization-state/);
    await expect(hire.getByRole("heading", { level: 1, name: "가입 신청" })).toBeVisible();

    await uploadPhoto(
      hire,
      hire.getByRole("button", { name: "내 사진 올리기" }),
      portrait("SOL-P0200"),
    );
    await expect(hire.getByText("사진을 바꿨습니다")).toBeVisible();
    await expect(hire.getByRole("img", { name: `${name} 프로필 사진` })).toHaveAttribute(
      "src",
      new RegExp(escapeRegExp(USER_PHOTO)),
    );
    await hire.getByRole("button", { name: "가입 신청", exact: true }).click();
    await expect(
      hire.getByRole("heading", { level: 1, name: "관리자 승인 대기 중" }),
    ).toBeVisible();
    await capture(hire, "join-pending");

    // 3. 관리자가 설정 → 조직에서 승인한다(업무 역할 기본 VIEWER).
    const admin = await signIn(browser, ADMIN_EMAIL);
    await admin.waitForURL(/\/dashboard$/);
    await admin.goto("/settings/organization");
    // 승인하면 같은 이름이 아래 구성원 표에도 생긴다. 가입 신청 표(caption "대기 중인 가입 신청 N건") 안에서만 찾는다.
    const row = admin
      .getByRole("table", { name: /대기 중인 가입 신청/ })
      .getByRole("row", { name: new RegExp(escapeRegExp(name)) });
    await expect(row.getByRole("img", { name: `${name} 프로필 사진` })).toHaveAttribute(
      "src",
      new RegExp(escapeRegExp(USER_PHOTO)),
    );
    await capture(admin, "admin-join-requests");
    await admin.getByRole("button", { name: `${name} 승인` }).click();
    await expect(admin.getByText(`${name} 님을 승인했습니다.`)).toBeVisible();
    await expect(row).toHaveCount(0);

    // 4. 신청자는 조직도에서 자기 사진을 본다.
    await hire.goto("/org-chart");
    await expect(hire).toHaveURL(/\/org-chart/);
    const hireDrawer = await openPerson(hire, department, name);
    await expect(hireDrawer.getByRole("img", { name: `${name} 프로필 사진` })).toHaveAttribute(
      "src",
      new RegExp(escapeRegExp(USER_PHOTO)),
    );
    await expect(hireDrawer.getByText("DEMO · 가상 인물")).toHaveCount(0);
    await capture(hire, "org-chart-new-hire");

    // 5. 관리자가 가상 직원 한 명의 사진을 바꾼다.
    const [member] = demoMemberSchema.parse(
      await localAdmin().call(
        "GET",
        "/rest/v1/team_members?select=name,department:departments(name)&is_demo=eq.true&order=person_code&limit=1",
      ),
    );
    const drawer = await openPerson(admin, member.department.name, member.name);
    await uploadPhoto(
      admin,
      drawer.getByRole("button", { name: `${member.name} 사진 올리기` }),
      portrait("SOL-P0002"),
    );
    await expect(admin.getByText("사진을 바꿨습니다")).toBeVisible();
    await expect(drawer.getByRole("img", { name: `${member.name} 프로필 사진` })).toHaveAttribute(
      "src",
      new RegExp(escapeRegExp(MEMBER_PHOTO)),
    );
    await capture(admin, "org-chart-admin-photo");
  } finally {
    await removeTestAccounts(accounts);
  }
});
