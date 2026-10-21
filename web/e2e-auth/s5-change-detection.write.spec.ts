import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  INGESTION_PATH,
  ROLE_EMAIL,
  RUNS_ENDPOINT,
  historyTable,
  startButtonName,
} from "./support/ingestion-fixtures";
import { localAdmin, readWorkContext, storageOf, widthOf } from "./support/work-fixtures";

// S5 공고 변경 감지와 멱등(19 S5 1~3단계) — /admin/ingestion 배치 LIVE 수동 수집 → 공고 변경 이력 화면.
// 기준: 화면 스펙 docs/plans/2026-10-21-s5-revisions-ui-spec.md §4.6(상세 진입 링크)·§4.7(FX-07 첫 화면)·§5.2(상태)·§7(문구)·§10(자리·증거 이름),
//       05 §2 GET /bids/:id/revisions·/:rev, 07 §6.2 LIVE 배치(변경 FX-06·07·10, 취소 FX-08, 중복 FX-09).
// 설정: playwright.s5.config.ts. globalSetup(support/work-setup.ts)이 격리 DB 를 demo:reset → demo:preanalyze 기준선으로 만든다.
// 이 기준선에서 공고마다 revision 은 1개다(SEED). 수동 수집은 Compose worker 가 소비해 실제 ingest_runs·bid_revisions 를 쓴다.
// 요청을 가로채거나 데이터를 심지 않는다. FX-07 의 id 만 로컬 service role 로 공고번호에서 찾는다(work-setup 맥락에 FX-07 이 없다).
//
// 순서: s5-ingest 프로젝트(@ingest)가 수집·API·멱등을 먼저 돌고, 그 뒤 s5-1440·s5-1280 이 같은 데이터로 화면을 본다.

const FX07_NOTICE_ID = "DEMO-2026-0007";
const FX07_TITLE = "한국도로공사 교통정보 데이터플랫폼 고도화 (가상)";

