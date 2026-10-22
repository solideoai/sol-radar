import { expect, test } from "@playwright/test";
import { readWorkContext, storageOf, topbar } from "./support/work-fixtures";

// V2-02(11 §3): 실행 모드는 모든 화면 Topbar 와 분석 띠에서 드러난다. mock 실행에서 분석 결과는 "가상 회사 프로필로 분석"이다.
test.use({ storageState: storageOf("sales") });

test("V2-02 Topbar 실행 모드·AI 가 mock 이고 FX-01 분석 띠에 분석 실행 모드와 가상 프로필 배지가 있다", async ({
  page,
}) => {
  const { bids } = readWorkContext();
  for (const path of ["/dashboard", "/bids", "/notifications", `/bids/${bids["FX-01"]}`]) {
    await page.goto(path);
    await expect(topbar(page).locator('[data-indicator="run-mode"]')).toHaveText("실행 모드: mock");
    // AI 지표는 마운트 뒤 /health/ready 를 읽어 채운다(첫 값 "확인 중").
    await expect(topbar(page).locator('[data-indicator="ai"]')).toHaveText("AI: mock");
  }

  const band = page.locator("section", { has: page.locator("#analysis-band-title") });
  await expect(band).toContainText("분석 실행 모드: mock");
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
