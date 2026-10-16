import { expect, test } from "@playwright/test";
// 워드마크의 정본. `pnpm bootstrap` 이 새 프로젝트를 만들 때 이 파일의 title 을 바꾼다. 이름을 여기에 따로 적으면 그때 깨진다.
import project from "@/project.json";

// 첫 화면(랜딩)의 내용 — 히어로의 버튼, 견본 화면, 기능·시작 구역, 바닥글. 정적이라 로그인·DB 없이 열린다.
// 같은 이름의 링크(시작하기·로그인·기능·시작 방법·로고)가 머리말·본문·바닥글에 같이 있다. 랜드마크 안에서 찾는다.
// 머리말은 site-header.spec.ts 가, 응답·오류·Supabase 요청은 home.spec.ts 가 본다.

test("히어로의 시작하기를 누르면 가입 화면으로 가고, 로그인은 계정 화면을 가리킨다", async ({
  page,
}) => {
  await page.goto("/");
  const main = page.getByRole("main");
  // 본문에는 '로그인 견본' 링크도 있다. 이름이 정확히 같은 것만 고른다.
  await expect(main.getByRole("link", { name: "로그인", exact: true })).toHaveAttribute(
    "href",
    "/auth/login",
  );
  const start = main.getByRole("link", { name: "시작하기", exact: true });
  await expect(start).toHaveAttribute("href", "/auth/sign-up");
  await start.click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  // DB 설정이 없는 빌드는 가입 폼 대신 연결 안내를 그린다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(회원가입|DB 가 연결되지 않았습니다)$/,
  );
});

// 견본 화면은 그림(figure)이고, 이름은 그 아래 설명 글이다. "견본 데이터"라고 밝히지 않으면 지어낸 수치로 읽힌다.
const PREVIEW = /견본 데이터/;
// 첫 화면의 Tab 자리는 스무 개 남짓이다. 그 안에 견본 화면을 지나지 못하면 멈춘다.
const MAX_TABS = 40;

test("견본 화면 안으로는 Tab 초점이 들어가지 않는다", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("figure", { name: PREVIEW });
  await expect(preview).toBeVisible();
  // 지금 초점이 견본 화면의 앞·안·뒤 어디에 있는지.
  const focusPlace = () =>
    preview.evaluate((figure) => {
      const active = document.activeElement;
      if (!active || active === document.body) return "none";
      if (figure.contains(active)) return "inside";
      const isAfter = figure.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING;
      return isAfter ? "after" : "before";
    });
  // 위에서부터 Tab 을 눌러 견본 화면에 닿거나 지날 때까지 간다. 초점은 문서 차례로 움직이므로 안에 설 자리가 있으면 지나기 전에 선다.
  const places: string[] = [];
  while (!["inside", "after"].includes(places.at(-1) ?? "") && places.length < MAX_TABS) {
    await page.keyboard.press("Tab");
    places.push(await focusPlace());
  }
  // 견본 화면 앞의 버튼(히어로)에는 서고, 그다음은 견본 화면을 건너뛴다.
  expect(places).toContain("before");
  expect(places.at(-1)).toBe("after");
});

test("견본 화면은 견본 데이터라고 밝히고, 화면 낭독기에는 안의 표를 읽히지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  const preview = page.getByRole("figure", { name: PREVIEW });
  await expect(preview).toBeVisible();
  // 그림 안에는 막대 차트의 낭독기용 표가 있다. 숨기지 않으면 화면 낭독기가 견본 숫자를 실제 값처럼 읽는다.
  await expect(preview.getByRole("table", { includeHidden: true })).toHaveCount(1);
  await expect(preview.getByRole("table")).toHaveCount(0);
});

test("기능 구역에 제목과 기능 여섯 칸이 있다", async ({ page }) => {
  await page.goto("/");
  const features = page.getByRole("region", { name: "처음부터 깔려 있는 가드레일" });
  await expect(features.getByRole("heading", { level: 2 })).toBeVisible();
  // 머리말과 바닥글의 '기능' 링크(/#features)가 이 id 로 온다.
  await expect(features).toHaveAttribute("id", "features");
  // 칸의 차례와 주제는 스펙(base-design 4.5)이 정한다. 문구 전체가 아니라 주제어만 본다.
  await expect(features.getByRole("heading", { level: 3 })).toHaveText([
    /검증 게이트/,
    /RLS/,
    /토큰 정본/,
    /웹과 앱/,
    /스킬/,
    /CI/,
  ]);
});

test("시작 구역에 제목과 세 단계가 차례대로 있다", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("region", { name: "세 단계로 시작합니다" });
  await expect(start.getByRole("heading", { level: 2 })).toBeVisible();
  // 머리말과 바닥글의 '시작 방법' 링크(/#start)가 이 id 로 온다.
  await expect(start).toHaveAttribute("id", "start");
  await expect(start.getByRole("listitem")).toHaveText([
    /\/setup/,
    /\/verify/,
    /\/predeploy-review/,
  ]);
});

const FOOTER_GROUPS = [
  {
    title: "둘러보기",
    links: [
      { name: "기능", href: "/#features" },
      { name: "시작 방법", href: "/#start" },
    ],
  },
  {
    title: "계정",
    links: [
      { name: "로그인", href: "/auth/login" },
      { name: "회원가입", href: "/auth/sign-up" },
      { name: "비밀번호 재설정", href: "/auth/reset" },
    ],
  },
];

test("바닥글에 첫 화면으로 가는 로고와 둘러보기·계정 링크가 있다", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: project.title, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  const nav = footer.getByRole("navigation", { name: "바닥글 메뉴" });
  for (const { title, links } of FOOTER_GROUPS) {
    const group = nav.getByRole("list", { name: title, exact: true });
    for (const { name, href } of links) {
      await expect(group.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
  }
});