// 고정 문구(계획 Global Constraints·스펙 §7).
const TITLE = "변경 이력";
const SINGLE_TITLE = "처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다.";
const FIRST_TITLE = "처음 수집한 revision 입니다";
const CANCELLED_BANNER = "이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다";
const LEGEND = "밑줄은 추가, 취소선은 삭제, 표시 없음은 유지입니다.";
const NOT_FOUND_TITLE = "변경 이력을 찾을 수 없습니다";
const NOT_FOUND_DESCRIPTION = "공고 주소나 revision 번호가 맞는지 확인하세요.";
const KST_MINUTE = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2} KST`;

// 19 S5 2단계: 기준선 위 첫 LIVE 수집. 두 번째부터는 다섯 건 모두 중복이다(idempotent-upsert.test.ts "다섯 건 모두 skippedDuplicate").
const FIRST_LIVE_SUMMARY = {
  created: 0,
  changed: 3,
  cancelled: 1,
  skippedDuplicate: 1,
  quarantined: 0,
  retried: 0,
};
const REPEAT_LIVE_SUMMARY = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 5,
  quarantined: 0,
  retried: 0,
};

// 실행 이력 표의 열(N8 스펙 §4.5 순서). admin-ingestion.spec.ts 와 같다.
const COLUMNS = [
  "시작",
  "상태",
  "소스·방식",
  "신규",
  "변경",
  "취소",
  "중복",
  "격리",
  "재시도",
] as const;
const COUNT_COLUMNS = [
  ["신규", "created"],
  ["변경", "changed"],
  ["취소", "cancelled"],
  ["중복", "skippedDuplicate"],
  ["격리", "quarantined"],
  ["재시도", "retried"],
] as const satisfies readonly (readonly [
  (typeof COLUMNS)[number],
  keyof typeof FIRST_LIVE_SUMMARY,
])[];

const summarySchema = z.strictObject({
  created: z.number().int(),
  changed: z.number().int(),
  cancelled: z.number().int(),
  skippedDuplicate: z.number().int(),
  quarantined: z.number().int(),
  retried: z.number().int(),
});
const runSchema = z.looseObject({
  id: z.uuid(),
  source: z.string(),
  batch: z.string().nullable(),
  trigger: z.string(),
  status: z.string(),
  summary: summarySchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
type IngestRun = z.infer<typeof runSchema>;

// GET /api/v1/bids/:id/revisions 한 줄(server/bids/bid.model.ts bidRevisionSummarySchema 와 같은 모양).
const revisionSummarySchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  amendmentNo: z.string().nullable(),
  fetchedAt: z.string(),
  checksum: z.string().min(1),
  changedFields: z.array(z.string()),
});
const revisionListSchema = z.array(revisionSummarySchema);
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown(),
    requestId: z.string(),
  }),
});

// ── 데이터 ──

// FX-07 은 work-setup 의 맥락(BID_FIXTURES)에 없다. 로컬 service role 로 데모 공고번호에서 id 하나를 찾는다(값은 찍지 않는다).
async function fx07Id(): Promise<string> {
  const rows = z
    .array(z.object({ id: z.uuid() }))
    .parse(
      await localAdmin().call(
        "GET",
        `/rest/v1/bid_notices?select=id&is_demo=eq.true&notice_id=eq.${FX07_NOTICE_ID}`,
      ),
    );
  expect(rows, `${FX07_NOTICE_ID} 데모 공고는 한 건이다`).toHaveLength(1);
  return rows[0].id;
}

async function readRevisions(page: Page, bidId: string) {
  const response = await page.request.get(`/api/v1/bids/${bidId}/revisions`);
  expect(response.status(), "GET revisions").toBe(200);
  return revisionListSchema.parse(await response.json());
}

// ── 로그인 ──

// 업무 역할 ADMIN(admin@soltech.invalid)만 수동 수집을 보낸다(N8). work-setup 은 이 계정의 로그인 상태를 저장하지 않아
// 같은 방식(로컬 service role 의 magiclink 토큰 → 앱의 /auth/confirm)으로 이 시험의 빈 브라우저에 세션을 만든다. 비밀번호를 쓰지 않는다.
async function signInAsAdmin(page: Page) {
  const link = z.object({ hashed_token: z.string().min(1) }).parse(
    await localAdmin().call("POST", "/auth/v1/admin/generate_link", {
      type: "magiclink",
      email: ROLE_EMAIL.admin,
    }),
  );
  await page.goto(
    `/auth/confirm?type=email&next=%2Fdashboard&token_hash=${encodeURIComponent(link.hashed_token)}`,
  );
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "대시보드", exact: true }),
  ).toBeVisible();
}

// ── 수동 수집 ──

const runButton = (page: Page) => page.getByRole("button", { name: "수동 수집 실행", exact: true });
const dataRows = (page: Page) =>
  historyTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
const cellOf = (row: Locator, column: (typeof COLUMNS)[number]) =>
  row.getByRole("cell").nth(COLUMNS.indexOf(column));

async function readRun(page: Page, id: string): Promise<{ status: number; run: IngestRun | null }> {
  const response = await page.request.get(`${RUNS_ENDPOINT}/${id}`);
  return {
    status: response.status(),
    run: response.status() === 200 ? runSchema.parse(await response.json()) : null,
  };
}

/** /admin/ingestion 에서 데모 데이터 · 배치 LIVE 를 보내고, worker 가 그 run 을 끝낼 때까지 같은 세션의 API 로 기다린다. */
async function runLiveBatch(page: Page): Promise<IngestRun> {
  await page.goto(INGESTION_PATH);
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  const dialog = page.getByRole("dialog", { name: "수동 수집 실행", exact: true });
  await expect(dialog).toBeVisible();
  // 실행 모드 mock 은 데모 데이터만 받는다(acceptsSource). 배치는 기본 선택이 없다(N8 D7).
  await expect(dialog.getByRole("radio", { name: /^데모 데이터 \(fixture\)/ })).toBeChecked();
  const live = dialog.getByRole("radio", { name: /^LIVE · 변경분 투입/ });
  await live.click();
  await expect(live).toBeChecked();

  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === RUNS_ENDPOINT,
  );
  await dialog.getByRole("button", { name: "수집 실행", exact: true }).click();
  const response = await posted;
  expect(response.status(), "POST runs").toBe(202);
  expect(response.request().postDataJSON()).toEqual({ source: "fixture", batch: "live" });
  const accepted = runSchema.parse(await response.json());
  expect(accepted).toMatchObject({
    source: "fixture",
    batch: "live",
    trigger: "MANUAL",
    status: "RUNNING",
  });
  await expect(dialog).toBeHidden();

  // worker 가 행을 만들기 전에는 404, 처리 중에는 RUNNING 이다. 끝난 상태(SUCCEEDED·PARTIAL·FAILED)가 될 때까지 본다.
  await expect
    .poll(
      async () => {
        const { status, run } = await readRun(page, accepted.id);
        return run === null ? `HTTP ${status}` : run.status;
      },
      { message: "worker 가 LIVE 수집 run 을 끝낸다", timeout: 120_000, intervals: [1_000, 2_000] },
    )
    .toMatch(/^(SUCCEEDED|PARTIAL|FAILED)$/);
  const { run } = await readRun(page, accepted.id);
  if (run === null) throw new Error("끝난 수집 run 을 다시 읽지 못했다");
  return run;
}

/** 실행 이력 표에서 그 run 의 행이 끝난 숫자를 보인다(화면 폴링이 저장된 run 을 다시 읽는다). */
async function expectRunRow(page: Page, run: IngestRun, summary: typeof FIRST_LIVE_SUMMARY) {
  await expect(historyTable(page).getByRole("columnheader")).toHaveText([...COLUMNS]);
  const row = dataRows(page).filter({
    has: page.getByRole("button", { name: startButtonName(run.startedAt, run.id), exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(cellOf(row, "소스·방식")).toContainText("데모 데이터 · 배치 LIVE");
  for (const [column, key] of COUNT_COLUMNS)
    await expect(cellOf(row, column), column).toHaveText(summary[key].toLocaleString("ko-KR"), {
      timeout: 30_000,
    });
}

// ── 화면 ──

const changesSection = (page: Page) => page.locator('[data-slot="revision-changes"]');
const changeRow = (page: Page, field: string) =>
  page.locator(`[data-slot="revision-change-row"][data-field="${field}"]`);
const contentDiff = (page: Page) => page.locator('[data-slot="revision-content-diff"]');
const revisionRail = (page: Page) =>
  page.getByRole("navigation", { name: "revision 목록", exact: true });
const stageTimeline = (page: Page) => page.getByRole("list", { name: "단계 이력", exact: true });
const descriptionLine = (page: Page, pattern: string) =>
  page.getByRole("main").getByText(new RegExp(`^${pattern}$`));

/** 스트리밍이 끝난 변경 이력 화면(레일이 그려진 뒤)을 기다린다. loading.tsx 뼈대도 같은 h1 을 그려서 레일을 먼저 본다. */
async function expectRevisionsLoaded(page: Page) {
  await expect(revisionRail(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: TITLE, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(TITLE);
}

async function openRevisions(page: Page, url: string) {
  await page.goto(url);
  await expectRevisionsLoaded(page);
}

/** 레일의 revision 링크: 받은 순서(최신 먼저), 주소 ?rev=N, 고른 하나만 aria-current="page". */
async function expectRail(page: Page, bidId: string, revisions: number[], selected: number) {
  const items = revisionRail(page).getByRole("link");
  await expect(items).toHaveCount(revisions.length);
  for (const [index, revision] of revisions.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAttribute("data-slot", "revision-item");
    await expect(item).toHaveAttribute("data-revision", String(revision));
    await expect(item).toHaveAttribute("href", `/bids/${bidId}/revisions?rev=${revision}`);
    if (revision === selected) await expect(item).toHaveAttribute("aria-current", "page");
    else await expect(item).not.toHaveAttribute("aria-current");
  }
  await expect(revisionRail(page).locator('[aria-current="page"]')).toHaveCount(1);
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = widthOf(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `가로 넘침(scrollWidth ≤ ${width})`).toBeLessThanOrEqual(width);
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

// ── 증거 ──

const seoulDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .replaceAll("-", "");

/**
 * 스펙 §10 증거 이름 YYYYMMDD-s5-<route>-<state>-<width>.png. Playwright outputDir 의 evidence/ 에 찍고,
 * 실행 뒤 docs/evidence/s5/ 로 옮긴다. 화면 크기(1440×900·1280×800) 그대로 찍는다.
 */
async function evidenceShot(page: Page, routeAndState: string) {
  const width = widthOf(page);
  // 상단바 AI 지표는 마운트 뒤 /health/ready 를 읽어 채운다. 첫 값("확인 중")이 증거에 찍히지 않게 기다린다.
  await expect(page.locator('[data-slot="topbar-status"] [data-indicator="ai"]')).not.toHaveText(
    /확인 중/,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const dir = path.join(test.info().project.outputDir, "evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${seoulDate()}-s5-${routeAndState}-${width}.png`),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

