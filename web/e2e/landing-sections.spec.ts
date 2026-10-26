import { expect, test, type Locator } from "@playwright/test";
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
    "SOL RADAR에서는",
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

test("주요 기능은 네 가지이고, 화면이 예시 데이터임을 밝힌다", async ({ page }) => {
  await page.goto("/");
  const features = page.getByRole("region", { name: SECTIONS[0].title });
  await expect(features.getByRole("heading", { level: 3 })).toHaveText([
    "공고 수집과 탐색",
    "기업 프로필 기반 자격 검토",
    "SOL Score와 판단 근거",
    "검토 이력과 변경 알림",
  ]);
  // 제목 앞에 아이콘을 두지 않는다. 기능 이름은 글자만으로 읽힌다.
  await expect(features.getByRole("heading", { level: 3 }).locator("svg")).toHaveCount(0);
  await expect(features.getByRole("note")).toHaveText("화면은 예시 데이터로 그렸습니다.");
  // 점수 조각은 demo-3 의 판단 근거를 보인다(판에서 옮겨 왔다).
  await expect(features.getByText(/필수 실적 요건 미충족/)).toBeVisible();
});

// 글자마다 그려진 줄의 위치를 재서, 줄이 바뀐 자리의 첫 글자를 모은다.
const lineStartsOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const range = document.createRange();
    const starts: string[] = [];
    let lineTop: number | null = null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      for (let index = 0; index < text.length; index += 1) {
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.height === 0) continue;
        if (lineTop === null || rect.top > lineTop + rect.height / 2) {
          lineTop = rect.top;
          starts.push(text.data[index]);
        }
      }
    }
    return starts;
  });

// 회귀: 1440 에서 "기관·예산·마감 / ·사업 단계" 처럼 가운뎃점이 줄 맨 앞으로 떨어졌다.
test("주요 기능 설명은 가운뎃점으로 줄을 시작하지 않는다", async ({ page }) => {
  await page.goto("/");
  const features = page.getByRole("region", { name: SECTIONS[0].title });
  const descriptions = features.locator("h3 + p");
  await expect(descriptions).toHaveCount(4);
  for (const description of await descriptions.all()) {
    expect(await lineStartsOf(description)).not.toContain("·");
  }
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
  // 원칙마다 말로만 하지 않고 화면의 실제 표시를 글자로 곁들인다.
  await expect(principles.getByText("화면에서", { exact: true })).toHaveCount(4);
  await expect(principles.getByText(/「소프트웨어사업자로 신고한 자」/)).toBeVisible();
});

const FAQ_QUESTIONS = [
  "어떤 기업을 위한 서비스인가요?",
  "SOL Score가 높으면 수주 가능성이 높다는 뜻인가요?",
  "AI가 입찰 참여 여부를 자동으로 결정하나요?",
  "기업 정보가 부족해도 분석할 수 있나요?",
  "어떤 데이터를 활용하나요?",
];

// 다섯 개뿐이라 접지 않는다. 핵심 고지("수주 확률 아님", "담당자가 결정")를 누르지 않고 읽게 한다.
test("FAQ 는 질문 다섯 개와 답이 처음부터 펼쳐져 있다", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "자주 묻는 질문" });
  await expect(faq.locator("dt")).toHaveText(FAQ_QUESTIONS);
  await expect(faq.locator("dd")).toHaveCount(5);
  await expect(faq.getByText(/실제 수주 확률을 의미하지 않습니다/)).toBeVisible();
  await expect(faq.getByRole("button")).toHaveCount(0);
});

test("주소에 #faq 를 붙여 열면 FAQ 제목이 머리말 아래에 보인다", async ({ page }) => {
  await page.goto("/#faq");
  await expectBelowHeader(page, page.getByRole("heading", { level: 2, name: "자주 묻는 질문" }));
});

// 마지막 안내는 버튼 하나로 끝맺는다. 분석 예시 보기는 히어로에 있다(landing.spec.ts 가 이동을 본다).
test("마지막 구역에는 시작하기 버튼 하나만 있다", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("region", { name: "다음 사업 검토, 근거부터 확인하세요." });
  await expect(cta.getByText(/검토할 사업의 우선순위를 정리하세요/)).toBeVisible();
  await expect(cta.getByRole("link", { name: "시작하기", exact: true })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
  await expect(cta.getByRole("link", { name: "시작하기", exact: true })).toHaveCSS(
    "height",
    "56px",
  );
  await expect(cta.getByRole("note")).toHaveCount(0);
  await expect(cta.getByRole("link")).toHaveCount(1);
  await expect(cta.getByRole("link", { name: "분석 예시 보기" })).toHaveCount(0);
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
