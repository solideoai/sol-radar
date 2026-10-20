import { createOwnedTeam, removeTestAccounts } from "./support/account-admin";
import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type APIResponse,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import {
  createTestAccount,
  deleteTestAccount,
  passwordSignIn,
  refreshSession,
  signInOrThrow,
  type TestAccount,
  visibleMembershipCount,
} from "./support/admin-accounts";
import {
  cellsOf,
  expectDialogFitsWidth,
  expectListFitsWidth,
  expectRowCells,
  readSeedListing,
  userRowOf,
} from "./support/admin-page";
import { BUSINESS_DASHBOARD } from "./support/account-page";
import { signInAs } from "./support/local-supabase";
import { SEED_ACCOUNTS, SEED_ROLES, authFileOf, uniqueTag } from "./support/seed";

// 운영자의 회원 정지·해제 — 화면(/admin)과 API(PATCH /api/admin/users/{id}/status).
// 정지된 회원은 새로 로그인하지 못하고, 세션이 끊기고, 화면·API·조직 데이터에 닿지 못한다. 해제하면 다시 로그인한다.
// 막는 것은 서버다: 버튼이 없다는 것과 함께 API 가 거절하는지(상태 코드·오류 코드)를 본다.
//
// 시드 계정을 정지하면 같은 실행의 다른 시험이 깨진다. 정지할 회원과 "다른 운영자"는 시험마다 따로 만들고(support/admin-accounts.ts)
// 끝나면 지운다. 계정을 만들면 관리자 목록의 전체 수가 바뀌어 2단계(시드를 읽는 시험이 끝난 뒤)에 돈다.
// 목록은 그 시험의 꼬리표로 검색해 자기가 만든 줄만 본다(같은 단계의 시험이 병렬로 돈다).
// 스펙: polaris/specs/done/social-auth-and-account.md 3장 5·4.3·4.4·5장, docs/boilerplate/AUTH-API.md

const SIGNED_OUT = { cookies: [], origins: [] };

const test = base.extend<{ api: APIRequestContext }>({
  // /api 는 Bearer 토큰으로만 로그인한다. 브라우저의 쿠키가 실리지 않게 쿠키 없는 요청 상자를 따로 쓴다.
  // 둘째 인자를 use 라고 부르면 React 의 use 로 읽혀 린트(rules-of-hooks)가 막는다.
  api: async ({ playwright, baseURL }, provide) => {
    const api = await playwright.request.newContext({
      baseURL,
      storageState: SIGNED_OUT,
    });
    await provide(api);
    await api.dispose();
  },
});

// 화면은 시드 운영자(정운영)로 본다.
test.use({ storageState: authFileOf("admin") });

const NON_ADMIN_ROLES = SEED_ROLES.filter((role) => role !== "admin");
const SUSPENDED_NOTICE = "정지된 계정이라 로그인할 수 없습니다. 운영자에게 문의해 주세요.";
// 다시 로그인한 뒤 첫 화면은 업무 첫 화면(/dashboard)이다.
const DASHBOARD = BUSINESS_DASHBOARD;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const patchStatus = (api: APIRequestContext, userId: string, status: string, token?: string) =>
  api.patch(`/api/admin/users/${userId}/status`, {
    headers: token ? bearer(token) : {},
    data: { status },
  });

const getMe = (api: APIRequestContext, token: string) =>
  api.get("/api/users/me", { headers: bearer(token) });

// 오류 응답의 모양: { error: { code, message } }, 공유 캐시에 남기지 않는다(docs/boilerplate/AUTH-API.md "오류").
const expectApiError = async (response: APIResponse, status: number, code: string) => {
  expect(response.status(), code).toBe(status);
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
  expect(response.headers()["cache-control"]).toBe("no-store");
};

// 활동 중인 회원으로 로그인되는지 — API 로 새로 로그인해 내 프로필을 읽는다.
const expectActive = async (api: APIRequestContext, account: TestAccount, role: string) => {
  const { accessToken } = await signInOrThrow(account);
  const me = await getMe(api, accessToken);
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ id: account.id, role, status: "active" });
};