async function expectNotFound(response: APIResponse, resource: "bid" | "revision") {
  expect(response.status()).toBe(404);
  const { error } = errorSchema.parse(await response.json());
  expect(error.code).toBe("NOT_FOUND");
  expect(error.details).toEqual({ resource });
  expect(response.headers()["x-request-id"]).toBe(error.requestId);
}

// ── s5-ingest: 데이터를 바꾸는 시험(1440 한 폭, 차례로) ──

test.describe("S5 수집·API·멱등 (ADMIN admin@soltech.invalid)", { tag: "@ingest" }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("S5 1·2단계: 배치 LIVE 수동 수집은 신규 0 · 변경 3 · 취소 1 · 중복 1 · 격리 0 으로 끝나고 표에 그 숫자가 보인다", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await fx07Id();
    // 기준선(demo:reset)에서는 FX-07 revision 이 1개다. 아래 변경 3 이 이 수집에서 났다는 전제다.
    expect((await readRevisions(page, id)).map((row) => row.revision)).toEqual([1]);

    const run = await runLiveBatch(page);
    expect(run).toMatchObject({
      source: "fixture",
      batch: "live",
      trigger: "MANUAL",
      status: "SUCCEEDED",
    });
    expect(run.summary).toEqual(FIRST_LIVE_SUMMARY);
    expect(run.finishedAt).not.toBeNull();

    // 화면: 접수 행이 저장된 run 으로 바뀌어 숫자가 채워지고, [수동 수집 실행]이 다시 눌린다.
    await expectRunRow(page, run, FIRST_LIVE_SUMMARY);
    await expect(runButton(page)).toBeEnabled({ timeout: 30_000 });

    // 저장된 효과: 새로 고친 뒤에도 같은 행·숫자다.
    await page.reload();
    await expectRunRow(page, run, FIRST_LIVE_SUMMARY);
  });

  test("S5 API: GET /bids/{FX-07}/revisions 는 200 · 2건 · 최신 먼저, /revisions/2 는 200 스냅샷, /revisions/0·9 는 404 NOT_FOUND 다", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await fx07Id();

    const list = await readRevisions(page, id);
    expect(list.map((row) => row.revision)).toEqual([2, 1]);
    expect(list.map((row) => row.amendmentNo)).toEqual(["02", "01"]);
    expect(Date.parse(list[0].fetchedAt)).toBeGreaterThanOrEqual(Date.parse(list[1].fetchedAt));
    expect(list[0].checksum).not.toBe(list[1].checksum);
    // 바뀐 항목은 저장된 changed_fields 다(J5). 차수는 저장값에 있고 화면 표에서만 뺀다.
    expect([...list[0].changedFields].sort()).toEqual(
      ["amendmentNo", "budgetKrw", "content", "status"].sort(),
    );

    const snapshot = await page.request.get(`/api/v1/bids/${id}/revisions/2`);
    expect(snapshot.status()).toBe(200);
    const body = z
      .looseObject({
        title: z.string(),
        amendmentNo: z.string().nullable(),
        budgetKrw: z.string().nullable(),
        content: z.string(),
      })
      .parse(await snapshot.json());
    expect(body.title).toBe(FX07_TITLE);
    expect(body.amendmentNo).toBe("02");
    expect(body.budgetKrw).toBe("2160000000");
    expect(body.content).toContain("Spark, Kubernetes 이다.");

    const first = z
      .looseObject({ budgetKrw: z.string().nullable(), content: z.string() })
      .parse(await (await page.request.get(`/api/v1/bids/${id}/revisions/1`)).json());
    expect(first.budgetKrw).toBe("1800000000");
    expect(first.content).not.toContain("Kubernetes");

    await expectNotFound(await page.request.get(`/api/v1/bids/${id}/revisions/0`), "revision");
    await expectNotFound(await page.request.get(`/api/v1/bids/${id}/revisions/9`), "revision");
  });

  test("S5 멱등: 같은 배치 LIVE 수집을 한 번 더 보내면 다섯 건 모두 중복이고 FX-07 revision 은 그대로 2건이다", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await fx07Id();
    const before = await readRevisions(page, id);
    expect(before.map((row) => row.revision)).toEqual([2, 1]);

    const run = await runLiveBatch(page);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.summary).toEqual(REPEAT_LIVE_SUMMARY);
    await expectRunRow(page, run, REPEAT_LIVE_SUMMARY);

    // 새 revision 이 없다: 목록(번호·checksum·수집 시각)이 수집 전과 같다.
    expect(await readRevisions(page, id)).toEqual(before);
  });
});

