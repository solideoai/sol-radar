import { expect, test, type Locator } from "@playwright/test";
// 워드마크의 정본. `pnpm bootstrap` 이 새 프로젝트를 만들 때 이 파일의 title 을 바꾼다. 이름을 여기에 따로 적으면 그때 깨진다.
import project from "@/project.json";

// 머리말은 정적이라 로그인·DB 없이도 같은 모양으로 열린다. 첫 화면(/)만 쓰는 마케팅 머리말이다.
// 같은 이름의 링크(로그인·시작하기·기능·시작 방법·로고)가 본문과 바닥글에도 있다. 머리말(banner) 안에서 찾는다.
const ACCOUNT_LINKS = [
  { name: "로그인", href: "/auth/login" },
  { name: "시작하기", href: "/auth/sign-up" },
];
// 첫 화면의 구역으로 가는 링크. 좁은 폭에서는 숨는다.
const SECTION_LINKS = [
  { name: "기능", href: "/#features" },
  { name: "시작 방법", href: "/#start" },
];

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("화면에 그려지지 않은 요소의 자리를 재려 했다");
  return box;
};

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

test("넓은 폭에서는 주요 메뉴의 구역 링크를 누르면 그 구역으로 간다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const nav = page.getByRole("banner").getByRole("navigation", { name: "주요 메뉴" });
  for (const { name, href } of SECTION_LINKS) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  // 기능 구역은 히어로와 견본 화면 아래에 있다. 처음에는 화면 밖이어야 눌러서 옮겨 갔는지 알 수 있다.
  const features = page.getByRole("heading", { level: 2, name: "처음부터 깔려 있는 가드레일" });
  await expect(features).not.toBeInViewport();
  await nav.getByRole("link", { name: "기능", exact: true }).click();
  await expect(page).toHaveURL(/\/#features$/);
  await expect(features).toBeInViewport();
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
  await expect(page.locator("#main-content")).toBeFocused();
  // 건너뛴 자리는 본문 랜드마크(main)다. 머리말까지 감싼 바깥 상자면 다음 Tab 이 다시 로고부터 지난다.
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  // 다음 Tab 은 머리말의 링크가 아니라 본문의 첫 링크(히어로의 시작하기)다.
  await page.keyboard.press("Tab");
  await expect(main.getByRole("link", { name: "시작하기", exact: true })).toBeFocused();
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

test("320px 에서 머리말이 한 줄이고 구역 링크는 숨는다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("navigation", { name: "주요 메뉴" })).toBeHidden();
  // 왼쪽부터 로고·로그인·시작하기. 좁으면 줄을 바꾸지 않고 워드마크가 말줄임된다.
  const items = [project.title, ...ACCOUNT_LINKS.map(({ name }) => name)].map((name) =>
    header.getByRole("link", { name, exact: true }),
  );
  for (const item of items) await expect(item).toBeVisible();
  const boxes = await Promise.all(items.map(boxOf));
  // 한 줄이면 세로 가운데가 같다(로고와 버튼은 높이가 달라 위쪽 선은 다르다). 줄이 바뀌면 버튼 높이만큼 벌어진다.
  const centers = boxes.map((box) => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  // 서로 겹치지 않고 화면 안에 차례로 놓인다.
  const edges = boxes.flatMap((box) => [box.x, box.x + box.width]);
  expect(edges).toEqual([...edges].sort((a, b) => a - b));
  expect(edges[0]).toBeGreaterThanOrEqual(0);
  expect(edges[edges.length - 1]).toBeLessThanOrEqual(320);
});
