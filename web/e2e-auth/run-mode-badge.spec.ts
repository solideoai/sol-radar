import { expect, test } from "@playwright/test";
import { readWorkContext, storageOf, topbar } from "./support/work-fixtures";

// V2-02: 모의 응답·가상 프로필은 기본 노출하고 실행 모드는 분석 상세 정보에서 확인한다.
// 10-26 운영 전환: Topbar 에서는 실행 모드·AI 상태를 뺐다(배포 설정 값이 실공고 화면에 "mock" 으로 보여 데모로 오해하게 했다).
test.use({ storageState: storageOf("sales") });

test("V2-02 모의 응답은 보이고 실행 모드는 분석 상세 정보에서 확인한다", async ({ page }) => {
  const { bids } = readWorkContext();
  for (const path of ["/dashboard", "/bids", "/notifications", `/bids/${bids["FX-01"]}`]) {
    await page.goto(path);
    await expect(topbar(page).locator('[data-indicator="freshness"]')).toBeVisible();
    await expect(
      topbar(page).locator('[data-indicator="run-mode"], [data-indicator="ai"]'),
    ).toHaveCount(0);
    await expect(topbar(page)).not.toContainText("실행 모드");
    await expect(topbar(page)).not.toContainText("AI:");
  }

  const band = page.locator("section", { has: page.locator("#analysis-band-title") });
  await expect(band.getByText("Mock 응답(데모 데이터)", { exact: true })).toBeVisible();
  await expect(band.getByText("분석 실행 모드: mock", { exact: true })).not.toBeVisible();
  await band.getByText("분석 상세 정보", { exact: true }).click();
  await expect(band.getByText("분석 실행 모드: mock", { exact: true })).toBeVisible();
  await expect(band.getByText("가상 회사 프로필로 분석", { exact: true })).toBeVisible();
  await expect(band).toContainText("AI: mock");
});

test("V2-02 /bids?origin=all 이면 출처 필터 값이 전체다", async ({ page }) => {
  await page.goto("/bids?origin=all");
  const origin = page
    .getByRole("combobox", { name: "데이터 구분", exact: true })
    .locator('[data-slot="select-value"]');
  await expect(origin).toHaveText("전체");
  await page.goto("/bids");
  await expect(origin).toHaveText("데모 공고");
});