// ── s5-1440·s5-1280: 수집 뒤 화면(읽기만, 폭마다 한 번) ──

test.describe("S5 변경 이력 화면 (SALES sales@soltech.invalid)", () => {
  test.use({ storageState: storageOf("sales") });

  test("S5 3단계: FX-07 상세의 단계 이력 r2 링크로 변경 이력을 열면 예산 18억 → 21.6억과 본문의 Kubernetes 추가가 보인다", async ({
    page,
  }) => {
    const id = await fx07Id();
    const errors = watchConsole(page);

    // 진입점(스펙 §4.6): 지금 단계 칸의 r2 하나만 링크다. 이름은 "r2 변경 이력 보기"(보이는 글자가 앞).
    await page.goto(`/bids/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(FX07_TITLE);
    const timeline = stageTimeline(page);
    const link = timeline.getByRole("link", { name: "r2 변경 이력 보기", exact: true });
    await expect(link).toHaveAttribute("href", `/bids/${id}/revisions`);
    await expect(timeline.getByRole("link")).toHaveCount(1);
    await expect(timeline.locator('[aria-current="step"]')).toContainText("r2");
    await link.scrollIntoViewIfNeeded();
    await evidenceShot(page, "bid-detail-revision-link");

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/bids/${id}/revisions$`));
    await expectRevisionsLoaded(page);

    // 머리말(§4.2): 공고명, h1, r1 → r2 · 차수 01 → 02 · 수집 … KST (화살표 낭독은 " 에서 ").
    await expect(page.locator('[data-slot="revision-bid-title"]')).toHaveText(FX07_TITLE);
    await expect(page.getByRole("link", { name: "공고 상세", exact: true })).toHaveAttribute(
      "href",
      `/bids/${id}`,
    );
    await expect(
      descriptionLine(
        page,
        String.raw`r1\s*→\s*에서\s*r2\s*·\s*차수 01\s*→\s*에서\s*02\s*·\s*수집 ${KST_MINUTE}`,
      ),
    ).toBeVisible();

    // 바뀐 항목 구역(§4.3): 개수(amendmentNo 제외 3개), 범례, 표 열 머리.
    const section = changesSection(page);
    await expect(
      section.getByRole("heading", { level: 2, name: "바뀐 항목", exact: true }),
    ).toBeVisible();
    await expect(section.getByText("3개", { exact: true })).toBeVisible();
    await expect(section.getByText(LEGEND, { exact: true })).toBeVisible();
    await expect(section.getByRole("columnheader")).toHaveText(["항목", "이전 r1", "이후 r2"]);
    await expect(section.locator('[data-slot="revision-change-row"]')).toHaveCount(2);

    // 예산 줄: 이전 18억(취소선) + 전체 금액, 이후 21.6억(밑줄) + 전체 금액.
    const budget = changeRow(page, "budgetKrw");
    await expect(budget.getByRole("rowheader")).toHaveText("예산");
    const [before, after] = [budget.getByRole("cell").nth(0), budget.getByRole("cell").nth(1)];
    await expect(before).toContainText("18억");
    await expect(before).toContainText("1,800,000,000원");
    await expect(after).toContainText("21.6억");
    await expect(after).toContainText("2,160,000,000원");
    await expect(before.getByText("18억", { exact: true })).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(after.getByText("21.6억", { exact: true })).toHaveCSS(
      "text-decoration-line",
      "underline",
    );

    // 공고 상태 줄: 공고 → 정정 공고.
    const status = changeRow(page, "status");
    await expect(status.getByRole("rowheader")).toHaveText("공고 상태");
    await expect(status.getByRole("cell").nth(0)).toHaveText("공고");
    await expect(status.getByRole("cell").nth(1)).toHaveText("정정 공고");

    // 본문(§4.4): Kubernetes 를 담은 ins 두 개(필수 기술 추가 · 정정공고 문장), 낭독 글자 "추가됨", 삭제된 18억원이다.
    const content = page.locator('[data-slot="revision-content"]');
    await expect(
      content.getByRole("heading", { level: 3, name: "본문", exact: true }),
    ).toBeVisible();
    const diff = contentDiff(page);
    const kubernetes = diff.locator("ins").filter({ hasText: "Kubernetes" });
    await expect(kubernetes).toHaveCount(2);
    await expect(kubernetes.first()).toBeVisible();
    await expect(kubernetes.first()).toHaveCSS("text-decoration-line", "underline");
    await expect(kubernetes.first().getByText("추가됨", { exact: true })).toBeAttached();
    await expect(kubernetes.first().getByText("추가 끝", { exact: true })).toBeAttached();
    await expect(diff.locator("del").filter({ hasText: "18억원이다" })).toHaveCount(1);
    await expect(diff.locator("ins").filter({ hasText: "21.6억원이다" })).toHaveCount(1);
    // 짧은 본문은 접을 곳이 없어 펼치기 버튼이 없다.
    await expect(page.getByRole("button", { name: "본문 전체 펼치기" })).toHaveCount(0);

    // 레일(§4.5): r2(고름, 바뀐 항목 3개) · r1(처음 수집).
    await expectRail(page, id, [2, 1], 2);
    const items = revisionRail(page).getByRole("link");
    await expect(items.nth(0)).toContainText("r2 · 차수 02");
    await expect(items.nth(0)).toContainText("바뀐 항목 3개");
    await expect(items.nth(1)).toContainText("r1 · 차수 01");
    await expect(items.nth(1)).toContainText("처음 수집");

    await expectNoHorizontalOverflow(page);
    await evidenceShot(page, "bid-revisions-fx07-loaded");
    expect(errors, "콘솔 오류·잡히지 않은 예외").toEqual([]);
  });

  test("S5 §4.7: FX-07 변경 이력 첫 화면에 예산 줄 · 본문 머리 · Kubernetes 추가가 스크롤 없이 보이고 가로로 넘치지 않는다", async ({
    page,
  }) => {
    const id = await fx07Id();
    await openRevisions(page, `/bids/${id}/revisions`);
    expect(await page.evaluate(() => window.scrollY), "첫 화면(스크롤 0)").toBe(0);
    await expect(changeRow(page, "budgetKrw")).toBeInViewport({ ratio: 1 });
    await expect(
      page
        .locator('[data-slot="revision-content"]')
        .getByRole("heading", { level: 3, name: "본문", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      contentDiff(page).locator("ins").filter({ hasText: "Kubernetes" }).first(),
    ).toBeInViewport({
      ratio: 1,
    });
    await expectNoHorizontalOverflow(page);
  });

  test("S5 하나뿐: FX-01 변경 이력은 처음 수집 문구만 있고 표가 없으며, 상세의 단계 이력 r1 은 링크가 아니다", async ({
    page,
  }) => {
    const id = readWorkContext().bids["FX-01"];
    const errors = watchConsole(page);

    await page.goto(`/bids/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const timeline = stageTimeline(page);
    await expect(timeline.locator('[aria-current="step"]')).toContainText("r1");
    await expect(timeline.getByRole("link")).toHaveCount(0);

    await openRevisions(page, `/bids/${id}/revisions`);
    const empty = changesSection(page).locator('[data-slot="revision-empty"]');
    await expect(empty).toHaveAttribute("data-reason", "single");
    await expect(empty.getByText(SINGLE_TITLE, { exact: true })).toBeVisible();
    await expect(empty.getByRole("link", { name: "공고 상세로", exact: true })).toHaveAttribute(
      "href",
      `/bids/${id}`,
    );
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    await expect(page.getByText(LEGEND, { exact: true })).toHaveCount(0);
    await expectRail(page, id, [1], 1);

    await expectNoHorizontalOverflow(page);
    await evidenceShot(page, "bid-revisions-fx01-empty");
    expect(errors, "콘솔 오류·잡히지 않은 예외").toEqual([]);
  });

  test("S5 취소: FX-08 변경 이력은 취소 띠와 공고 상태 공고 → 취소됨, 본문 끝 취소공고 추가를 보인다", async ({
    page,
  }) => {
    const id = readWorkContext().bids["FX-08"];
    const errors = watchConsole(page);

    await openRevisions(page, `/bids/${id}/revisions`);
    await expect(page.locator('[data-slot="revision-cancelled"]')).toContainText(CANCELLED_BANNER);
    const status = changeRow(page, "status");
    await expect(status.getByRole("cell").nth(0)).toHaveText("공고");
    await expect(status.getByRole("cell").nth(1)).toHaveText("취소됨");
    await expect(
      contentDiff(page).locator("ins").filter({ hasText: "취소공고: 본 공고는 취소한다." }),
    ).toHaveCount(1);
    await expectRail(page, id, [2, 1], 2);

    await expectNoHorizontalOverflow(page);
    await evidenceShot(page, "bid-revisions-fx08-loaded");
    expect(errors, "콘솔 오류·잡히지 않은 예외").toEqual([]);
  });

  test("S5 첫 revision: FX-07 ?rev=1 은 레일의 r1 을 고르고 비교할 이전 revision 이 없다는 빈 상태다", async ({
    page,
  }) => {
    const id = await fx07Id();
    await openRevisions(page, `/bids/${id}/revisions?rev=1`);
    await expectRail(page, id, [2, 1], 1);
    const empty = changesSection(page).locator('[data-slot="revision-empty"]');
    await expect(empty).toHaveAttribute("data-reason", "first");
    await expect(empty.getByText(FIRST_TITLE, { exact: true })).toBeVisible();
    await expect(empty.getByRole("link", { name: "최신 변경 보기", exact: true })).toHaveAttribute(
      "href",
      `/bids/${id}/revisions`,
    );
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    await expect(
      descriptionLine(page, String.raw`r1\s*·\s*차수 01\s*·\s*수집 ${KST_MINUTE}`),
    ).toBeVisible();
  });

  for (const rev of ["abc", "0", "9"]) {
    test(`S5 없음: FX-07 ?rev=${rev} 는 변경 이력을 찾을 수 없습니다 화면이다`, async ({
      page,
    }) => {
      const id = await fx07Id();
      const response = await page.goto(`/bids/${id}/revisions?rev=${rev}`);
      // loading.tsx 가 있어 스트리밍이 먼저 시작되면 HTTP 상태는 200 일 수 있다. 화면(404 UI)으로 판정하고 상태는 기록만 한다.
      test
        .info()
        .annotations.push({ type: "http-status", description: String(response?.status()) });
      await expect(
        page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(NOT_FOUND_DESCRIPTION, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "공고 목록으로", exact: true })).toHaveAttribute(
        "href",
        "/bids",
      );
      await expect(revisionRail(page)).toHaveCount(0);
      await expect(changesSection(page)).toHaveCount(0);
    });
  }
});