const submitLogin = async (page: Page, account: TestAccount) => {
  await page.goto("/auth/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
};

test("운영자가 화면에서 회원을 정지하면 상태가 정지가 되고, 그 회원은 새로 로그인하지 못하며 남은 토큰의 API·조직 데이터·갱신이 막히고, 해제하면 다시 로그인한다", async ({
  page,
  browser,
  api,
}) => {
  const tag = uniqueTag();
  const target = await createTestAccount({ label: "suspend", tag, name: `정지 시험 ${tag}` });
  // 그 회원이 정지 뒤에 로그인하려는 기기.
  const device = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    await createOwnedTeam(target);
    // 정지 전: 그 회원의 토큰으로 API 와 명시적으로 만든 업무 조직이 열린다. 뒤에서 같은 토큰이 막히는지 본다.
    const before = await signInOrThrow(target);
    expect((await getMe(api, before.accessToken)).status()).toBe(200);
    expect(await visibleMembershipCount(before.accessToken)).toBe(1);

    await page.goto(`/admin?q=${tag}`);
    const row = userRowOf(page, target.email);
    await expectRowCells(row, target);
    const suspend = row.getByRole("button", { name: `${target.name} 정지`, exact: true });

    // 확인 단계 — 취소하면 아무것도 바뀌지 않는다.
    await suspend.click();
    const confirmSuspend = page.getByRole("dialog", { name: `${target.name} 님을 정지할까요?` });
    await expect(confirmSuspend).toContainText(
      "정지하면 이 회원은 바로 모든 기기에서 로그아웃되고",
    );
    await expect(confirmSuspend).toContainText(target.email);
    await confirmSuspend.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirmSuspend).toHaveCount(0);
    await expect(suspend).toBeFocused();
    await page.reload();
    await expectRowCells(row, target);
    expect((await getMe(api, before.accessToken)).status()).toBe(200);

    // 정지 — 목록의 상태가 바뀌고 새로 고쳐도 남는다.
    await suspend.click();
    await confirmSuspend.getByRole("button", { name: "정지", exact: true }).click();
    await expect(page.getByText(`${target.name} 님을 정지했습니다`)).toBeVisible();
    await expect(confirmSuspend).toHaveCount(0);
    await expectRowCells(row, { ...target, suspended: true });
    await page.reload();
    await expectRowCells(row, { ...target, suspended: true });

    // 남은 토큰: 아직 만료 전이라 서명은 맞지만 API 는 403 suspended, 조직 데이터는 비고, 갱신은 실패한다(세션이 지워졌다).
    await expectApiError(await getMe(api, before.accessToken), 403, "suspended");
    expect(await visibleMembershipCount(before.accessToken)).toBe(0);
    expect(await refreshSession(before.refreshToken)).toMatchObject({
      ok: false,
      errorCode: "refresh_token_not_found",
    });
    // 새로 로그인: 로그인 화면이 정지 안내로 거절하고 로그인 화면에 머문다. API 로그인도 user_banned 다.
    const loginPage = await device.newPage();
    await submitLogin(loginPage, target);
    await expect(loginPage.getByRole("alert").filter({ hasText: SUSPENDED_NOTICE })).toHaveText(
      SUSPENDED_NOTICE,
    );
    await expect(loginPage).toHaveURL(/\/auth\/login$/);
    await expect(loginPage.getByRole("heading", { level: 1 })).toHaveText("로그인");
    expect(await passwordSignIn(target)).toMatchObject({ ok: false, errorCode: "user_banned" });

    // 해제 — 확인 단계를 거쳐 상태가 정상으로 돌아온다.
    await row.getByRole("button", { name: `${target.name} 정지 해제`, exact: true }).click();
    const confirmRestore = page.getByRole("dialog", {
      name: `${target.name} 님의 정지를 해제할까요?`,
    });
    await expect(confirmRestore).toContainText(
      "해제하면 이 회원이 다시 로그인해 이전처럼 이용할 수 있습니다.",
    );
    await confirmRestore.getByRole("button", { name: "해제", exact: true }).click();
    await expect(page.getByText(`${target.name} 님의 정지를 해제했습니다`)).toBeVisible();
    await expect(confirmRestore).toHaveCount(0);
    await expectRowCells(row, target);
    await page.reload();
    await expectRowCells(row, target);

    // 다시 로그인된다 — 화면도, API 도. 자기 조직도 다시 보인다.
    await submitLogin(loginPage, target);
    await expect(loginPage).toHaveURL(DASHBOARD);
    await expect(loginPage.getByRole("heading", { level: 1 })).toHaveText("대시보드");
    const after = await signInOrThrow(target);
    expect(await visibleMembershipCount(after.accessToken)).toBe(1);
    await expectActive(api, target, "user");
  } finally {
    await device.close();
    await removeTestAccounts([target]);
  }
});

