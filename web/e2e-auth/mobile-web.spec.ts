import { expect, test } from "@playwright/test";
import { authFileOf } from "./support/seed";

test.use({ storageState: authFileOf("owner"), viewport: { width: 390, height: 844 } });

test("모바일에서 메뉴로 공고를 열고 필터를 취소·적용한 뒤 일정을 읽는다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
  await page.getByRole("button", { name: "사이드바 여닫기" }).click();
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "입찰 공고", exact: true })
    .click();
  await expect(page).toHaveURL(/\/bids(?:\?|$)/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: /^필터(?: \d+)?$/ }).click();
  await page.getByRole("button", { name: "AI·AX", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("keyword")).toBe(false);
  await page.getByRole("button", { name: /^필터(?: \d+)?$/ }).click();
  await page.getByRole("button", { name: "AI·AX", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page).toHaveURL(/keyword=AI_AX/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "키워드: AI·AX 조건 해제", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "사이드바 여닫기" }).click();
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "입찰 일정", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "입찰 일정" })).toBeVisible();
  await expect(page.getByRole("region", { name: /일정 목록$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/mobile-web/calendar-390.png" });
});
