import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { readLocalStatus } from "./support/local-status";
import { uniqueTag } from "./support/seed";

// 19 S2/S3/S4/S7 · 11 §5 · fixtures/goldens/FX-01.json.
// Prerequisites: demo:reset's .invalid accounts, mock mode, and real persisted
// pre-analysis of FX-01. db-seed's seed-* accounts are a separate fixture.
// This test never seeds scores, intercepts requests, or supplies fake app data.
const FX01_TITLE = "세종특별자치시 차세대 행정정보시스템 고도화 (가상)";
const SALES = "sales@soltech.invalid";
const OUTSIDER = "viewer@other.invalid";
const FACTORS = [
  { name: "기술 스택 적합", points: 24, max: 30 },
  { name: "유사 수행 실적", points: 25, max: 25 },
  { name: "인력 가용성", points: 20, max: 20 },
  { name: "규모 적합성", points: 15, max: 15 },
  { name: "전략적 선호", points: 10, max: 10 },
] as const;
const KEV = [
  { name: "BID", probability: 0.71, percent: 71 },
  { name: "WATCH", probability: 0.24, percent: 24 },
  { name: "NO-BID", probability: 0.05, percent: 5 },
] as const;

const reviewSchema = z.object({
  id: z.uuid(),
  bidId: z.uuid(),
  decision: z.enum(["BID", "WATCH", "NO_BID"]),
  reason: z.string(),
  systemRecommendationAtDecision: z.enum(["BID", "WATCH", "NO_BID"]).nullable(),
  disagreementFlag: z.boolean(),
});

function demoPassword(): string {
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("demo:reset에 사용한 DEMO_SEED_PASSWORD가 필요합니다.");
  }
  return password;
}

