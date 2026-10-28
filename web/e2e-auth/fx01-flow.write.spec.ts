import { expect, type Locator, type Page, test } from "@playwright/test";
import { z } from "zod";
import { uniqueTag } from "./support/seed";
import { readWorkContext, storageOf } from "./support/work-fixtures";

// 19 S2·S3·S4·S7 · 11 §5 · fixtures/goldens/FX-01.json 을 한 브라우저 흐름으로 잇는다.
// 데이터는 C6 하네스(playwright.work.config.ts 의 globalSetup = support/work-setup.ts)가 만든 데모 상태다:
// demo:reset 의 .invalid 계정, mock 모드, FX-01 사전 분석(COMPLETED · 94 · BID). 로그인 상태는 storageOf(역할)로 받는다.
// 점수를 심거나 요청을 가로채지 않는다. 화면 배치·글자·스크린샷·axe 는 work-screens.spec.ts 가 본다.
// S4 가 FX-01 에 WATCH 결정을 쓰므로 *.write.spec.ts 다(읽기 spec 이 모두 끝난 뒤 한 작업자로 돈다).
const FX01_TITLE = "세종특별자치시 차세대 행정정보시스템 고도화 (가상)";
const FACTORS = [
  { name: "기술 스택 적합", points: 24, max: 30 },
  { name: "유사 수행 실적", points: 25, max: 25 },
  { name: "인력 가용성", points: 20, max: 20 },
  { name: "규모 적합성", points: 15, max: 15 },
  { name: "전략적 선호", points: 10, max: 10 },
] as const;
const KEV = [
  { name: "추천", probability: 0.71, percent: 71 },
  { name: "보류", probability: 0.24, percent: 24 },
  { name: "비추천", probability: 0.05, percent: 5 },
] as const;

// GET·POST /api/v1/bids/{id}/reviews 응답의 일부(server/bids/review.model.ts reviewSchema).
const reviewSchema = z.object({
  id: z.uuid(),
  bidId: z.uuid(),
  decision: z.enum(["BID", "WATCH", "NO_BID"]),
  reason: z.string(),
  systemRecommendationAtDecision: z.enum(["BID", "WATCH", "NO_BID"]).nullable(),
  disagreementFlag: z.boolean(),
});

const decisionRail = (page: Page) =>
  page.getByRole("complementary", { name: "참여 판단", exact: true });

// 표 머리 글자로 행의 칸 하나를 집는다. 10열 목록 표는 "권고"와 "최종 결정" 두 칸에 같은 글자(추천)가 올 수 있어
// (seed 가 FX-01 에 BID 결정을 미리 넣는다, scripts/demo/plan.mjs DEMO_REVIEWS) 칸 이름만으로는 하나로 좁혀지지 않는다.
async function cellOf(table: Locator, row: Locator, header: string): Promise<Locator> {
  const heads = await table.getByRole("columnheader").allInnerTexts();
  const index = heads.indexOf(header);
  if (index < 0) throw new Error(`표에 "${header}" 열이 없다: ${heads.join(" | ")}`);
  return row.getByRole("cell").nth(index);
}

test.use({ storageState: storageOf("sales"), viewport: { width: 1440, height: 900 } });

