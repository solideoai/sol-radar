import { expect, test, type Page } from "@playwright/test";
// 워드마크의 정본. 이름을 여기에 따로 적으면 project.json 을 바꿀 때 깨진다.
import project from "@/project.json";
import { expectBelowHeader } from "./sticky-header";

// 첫 화면(랜딩). 데스크톱 전용이라(docs/16-DECISIONS.md ADR-007) 1440px 을 기본으로 본다. 로그인·DB 없이 열린다.
// 같은 이름의 링크(시작하기·분석 예시 보기·로그인·메뉴·로고)가 머리말·본문·바닥글에 같이 있다. 랜드마크·구역 안에서 찾는다.
// 머리말은 site-header.spec.ts 가, 히어로 아래 구역은 landing-sections.spec.ts 가 본다.

test.use({ viewport: { width: 1440, height: 900 } });

const heroOf = (page: Page) => page.getByRole("region", { name: /수많은 공고 속/ });
const previewOf = (page: Page) => page.getByRole("region", { name: "공고 분석 예시" });

test("제목과 설명 메타데이터가 SOL RADAR 의 것이다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("SOL RADAR — 공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /수주 확률이 아닙니다/,
  );
});

test("히어로에 제목·설명·두 버튼이 있고, 시작하기는 가입 화면으로 간다", async ({ page }) => {
  await page.goto("/");
  const hero = heroOf(page);
  await expect(
    hero.getByText(/공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 플랫폼입니다/),
  ).toBeVisible();
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText(
    /^수많은 공고 속,\s*솔리데오가 검토할 사업부터$/,
  );
  await expect(hero.getByText(/참가 자격, 사업 적합도, 추가 확인 사항을 한눈에/)).toBeVisible();
  await expect(hero.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText(/MVP|개발 중|개발 예정|로그인만 이용/)).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "분석 예시 보기" })).toHaveAttribute(
    "href",
    "/#demo",
  );
  const start = hero.getByRole("link", { name: "시작하기", exact: true });
  await expect(start).toHaveAttribute("href", "/auth/sign-up");
  await start.click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  // DB 설정이 없는 빌드는 가입 폼 대신 연결 안내를 그린다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(회원가입|DB 가 연결되지 않았습니다)$/,
  );
});

