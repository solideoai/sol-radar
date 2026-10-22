import { expect, test, type Page } from "@playwright/test";
import {
  assertNoAxe,
  readWorkContext,
  shot,
  storageOf,
  tabTo,
  topbar,
  widthOf,
} from "./support/work-fixtures";

// G8(11 §3): 데모 데이터는 어디서든 DEMO 로 드러난다. 목록 모든 행·Topbar·상세 제목 앞, 초점을 주면 09 고정 툴팁.
const DEMO_TOOLTIP = "이 데이터는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다.";

// 닫히는 중인 앞 툴팁이 잠깐 DOM 에 남으므로 열린 것만 본다.
const openTooltip = (page: Page) => page.locator('[data-slot="tooltip-content"][data-open]');

test.use({ storageState: storageOf("sales") });

test("G8 목록 모든 행과 Topbar·상세 제목 앞에 DEMO 가 있고 초점을 주면 09 툴팁이 보인다", async ({
  page,
}) => {
  const width = widthOf(page);
  const { bids } = readWorkContext();
  // NOTICE 15건과 예정 사업 4건을 모두 열어 전체 DEMO 표시를 검증한다.
  await page.goto("/bids?includeEarly=true");
  await expect(page.getByRole("heading", { level: 1, name: "입찰 공고" })).toBeVisible();

  const rows = page.getByRole("table", { name: /입찰 공고 사업기회 목록/ }).locator("tbody tr");
  await expect(rows).toHaveCount(19);
  // 현재 사업기회 표는 관심·출처 열을 앞에 두고 DEMO는 제목 셀에 표시한다.
  for (const row of await rows.all())
    await expect(row.getByText("DEMO", { exact: true })).toBeVisible();

  const badge = topbar(page).locator('[data-indicator="demo"]').getByText("DEMO", { exact: true });
  await expect(badge).toBeVisible();
  await tabTo(page, topbar(page).locator('[data-indicator="demo"] [tabindex="0"]'));
  await expect(openTooltip(page)).toHaveText(DEMO_TOOLTIP);
  await shot(page, "bids-list", "demo-badge", width);
  await assertNoAxe(page, "bids-list-demo-badge");

  await page.goto(`/bids/${bids["FX-01"]}`);
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toContainText("세종특별자치시");
  // 제목 위 배지 줄의 첫 배지가 DEMO 다(스펙 §5.4.1).
  const eyebrowDemo = page
    .locator("main#main-content")
    .locator('[tabindex="0"]', { hasText: /^DEMO$/ })
    .first();
  await expect(eyebrowDemo).toBeVisible();
  const [badgeBox, titleBox] = await Promise.all([eyebrowDemo.boundingBox(), title.boundingBox()]);
  expect(badgeBox && titleBox && badgeBox.y < titleBox.y).toBe(true);
  await tabTo(page, eyebrowDemo);
  await expect(openTooltip(page)).toHaveText(DEMO_TOOLTIP);
});
