import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { assertNoAxe, localAdmin, readWorkContext, shot, storageOf } from "./support/work-fixtures";

test.use({ storageState: storageOf("sales") });

async function capture(page: Page, name: string) {
  await assertNoAxe(page, `p1-${name}`);
  await shot(page, `p1-${name}`, "loaded", 1440);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  await shot(page, `p1-${name}`, "loaded", 1280);
  await page.setViewportSize({ width: 1440, height: 900 });
}

// 하나의 로컬 쓰기 흐름. 기존 읽기 프로젝트 완료 후 실행하며 globalTeardown이 데모 기준선을 복구한다.
test("P1 관심 → 분석 4건 비교 → 프로젝트 저장 → 인력 조회", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { bids } = readWorkContext();
  const bidId = bids["FX-01"];
  await page.goto(`/bids/${bidId}`);
  const toggle = page.locator(`[data-slot="watch-toggle"][data-bid-id="${bidId}"]`);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const added = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(`/bids/${bidId}/watch`),
  );
  await toggle.click();
  expect((await added).status()).toBe(200);
  await page.getByRole("link", { name: "관심 공고", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관심 공고", exact: true })).toBeVisible();
  const watchedRow = page
    .getByRole("row")
    .filter({ has: page.locator(`a[href^="/bids/${bidId}"]`) });
  await expect(watchedRow).toHaveCount(1);
  await capture(page, "watchlist");
  const removed = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().endsWith(`/bids/${bidId}/watch`),
  );
  await watchedRow.locator('[data-slot="watch-toggle"]').click();
  expect((await removed).status()).toBe(200);
  await expect(watchedRow).toBeVisible();
  await expect(watchedRow.getByText("관심 해제됨", { exact: true })).toBeVisible();
  await expect(watchedRow.locator('[data-slot="watch-toggle"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.reload();
  await expect(page.getByText("아직 관심 공고가 없습니다", { exact: true })).toBeVisible();

  const historyResponse = await page.request.get("/api/v1/analyses?limit=4");
  expect(historyResponse.status()).toBe(200);
  const history = z
    .object({ items: z.array(z.object({ id: z.uuid() })) })
    .parse(await historyResponse.json());
  expect(history.items).toHaveLength(4);
  const ids = history.items.map((item) => item.id);
  const admin = localAdmin();
  const saved = z
    .array(
      z.object({
        id: z.uuid(),
        status: z.string(),
        score: z.number().nullable(),
        recommendation: z.string().nullable(),
        error_code: z.string().nullable(),
      }),
    )
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/score_runs?select=id,status,score,recommendation,error_code&id=in.(${ids[2]},${ids[3]})`,
      ),
    );
  try {
    await admin.call("PATCH", `/rest/v1/score_runs?id=eq.${ids[2]}`, { status: "PARTIAL" });
    await admin.call("PATCH", `/rest/v1/score_runs?id=eq.${ids[3]}`, {
      status: "FAILED",
      score: null,
      recommendation: null,
      error_code: "E2E_STORED_FAILURE",
    });
    await page.goto(`/analysis?compare=${ids.join(",")}`);
    await expect(page.getByRole("heading", { level: 1, name: "분석 결과 비교" })).toBeVisible();
    const comparison = page.getByRole("table", { name: "저장된 분석 결과 비교", exact: true });
    await expect(comparison.getByRole("columnheader")).toHaveCount(5);
    await expect(comparison.getByText("E2E_STORED_FAILURE", { exact: true })).toBeVisible();
    await expect(comparison.getByText(/부분 완료/)).toBeVisible();
    await page.locator("#analysis-comparison-title").scrollIntoViewIfNeeded();
    await capture(page, "analysis-four");
  } finally {
    for (const { id, ...row } of saved)
      await admin.call("PATCH", `/rest/v1/score_runs?id=eq.${id}`, row);
  }

  await page.goto(`/bids/${bidId}`);
  // 앞선 FX-01 흐름이 WATCH 결정을 기록하므로 이 흐름에서 새 BID를 실제로 기록한다.
  const rail = page.getByRole("complementary", { name: "참여 판단", exact: true });
  await rail.getByRole("radio", { name: "BID", exact: true }).click();
  await rail
    .getByLabel("사유", { exact: true })
    .fill("P1 통합: 제출 조건을 확인하여 입찰 프로젝트를 진행합니다.");
  await rail.getByRole("button", { name: "결정 기록", exact: true }).click();
  await page.getByRole("button", { name: "입찰 프로젝트 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByLabel("새 체크리스트 항목", { exact: true }).fill("P1 제출 서류 확인");
  await page.getByRole("button", { name: "항목 추가", exact: true }).click();
  const completed = page.getByRole("checkbox", { name: "P1 제출 서류 확인 완료" });
  await expect(completed).toBeVisible();
  // DB 저장 뒤 서버 스냅샷으로 바뀌는 제어 체크박스이므로 완료 상태를 기다린다.
  await completed.click();
  await expect(completed).toBeChecked();
  await page.locator("#project-status").selectOption("SUBMITTED");
  await page.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
  await expect(page.getByText("프로젝트를 저장했습니다", { exact: true })).toBeVisible();
  await page.locator("#project-result").selectOption("WON");
  await page.getByRole("button", { name: "결과 기록", exact: true }).click();
  await expect(page.getByText("결과를 기록했습니다", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("#project-status")).toHaveValue("SUBMITTED");
  await expect(completed).toBeChecked();
  await expect(page.locator("#project-result")).toHaveValue("WON");
  await capture(page, "project-detail");
  const detail = await page.request.get(`/api/v1/projects/${projectId}`);
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toMatchObject({
    status: "SUBMITTED",
    result: "WON",
    checklistProgress: { done: 1, total: 1 },
  });
  const viewerContext = await browser.newContext({ storageState: storageOf("viewer") });
  try {
    const viewer = await viewerContext.newPage();
    await viewer.goto(new URL(`/projects/${projectId}`, page.url()).href);
    await expect(viewer.getByText("읽기 전용입니다.", { exact: false })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "프로젝트 저장", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "항목 추가", exact: true })).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "입찰 프로젝트" })).toBeVisible();
  await capture(page, "project-board");

  await page.goto(`/workforce?bidIds=${[bidId, bids["FX-03"], bids["FX-04"]].join(",")}`);
  await expect(page.getByRole("heading", { level: 1, name: "인력 배치 시뮬레이션" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "분석 당시 인력 가용성", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "현재 배정과 기간 충돌", exact: true }),
  ).toBeVisible();
  await page.locator("#snapshot-heading").scrollIntoViewIfNeeded();
  await capture(page, "workforce-three");
});