test("정지되기 전에 로그인해 둔 기기에서 앱 화면(대시보드)을 열면 계정 화면의 정지 안내로 간다", async ({
  browser,
  api,
}) => {
  const tag = uniqueTag();
  const target = await createTestAccount({ label: "device", tag, name: `기기 시험 ${tag}` });
  const device = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    await createOwnedTeam(target);
    const devicePage = await device.newPage();
    await submitLogin(devicePage, target);
    await expect(devicePage).toHaveURL(DASHBOARD);
    const dashboard = devicePage.url();

    // 정지는 이 시험의 준비라 API 로 한다(화면으로 하는 정지는 위 시험이 본다).
    const me = await signInAs("admin");
    expect((await patchStatus(api, target.id, "suspended", me.token)).status()).toBe(200);

    // 이 기기의 쿠키에는 아직 만료 전인 access token 이 있다. 앱 화면 대신 계정 화면이 정지 안내와 로그아웃 버튼을 보인다
    // (app/auth/login/page.tsx 의 suspended — "앱 틀이 여기로 보낸다").
    await devicePage.goto(dashboard);
    await expect(devicePage).toHaveURL(/\/auth\/login$/);
    await expect(devicePage.getByRole("heading", { level: 1 })).toHaveText(
      "이용이 정지된 계정입니다",
    );
    await expect(devicePage.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  } finally {
    await device.close();
    await removeTestAccounts([target]);
  }
});

test("나와 다른 운영자의 줄에는 정지 버튼이 없고, API 로 바꾸려 해도 409 self·admin_target 으로 거절된다", async ({
  page,
  api,
}) => {
  const tag = uniqueTag();
  const otherAdmin = await createTestAccount({
    label: "admin",
    tag,
    name: `다른 운영자 ${tag}`,
    isAdmin: true,
  });
  try {
    await page.goto(`/admin?q=${tag}`);
    await expectRowCells(userRowOf(page, otherAdmin.email), { ...otherAdmin, isAdmin: true });

    // 시드 운영자의 가입일은 오늘이 아니다(시드는 다시 돌려도 계정을 보존한다). DB 에서 읽는다.
    const { admin } = SEED_ACCOUNTS;
    const seed = await readSeedListing();
    await page.goto(`/admin?q=${encodeURIComponent(admin.email)}`);
    await expectRowCells(userRowOf(page, admin.email), {
      ...admin,
      isMe: true,
      isAdmin: true,
      joined: seed.joinedOf("admin"),
    });

    // 버튼이 없어도 직접 부를 수 있다. 서버가 거절하고 아무것도 바꾸지 않는다.
    const me = await signInAs("admin");
    for (const status of ["suspended", "active"]) {
      await expectApiError(
        await patchStatus(api, otherAdmin.id, status, me.token),
        409,
        "admin_target",
      );
      await expectApiError(await patchStatus(api, me.userId, status, me.token), 409, "self");
    }
    await expectActive(api, otherAdmin, "admin");
    const self = await getMe(api, me.token);
    expect(self.status()).toBe(200);
    expect(await self.json()).toMatchObject({ id: me.userId, role: "admin", status: "active" });
  } finally {
    await deleteTestAccount(otherAdmin);
  }
});

