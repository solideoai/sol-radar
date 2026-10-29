import { expect, test, type Page } from "@playwright/test";
import { DATA_SOURCES, SOLIDEO_SERVICES } from "@/components/landing/showcase-data";
import { STEP } from "@/components/landing/work-demo-data";

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

// 마우스를 올리거나 눌러도 멈추지 않는다(2026-10-28 사용자 요청).
test("줄 위에 마우스를 올리거나 눌러도 흐름이 멈추지 않는다", async ({ page }) => {
  await page.goto("/");
  for (const name of [SERVICES_TITLE, SOURCES_TITLE]) {
    const track = regionOf(page, name).getByTestId("marquee-track");
    // 트랙은 계속 움직여 Playwright 가 멈추기를 기다린다. 움직이지 않는 바깥 칸(줄 전체)에 올린다.
    const viewport = regionOf(page, name).getByTestId("marquee-viewport");
    await viewport.hover();
    await expect(track).toHaveCSS("animation-play-state", "running");
    await viewport.click();
    await expect(viewport).toBeFocused();
    await expect(track).toHaveCSS("animation-play-state", "running");
  }
});

test("키보드로 줄에 초점을 옮기면 흐름이 멈춘다", async ({ page }) => {
  await page.goto("/");
  const viewport = regionOf(page, SERVICES_TITLE).getByTestId("marquee-viewport");
  // 마우스로 누른 초점과 구분되게 실제 Tab 으로 들어간다. 줄 앞 링크 수에 기대지 않게 넉넉히 누른다.
  for (
    let presses = 0;
    presses < 30 && !(await viewport.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press("Tab");
  }
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

// 들어오자마자 출처 로고 줄과 고지 문장까지 첫 화면에 다 보여야 한다(2026-10-28 사용자 요청). 노트북 브라우저 높이 800 기준.
// 고지 문장 아래에는 살짝 여백이 남는다(같은 날 사용자 요청). 24px 이상 비어 있는지 본다.
test("첫 화면(높이 800)에 출처 로고 줄과 고지 문장이 잘리지 않고 보인다", async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const sources = regionOf(page, SOURCES_TITLE);
    const logos = await sources.getByTestId("marquee-viewport").boundingBox();
    const notice = await sources
      .getByText("기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다.")
      .boundingBox();
    expect(logos).not.toBeNull();
    expect(notice).not.toBeNull();
    expect((logos?.y ?? Infinity) + (logos?.height ?? 0)).toBeLessThanOrEqual(800);
    expect((notice?.y ?? Infinity) + (notice?.height ?? 0)).toBeLessThanOrEqual(800 - 24);
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

// 흐르는 줄 둘 아래 업무 데모: 동영상이 아니라 HTML 로 그린 앱 화면이 장면을 바꿔 가며 흐른다(2026-10-28 사용자 지시).
// 출처 줄 고지 문장 바로 아래에 둔다(2026-10-28 사용자 요청). 판이 화면에 보일 때만 흐르므로 시험은 판까지 스크롤한다.
// 장면은 data-scene, 단계는 data-step 으로 드러낸다. 움직이는 판은 화면 낭독기에서 빠지고 흐름 요약 문단을 읽는다.
const workDemo = (page: Page) => page.getByRole("region", { name: "SOL RADAR 업무 데모" });

test("업무 데모는 출처 줄 고지 문장 아래에서 장면을 바꿔 가며 흐른다", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  const demo = workDemo(page);
  await expect(demo).toHaveAttribute("data-scene", "1");
  // 판 위에 구역 제목이 있다(2026-10-28 사용자 요청).
  await expect(
    demo.getByRole("heading", { level: 2, name: "매일 아침, 새 공고가 검토 목록이 되기까지" }),
  ).toBeVisible();
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute("data-scene", "2", { timeout: 10_000 });
  await expect(demo.locator('[aria-hidden="true"][inert]')).toHaveCount(1);

  // 흐르는 줄 둘이 먼저이고, 데모 판은 출처 줄의 고지 문장 아래에서 시작한다.
  const notice = await page
    .getByText("기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다.")
    .boundingBox();
  const sourcesBox = await regionOf(page, SOURCES_TITLE).boundingBox();
  const demoBox = await demo.boundingBox();
  expect(notice).not.toBeNull();
  expect(sourcesBox).not.toBeNull();
  expect(demoBox).not.toBeNull();
  expect(demoBox?.y ?? -Infinity).toBeGreaterThanOrEqual((notice?.y ?? 0) + (notice?.height ?? 0));
  expect(demoBox?.y ?? -Infinity).toBeGreaterThanOrEqual(
    (sourcesBox?.y ?? 0) + (sourcesBox?.height ?? 0),
  );

  // 옆에서 들어온 패널이 정착한 뒤 공고를 누른다. 커서 끝이 실제 목표 안에 있어야 한다.
  // 360ms의 누름 단계를 느린 단언 폴링으로 건너뛰지 않게 DOM의 도착을 기다린다.
  await page
    .locator(`section[aria-label="SOL RADAR 업무 데모"][data-step="${STEP.rowPress}"]`)
    .waitFor({ state: "attached", timeout: 12_000 });
  const target = await demo.locator('[data-demo-target="bid-row"]').boundingBox();
  const cursor = demo.locator('[data-pressed="true"] > div');
  const pointer = await cursor.boundingBox();
  expect(target).not.toBeNull();
  expect(pointer).not.toBeNull();
  expect(pointer?.x ?? -Infinity).toBeGreaterThanOrEqual(target?.x ?? 0);
  expect(pointer?.x ?? Infinity).toBeLessThan((target?.x ?? 0) + (target?.width ?? 0));
  expect(pointer?.y ?? -Infinity).toBeGreaterThanOrEqual(target?.y ?? 0);
  expect(pointer?.y ?? Infinity).toBeLessThan((target?.y ?? 0) + (target?.height ?? 0));
  expect(
    await cursor.evaluate((node) => getComputedStyle(node, "::before").animationName),
  ).not.toBe("none");

  await expect(demo).toHaveAttribute("data-scene", "4");
  const panel = demo.locator('[data-active="true"]');
  expect(
    await panel.evaluate((node) =>
      node.getAnimations().some((animation) => {
        const frames =
          animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
        return new Set(frames.map((frame) => frame.transform)).size > 1;
      }),
    ),
  ).toBe(true);
  await expect(demo).toHaveAttribute("data-step", String(STEP.detailBubble), { timeout: 8000 });
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(demo).toHaveAttribute("data-scene", "5");
  await expect(demo).toHaveAttribute("data-step", String(STEP.replay), { timeout: 5000 });
  await expect(demo).toHaveAttribute("data-step", "0", { timeout: 5000 });
});

test("키보드로 데모 멈춤을 누르면 그 단계에 머물고, 데모 재생을 누르면 이어서 흐른다", async ({
  page,
}) => {
  await page.goto("/");
  const demo = workDemo(page);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute("data-scene", "2");
  // 버튼은 화면에서 숨어 있다가 키보드 초점이 오면 보인다(2026-10-28 사용자 요청).
  const pause = demo.getByRole("button", { name: "데모 멈춤", exact: true });
  expect((await pause.locator("..").boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await pause.focus();
  await pause.press("Enter");
  const play = demo.getByRole("button", { name: "데모 재생", exact: true });
  await expect(play).toBeFocused();
  // 버튼 이름이 바뀌므로 감싼 칸은 새 이름(데모 재생)의 버튼에서 다시 찾는다.
  expect((await play.locator("..").boundingBox())?.width ?? 0).toBeGreaterThan(20);
  const step = (await demo.getAttribute("data-step")) ?? "";
  const panel = demo.locator('[data-active="true"]');
  const pausedTimes = () =>
    panel.evaluate((node) =>
      node
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "paused")
        .map((animation) => animation.currentTime),
    );
  const times = await pausedTimes();
  expect(times.length).toBeGreaterThan(0);
  // 한 단계는 3초를 넘지 않는다. 그보다 길게 기다려도 그대로다.
  await page.waitForTimeout(3500);
  await expect(demo).toHaveAttribute("data-step", step);
  expect(await pausedTimes()).toEqual(times);
  await play.press("Enter");
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
