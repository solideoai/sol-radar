import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { z } from "zod";
import { readWorkContext, storageOf } from "./support/work-fixtures";

// BOOST-2 가정 재계산(계획 Task 5 · 디자인 스펙 docs/plans/2026-10-20-boost2-what-if-ui.md §4.3·§4.7·§10).
// 데이터는 C6 하네스(playwright.work.config.ts 의 globalSetup = support/work-setup.ts)가 만든 데모 상태다:
// demo:reset → mock 모드 확인 → demo:preanalyze 가 만든 FX-03 run(NO-BID · 68 · 정보통신공사업 등록 미충족).
// 점수를 심거나 요청을 가로채지 않는다. 스위치는 서버의 진입 호출(빈 가정)이 assumable 로 준 행에만 붙으므로,
// 스위치가 보이면 실제 FX-03 run 의 입력 기록에 ICT_CONSTRUCTION 이 있다는 뜻이다.
// 가정 계산은 저장하지 않는 읽기지만, 결정 기록 건수가 그대로인지 보려고 *.write.spec.ts 의 순서(읽기 spec 뒤)에 둔다.
const REQUIREMENT_NAME = "정보통신공사업 등록";
const REQUIREMENT_CODE = "ICT_CONSTRUCTION";
const FIXED_LINES = [
  "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.",
  "결정 모델 의견은 가정에 포함하지 않았습니다.",
] as const;
// 디자인 스펙 §6 금지 글자(F1). 가정 결과를 확률처럼 읽히게 하는 말을 띠에 쓰지 않는다.
const FORBIDDEN = /확률|승률|가능성|수주|%/;

const VIEWPORT = {
  1440: { width: 1440, height: 900 },
  1280: { width: 1280, height: 800 },
} as const;

// 증거 스크린샷은 BOOST-2 폴더에 둔다(06 §12 이름 규칙: YYYYMMDD-phaseN-<route>-<state>-<width>.png).
const EVIDENCE_DIR = path.join(__dirname, "..", "..", "docs", "evidence", "boost2");
const seoulDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .replaceAll("-", "");

// GET /api/v1/bids/{id}/reviews 응답에서 건수와 id 만 본다(server/bids/review.model.ts reviewSchema 의 일부).
const reviewsSchema = z.array(z.object({ id: z.uuid() }));

const decisionRail = (page: Page) =>
  page.getByRole("complementary", { name: "참여 판단", exact: true });

const whatIfBand = (page: Page) => page.locator('[data-slot="what-if-band"]');

// 비교표에서 행 머리(권고·SOL Score·필수자격) 한 줄의 [원래, 가정] 칸.
function comparisonCells(band: Locator, label: string): [Locator, Locator] {
  const row = band
    .getByRole("table", { name: "원래 결과와 가정 결과 비교", exact: true })
    .getByRole("row")
    .filter({ has: band.page().getByRole("rowheader", { name: label, exact: true }) });
  return [row.getByRole("cell").nth(0), row.getByRole("cell").nth(1)];
}

async function readReviewIds(page: Page, endpoint: string): Promise<string[]> {
  const response = await page.request.get(endpoint);
  expect(response.status()).toBe(200);
  return reviewsSchema.parse(await response.json()).map(({ id }) => id);
}

