import { expect, test, type Locator, type Page } from "@playwright/test";

// 첫 화면의 스크롤 등장 효과(components/landing/reveal.tsx). 데스크톱 전용이라(ADR-007) 1440×900 에서 본다.
// 열 때 화면 아래에 있는 블록은 data-reveal="hidden"(투명·24px 아래)으로 시작하고, 20% 이상 보이면 "shown" 이 되어 떠오른다.
// 한 번 나타나면 다시 숨지 않는다. 움직임 줄이기면 아무것도 숨거나 움직이지 않는다.
// 사람이 보는 결과는 "투명했다가 보인다" 이므로 data-reveal 값과 함께 계산된 opacity·translate 를 잰다.
// 히어로·미리보기의 첫 등장 애니메이션은 landing.spec.ts 가 본다.

test.use({ viewport: { width: 1440, height: 900 } });

const REVEAL = "[data-reveal]";
const HIDDEN = '[data-reveal="hidden"]';
const FEATURES_TITLE = "검토에 필요한 정보를 한 흐름으로 모읍니다";
const ERROR_TITLE = "문제가 생겼습니다";
// 전환은 500ms 다. 관찰 신호가 오는 시간을 더해도 1.5초 안에는 끝나야 한다.
const SETTLE = { timeout: 1_500 };
// 숨김이 풀리면 translate 값이 빠진다(none). 0 으로 읽히는 경우도 같은 뜻이다.
const NO_TRANSLATE = /^(none|0px|0px 0px)$/;

const heroOf = (page: Page) => page.getByRole("region", { name: /수많은 공고 속/ });
const previewOf = (page: Page) => page.getByRole("region", { name: "공고 분석 예시" });
// 주요 기능 구역의 제목 묶음(보조 문구·제목·설명·안내)을 감싼 블록. 처음 화면에서는 접히는 선 아래에 있다.
const featuresHeadingOf = (page: Page) =>
  page.locator(REVEAL, { has: page.getByRole("heading", { level: 2, name: FEATURES_TITLE }) });

// 요소와 조상들의 opacity 를 곱한 값. 감싼 블록이 투명하면 안쪽 글자도 보이지 않는다.
const visibleOpacity = (locator: Locator) =>
  locator.evaluate((element) => {
    const opacityOf = (node: Element | null): number =>
      node ? Number(getComputedStyle(node).opacity) * opacityOf(node.parentElement) : 1;
    return opacityOf(element);
  });

const styleOf = (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        top: element.getBoundingClientRect().top,
        opacity: style.opacity,
        translate: style.translate,
      };
    }),
  );

// data-reveal 은 하이드레이션 때 ref 콜백이 단다. 숨은 블록이 생겼으면 효과가 살아 있다는 뜻이다.
// 이 확인이 없으면 효과가 통째로 사라져도 "숨은 블록이 없다" 는 단언들이 늘 통과한다.
const expectSomeHidden = (page: Page) =>
  expect.poll(() => page.locator(HIDDEN).count()).toBeGreaterThan(0);

// 화면이 한 번 이상 다시 그려질 때까지 기다린다. IntersectionObserver 는 그릴 때 겹침을 잰다.
const nextFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

const watchPageErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

// 브라우저가 새로 받은 문서(HTML) 주소. 비어 있으면 그 사이의 이동은 클라이언트 이동이다.
const watchDocuments = (page: Page) => {
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  return documents;
};

// FAQ 첫 질문을 펼친다. 펼쳐지면 하이드레이션이 끝났다는 뜻이기도 하다.
const openFirstQuestion = async (page: Page) => {
  const question = page
    .getByRole("region", { name: "자주 묻는 질문" })
    .getByRole("button", { name: "어떤 기업을 위한 서비스인가요?" });
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
};

// 머리말의 로그인으로 옮겨 가서 오류 화면이 아닌 로그인 화면이 그려졌는지 본다.
const goToLogin = async (page: Page) => {
  await page.getByRole("banner").getByRole("link", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  // DB 설정이 없는 빌드는 로그인 폼 대신 연결 안내를 그린다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(로그인|DB 가 연결되지 않았습니다)$/,
  );
};

test("처음 열면 접히는 선 아래 블록만 숨어 있고, 히어로·분석 미리보기는 숨지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  await expectSomeHidden(page);
  const innerHeight = await page.evaluate(() => window.innerHeight);
  for (const block of await styleOf(page.locator(HIDDEN))) {
    expect(block.top).toBeGreaterThanOrEqual(innerHeight);
    expect(block.opacity).toBe("0");
    expect(block.translate).toBe("0px 24px");
  }
  const hero = heroOf(page);
  const preview = previewOf(page);
  await expect(hero.locator(REVEAL)).toHaveCount(0);
  await expect(preview.locator(REVEAL)).toHaveCount(0);
  // 히어로·미리보기는 자기 첫 등장 애니메이션만 있다. 스크롤하지 않아도 끝까지 보여야 한다.
  await expect.poll(() => visibleOpacity(hero.getByRole("heading", { level: 1 }))).toBe(1);
  await expect.poll(() => visibleOpacity(preview.getByRole("figure"))).toBe(1);
});

