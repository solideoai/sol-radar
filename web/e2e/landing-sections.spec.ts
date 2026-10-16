import { expect, test } from "@playwright/test";
import { expectBelowHeader } from "./sticky-header";

// 첫 화면의 히어로 아래 구역들. 데스크톱 전용이라 1440px 에서 본다. 구역은 h2 로 이름 붙은 region 이다.

test.use({ viewport: { width: 1440, height: 900 } });

const SECTIONS = [
  { link: "주요 기능", hash: "#features", title: "검토에 필요한 정보를 한 흐름으로 모읍니다" },
  {
    link: "분석 방식",
    hash: "#analysis",
    title: "기업 정보를 등록하면, 검토할 사업이 명확해집니다.",
  },
  {
    link: "서비스 소개",
    hash: "#about",
    title: "공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다.",
  },
];

SECTIONS.forEach(({ link, hash, title }) =>
  test(`머리말의 ${link} 링크는 그 구역으로 가고, 제목이 머리말에 가리지 않는다`, async ({
    page,
  }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 2, name: title });
    // 처음에는 화면 밖이어야 눌러서 옮겨 갔는지 알 수 있다.
    await expect(heading).not.toBeInViewport();
    await page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", { name: link, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${hash}$`));
    await expectBelowHeader(page, heading);
  }),
);

test("서비스 소개는 지금 방식과 SOL RADAR 를 비교하는 표다", async ({ page }) => {
  await page.goto("/");
  const about = page.getByRole("region", { name: SECTIONS[2].title });
  await expect(about.getByRole("columnheader")).toHaveText([
    "검토 단계",
    "지금은",
    /SOL RADAR에서는/,
  ]);
  await expect(about.getByRole("rowheader")).toHaveText([
    "요구사항 파악",
    "자격·실적 대조",
    "판단 기록",
  ]);
  await expect(about.getByText("서비스 소개", { exact: true })).toHaveCount(0);
});

test("구역 제목 위에 작은 머리글이 없다", async ({ page }) => {
  await page.goto("/");
  const h2s = page.getByRole("main").locator("h2:not(.sr-only)");
  await expect(h2s).not.toHaveCount(0);
  for (const h2 of await h2s.all()) {
    expect(await h2.evaluate((element) => element.previousElementSibling)).toBeNull();
  }
});

test("주요 기능은 네 가지이고, 모두 개발 예정이라고 밝힌다", async ({ page }) => {
  await page.goto("/");
  const features = page.getByRole("region", { name: SECTIONS[0].title });
  await expect(features.getByRole("heading", { level: 3 })).toHaveText([
    "공고 수집과 탐색",
    "기업 프로필 기반 자격 검토",
    "SOL Score와 판단 근거",
    "검토 이력과 변경 알림",
  ]);
  await expect(features.getByText("개발 예정", { exact: true })).toHaveCount(4);
  await expect(features.getByRole("note")).toContainText("아직 이용할 수 없습니다");
  // 점수 조각은 demo-3 의 판단 근거를 보인다(판에서 옮겨 왔다).
  await expect(features.getByText(/필수 실적 요건 미충족/)).toBeVisible();
});

test("작동 방식은 세 단계이고, 단계마다 하는 일과 얻는 것이 있다", async ({ page }) => {
  await page.goto("/");
  const analysis = page.getByRole("region", { name: SECTIONS[1].title });
  await expect(analysis.getByRole("heading", { level: 3 })).toHaveText([
    "기업 프로필 등록",
    "공고와 요구사항 비교",
    "근거 확인 후 참여 결정",
  ]);
  const steps = analysis.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  for (const step of await steps.all()) {
    await expect(step).toContainText("하는 일");
    await expect(step).toContainText("얻는 것");
  }
});

test("분석 원칙 네 가지가 있다", async ({ page }) => {
  await page.goto("/");
  const principles = page.getByRole("region", {
    name: "점수만 보여주지 않고, 판단의 근거를 함께 제공합니다.",
  });
  await expect(principles.getByRole("heading", { level: 3 })).toHaveText([
    "원문과 근거를 연결합니다",
    "확인된 정보와 확인이 필요한 정보를 나눕니다",
    "적합도와 수주 확률을 구분합니다",
    "AI 권고와 최종 결정을 구분합니다",
  ]);
});

const FAQ_QUESTIONS = [
  "어떤 기업을 위한 서비스인가요?",
  "SOL Score가 높으면 수주 가능성이 높다는 뜻인가요?",
  "AI가 입찰 참여 여부를 자동으로 결정하나요?",
  "기업 정보가 부족해도 분석할 수 있나요?",
  "어떤 데이터를 활용하나요?",
];

test("FAQ 는 질문 다섯 개이고, 누르거나 Enter 로 답을 펼치고 접는다", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "자주 묻는 질문" });
  await expect(faq.getByRole("button")).toHaveText(FAQ_QUESTIONS);
  const score = faq.getByRole("button", { name: FAQ_QUESTIONS[1] });
  const scoreAnswer = faq.getByText("실제 수주 확률을 의미하지 않습니다.", { exact: false });
  await expect(score).toHaveAttribute("aria-expanded", "false");
  await expect(scoreAnswer).toBeHidden();
  await score.click();
  await expect(score).toHaveAttribute("aria-expanded", "true");
  await expect(scoreAnswer).toBeVisible();
  await score.press("Enter");
  await expect(score).toHaveAttribute("aria-expanded", "false");
  await expect(scoreAnswer).toBeHidden();
  const data = faq.getByRole("button", { name: FAQ_QUESTIONS[4] });
  await data.focus();
  await page.keyboard.press("Space");
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(faq.getByText(/실제 연동 범위는 개발 상태에 맞춰 안내합니다/)).toBeVisible();
});

test("주소에 #faq 를 붙여 열면 FAQ 제목이 머리말 아래에 보인다", async ({ page }) => {
  await page.goto("/#faq");
  await expectBelowHeader(page, page.getByRole("heading", { level: 2, name: "자주 묻는 질문" }));
});

test("마지막 구역에 시작하기·분석 예시 보기와 MVP 개발 중 안내가 있다", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("region", { name: "다음 사업 검토, 근거부터 확인하세요." });
  await expect(cta.getByText(/검토할 사업의 우선순위를 정리하세요/)).toBeVisible();
  await expect(cta.getByRole("link", { name: "시작하기", exact: true })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
  await expect(cta.getByRole("note")).toContainText("MVP를 개발하고 있습니다");
  const demo = cta.getByRole("link", { name: "분석 예시 보기" });
  await expect(demo).toHaveAttribute("href", "/#demo");
  await demo.click();
  await expect(page).toHaveURL(/\/#demo$/);
  await expectBelowHeader(
    page,
    page.getByRole("region", { name: "공고 분석 예시" }).getByRole("figure"),
  );
});

test('첫 화면에는 빈 링크(href="#")와 이름 없는 링크·버튼이 없다', async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="#"], a:not([href])')).toHaveCount(0);
  for (const control of [
    ...(await page.getByRole("link").all()),
    ...(await page.getByRole("button").all()),
  ]) {
    await expect(control).toHaveAccessibleName(/\S/);
  }
});
