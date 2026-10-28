import { expect, test, type Page } from "@playwright/test";
import { DATA_SOURCES, LANDING_VIDEO, SOLIDEO_SERVICES } from "@/components/landing/showcase-data";

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

// 녹화 영상: 히어로와 흐르는 줄 사이(06-UI-UX §3.4). 소리 없이 되풀이하고, 자동 재생 속성 없이 화면이 열리면 스스로 튼다.
// 움직임 줄이기면 틀지 않고 포스터와 재생 조작 막대를 둔다.
const landingVideo = (page: Page) => page.locator("main video");

test("녹화 영상은 히어로와 흐르는 줄 사이에서 소리 없이 되풀이해 재생된다", async ({ page }) => {
  expect(LANDING_VIDEO).not.toBeNull();
  await page.goto("/");
  const video = landingVideo(page);
  await expect(video).toHaveCount(1);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(video).toHaveJSProperty("playsInline", true);
  await expect(video).not.toHaveAttribute("autoplay");
  await expect(video).toHaveAttribute("poster", LANDING_VIDEO?.poster ?? "");
  const sources = await video
    .locator("source")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("src")));
  expect(sources).toEqual([LANDING_VIDEO?.webm, LANDING_VIDEO?.mp4]);

  // 1초 뒤에도 재생 중이고 시간이 흘렀다(파일을 실제로 받아 튼다).
  await page.waitForTimeout(1000);
  await expect(video).toHaveJSProperty("paused", false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(
    0,
  );

  const heroTitle = await page.getByRole("heading", { level: 1 }).boundingBox();
  const heroBottom = heroTitle === null ? Infinity : heroTitle.y + heroTitle.height;
  const videoBox = await video.boundingBox();
  const marqueeTop = (await regionOf(page, SERVICES_TITLE).boundingBox())?.y ?? -Infinity;
  expect(videoBox).not.toBeNull();
  expect(videoBox?.y ?? -Infinity).toBeGreaterThan(heroBottom);
  expect((videoBox?.y ?? Infinity) + (videoBox?.height ?? 0)).toBeLessThanOrEqual(marqueeTop);
});

test("움직임 줄이기를 켜고 열면 영상은 멈춘 채 재생 조작 막대를 보인다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const video = landingVideo(page);
  await expect(video).toHaveJSProperty("controls", true);
  await page.waitForTimeout(1000);
  await expect(video).toHaveJSProperty("paused", true);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(0);
  // 조작 막대와 겹치지 않게 멈춤·재생 버튼은 숨는다.
  await expect(page.getByRole("button", { name: /^영상 (멈춤|재생)$/ })).toHaveCount(0);
});

// 5초 넘게 스스로 움직이는 내용은 멈출 수 있어야 한다(WCAG 2.2.2). 영상 오른쪽 아래의 버튼으로 멈추고 다시 튼다.
test("영상 멈춤 버튼을 누르면 멈춘 채 있고, 다시 누르면 재생한다", async ({ page }) => {
  await page.goto("/");
  const video = landingVideo(page);
  await expect(video).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "영상 멈춤", exact: true }).click();
  await expect(video).toHaveJSProperty("paused", true);
  const play = page.getByRole("button", { name: "영상 재생", exact: true });
  await expect(play).toBeVisible();
  // 사용자가 멈추면 다시 누를 때까지 스스로 다시 틀지 않는다.
  await page.waitForTimeout(1000);
  await expect(video).toHaveJSProperty("paused", true);
  await play.click();
  await expect(video).toHaveJSProperty("paused", false);
  await expect(page.getByRole("button", { name: "영상 멈춤", exact: true })).toBeVisible();
});