async function login(page: Page): Promise<void> {
  await page.goto("/auth/login?next=%2Fdashboard");
  await page.getByLabel("이메일").fill(SALES);
  await page.getByLabel("비밀번호", { exact: true }).fill(demoPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL("/dashboard");
}

// Node fetch keeps the Auth password/token out of Playwright request attachments.
// Only the local anon key and this user's token are used; no service-role access.
async function demoToken(email: string): Promise<string> {
  const status = readLocalStatus();
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("로컬 Supabase anon 키가 필요합니다.");
  const response = await fetch(`${status.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: demoPassword() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`데모 계정 로그인 실패: HTTP ${response.status}`);
  return z.object({ access_token: z.string().min(1) }).parse(await response.json()).access_token;
}

async function authenticatedGet(baseURL: string, path: string, token: string): Promise<Response> {
  return fetch(new URL(path, baseURL), {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });

test("FX-01: 로그인부터 94점·근거 확인, WATCH 결정과 이력 보존까지", async ({ page }) => {
  await test.step("S2: 대시보드 BID 권고에 FX-01 94점이 보인다", async () => {
    await login(page);
    await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
    const row = page
      .getByRole("table", { name: "BID 권고" })
      .getByRole("row")
      .filter({
        has: page.getByRole("link", { name: FX01_TITLE, exact: true }),
      });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell", { name: "94", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: "BID", exact: true })).toBeVisible();
  });

  await test.step("S3: 공고 목록에서 FX-01 상세를 연다", async () => {
    await page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", {
        name: "입찰 공고",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL("/bids");
    await expect(page.getByRole("heading", { level: 1, name: "입찰 공고" })).toBeVisible();
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { name: FX01_TITLE, exact: true }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell", { name: "94", exact: true })).toBeVisible();
    await row.getByRole("link", { name: FX01_TITLE, exact: true }).click();
    await expect(page).toHaveURL(/\/bids\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: FX01_TITLE })).toBeVisible();
  });

  await test.step("자격 3건·점수 분해·Kev mock 분포를 확인한다", async () => {
    const qualification = page.getByRole("region", { name: /^필수자격/ });
    await expect(qualification.getByRole("listitem")).toHaveCount(3);
    await expect(qualification.getByText("충족", { exact: true })).toHaveCount(3);
    await expect(page.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
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
        factors.getByText(`${factor.points.toFixed(1)} / ${factor.max}`, {
          exact: true,
        }),
      ).toBeVisible();
    }
    const kev = page.getByRole("region", { name: "Kev 참고 지표", exact: true });
    for (const option of KEV) {
      const meter = kev.getByRole("meter", { name: `${option.name} 선택지`, exact: true });
      await expect(meter).toHaveAttribute("aria-valuenow", String(option.probability));
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        `${option.name} 선택지 ${option.percent}%`,
      );
      await expect(kev.getByText(`${option.percent}%`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("AI: mock", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("가상 회사 프로필로 분석", { exact: true })).toBeVisible();
  });

  await test.step("검증된 자격 근거 서랍을 열고 닫는다", async () => {
    const opener = page
      .getByRole("region", { name: /^필수자격/ })
      .getByRole("button", {
        name: /^근거(?: p\.| API|$)/,
      })
      .first();
    await opener.click();
    const drawer = page.getByRole("dialog", { name: /^근거/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("blockquote").first()).toContainText("소프트웨어사업자");
    await expect(
      drawer.getByText(/^원문 대조: (정확히 일치|정규화 후 일치|유사 일치)$/).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(opener).toBeFocused();
  });

  await test.step("S4: WATCH를 기록하고 결정 이력이 정확히 한 건 늘어난다", async () => {
    const bidId = z.uuid().parse(new URL(page.url()).pathname.split("/").at(-1));
    const endpoint = `/api/v1/bids/${bidId}/reviews`;
    const beforeResponse = await page.request.get(endpoint);
    expect(beforeResponse.status()).toBe(200);
    const before = z.array(reviewSchema).parse(await beforeResponse.json());
    const panel = page.getByRole("complementary", { name: "참여 판단" });
    const reason = `FX-01 E2E ${uniqueTag()}: 참여 전 계약 조건을 확인하기 위해 WATCH로 기록합니다.`;
    await panel.getByRole("radio", { name: "WATCH", exact: true }).check();
    await panel.getByRole("textbox", { name: /사유/ }).fill(reason);
    const savedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint && response.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "결정 기록", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(201);
    const review = reviewSchema.parse(await saved.json());
    expect(review).toMatchObject({
      bidId,
      decision: "WATCH",
      reason,
      systemRecommendationAtDecision: "BID",
      disagreementFlag: true,
    });
    const afterResponse = await page.request.get(endpoint);
    expect(afterResponse.status()).toBe(200);
    const after = z.array(reviewSchema).parse(await afterResponse.json());
    expect(after).toHaveLength(before.length + 1);
    expect(after.map(({ id }) => id)).toEqual(expect.arrayContaining(before.map(({ id }) => id)));
    expect(after.filter(({ id }) => id === review.id)).toEqual([review]);
    await expect(panel.getByRole("heading", { name: "결정 이력", exact: true })).toBeVisible();
    await expect(panel.getByText(reason, { exact: true })).toBeVisible();
    await expect(panel.getByText(/마지막 결정:\s*WATCH/)).toBeVisible();
    await page.reload();
    await expect(panel.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "94",
    );
  });
});

test("S7: org-01 자격 3건은 조회되지만 다른 조직 viewer에게는 404다", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL이 필요합니다.");
  const salesToken = await demoToken(SALES);
  const listResponse = await authenticatedGet(
    baseURL,
    `/api/v1/bids?origin=demo&q=${encodeURIComponent(FX01_TITLE)}`,
    salesToken,
  );
  expect(listResponse.status).toBe(200);
  const list = z
    .object({ items: z.array(z.object({ id: z.uuid(), title: z.string() })) })
    .parse(await listResponse.json());
  const [bid] = z
    .array(z.object({ id: z.uuid(), title: z.literal(FX01_TITLE) }))
    .length(1)
    .parse(list.items.filter(({ title }) => title === FX01_TITLE));
  const path = `/api/v1/bids/${bid.id}/qualification-checks`;
  // Positive control: a missing route's generic404 must never pass isolation.
  const ownResponse = await authenticatedGet(baseURL, path, salesToken);
  expect(ownResponse.status).toBe(200);
  const checks = z
    .array(z.object({ outcome: z.literal("SATISFIED"), mandatory: z.literal(true) }))
    .length(3)
    .parse(await ownResponse.json());
  expect(checks).toHaveLength(3);

  const outsiderToken = await demoToken(OUTSIDER);
  const hidden = await authenticatedGet(baseURL, path, outsiderToken);
  expect(hidden.status).toBe(404);
  expect(hidden.headers.get("content-type")).toContain("application/json");
  const error = z
    .object({ error: z.object({ code: z.literal("NOT_FOUND"), requestId: z.uuid() }) })
    .parse(await hidden.json());
  expect(hidden.headers.get("x-request-id")).toBe(error.error.requestId);
  const publicBid = await authenticatedGet(baseURL, `/api/v1/bids/${bid.id}`, outsiderToken);
  expect(publicBid.status).toBe(200);
  expect(await publicBid.json()).toMatchObject({ id: bid.id, latestAnalysis: null, reviews: [] });
});