test("운영자가 아닌 회원이 자기 토큰으로 상태 API 를 부르면 403 forbidden, 토큰 없이·쿠키로만 부르면 401 이고, 대상은 그대로다", async ({
  page,
  api,
}) => {
  const tag = uniqueTag();
  const target = await createTestAccount({ label: "target", tag, name: `대상 ${tag}` });
  try {
    // 조직의 owner 도 서비스 운영자가 아니다(org_role 과 profiles.is_admin 은 다르다).
    for (const role of NON_ADMIN_ROLES) {
      const session = await signInAs(role);
      for (const status of ["suspended", "active"]) {
        await expectApiError(
          await patchStatus(api, target.id, status, session.token),
          403,
          "forbidden",
        );
      }
    }

    const anonymous = await patchStatus(api, target.id, "suspended");
    await expectApiError(anonymous, 401, "unauthenticated");
    expect(anonymous.headers()["www-authenticate"]).toBe("Bearer");
    // 운영자의 브라우저 쿠키만으로는 로그인되지 않는다 — 다른 사이트가 운영자의 브라우저를 빌려 부르지 못한다(CSRF).
    const withCookies = await page.request.patch(`/api/admin/users/${target.id}/status`, {
      data: { status: "suspended" },
    });
    await expectApiError(withCookies, 401, "unauthenticated");

    // 거절은 아무것도 바꾸지 않았다.
    await expectActive(api, target, "user");
    await page.goto(`/admin?q=${tag}`);
    await expectRowCells(userRowOf(page, target.email), target);
  } finally {
    await removeTestAccounts([target]);
  }
});

test("운영자의 토큰으로 상태 API 를 부르면 정지·해제되고, 잘못된 본문·id 는 400, 없는 회원은 404 다", async ({
  api,
}) => {
  const tag = uniqueTag();
  const target = await createTestAccount({ label: "api", tag, name: `API 정지 ${tag}` });
  try {
    const me = await signInAs("admin");
    const before = await signInOrThrow(target);

    const suspended = await patchStatus(api, target.id, "suspended", me.token);
    expect(suspended.status()).toBe(200);
    expect(await suspended.json()).toEqual({ id: target.id, status: "suspended" });
    await expectApiError(await getMe(api, before.accessToken), 403, "suspended");
    expect(await passwordSignIn(target)).toMatchObject({ ok: false, errorCode: "user_banned" });

    const restored = await patchStatus(api, target.id, "active", me.token);
    expect(restored.status()).toBe(200);
    expect(await restored.json()).toEqual({ id: target.id, status: "active" });
    await expectActive(api, target, "user");

    // 바꾸지 못하는 요청. 상태 값은 active·suspended 둘뿐이고(탈퇴는 상태가 아니다), id 는 회원 id(uuid)다.
    await expectApiError(await patchStatus(api, target.id, "deleted", me.token), 400, "invalid");
    await expectApiError(
      await patchStatus(api, "not-a-uuid", "suspended", me.token),
      400,
      "invalid",
    );
    await expectApiError(
      await patchStatus(api, randomUUID(), "suspended", me.token),
      404,
      "not_found",
    );
    await expectActive(api, target, "user");
  } finally {
    await removeTestAccounts([target]);
  }
});

test("375·1280px 에서 정지된 회원의 줄과 해제 대화상자가 가로로 넘치지 않고, 좁은 단은 상태 칸 대신 이름 옆에 정지를 적는다", async ({
  page,
  api,
}) => {
  const tag = uniqueTag();
  // 줄 바꿈할 곳이 없는 가장 긴 표시 이름(40자)과 긴 이메일 — 말줄임·줄 바꿈이 없으면 넘친다.
  const target = await createTestAccount({
    label: `long-${"x".repeat(32)}`,
    tag,
    name: `${"가나다라마바사아자차카타파하".repeat(2)}${tag}`.slice(0, 40),
  });
  try {
    const me = await signInAs("admin");
    expect((await patchStatus(api, target.id, "suspended", me.token)).status()).toBe(200);

    for (const { width, isNarrow } of [
      { width: 375, isNarrow: true },
      { width: 1280, isNarrow: false },
    ]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/admin?q=${tag}`);
      const row = userRowOf(page, target.email);
      await expectRowCells(row, { ...target, suspended: true });
      await expectListFitsWidth(page);
      const cells = cellsOf(row);
      await expect(cells.nth(0).getByText("정지", { exact: true })).toBeVisible({
        visible: isNarrow,
      });
      await expect(cells.nth(2)).toBeVisible({ visible: !isNarrow });

      const restore = row.getByRole("button", { name: `${target.name} 정지 해제`, exact: true });
      await expect(restore).toBeInViewport({ ratio: 1 });
      await restore.click();
      const dialog = page.getByRole("dialog", { name: `${target.name} 님의 정지를 해제할까요?` });
      await expect(dialog).toContainText(target.email);
      await expectDialogFitsWidth(page, dialog);
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(restore).toBeFocused();
    }
  } finally {
    await removeTestAccounts([target]);
  }
});
