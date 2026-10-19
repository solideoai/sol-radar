import { expect, test, type Page } from "@playwright/test";
import {
  assertNoAxe,
  choose,
  fontSizeOf,
  horizontalOverflow,
  readWorkContext,
  shot,
  storageOf,
  tableRows,
  topbar,
  widthOf,
} from "./support/work-fixtures";

// C6 네 화면의 상태·값·글자·넘침과 06 §12 스크린샷(읽기만 한다). 값의 정본은 11 #6~#9·19 S2·S3, ADR-030 B25·B26, Ruling 9.
// 알림 읽음·결정 기록처럼 데이터를 바꾸는 확인은 *.write.spec.ts 에 있다.
test.use({ storageState: storageOf("sales") });

const sidebarMenuFont = (page: Page) =>
  fontSizeOf(
    page
      .getByRole("navigation", { name: "주요 메뉴", exact: true })
      .getByRole("link", { name: "입찰 공고" }),
  );

test.describe("S2 /dashboard", () => {
  test("카드·BID 표 값이 19 S2 와 같고 표 두 개는 위아래로 쌓이며 +3px 눈금이다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto("/dashboard");
    const h1 = page.getByRole("heading", { level: 1, name: "대시보드", exact: true });
    await expect(h1).toBeVisible();

    const summary = page.locator('section[aria-labelledby="dashboard-summary-title"]');
    const card = (label: string) =>
      summary.locator('[data-slot="card"]').filter({ has: page.getByText(label, { exact: true }) });
    await expect(card("BID 권고").locator(".type-title")).toHaveText("3");
    await expect(card("분석 현황").locator(".type-title")).toHaveText("18");
    await expect(card("분석 현황")).toContainText("부분 0 · 실패 0");
    await expect(card("수집")).toContainText("적재 19 · 격리 1");

    const bidTable = page.getByRole("table", { name: "BID 권고 (점수 높은 순)" });
    const rows = await tableRows(bidTable);
    expect(rows.slice(0, 3)).toEqual([
      { id: bids["FX-01"], score: "94" },
      { id: bids["FX-18"], score: "82" },
      { id: bids["FX-06"], score: "78" },
    ]);

    // Ruling 9: 두 표는 위아래로 쌓인다(나란히가 아니다).
    const [bidBox, deadlineBox] = await Promise.all([
      bidTable.boundingBox(),
      page.getByRole("table", { name: "마감 임박 (7일)" }).boundingBox(),
    ]);
    expect(bidBox && deadlineBox && deadlineBox.y >= bidBox.y + bidBox.height).toBe(true);
    expect(bidBox && deadlineBox && Math.abs(deadlineBox.x - bidBox.x) < 1).toBe(true);

    // ADR-030 B25·B26: 대시보드 본문 +3px(h1 33·본문 17), 사이드바 메뉴 16.
    expect(await fontSizeOf(h1)).toBe("33px");
    expect(
      await fontSizeOf(
        page.locator("main#main-content > div > div").first().locator("p.type-body"),
      ),
    ).toBe("17px");
    expect(await sidebarMenuFont(page)).toBe("16px");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await shot(page, "dashboard", "loaded", width);
    await assertNoAxe(page, "dashboard-loaded");
  });
});