test("블록이 화면에 들어오면 떠올라 나타나고, 다시 맨 위로 올라가도 숨지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  const block = featuresHeadingOf(page);
  await expect(block).toHaveAttribute("data-reveal", "hidden");
  await expect(block).toHaveCSS("opacity", "0");

  await block.scrollIntoViewIfNeeded();
  await expect(block).toHaveAttribute("data-reveal", "shown");
  await expect(block).toHaveCSS("opacity", "1", SETTLE);
  await expect(block).toHaveCSS("translate", NO_TRANSLATE, SETTLE);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  // toBeInViewport 도 IntersectionObserver 로 잰다. 화면 밖이 확인됐으면 페이지의 관찰 신호도 이미 지나갔다.
  await expect(block).not.toBeInViewport();
  await expect(block).toHaveAttribute("data-reveal", "shown");
  await expect(block).toHaveCSS("opacity", "1");
});

test("화면 높이씩 끝까지 내려가면 숨은 블록이 하나도 남지 않는다", async ({ page }) => {
  await page.goto("/");
  await expectSomeHidden(page);
  const atBottom = () =>
    page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
    );
  // 사람처럼 화면 높이씩 내린다. 한 번에 바닥으로 뛰면 지나친 블록은 겹침을 잴 기회가 없다.
  while (!(await atBottom())) {
    await page.evaluate(() => window.scrollBy({ top: window.innerHeight, behavior: "instant" }));
    await nextFrames(page);
  }
  await expect(page.locator(HIDDEN)).toHaveCount(0);
  await expect
    .poll(async () =>
      (await styleOf(page.locator(REVEAL))).filter(({ opacity }) => opacity !== "1"),
    )
    .toEqual([]);
});

test("움직임 줄이기면 스크롤하지 않아도 숨거나 비켜 선 블록이 없다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // data-reveal 은 움직임 설정과 관계없이 붙는다. 숨김을 막는 것은 CSS(motion-safe) 하나다.
  await expectSomeHidden(page);
  for (const block of await styleOf(page.locator(REVEAL))) {
    expect(block.opacity).toBe("1");
    expect(block.translate).toMatch(NO_TRANSLATE);
  }
});

// 주소에 구역(#faq)을 붙여 열면 그 구역이 이미 화면 안이라, 그 자리의 블록은 숨기지 않는다(깜빡임 방지).
test("주소에 #faq 를 붙여 바로 열면 FAQ 제목이 숨지 않고 보이며 질문을 펼칠 수 있다", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/#faq");
  const faq = page.getByRole("region", { name: "자주 묻는 질문" });
  const heading = faq.getByRole("heading", { level: 2, name: "자주 묻는 질문" });
  await expect(heading).toBeInViewport();
  await expect.poll(() => visibleOpacity(heading), SETTLE).toBe(1);
  // 질문이 펼쳐지면 하이드레이션이 끝난 것이다. 그 전에 단언을 마치면 ref 콜백이 돌기 전에 통과할 수 있다.
  await openFirstQuestion(page);
  await expect(faq.locator(REVEAL)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: ERROR_TITLE })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 회귀: 숨기지 않은(화면 안에서 시작한) 블록은 정리 함수가 없어, 떼어질 때 ref 콜백이 null 로 다시 불린다.
// 그때 getBoundingClientRect 를 부르면 예외로 오류 화면이 떴다. #faq 로 열면 그런 블록만 생겨 이 길을 지난다.
test("#faq 로 바로 연 화면에서 머리말의 로그인으로 옮겨 가도 오류 화면이 뜨지 않는다", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const documents = watchDocuments(page);
  await page.goto("/#faq");
  await openFirstQuestion(page);
  documents.length = 0;

  await goToLogin(page);
  expect(documents).toEqual([]);
  expect(errors).toEqual([]);
});

test("머리말의 로그인으로 옮겨 갔다가 뒤로 가면 오류 화면 없이 첫 화면이 보이고 블록도 나타난다", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const documents = watchDocuments(page);
  await page.goto("/");
  // 하이드레이션 전에 누르면 링크가 문서를 새로 받아 클라이언트 이동을 시험하지 못한다.
  await expectSomeHidden(page);
  documents.length = 0;

  await goToLogin(page);
  expect(documents).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(heroOf(page).getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: ERROR_TITLE })).toHaveCount(0);
  // 돌아온 화면에서도 효과가 살아 있어야 한다. 숨은 채 관찰이 끊기면 내용이 영영 보이지 않는다.
  const block = featuresHeadingOf(page);
  await block.scrollIntoViewIfNeeded();
  await expect(block).toHaveAttribute("data-reveal", "shown");
  await expect(block).toHaveCSS("opacity", "1", SETTLE);
  expect(errors).toEqual([]);
});