test("FX-01: 현재 대시보드부터 94점 근거 확인, 보류 결정과 이력 보존까지", async ({ page }) => {
  const { bids } = readWorkContext();
  const bidId = bids["FX-01"];

  await test.step("S2: 현재 공공조달 대시보드와 우선 검토 목록이 보인다", async () => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "대시보드", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "우선 검토할 입찰", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "수집 소스 상태", exact: true })).toBeVisible();
    const summary = page.getByRole("region", { name: "공공조달 요약" });
    for (const label of [
      "신규 발견",
      "분석 대기",
      "추천 권고",
      "마감 임박 (7일)",
      "진행 중 입찰 프로젝트",
    ])
      await expect(summary.getByText(label, { exact: true })).toBeVisible();
    // 현재 우선 검토는 최근순 5건이다. FX-01의 94점·BID는 아래 전체 목록에서 확인한다.
  });

  await test.step("S3: 공고 목록에서 FX-01 상세를 연다", async () => {
    await page
      .getByRole("navigation", { name: "주요 메뉴", exact: true })
      .getByRole("link", { name: "입찰 공고", exact: true })
      .click();
    await expect(page).toHaveURL("/bids");
    await expect(
      page.getByRole("heading", { level: 1, name: "입찰 공고", exact: true }),
    ).toBeVisible();
    const table = page.getByRole("table", { name: /입찰 공고 사업기회 목록/ });
    const row = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: FX01_TITLE, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(await cellOf(table, row, "SOL Score")).toHaveText("94");
    await expect(await cellOf(table, row, "권고")).toHaveText("추천");
    // seed 의 사전 결정(19 §3: FX-01 BID). S4 가 WATCH 를 기록하면 마지막 결정이 바뀐다.
    await expect(await cellOf(table, row, "최종 결정")).toHaveText("추천");
    await row.getByRole("link", { name: FX01_TITLE, exact: true }).click();
    // 목록 행 링크는 /bids/<id> 이고, 목록 조건이 있으면 ?list=<조건>이 붙는다(components/bids/bid-table.tsx detailHref).
    await expect(page).toHaveURL(new RegExp(`/bids/${bidId}(\\?list=[^#]*)?$`));
    await expect(
      page.getByRole("heading", { level: 1, name: FX01_TITLE, exact: true }),
    ).toBeVisible();
  });

  await test.step("자격 3건 충족·점수 분해 5행·Kev mock 분포를 확인한다", async () => {
    // ② 분석 요약 띠: mock 으로 돌린 분석이고 가상 회사 프로필 배지가 있다. 분석된 공고의 머리 버튼은 [재분석]이다(19 S3).
    // 재분석은 누르지 않는다 — 데모 데이터를 바꾼다.
    const band = page.getByRole("region", { name: "분석 요약", exact: true });
    await expect(band.getByText("AI: mock", { exact: true })).toBeVisible();
    await expect(band.getByText("가상 회사 프로필로 분석", { exact: true })).toBeVisible();
    const reanalyze = page.getByRole("button", { name: "재분석", exact: true });
    await expect(reanalyze).toBeVisible();
    await expect(reanalyze).toBeEnabled();

    const qualification = page.getByRole("region", { name: /^필수자격/ });
    await expect(qualification.getByRole("heading", { level: 2 })).toContainText("3건 · 모두 충족");
    await expect(qualification.getByRole("listitem")).toHaveCount(3);
    await expect(qualification.getByText("충족", { exact: true })).toHaveCount(3);

    const rail = decisionRail(page);
    await expect(rail).toContainText(/권고\s*추천/);
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "94",
    );

    const factors = page.getByRole("region", { name: "SOL Score 분해", exact: true });
    await expect(factors.getByRole("listitem")).toHaveCount(5);
    for (const factor of FACTORS) {
      const meter = factors.getByRole("meter", { name: factor.name, exact: true });
      await expect(meter).toHaveAttribute("aria-valuenow", String(factor.points));
      await expect(meter).toHaveAttribute("aria-valuemax", String(factor.max));
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        `${factor.points.toFixed(1)}점 / ${factor.max}점`,
      );
      await expect(
        factors.getByText(`${factor.points.toFixed(1)} / ${factor.max}`, { exact: true }),
      ).toBeVisible();
    }

    const kev = page.getByRole("region", { name: "결정 모델 참고 지표", exact: true });
    for (const option of KEV) {
      const meter = kev.getByRole("meter", { name: `${option.name} 선택지`, exact: true });
      await expect(meter).toHaveAttribute("aria-valuenow", String(option.probability));
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        `${option.name} 선택지 ${option.percent}%`,
      );
      await expect(kev.getByText(`${option.percent}%`, { exact: true })).toBeVisible();
    }
    await expect(kev.getByText("규칙 권고와 같음", { exact: true })).toBeVisible();
  });

  await test.step("검증된 자격 근거 서랍을 열고 닫는다", async () => {
    // 자격 행의 근거 버튼 이름은 `근거 {위치} · "{인용 앞부분}"` 이다(components/bids/qualification-checklist.tsx evidenceText).
    const opener = page
      .getByRole("region", { name: /^필수자격/ })
      .getByRole("button", { name: /^근거 \S.* · ".+"$/ })
      .first();
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "근거", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("blockquote").first()).toContainText("소프트웨어사업자");
    await expect(
      drawer.getByText(/^원문 대조: (정확히 일치|정규화 후 일치|유사 일치)$/).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  await test.step("S4: 보류를 기록하면 결정 이력이 정확히 한 건 늘고 새로 고침 뒤에도 남는다", async () => {
    const endpoint = `/api/v1/bids/${bidId}/reviews`;
    const beforeResponse = await page.request.get(endpoint);
    expect(beforeResponse.status()).toBe(200);
    const before = z.array(reviewSchema).parse(await beforeResponse.json());

    const rail = decisionRail(page);
    const reason = `FX-01 E2E ${uniqueTag()}: 참여 전 계약 조건을 확인하기 위해 보류로 기록합니다.`;
    await rail.getByRole("radio", { name: "보류", exact: true }).check();
    await rail.getByRole("textbox", { name: "사유", exact: true }).fill(reason);
    const savedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === "POST",
    );
    await rail.getByRole("button", { name: "결정 기록", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(201);
    // 화면(submit-review.ts)은 201 본문을 읽지 않는다. 페이지가 소비하지 않은 fetch 본문은 response.json() 이
    // 끝까지 기다리지 못할 수 있어(실측 30초 timeout), 요청 본문은 여기서 보고 저장된 값은 아래 GET 목록으로 확인한다.
    expect(saved.request().postDataJSON()).toMatchObject({ decision: "WATCH", reason });
    await expect(page.getByText("결정을 기록했습니다", { exact: true })).toBeVisible();

    const afterResponse = await page.request.get(endpoint);
    expect(afterResponse.status()).toBe(200);
    const after = z.array(reviewSchema).parse(await afterResponse.json());
    expect(after).toHaveLength(before.length + 1);
    expect(after.map(({ id }) => id)).toEqual(expect.arrayContaining(before.map(({ id }) => id)));
    const added = after.filter(({ id }) => !before.some((prev) => prev.id === id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      bidId,
      decision: "WATCH",
      reason,
      systemRecommendationAtDecision: "BID",
      disagreementFlag: true,
    });

    await expect(rail.getByRole("heading", { name: "결정 이력", exact: true })).toBeVisible();
    await expect(rail.getByText(reason, { exact: true })).toBeVisible();
    await expect(rail).toContainText("마지막 결정: 보류 · 이영업");
    // 사람 결정이 바뀌어도 규칙 점수는 그대로다.
    await page.reload();
    await expect(rail.getByText(reason, { exact: true })).toBeVisible();
    await expect(rail).toContainText("마지막 결정: 보류 · 이영업");
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "94",
    );
  });
});