async function evidenceShot(page: Page, inView: Locator, width: 1440 | 1280) {
  expect(page.viewportSize()?.width, `what-if 증거는 ${width}px 에서 찍는다`).toBe(width);
  await inView.scrollIntoViewIfNeeded();
  // 상단바 AI 지표는 마운트 뒤 /health/ready 를 읽어 채운다. 첫 값("확인 중")이 증거에 찍히지 않게 기다린다.
  await expect(page.locator('[data-slot="topbar-status"] [data-indicator="ai"]')).not.toHaveText(
    /확인 중/,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${seoulDate()}-phase3-bid-detail-what-if-${width}.png`),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

test.use({ storageState: storageOf("sales"), viewport: VIEWPORT[1440] });

test("FX-03: 정보통신공사업 보유 가정은 NO-BID → WATCH 를 보이지만 저장하지 않는다", async ({
  page,
}) => {
  const { bids } = readWorkContext();
  const bidId = bids["FX-03"];
  const reviewsEndpoint = `/api/v1/bids/${bidId}/reviews`;
  const rail = decisionRail(page);
  const band = whatIfBand(page);
  const toggle = page.getByRole("switch", { name: `${REQUIREMENT_NAME} 보유 가정`, exact: true });

  const reviewsBefore = await test.step("결정 기록 건수를 먼저 센다", async () =>
    readReviewIds(page, reviewsEndpoint));

  await test.step("FX-03 상세: 정보통신공사업 등록 행에만 보유 가정 스위치가 있다", async () => {
    await page.goto(`/bids/${bidId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(rail).toContainText(/권고\s*NO-BID/);
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuetext",
      "68점 / 100점 (참고)",
    );
    // 진입 호출(빈 가정) 200 의 assumable 에 ICT_CONSTRUCTION 이 있어야 스위치가 그려진다(§4.2).
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("data-slot", "what-if-switch");
    await expect(toggle).toHaveAttribute("data-code", REQUIREMENT_CODE);
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('[data-slot="what-if-switch"]')).toHaveCount(1);
    await expect(band).toHaveCount(0);
  });

  await test.step("스위치를 켜면 띠가 NO-BID → WATCH, 68 → 68 을 보인다", async () => {
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(band).toBeVisible();
    await expect(band).not.toHaveAttribute("aria-busy", "true");

    const [recommendationBefore, recommendationAfter] = comparisonCells(band, "권고");
    await expect(recommendationBefore).toHaveText("NO-BID");
    await expect(recommendationAfter).toHaveText("WATCH");

    const [scoreBefore, scoreAfter] = comparisonCells(band, "SOL Score");
    await expect(scoreBefore).toHaveText(/^68\s*\/\s*100\s*참고$/);
    await expect(scoreAfter).toHaveText(/^68\s*\/\s*100\s*변화 없음$/);

    const [qualificationBefore, qualificationAfter] = comparisonCells(band, "필수자격");
    await expect(qualificationBefore).toHaveText("미충족");
    await expect(qualificationAfter).toHaveText("충족");

    await expect(band.getByText(`${REQUIREMENT_NAME} 보유`, { exact: true })).toBeVisible();
    for (const line of FIXED_LINES)
      await expect(band.getByText(line, { exact: true })).toBeVisible();
    expect(await band.innerText()).not.toMatch(FORBIDDEN);
  });

  await test.step("오른쪽 참여 판단의 권고·점수는 NO-BID 68 그대로다", async () => {
    await expect(rail).toContainText(/권고\s*NO-BID/);
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuetext",
      "68점 / 100점 (참고)",
    );
  });

  await test.step("1440·1280 증거를 찍는다", async () => {
    await evidenceShot(page, band, 1440);
    await page.setViewportSize(VIEWPORT[1280]);
    await expect(band).toBeVisible();
    await evidenceShot(page, band, 1280);
    await page.setViewportSize(VIEWPORT[1440]);
  });

  await test.step("새로 고침하면 가정은 사라진다", async () => {
    await page.reload();
    // 진입 호출이 끝나 스위치가 다시 그려진 뒤에 띠가 없음을 본다(그리기 전의 빈 화면으로 통과하지 않게).
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(band).toHaveCount(0);
    await expect(rail).toContainText(/권고\s*NO-BID/);
  });

  await test.step("결정 기록 건수는 처음과 같다", async () => {
    const reviewsAfter = await readReviewIds(page, reviewsEndpoint);
    expect(reviewsAfter).toHaveLength(reviewsBefore.length);
    expect([...reviewsAfter].sort()).toEqual([...reviewsBefore].sort());
  });
});