test.describe("S3 /bids", () => {
  test("목록 정상 상태·글자·넘침과 스크린샷", async ({ page }) => {
    const width = widthOf(page);
    await page.goto("/bids");
    const h1 = page.getByRole("heading", { level: 1, name: "입찰 공고", exact: true });
    await expect(h1).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^공고 \d+건 표시$/ })).toHaveText(
      "공고 19건 표시",
    );
    expect(await fontSizeOf(h1)).toBe("30px");
    expect(await sidebarMenuFont(page)).toBe("16px");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bids-list", "loaded", width);
    await assertNoAxe(page, "bids-list-loaded");
  });

  test("권고 BID + 점수 높은 순이면 FX-01 94·FX-18 82·FX-06 78, 결정 NO-BID 면 FX-03", async ({
    page,
  }) => {
    const { bids } = readWorkContext();
    await page.goto("/bids");
    const table = page.getByRole("table", { name: "입찰 공고 목록" });
    await choose(page, "권고", "BID");
    await expect(page).toHaveURL(/[?&]recommendation=BID(&|$)/);
    await choose(page, "정렬", "점수 높은 순");
    await expect(page).toHaveURL(/[?&]sort=score%3Adesc(&|$)/);
    await expect(table.locator("tbody tr")).toHaveCount(3);
    expect(await tableRows(table)).toEqual([
      { id: bids["FX-01"], score: "94" },
      { id: bids["FX-18"], score: "82" },
      { id: bids["FX-06"], score: "78" },
    ]);

    await page.getByRole("button", { name: "필터 초기화" }).click();
    await expect(page).toHaveURL(/\/bids$/);
    await expect(table.locator("tbody tr")).toHaveCount(19);
    await choose(page, "결정", "NO-BID");
    await expect(page).toHaveURL(/[?&]decision=NO_BID(&|$)/);
    await expect
      .poll(async () => (await tableRows(table)).map((row) => row.id))
      .toContain(bids["FX-03"]);
  });

  test("필터 결과 0건이면 빈 상태와 필터 초기화를 보인다", async ({ page }) => {
    const width = widthOf(page);
    await page.goto("/bids");
    const search = page.getByRole("searchbox", { name: "공고 검색" });
    await search.fill("존재하지않는공고zz");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByText("조건에 맞는 공고가 없습니다", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /건 표시$/ })).toHaveText(
      "공고 0건 표시",
    );
    await expect(page.locator("main").getByRole("button", { name: "필터 초기화" })).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bids-list", "empty", width);
    await assertNoAxe(page, "bids-list-empty");
  });

  test("잘못된 공고 주소는 공고를 찾을 수 없습니다와 공고 목록으로를 보인다", async ({ page }) => {
    await page.goto("/bids/not-a-uuid");
    await expect(page.getByText("공고를 찾을 수 없습니다").first()).toBeVisible();
    const back = page.getByRole("link", { name: "공고 목록으로" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/bids$/);
  });
});

test.describe("S4 /bids/[id] FX-01", () => {
  test("상세 정상 상태·넘침·스크린샷, 결정 레일은 sticky, 첨부 내려받기 링크는 없다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto(`/bids/${bids["FX-01"]}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("세종특별자치시");
    const rail = page.getByRole("complementary", { name: "참여 판단" });
    await expect(rail).toContainText("94");
    await expect(page.getByRole("heading", { level: 2, name: "SOL Score 분해" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bid-detail", "loaded", width);
    await assertNoAxe(page, "bid-detail-loaded");

    // 첨부는 상태만 보인다. 내려받기 링크(MinIO·presigned·download 속성)를 그리지 않는다(09).
    const detail = await page.request.get(`/api/v1/bids/${bids["FX-01"]}`);
    const { sourceUrl } = (await detail.json()) as { sourceUrl: string };
    const attachments = page.locator('section[aria-labelledby="attachment-status-title"]');
    await expect(attachments).toBeVisible();
    const attachmentHrefs = await attachments
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(attachmentHrefs.every((href) => href === sourceUrl)).toBe(true);
    const pageHrefs = await page
      .locator("a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(
      pageHrefs.filter((href) => /download|minio|presign|X-Amz|:9000|:19100/i.test(href)),
    ).toEqual([]);
    expect(await page.locator("a[download]").count()).toBe(0);

    // 결정 레일은 sticky(top-18 = 72px)다. 본문을 내려도 레일 위 끝이 Topbar 아래에 붙어 있다.
    const railBox = page.locator('[data-slot="bid-detail-rail"]');
    expect(await railBox.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
    const topBefore = await railBox.evaluate((element) => element.getBoundingClientRect().top);
    await page.mouse.move(400, 500);
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(() => railBox.evaluate((element) => element.getBoundingClientRect().top))
      .toBeCloseTo(72, 0);
    const scrolled = await page.evaluate(() => {
      const main = document.querySelector('[data-slot="bid-detail-main"]');
      return main ? main.getBoundingClientRect().top : 0;
    });
    expect(scrolled).toBeLessThan(topBefore - 200);
  });
});

test.describe("/notifications", () => {
  test("알림 정상 상태: 2건, 바깥 링크는 앱 안 공고 경로로 바뀌어 있다", async ({ page }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "알림", exact: true })).toBeVisible();
    const list = page.locator("main ul.divide-y");
    await expect(list.locator("li")).toHaveCount(2);
    await expect(list.getByText("결정 담당으로 지정되었습니다.", { exact: true })).toBeVisible();
    await expect(list.getByText("분석이 끝났습니다.", { exact: true })).toBeVisible();
    const evil = list.getByRole("link").filter({ hasText: "분석이 끝났습니다." });
    await expect(evil).toHaveAttribute("href", `/bids/${bids["FX-04"]}`);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.filter((href) => href.includes("evil.example"))).toEqual([]);
    await expect(topbar(page).getByRole("button", { name: "알림, 안 읽음 2건" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "notifications", "loaded", width);
    await assertNoAxe(page, "notifications-loaded");
  });
});
