import { expect, test, type Page } from "@playwright/test";
import { DATA_SOURCES, SOLIDEO_SERVICES } from "@/components/landing/showcase-data";

// 히어로 아래 흐르는 줄 둘: 솔리데오 수행 서비스와 데이터 출처(스펙 2026-10-28-ui-refresh §4.5).
// 목록은 두 번 이어 붙여 흐르고, 둘째 사본은 화면 낭독기에서 숨긴다(aria-hidden). 첫 사본만 센다.

test.use({ viewport: { width: 1440, height: 900 } });

const SERVICES_TITLE = "솔리데오가 수행한 공공 서비스";
const SOURCES_TITLE = "SOL RADAR 가 공고를 가져오는 곳";

const regionOf = (page: Page, name: string) => page.getByRole("region", { name });
const firstCopyItems = (page: Page, name: string) =>
  regionOf(page, name).locator('ul:not([aria-hidden="true"]) > li');
const secondCopyOf = (page: Page, name: string) =>
  regionOf(page, name).locator('ul[aria-hidden="true"]');

test("솔리데오 수행 서비스 줄에 서비스 17개가 사이트 순서대로 로고로만 있다", async ({ page }) => {
  await page.goto("/");
  const region = regionOf(page, SERVICES_TITLE);
  const items = firstCopyItems(page, SERVICES_TITLE);
  await expect(items).toHaveCount(SOLIDEO_SERVICES.length);
  expect(SOLIDEO_SERVICES).toHaveLength(17);
  // 카드에는 글자 없이 로고만 있고, 이름은 그림 alt 로 읽힌다(2026-10-28 사용자 요청).
  const logos = region.locator('ul:not([aria-hidden="true"])').getByRole("img");
  await expect(logos).toHaveCount(17);
  await expect(logos.first()).toHaveAttribute("alt", "정부24");
  // 둘째 사본은 화면 낭독기에서 숨어 줄 전체에서도 이름 있는 그림이 17개다(34개가 아니다).
  await expect(region.getByRole("img")).toHaveCount(17);
  const visibleText = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).innerText.trim()).filter(Boolean),
  );
  expect(visibleText).toEqual([]);
  // 원본 경로로 바로 받는지 본다(next/image 최적화 경로는 운영에서 404).
  await expect(logos.first()).toHaveAttribute("src", /^\/landing\/services\//);
});

test("데이터 출처 줄은 기관마다 로고 한 칸이고, 연결 상태 글자는 없다", async ({ page }) => {
  await page.goto("/");
  const region = regionOf(page, SOURCES_TITLE);
  const items = firstCopyItems(page, SOURCES_TITLE);
  await expect(items).toHaveCount(DATA_SOURCES.length);
  expect(DATA_SOURCES).toHaveLength(9);
  // 서비스 줄처럼 로고만 있고 이름은 그림 alt 로 읽힌다. 연결 상태는 문서로 관리한다(2026-10-28 사용자 요청).
  const logos = region.locator('ul:not([aria-hidden="true"])').getByRole("img");
  await expect(logos).toHaveCount(9);
  await expect(logos.first()).toHaveAttribute("alt", "나라장터(조달청)");
  // 둘째 사본은 화면 낭독기에서 숨어 줄 전체에서도 이름 있는 그림이 9개다(18개가 아니다).
  await expect(region.getByRole("img")).toHaveCount(9);
  const visibleText = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).innerText.trim()).filter(Boolean),
  );
  expect(visibleText).toEqual([]);
  await expect(page.getByText("연결 예정")).toHaveCount(0);
  await expect(page.getByText("공공데이터포털")).toHaveCount(0);
  await expect(
    region.getByText("기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다."),
  ).toBeVisible();
});

test("줄 위에 마우스를 올리면 흐름이 멈춘다", async ({ page }) => {
  await page.goto("/");
  for (const name of [SERVICES_TITLE, SOURCES_TITLE]) {
    const track = regionOf(page, name).getByTestId("marquee-track");
    await expect(track).toHaveCSS("animation-play-state", "running");
    // 트랙은 계속 움직여 Playwright 가 멈추기를 기다린다. 움직이지 않는 바깥 칸(줄 전체)에 올린다.
    await regionOf(page, name).getByTestId("marquee-viewport").hover();
    await expect(track).toHaveCSS("animation-play-state", "paused");
  }
});

