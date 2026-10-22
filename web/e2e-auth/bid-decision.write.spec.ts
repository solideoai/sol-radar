import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  assertNoAxe,
  choose,
  kevDistribution,
  kevSection,
  localAdmin,
  readWorkContext,
  shot,
  storageOf,
  tableRows,
} from "./support/work-fixtures";

// S3·S4(19) 쓰기 흐름. 공용 데모 데이터를 바꾸므로 읽기 spec 이 모두 끝난 뒤 한 작업자로 차례로 돈다.
// 바꾼 것(FX-02 분석·결정, FX-08 취소)은 다음 실행의 globalSetup(demo:reset → demo:preanalyze)이 처음 상태로 되돌린다.
test.use({ storageState: storageOf("sales") });
test.describe.configure({ mode: "serial" });

const VIEWPORT = {
  1440: { width: 1440, height: 900 },
  1280: { width: 1280, height: 800 },
} as const;

/** 같은 상태를 1440·1280 두 폭으로 찍고 axe 를 돈다. inView 가 있으면 폭을 바꾼 뒤에도 그 요소가 보이게 한다. */
async function shotBothWidths(page: Page, route: string, state: string, inView?: Locator) {
  await inView?.scrollIntoViewIfNeeded();
  await shot(page, route, state, 1440);
  await assertNoAxe(page, `${route}-${state}-1440`);
  await page.setViewportSize(VIEWPORT[1280]);
  await inView?.scrollIntoViewIfNeeded();
  await shot(page, route, state, 1280);
  await assertNoAxe(page, `${route}-${state}-1280`);
  await page.setViewportSize(VIEWPORT[1440]);
}

test("S3 취소 공고는 상태 '취소 포함'을 고를 때만 보인다(ADR-029 A7)", async ({ page }) => {
  const { bids } = readWorkContext();
  const admin = localAdmin();
  // seed 에는 취소 공고가 없다(FX-08 취소는 S5 LIVE 배치). 로컬 service role 로 잠깐 취소로 바꾸고 되돌린다.
  await admin.call("PATCH", `/rest/v1/bid_notices?id=eq.${bids["FX-08"]}`, { status: "CANCELLED" });
  try {
    // 현재 기본 목록은 NOTICE 15건이다(예정 사업 4건 제외).
    await page.goto("/bids");
    const table = page.getByRole("table", { name: /입찰 공고 사업기회 목록/ });
    await expect(table.locator("tbody tr")).toHaveCount(14);
    expect((await tableRows(table)).map((row) => row.id)).not.toContain(bids["FX-08"]);

    await choose(page, "상태", "취소 포함");
    await expect(page).toHaveURL(/status=CANCELLED/);
    await expect(table.locator("tbody tr")).toHaveCount(15);
    const cancelled = table.locator("tbody tr", {
      has: page.locator(`a[href^="/bids/${bids["FX-08"]}"]`),
    });
    await expect(cancelled).toContainText("취소됨");

    await choose(page, "상태", "진행 중 (기본)");
    await expect(table.locator("tbody tr")).toHaveCount(14);
  } finally {
    await admin.call("PATCH", `/rest/v1/bid_notices?id=eq.${bids["FX-08"]}`, { status: "OPEN" });
  }
});

