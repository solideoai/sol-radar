import { expect, test, type Page } from "@playwright/test";
import {
  assertNoAxe,
  EVIL_LINK_NOTIFICATION_TITLE,
  localAdmin,
  readWorkContext,
  shot,
  storageOf,
  topbar,
} from "./support/work-fixtures";

// /notifications 쓰기 흐름(스펙 §5.5). 알림을 읽음으로 바꾸므로 읽기 spec(notifications-loaded)이 끝난 뒤 돈다.
test.describe.configure({ mode: "serial" });

const VIEWPORT = {
  1440: { width: 1440, height: 900 },
  1280: { width: 1280, height: 800 },
} as const;

const readPatch = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/api\/v1\/notifications\/[^/]+\/read$/.test(new URL(response.url()).pathname),
  );

test.describe("sales", () => {
  test.use({ storageState: storageOf("sales") });

  test("바깥 링크 알림을 누르면 앱 안 공고로 가고, 다 읽으면 안 읽음 목록은 빈 상태다(O1)", async ({
    page,
  }) => {
    const { bids } = readWorkContext();
    await page.goto("/notifications");
    const evil = page
      .locator("main ul")
      .getByRole("link")
      .filter({ hasText: EVIL_LINK_NOTIFICATION_TITLE });
    await expect(evil).toHaveAttribute("href", `/bids/${bids["FX-04"]}`);
    const patched = readPatch(page);
    await evil.click();
    await expect(page).toHaveURL(new RegExp(`/bids/${bids["FX-04"]}$`));
    expect((await patched).ok()).toBe(true);
    expect(page.url()).not.toContain("evil.example");

    // 남은 안 읽은 알림을 모두 읽는다(행을 누르면 읽음 처리 후 그 공고로 간다).
    for (let round = 0; round < 10; round += 1) {
      await page.goto("/notifications?unread=1");
      await expect(
        page.getByRole("heading", { level: 1, name: "알림", exact: true }),
      ).toBeVisible();
      const rows = page.locator("main ul.divide-y li a");
      if ((await rows.count()) === 0) break;
      const next = readPatch(page);
      await rows.first().click();
      await next;
      await expect(page).toHaveURL(/\/bids\//);
    }
    await page.goto("/notifications?unread=1");
    await expect(page.getByText("안 읽은 알림이 없습니다", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "전체 보기" })).toBeVisible();
    await expect(topbar(page).getByRole("button", { name: "알림", exact: true })).toBeVisible();
    await shot(page, "notifications", "empty", 1440);
    await assertNoAxe(page, "notifications-empty-1440");
    await page.setViewportSize(VIEWPORT[1280]);
    await shot(page, "notifications", "empty", 1280);
    await assertNoAxe(page, "notifications-empty-1280");
  });
});

test.describe("analyst", () => {
  test.use({ storageState: storageOf("analyst") });

  test("목록이 바뀌어 커서가 무효면 [처음부터 보기]가 같은 주소로 다시 이동해 서버 첫 쪽을 새로 읽는다", async ({
    page,
  }) => {
    const { bids, users, orgs } = readWorkContext();
    const admin = localAdmin();
    const tag = `e2e-c6-restart:${Date.now().toString(36)}`;
    const row = (n: number, title: string, minutesAgo: number) => ({
      org_id: orgs.org01,
      user_id: users.analyst,
      type: "REVIEW_ASSIGNED",
      channel: "IN_APP",
      status: "SENT",
      idempotency_key: `${tag}:${n}`,
      payload: {
        bidId: bids["FX-01"],
        title,
        message: "E2E 커서 시험",
        link: `/bids/${bids["FX-01"]}`,
      },
      sent_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });
    await admin.call(
      "POST",
      "/rest/v1/notifications",
      Array.from({ length: 21 }, (_, n) => row(n, `커서 시험 알림 ${n + 1}`, 30 + n)),
    );
    try {
      await page.goto("/notifications");
      const list = page.locator("main ul.divide-y");
      await expect(list.locator("li")).toHaveCount(20);
      await page.route(
        (url) => url.pathname === "/api/v1/notifications" && url.searchParams.has("cursor"),
        (route) =>
          route.fulfill({
            status: 400,
            headers: { "Content-Type": "application/json", "X-Request-Id": "e2e-c6-cursor" },
            body: JSON.stringify({
              error: {
                code: "INVALID_CURSOR",
                message: "목록이 바뀌었습니다.",
                details: {},
                requestId: "e2e-c6-cursor",
              },
            }),
          }),
      );
      await page.getByRole("button", { name: "더 보기", exact: true }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "목록이 바뀌었습니다" }),
      ).toBeVisible();
      await page.unroute(
        (url) => url.pathname === "/api/v1/notifications" && url.searchParams.has("cursor"),
      );

      // 그사이 서버 목록이 바뀐다: 새 알림 한 건이 맨 위에 온다.
      const freshTitle = `처음부터 보기 뒤 새 알림 ${tag.slice(-6)}`;
      await admin.call("POST", "/rest/v1/notifications", [row(99, freshTitle, 0)]);
      await page.evaluate(() => Reflect.set(window, "__c6SoftNav", true));
      await page.getByRole("button", { name: "처음부터 보기", exact: true }).click();
      await expect(list.locator("li").first()).toContainText(freshTitle);
      await expect(page.getByRole("alert").filter({ hasText: "목록이 바뀌었습니다" })).toHaveCount(
        0,
      );
      await expect(page.getByRole("button", { name: "더 보기", exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/notifications$/);
      // 전체 새로고침이 아니라 같은 주소 router.push 로 서버 컴포넌트를 다시 읽었다.
      expect(await page.evaluate(() => Reflect.get(window, "__c6SoftNav"))).toBe(true);
    } finally {
      await admin.call(
        "DELETE",
        `/rest/v1/notifications?idempotency_key=like.${encodeURIComponent(`${tag}:*`)}`,
      );
    }
  });
});