test("키보드로 줄에 초점을 옮기면 흐름이 멈춘다", async ({ page }) => {
  await page.goto("/");
  const viewport = regionOf(page, SERVICES_TITLE).getByTestId("marquee-viewport");
  await viewport.focus();
  await expect(viewport).toBeFocused();
  await expect(regionOf(page, SERVICES_TITLE).getByTestId("marquee-track")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
});

test("움직임 줄이기를 켜면 줄이 멈추고 둘째 사본이 보이지 않는다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const name of [SERVICES_TITLE, SOURCES_TITLE]) {
    await expect(secondCopyOf(page, name)).toBeHidden();
    await expect(regionOf(page, name).getByTestId("marquee-track")).toHaveCSS(
      "animation-name",
      "none",
    );
  }
});

test("흐르는 줄이 페이지를 가로로 넘치게 하지 않는다", async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(regionOf(page, SOURCES_TITLE)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  }
});

// 히어로 아래 업무 데모: 동영상이 아니라 HTML 로 그린 앱 화면이 장면을 바꿔 가며 흐른다(2026-10-28 사용자 지시).
// 장면은 data-scene, 단계는 data-step 으로 드러낸다. 움직이는 판은 화면 낭독기에서 빠지고 흐름 요약 문단을 읽는다.
const workDemo = (page: Page) => page.getByRole("region", { name: "SOL RADAR 업무 데모" });

test("업무 데모는 히어로와 흐르는 줄 사이에서 장면을 바꿔 가며 흐른다", async ({ page }) => {
  await page.goto("/");
  const demo = workDemo(page);
  await expect(demo).toHaveAttribute("data-scene", "1");
  await expect(demo).toHaveAttribute("data-scene", "2", { timeout: 10_000 });
  await expect(demo.locator('[aria-hidden="true"][inert]')).toHaveCount(1);
  await expect(
    demo.getByText("가상 공고로 만든 예시 화면입니다. 출처 이름과 로고만 실제입니다."),
  ).toBeVisible();

  const heroTitle = await page.getByRole("heading", { level: 1 }).boundingBox();
  const demoBox = await demo.boundingBox();
  const marqueeTop = (await regionOf(page, SERVICES_TITLE).boundingBox())?.y ?? -Infinity;
  expect(heroTitle).not.toBeNull();
  expect(demoBox).not.toBeNull();
  expect(demoBox?.y ?? -Infinity).toBeGreaterThan((heroTitle?.y ?? 0) + (heroTitle?.height ?? 0));
  expect((demoBox?.y ?? Infinity) + (demoBox?.height ?? 0)).toBeLessThanOrEqual(marqueeTop);
});

test("데모 멈춤을 누르면 그 단계에 머물고, 데모 재생을 누르면 이어서 흐른다", async ({ page }) => {
  await page.goto("/");
  const demo = workDemo(page);
  await expect(demo).toHaveAttribute("data-step", /^[1-9]/);
  await demo.getByRole("button", { name: "데모 멈춤", exact: true }).click();
  const step = (await demo.getAttribute("data-step")) ?? "";
  // 한 단계는 3초를 넘지 않는다. 그보다 길게 기다려도 그대로다.
  await page.waitForTimeout(3500);
  await expect(demo).toHaveAttribute("data-step", step);
  await demo.getByRole("button", { name: "데모 재생", exact: true }).click();
  await expect(demo).not.toHaveAttribute("data-step", step);
});

test("움직임 줄이기면 데모는 분석 상세 완성 화면에 멈춰 있고 움직이는 요소가 없다", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const demo = workDemo(page);
  await expect(demo).toHaveAttribute("data-scene", "4");
  await expect(demo.getByRole("button", { name: "데모 재생", exact: true })).toBeVisible();
  const step = (await demo.getAttribute("data-step")) ?? "";
  await page.waitForTimeout(3500);
  await expect(demo).toHaveAttribute("data-step", step);
  const animated = await demo.evaluate(
    (element) =>
      [...element.querySelectorAll("*")].filter(
        (node) => getComputedStyle(node).animationName !== "none",
      ).length,
  );
  expect(animated).toBe(0);
});
