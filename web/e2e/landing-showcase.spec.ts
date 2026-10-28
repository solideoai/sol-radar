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

test("솔리데오 수행 서비스 줄에 서비스 17개가 사이트 순서대로 있다", async ({ page }) => {
  await page.goto("/");
  const items = firstCopyItems(page, SERVICES_TITLE);
  await expect(items).toHaveCount(SOLIDEO_SERVICES.length);
  expect(SOLIDEO_SERVICES).toHaveLength(17);
  await expect(items.first()).toHaveText("정부24");
  // 그림은 옆 이름 글자와 같은 뜻이라 alt 가 비어 있다(역할 img 가 아니다). 원본 경로로 바로 받는지 본다(next/image 최적화 경로는 운영에서 404).
  await expect(items.first().locator("img")).toHaveAttribute("src", /^\/landing\/services\//);
});

test("데이터 출처 줄은 기관마다 한 칸이고, 수집하지 않는 기관에만 연결 예정 꼬리표가 있다", async ({
  page,
}) => {
  await page.goto("/");
  const region = regionOf(page, SOURCES_TITLE);
  const items = firstCopyItems(page, SOURCES_TITLE);
  await expect(items).toHaveCount(DATA_SOURCES.length);
  const planned = DATA_SOURCES.filter((source) => source.status === "planned");
  // 꼬리표가 하나도 없으면 아래 단언이 지키는 것이 없다. 지금 목록에는 연결 예정 기관이 있다.
  expect(planned.length).toBeGreaterThan(0);
  await expect(
    region.locator('ul:not([aria-hidden="true"])').getByText("연결 예정", { exact: true }),
  ).toHaveCount(planned.length);
  for (const [index, source] of DATA_SOURCES.entries()) {
    const item = items.nth(index);
    await expect(item).toContainText(source.name);
    await expect(item.getByText("연결 예정", { exact: true })).toHaveCount(
      source.status === "planned" ? 1 : 0,
    );
  }
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