test("S4 FX-02 분석 실행 → 대기·분석 중 → 완료 72·분해·사람 검토 권장 → WATCH 결정 기록 → 저장 실패 상태", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { bids } = readWorkContext();
  await page.goto(`/bids/${bids["FX-02"]}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const band = page.locator("section", { has: page.locator("#analysis-band-title") });
  const rail = page.getByRole("complementary", { name: "참여 판단" });
  const live = page.locator('[data-slot="analysis-live"]');
  await expect(band).toContainText("미분석");
  await expect(page.getByText("아직 분석하지 않았습니다", { exact: true })).toBeVisible();
  await expect(rail.getByText("아직 기록된 결정이 없습니다")).toBeVisible();

  // 끝난 뒤 화면이 전체 새로고침이 아니라 router.refresh() 로 다시 그려졌는지 보려는 표시.
  await page.evaluate(() => Reflect.set(window, "__c6SoftRefresh", true));

  // 첫 poll 응답 하나를 늦춘다(최소 2초, 대기 화면 스크린샷·axe 를 마칠 때까지).
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/v1/analyses/*", async (route) => {
    if (!held && route.request().method() === "GET") {
      held = true;
      await Promise.all([gate, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    await route.continue();
  });

  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/bids\/[^/]+\/analyses$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "분석 실행", exact: true }).click();
  const response = await posted;
  expect(response.status()).toBe(202);
  const accepted = z
    .object({ analysisId: z.uuid(), status: z.string(), pollUrl: z.string() })
    .parse(await response.json());

  // 대기 중·분석 중: 띠 상태와 본문 skeleton, 레일 위 skeleton.
  await expect(band.getByText(/^(대기 중|분석 중)$/)).toBeVisible();
  await expect(page.locator('[data-slot="analysis-pending"]')).toBeVisible();
  await expect(page.locator('[data-slot="decision-pending"]')).toBeVisible();
  await expect(live).toHaveText(/^(분석 대기 중|분석 중)$/);
  await shotBothWidths(page, "bid-detail", "loading");
  await expect(page.locator('[data-slot="analysis-pending"]')).toBeVisible();
  release();

  // 10초 안에 완료(19 S4 2번). 붙잡아 둔 poll 을 놓은 뒤부터 잰다. 정확한 자리 두 곳에 10초 timeout 을 준다:
  // 화면 낭독기 live 문구(끝난 순간 한 번 바뀐다)와 레일 SOL Score 게이지(router.refresh 로 서버가 다시 그린 값).
  await expect(live).toHaveText("분석이 끝났습니다. SOL Score 72, 권고 WATCH", {
    timeout: 10_000,
  });
  await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "72",
    { timeout: 10_000 },
  );
  await expect(band.getByText("완료", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__c6SoftRefresh"))).toBe(true);
  const run = z
    .object({
      status: z.literal("COMPLETED"),
      solScore: z.number(),
      queuedAt: z.string(),
      finishedAt: z.string(),
    })
    .parse(await (await page.request.get(accepted.pollUrl)).json());
  expect(Math.round(run.solScore)).toBe(72);
  expect(Date.parse(run.finishedAt) - Date.parse(run.queuedAt)).toBeLessThan(10_000);

  const factors = page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: "SOL Score 분해" }),
  });
  const points = await factors
    .locator("ul > li")
    .evaluateAll((items) =>
      items.map((item) => item.textContent?.match(/(\d+\.\d) \/ \d+/)?.[1] ?? ""),
    );
  expect(points).toEqual(["15.0", "18.3", "14.0", "15.0", "10.0"]);
  await expect(rail.getByText("사람 검토 권장", { exact: true })).toBeVisible();
  await expect(rail).toContainText(/권고\s*WATCH/);
  // S4 4번: Kev 분포 BID 0.36 / WATCH 0.52 / NO-BID 0.12, 규칙 권고 WATCH 와 같다.
  expect(await kevDistribution(page)).toEqual({ BID: 36, WATCH: 52, "NO-BID": 12 });
  await expect(kevSection(page)).toContainText("규칙 권고와 같음");
  await page.unroute("**/api/v1/analyses/*");

  // 결정 기록: WATCH + 사유 + 담당자 = 나(이영업).
  const watch = rail.getByRole("radio", { name: "WATCH", exact: true });
  await expect(watch).toBeChecked();
  await watch.click();
  const reason = rail.getByLabel("사유", { exact: true });
  await reason.fill("S4 E2E: 일정과 인력 배치를 다시 확인한 뒤 판단한다.");
  await expect(
    rail
      .getByRole("combobox", { name: "담당자", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("이영업");
  await rail.getByRole("button", { name: "결정 기록", exact: true }).click();
  await expect(page.getByText("결정을 기록했습니다", { exact: true })).toBeVisible();
  const history = rail.locator('section[aria-labelledby="review-history-title"]');
  await expect(history.locator("li")).toHaveCount(1);
  await expect(history).toContainText("마지막 결정: WATCH · 이영업");
  await expect(reason).toHaveValue("");
  // 성공 토스트가 사라진 뒤 실패 상태를 만든다(증거에 두 상태가 겹치지 않게).
  await expect(page.getByText("결정을 기록했습니다", { exact: true })).toBeHidden({
    timeout: 15_000,
  });

  // 저장 실패: POST reviews 에 500 봉투를 주면 코드·요청 ID 가 보이고 입력이 남는다.
  await page.route("**/api/v1/bids/*/reviews", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 500,
      headers: { "Content-Type": "application/json", "X-Request-Id": "e2e-c6-req-500" },
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "요청을 처리하지 못했습니다.",
          details: {},
          requestId: "e2e-c6-req-500",
        },
      }),
    });
  });
  const failedReason = "저장 실패 상태 확인용 사유입니다(E2E).";
  await reason.fill(failedReason);
  await rail.getByRole("button", { name: "결정 기록", exact: true }).click();
  const alert = rail.getByRole("alert");
  await expect(alert).toContainText("결정을 저장하지 못했습니다");
  await expect(alert).toContainText("INTERNAL_ERROR · e2e-c6-req-500");
  await expect(reason).toHaveValue(failedReason);
  await expect(history.locator("li")).toHaveCount(1);
  await shotBothWidths(page, "bid-detail", "error", alert);
  await page.unroute("**/api/v1/bids/*/reviews");
});