// G5·S7: 같은 자격 API 가 org-01 SALES 에게는 200(3건 SATISFIED)이고 org-02 VIEWER 에게는 404 봉투다.
// 대조군(200)이 같은 시험에 있어야 아래 404 가 "없는 경로의 일반 404"가 아니라 조직 격리라는 뜻이 된다.
// 404 봉투·상세 200 의 단언은 bid-isolation.spec.ts 와 같은 것만 적고, 여기에만 X-Request-Id 대조를 둔다.
test("S7: org-01 자격 3건은 조회되지만 다른 조직 VIEWER 에게는 404 다", async ({
  page,
  playwright,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL 이 필요합니다.");
  const { bids } = readWorkContext();
  const path = `/api/v1/bids/${bids["FX-01"]}/qualification-checks`;

  const own = await page.request.get(path);
  expect(own.status()).toBe(200);
  const checks = z
    .array(z.object({ outcome: z.literal("SATISFIED"), mandatory: z.literal(true) }))
    .length(3)
    .parse(await own.json());
  expect(checks).toHaveLength(3);

  // 다른 조직 VIEWER 의 세션 쿠키만 쓰는 API 컨텍스트. 페이지는 필요 없다.
  const outsider = await playwright.request.newContext({
    baseURL,
    storageState: storageOf("outsider"),
  });
  try {
    const hidden = await outsider.get(path);
    expect(hidden.status()).toBe(404);
    expect(hidden.headers()["content-type"]).toContain("application/json");
    const envelope = z
      .object({
        error: z.object({
          code: z.literal("NOT_FOUND"),
          details: z.object({ resource: z.literal("analysis") }),
          requestId: z.uuid(),
        }),
      })
      .parse(await hidden.json());
    expect(hidden.headers()["x-request-id"]).toBe(envelope.error.requestId);

    const detail = await outsider.get(`/api/v1/bids/${bids["FX-01"]}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: bids["FX-01"],
      latestAnalysis: null,
      latestReview: null,
      reviews: [],
    });
  } finally {
    await outsider.dispose();
  }
});