test("분석 예시 보기를 누르면 미리보기로 가고, 머리말에 가리지 않는다", async ({ page }) => {
  await page.goto("/");
  await heroOf(page).getByRole("link", { name: "분석 예시 보기" }).click();
  await expect(page).toHaveURL(/\/#demo$/);
  // 분석 예시 보기는 구역 제목이 아니라 미리보기 틀(figure)로 바로 온다(점수와 고지가 13인치 화면에 함께 들어오게). 그 틀의 윗변을 잰다.
  // 안쪽 요소(목록 등)를 재면 scroll-mt 가 빠져도 머리말 아래에 있어 시험이 지켜 주지 못한다.
  await expectBelowHeader(page, previewOf(page).getByRole("figure"));
});

test("미리보기는 예시 데이터라고 밝히고, 대표 예시의 점수·자격·권고가 맞는다", async ({ page }) => {
  await page.goto("/");
  const preview = previewOf(page);
  // 회색 띠 위에 보이는 구역 제목이 있다(2026-10-28 사용자 요청).
  await expect(
    preview.getByRole("heading", { level: 2, name: "예시 공고로 분석 화면을 직접 살펴보세요" }),
  ).toBeVisible();
  await expect(preview.getByText("예시 데이터").first()).toBeVisible();
  const panel = preview.getByRole("tabpanel");
  await expect(
    panel.getByRole("heading", { name: "공공기관 업무지원 시스템 고도화" }),
  ).toBeVisible();
  for (const term of ["기관명", "사업 예산", "제안서 마감"]) {
    await expect(panel.getByText(term, { exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("meter", { name: "SOL Score" })).toHaveAttribute(
    "aria-valuenow",
    "82",
  );
  await expect(panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다.")).toBeVisible();
  await expect(panel.getByText("보류", { exact: true })).toBeVisible();
  await expect(panel.getByText("충족 2 · 확인 필요 1 · 미충족 0")).toBeVisible();
  await expect(panel.getByText("필수 증빙의 유효기간 확인 필요")).toBeVisible();
  await expect(panel.getByText("공고문 p.2").first()).toBeVisible();
  await expect(panel.getByText("담당자 결정")).toBeVisible();
  // 판에는 링크가 없다. 예시 공고를 실제 공고처럼 꾸미지 않는다.
  await expect(preview.getByRole("link")).toHaveCount(0);
});

// 심사 화면은 1440×900 과 13인치 노트북(1280×800) 둘 다다. 점수만 보이고 고지가 접힘선 아래로 빠지면 안 된다.
// 히어로와 분석 예시 사이에 흐르는 줄(과 녹화 영상)이 들어와 예시는 첫 화면 아래에 있다(스펙 2026-10-28-ui-refresh §4.5).
// 그래서 분석 예시 보기로 간 화면에서 점수와 고지가 함께 보이는지 본다.
[
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
].forEach((viewport) =>
  test(`${viewport.width}×${viewport.height} 분석 예시 보기를 누르면 점수와 수주 확률 고지가 함께 화면 안에 보인다`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await heroOf(page).getByRole("link", { name: "분석 예시 보기" }).click();
    await expect(page).toHaveURL(/\/#demo$/);
    const panel = previewOf(page).getByRole("tabpanel");
    await expect(panel.getByRole("meter", { name: "SOL Score" })).toBeInViewport({ ratio: 1 });
    await expect(
      panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다."),
    ).toBeInViewport({ ratio: 1 });
  }),
);

// 권고는 화면에 한글(추천·보류·비추천)로 쓴다(ADR-062). 값(BID·WATCH·NO_BID)은 코드에만 있고 글자로 보이지 않는다.
// 움직이는 업무 데모(aria-hidden)도 getByText 에 잡히므로 데모 표의 배지까지 함께 본다.
test("첫 화면의 권고 표기는 추천·보류·비추천이고 영어 표기는 남지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/\b(BID|WATCH|NO-BID)\b/)).toHaveCount(0);
  for (const label of ["추천", "보류", "비추천"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeAttached();
  }
});

test("목록에서 다른 공고를 고르면 분석이 바뀐다", async ({ page }) => {
  await page.goto("/");
  const preview = previewOf(page);
  await preview.getByRole("tab", { name: /통합 민원 포털 기능 개선/ }).click();
  const panel = preview.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "통합 민원 포털 기능 개선" })).toBeVisible();
  await expect(panel.getByRole("meter", { name: "SOL Score" })).toHaveAttribute(
    "aria-valuenow",
    "88",
  );
  await expect(panel.getByText("추천", { exact: true })).toBeVisible();
});

[1280, 1440, 1920].forEach((width) =>
  test(`${width}px 폭에서 가로로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  }),
);

test("1280px 미만에서만 데스크톱 화면 안내가 보인다", async ({ page }) => {
  const notice = page.getByRole("note").filter({ hasText: "데스크톱 화면" });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await expect(notice).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(notice).toBeHidden();
});

// 등장 애니메이션은 motion-safe 에만 걸려 있다. 움직임 줄이기를 켜면 하나도 남지 않아야 한다.
const animatedCount = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("body *")].filter(
        (element) => getComputedStyle(element).animationName !== "none",
      ).length,
  );

test("움직임 줄이기를 켜면 등장 애니메이션이 하나도 없다", async ({ page }) => {
  await page.goto("/");
  // 먼저 애니메이션이 실제로 있는지 본다. 없으면 아래 단언이 늘 통과해 아무것도 지키지 못한다.
  expect(await animatedCount(page)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animatedCount(page)).toBe(0);
});

const FOOTER_GROUPS = [
  {
    title: "둘러보기",
    links: [
      { name: "주요 기능", href: "/#features" },
      { name: "분석 방식", href: "/#analysis" },
      { name: "서비스 소개", href: "/#about" },
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

test("바닥글에 로고·한 줄 소개·메뉴·저작권이 있고, 없는 정책 화면으로 가는 링크는 없다", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: project.title, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(footer.getByText(project.description)).toBeVisible();
  await expect(footer.getByText(`© 2026 ${project.title}`)).toBeVisible();
  const nav = footer.getByRole("navigation", { name: "바닥글 메뉴" });
  for (const { title, links } of FOOTER_GROUPS) {
    const group = nav.getByRole("list", { name: title, exact: true });
    for (const { name, href } of links) {
      await expect(group.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
  }
  await expect(footer.getByRole("link", { name: /약관|개인정보/ })).toHaveCount(0);
});

test("첫 화면 본문·머리말·바닥글은 낱말 단위로 줄을 바꾸고 바탕은 흰색이다", async ({ page }) => {
  await page.goto("/");
  for (const role of ["main", "banner", "contentinfo"] as const) {
    await expect(page.getByRole(role)).toHaveCSS("word-break", "keep-all");
  }
  await expect(page.getByRole("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("1440 첫 화면의 보이는 글자는 모두 13px 이상이다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) =>
        [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()),
      )
      .filter((element) => element.getClientRects().length > 0 && !element.closest(".sr-only"))
      .map((element) => parseFloat(getComputedStyle(element).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(50);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
});
