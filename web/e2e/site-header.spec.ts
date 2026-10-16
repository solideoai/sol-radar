import { expect, test } from "@playwright/test";
// 워드마크의 정본. 이름을 여기에 따로 적으면 project.json 을 바꿀 때 깨진다.
import project from "@/project.json";
import { boxOf } from "./sticky-header";

// 첫 화면(/)만 쓰는 마케팅 머리말. 데스크톱 전용이라(ADR-007) 좁은 폭용 메뉴가 없다. 기본 폭은 Desktop Chrome(1280px)이다.
// 같은 이름의 링크(로그인·시작하기·메뉴·로고)가 본문과 바닥글에도 있다. 머리말(banner) 안에서 찾는다.
// 메뉴를 눌러 구역으로 옮겨 가는 것은 landing-sections.spec.ts 가 본다.
const ACCOUNT_LINKS = [
  { name: "로그인", href: "/auth/login" },
  { name: "시작하기", href: "/auth/sign-up" },
];
const SECTION_LINKS = [
  { name: "주요 기능", href: "/#features" },
  { name: "분석 방식", href: "/#analysis" },
  { name: "서비스 소개", href: "/#about" },
];

test("머리말의 로고는 첫 화면으로, 로그인·시작하기는 계정 화면으로 간다", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: project.title, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  for (const { name, href } of ACCOUNT_LINKS) {
    const link = header.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }
});

test("주요 메뉴에 구역 링크 세 개가 차례대로 있다", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("banner").getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav.getByRole("link")).toHaveText(SECTION_LINKS.map(({ name }) => name));
  for (const { name, href } of SECTION_LINKS) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
});

test("첫 Tab 에 건너뛰기 링크가 보이고 누르면 본문으로 간다", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  // not-sr-only 가 높이·안쪽 여백을 되돌리지 않는지: 누를 수 있는 크기여야 한다.
  const box = await skip.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  // 다음 Tab 은 머리말의 링크가 아니라 본문의 첫 링크(히어로의 시작하기)다.
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("region", { name: /수많은 공고 속/ })
      .getByRole("link", { name: "시작하기", exact: true }),
  ).toBeFocused();
});

// 인증 틀(로그인·안내·없는 주소)도 같은 건너뛰기 링크를 쓴다. 없는 주소는 DB 없이 인증 틀을 그린다.
// 한 마디 주소(/<이름>)는 조직 주소(/[slug])라 404 가 아니다. 없는 주소는 조직 아래의 없는 화면으로 쓴다.
test("인증 틀에서도 건너뛰기 링크가 본문(main)으로 간다", async ({ page }) => {
  await page.goto("/acme/route-that-does-not-exist");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.getByRole("main")).toBeFocused();
});

test("1280px 에서 머리말이 한 줄이고 로고·메뉴·버튼이 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const names = [project.title, ...SECTION_LINKS.map(({ name }) => name), "로그인", "시작하기"];
  const items = names.map((name) => header.getByRole("link", { name, exact: true }));
  for (const item of items) await expect(item).toBeVisible();
  const boxes = await Promise.all(items.map(boxOf));
  // 한 줄이면 세로 가운데가 같다(로고와 버튼은 높이가 달라 위쪽 선은 다르다).
  const centers = boxes.map((box) => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  // 서로 겹치지 않고 화면 안에 차례로 놓인다.
  const edges = boxes.flatMap((box) => [box.x, box.x + box.width]);
  expect(edges).toEqual([...edges].sort((a, b) => a - b));
  expect(edges[0]).toBeGreaterThanOrEqual(0);
  expect(edges[edges.length - 1]).toBeLessThanOrEqual(1280);
});

test("아래로 내려도 머리말이 화면 맨 위에 붙어 있다", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const header = page.getByRole("banner");
  await expect(header).toBeInViewport();
  expect((await boxOf(header)).y).toBe(0);
});

test("머리말은 72px 단색이고 메뉴 글자는 17px 이다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const { height } = await boxOf(header);
  expect(height).toBeGreaterThanOrEqual(72);
  expect(height).toBeLessThanOrEqual(73);
  await expect(header).toHaveCSS("backdrop-filter", "none");
  await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(
    header.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link").first(),
  ).toHaveCSS("font-size", "17px");
});
