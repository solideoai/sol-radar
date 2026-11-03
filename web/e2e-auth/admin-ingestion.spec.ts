import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  CSRF_HEADERS,
  INGESTION_PATH,
  OPERATOR_ROLE,
  ROLE_SOL_ROLE,
  RUNS_ENDPOINT,
  expectNoConsoleErrors,
  expectNoHorizontalOverflow,
  expectTopbarSettled,
  historyTable,
  ingestionStorageOf,
  readIngestJob,
  readIngestionContext,
  resetIngestRateLimit,
  shortId,
  shotIngestion,
  startButtonName,
  waitForTopbarReads,
  watchConsole,
  type IngestSummary,
  type IngestionRole,
  type SeedRun,
} from "./support/ingestion-fixtures";
import { widthOf } from "./support/work-fixtures";

// N8 /admin/ingestion — 업무 역할 ADMIN 전용 수집 관리 화면(playwright.ingestion.config.ts, 1440·1280 두 폭).
// 기준: 계획서 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1(권한·202 본문·job data),
//       디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md §4.5 표·§4.6 대화상자·§4.7 서랍·§4.9 403(D10),
//       11-TESTING §5 #17·19-DEMO-SCENARIO S7(SEED 격리 1건·재시도 2회).
// 데이터: globalSetup(support/ingestion-setup.ts)이 N8 격리 Supabase 에 demo:reset 을 넣고 analyst 를 운영자로 켠다.
// 이 시험은 ingest_runs 행을 만들지 않는다. 수동 수집은 Redis(별도 DB 번호)에 job 만 넣고, 소비하는 worker 가 없다.

const TITLE = "데이터 수집 관리";
const DESCRIPTION =
  "공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.";
const FORBIDDEN_TITLE = "이 화면을 볼 권한이 없습니다";
// 업무 역할의 화면 이름(web/server/shared/sol-role-label.ts 와 같은 글자). 권한 안내는 영문 코드를 쓰지 않는다.
const SOL_ROLE_NAME = { ADMIN: "관리자", SALES: "영업", ANALYST: "분석", VIEWER: "열람" } as const;
const G2B_REASON = "실행 모드 fixture에서는 쓸 수 없습니다. live 모드에서만 됩니다.";
const BUSY_HINT = "실행 중인 수집이 끝나면 다시 실행할 수 있습니다";

// 실행 이력 표의 머리 줄(스펙 §4.5 열 순서). 칸은 이 순서로 찾는다.
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
] as const satisfies readonly (readonly [(typeof COLUMNS)[number], keyof IngestSummary])[];

const ZERO_SUMMARY: IngestSummary = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

const runButton = (page: Page) => page.getByRole("button", { name: "수동 수집 실행", exact: true });
const resultLine = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^수집 실행 \d+건 표시$/ });
const dataRows = (page: Page) =>
  historyTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
const cellOf = (row: Locator, column: (typeof COLUMNS)[number]) =>
  row.getByRole("cell").nth(COLUMNS.indexOf(column));
const runModeOf = (seed: SeedRun) => seed.runMode.toLowerCase();

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown(),
    requestId: z.string(),
  }),
});

// 11 §5 #17·07 §6.2: SEED 수집은 FX-12(공고번호 DEMO-2026-0012)를 필수 필드(title) 누락으로 격리하고 FX-20 의 429 를
// 두 번 재시도해 PARTIAL 로 끝난다. 화면은 저장값(sourceKey·detail)을 그대로 보인다(D6).
function expectSeedContract(seed: SeedRun) {
  expect(seed.status).toBe("PARTIAL");
  expect(seed.summary.quarantined).toBe(1);
  expect(seed.summary.retried).toBe(2);
  expect(seed.errors).toEqual([
    {
      sourceKey: "fixture:DEMO-2026-0012",
      errorCode: "MISSING_REQUIRED_FIELD",
      resultCode: null,
      detail: "missing: title",
    },
  ]);
}

async function expectSeedRow(page: Page, seed: SeedRun) {
  await expect(historyTable(page).getByRole("columnheader")).toHaveText([...COLUMNS]);
  const row = dataRows(page).filter({
    has: page.getByRole("button", { name: startButtonName(seed.startedAt, seed.id), exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(cellOf(row, "상태")).toContainText("부분 완료");
  await expect(cellOf(row, "상태")).toContainText(shortId(seed.id));
  await expect(cellOf(row, "소스·방식")).toContainText("데모 데이터 · 배치 SEED");
  await expect(cellOf(row, "소스·방식")).toContainText(
    `실행 모드 ${runModeOf(seed)} · 데모 초기화`,
  );
  for (const [column, key] of COUNT_COLUMNS)
    await expect(cellOf(row, column), column).toHaveText(seed.summary[key].toLocaleString("ko-KR"));
}

async function expectSeedDrawer(page: Page, seed: SeedRun): Promise<Locator> {
  const drawer = page.getByRole("dialog", { name: `수집 실행 ${shortId(seed.id)}`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAccessibleDescription(
    `데모 데이터 (fixture) · 배치 SEED · 실행 모드 ${runModeOf(seed)}`,
  );
  await expect(drawer.getByText("부분 완료 (격리 1건)", { exact: true })).toBeVisible();

  // 격리 무리: FX-12 한 건. 공고 식별·사유 코드·상세를 저장값 그대로 보인다.
  const quarantine = drawer.locator("section").filter({
    has: page.getByRole("heading", { level: 3, name: "격리 1건", exact: true }),
  });
  const items = quarantine.getByRole("listitem");
  await expect(items).toHaveCount(1);
  const [stored] = seed.errors;
  await expect(items.getByText(stored.sourceKey, { exact: true })).toBeVisible();
  await expect(items).toContainText(`필수 필드 누락 ${stored.errorCode}`);
  await expect(items.getByText(stored.detail, { exact: true })).toBeVisible();

  // 재시도는 횟수만 보인다(D4 채택 안 함).
  await expect(
    drawer.getByRole("heading", {
      level: 3,
      name: `재시도 ${seed.summary.retried}회`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(drawer.getByText(seed.id, { exact: true })).toBeVisible();
  return drawer;
}

// 403 안내(D10): 화면은 200 + 안내(PeopleForbidden 관례), API 는 403 이다. 데이터를 읽지 않는다.
async function expectForbiddenScreen(page: Page, role: IngestionRole) {
  const context = readIngestionContext();
  const logs = watchConsole(page);
  const ingestionCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(RUNS_ENDPOINT))
      ingestionCalls.push(request.url());
  });

  // 상단바는 30초마다 다시 읽어 networkidle 을 기다리지 않는다. 대신 마운트 때의 상단바 읽기가 끝날 때까지
  // (클라이언트 효과가 한 바퀴 돈 뒤까지) 수집 API 요청을 지켜보고, 그 뒤에도 안내 화면이 그대로인지 본다.
  const topbarReads = waitForTopbarReads(page);
  const response = await page.goto(INGESTION_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: TITLE, exact: true })).toBeVisible();
  const notice = page.getByRole("alert").filter({
    has: page.getByRole("heading", { name: FORBIDDEN_TITLE, exact: true }),
  });
  const expectNoticeOnly = async () => {
    await expect(notice).toBeVisible();
    await expect(page.getByRole("heading", { name: "실행 이력", exact: true })).toHaveCount(0);
    await expect(historyTable(page)).toHaveCount(0);
    await expect(runButton(page)).toHaveCount(0);
  };
  await expectNoticeOnly();
  await expect(notice).toContainText(
    `데이터 수집 관리는 업무 역할이 관리자인 구성원만 볼 수 있습니다. 지금 역할: ${SOL_ROLE_NAME[ROLE_SOL_ROLE[role]]}`,
  );
  await expect(notice.getByRole("link", { name: "대시보드로", exact: true })).toHaveAttribute(
    "href",
    "/dashboard",
  );
  await expectNoHorizontalOverflow(page, `forbidden-${role}`);

  await topbarReads;
  await expectTopbarSettled(page);
  await expectNoticeOnly();
  expect(ingestionCalls, "403 화면은 수집 API 를 부르지 않는다").toEqual([]);
  expectNoConsoleErrors(logs, context);
}

// 수집 API 세 개가 ADMIN 이 아니면 403 FORBIDDEN {required:["ADMIN"]} 이다. POST 는 job 을 넣지 않는다(계획서 §1 1번).
async function expectApiForbidden(page: Page) {
  const context = readIngestionContext();
  const expectForbidden = async (response: APIResponse, label: string) => {
    expect(response.status(), label).toBe(403);
    const { error } = errorSchema.parse(await response.json());
    expect(error.code, label).toBe("FORBIDDEN");
    expect(error.details, label).toEqual({ required: ["ADMIN"] });
    expect(response.headers()["x-request-id"], label).toBe(error.requestId);
  };
  await expectForbidden(await page.request.get(RUNS_ENDPOINT), "GET 목록");
  await expectForbidden(
    await page.request.get(`${RUNS_ENDPOINT}/${context.seedRun.id}`),
    "GET 상세",
  );
  const key = randomUUID();
  await expectForbidden(
    await page.request.post(RUNS_ENDPOINT, {
      headers: { ...CSRF_HEADERS, "Idempotency-Key": key },
      data: { source: "fixture", batch: "seed" },
    }),
    "POST",
  );
  expect(await readIngestJob(`manual:${context.orgId}:${key}`), "403 요청의 job").toBeNull();
}

test.describe("ADMIN(admin@solideos.com)", () => {
  test.use({ storageState: ingestionStorageOf("admin") });

  test("권한: ADMIN 은 /admin/ingestion 을 200 으로 열고 실행 이력과 SEED run 행을 본다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const context = readIngestionContext();
    const logs = watchConsole(page);

    const response = await page.goto(INGESTION_PATH);
    expect(response?.status()).toBe(200);
    // 읽어 온 화면에만 있는 것(실행 단추·결과 줄·표)을 먼저 본다. loading.tsx 뼈대도 같은 제목·설명을 그려서,
    // 스트리밍이 끝난 경계를 React 가 바꿔 넣기 전에는 같은 설명 문단이 잠깐 둘(하나는 숨은 경계 안) 있다.
    await expect(runButton(page)).toBeEnabled();
    await expect(
      page.getByRole("heading", { level: 2, name: "실행 이력", exact: true }),
    ).toBeVisible();
    await expect(resultLine(page)).toHaveText(`수집 실행 ${context.firstPageCount}건 표시`);
    await expect(dataRows(page)).toHaveCount(context.firstPageCount);
    await expectSeedRow(page, context.seedRun);
    // 바꿔 넣은 뒤에는 제목·설명이 하나씩이어야 한다(strict).
    await expect(page.getByRole("heading", { level: 1, name: TITLE, exact: true })).toBeVisible();
    await expect(page.getByText(DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: FORBIDDEN_TITLE })).toHaveCount(0);

    await expectNoHorizontalOverflow(page, "loaded");
    await shotIngestion(page, context, "loaded", width);
    expectNoConsoleErrors(logs, context);
  });

  test("S7 #17: SEED run 행을 열면 서랍에 FX-12 격리 1건(저장값 그대로)과 재시도 2회가 보이고, 닫으면 주소·초점이 돌아온다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const context = readIngestionContext();
    const seed = context.seedRun;
    expectSeedContract(seed);
    const logs = watchConsole(page);

    await page.goto(INGESTION_PATH);
    await expectSeedRow(page, seed);
    const opener = page.getByRole("button", {
      name: startButtonName(seed.startedAt, seed.id),
      exact: true,
    });
    await opener.click();
    await expect(page).toHaveURL(new RegExp(`${INGESTION_PATH}\\?run=${seed.id}$`));
    const drawer = await expectSeedDrawer(page, seed);
    await expectNoHorizontalOverflow(page, "drawer-seed");
    await shotIngestion(page, context, "drawer-seed", width);

    // 서랍은 Esc 로 닫히고 ?run 이 빠지며 초점은 연 단추로 돌아온다(스펙 §4.7·§7).
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${INGESTION_PATH}$`));
    await expect(opener).toBeFocused();
    expectNoConsoleErrors(logs, context);
  });

  test("S7 #17: ?run=<SEED id> 주소로 바로 열어도 같은 서랍이다", async ({ page }) => {
    const context = readIngestionContext();
    const seed = context.seedRun;
    expectSeedContract(seed);
    const logs = watchConsole(page);

    const response = await page.goto(`${INGESTION_PATH}?run=${seed.id}`);
    expect(response?.status()).toBe(200);
    await expectSeedDrawer(page, seed);
    expectNoConsoleErrors(logs, context);
  });

  test("수동 수집(fixture 모드): g2b 는 이유와 함께 비활성이고, 데모 데이터·배치 SEED 를 보내면 202 뒤 표 맨 위에 접수됨 행이 생긴다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const context = readIngestionContext();
    const admin = context.users.admin;
    await resetIngestRateLimit(context.orgId);
    const logs = watchConsole(page);

    await page.goto(INGESTION_PATH);
    await expect(resultLine(page)).toHaveText(`수집 실행 ${context.firstPageCount}건 표시`);
    await runButton(page).click();
    const dialog = page.getByRole("dialog", { name: "수동 수집 실행", exact: true });
    await expect(dialog).toBeVisible();

    // 실행 모드 fixture: 데모 데이터만 쓸 수 있어 미리 골라 두고, 나라장터는 숨기지 않고 이유와 함께 비활성이다.
    const fixture = dialog.getByRole("radio", { name: /^데모 데이터 \(fixture\)/ });
    const g2b = dialog.getByRole("radio", { name: /^나라장터 \(g2b\)/ });
    await expect(fixture).toBeChecked();
    await expect(fixture).toBeEnabled();
    await expect(g2b).toBeDisabled();
    await expect(g2b).not.toBeChecked();
    await expect(g2b).toHaveAccessibleDescription(G2B_REASON);
    await expect(dialog.getByText(G2B_REASON, { exact: true })).toBeVisible();

    // 배치는 기본 선택이 없다(D7). 고르기 전에는 [수집 실행]이 비활성이다.
    const submit = dialog.getByRole("button", { name: "수집 실행", exact: true });
    await expect(submit).toBeDisabled();
    const seedBatch = dialog.getByRole("radio", { name: /^SEED · 처음 적재/ });
    await seedBatch.click();
    await expect(seedBatch).toBeChecked();
    await expect(submit).toBeEnabled();
    await expectNoHorizontalOverflow(page, "dialog");
    await shotIngestion(page, context, "dialog", width);

    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === RUNS_ENDPOINT,
    );
    await submit.click();
    const response = await posted;
    expect(response.status()).toBe(202);
    const sent = response.request();
    expect(sent.headers()["x-requested-with"]).toBe(CSRF_HEADERS["X-Requested-With"]);
    const idempotencyKey = z.uuid().parse(sent.headers()["idempotency-key"]);
    expect(sent.postDataJSON()).toEqual({ source: "fixture", batch: "seed" });

    // 202 본문은 05 §6.5 모양이다. worker 가 행을 만들기 전의 RUNNING 이다(계획서 §1 11번).
    const body: unknown = await response.json();
    const { id, startedAt } = z
      .looseObject({ id: z.uuid(), startedAt: z.iso.datetime({ offset: true }) })
      .parse(body);
    expect(body).toEqual({
      id,
      source: "fixture",
      runMode: "fixture",
      batch: "seed",
      trigger: "MANUAL",
      status: "RUNNING",
      summary: ZERO_SUMMARY,
      quotaUsed: 0,
      errors: [],
      cursor: null,
      requestedBy: { id: admin.id, name: admin.name },
      startedAt,
      finishedAt: null,
    });

    // 대화상자가 닫히고 초점은 [수동 수집 실행]으로 돌아온다. 접수 행이 생겨 단추는 비활성 + 이유(D9)다.
    await expect(dialog).toBeHidden();
    await expect(runButton(page)).toBeFocused();
    await expect(runButton(page)).toBeDisabled();
    await expect(runButton(page)).toHaveAccessibleDescription(BUSY_HINT);

    // 표 맨 위에 접수 행(화면 전용 상태 "접수됨", D15). 숫자는 비운다.
    const accepted = dataRows(page).first();
    await expect(
      accepted.getByRole("button", { name: startButtonName(startedAt, id), exact: true }),
    ).toBeVisible();
    await expect(cellOf(accepted, "상태")).toContainText("접수됨");
    await expect(cellOf(accepted, "상태")).toContainText(shortId(id));
    await expect(cellOf(accepted, "소스·방식")).toContainText("데모 데이터 · 배치 SEED");
    await expect(cellOf(accepted, "소스·방식")).toContainText(
      `실행 모드 fixture · 수동 · ${admin.name}`,
    );
    for (const [column] of COUNT_COLUMNS)
      await expect(cellOf(accepted, column), column).toHaveText("—");
    await expect(dataRows(page)).toHaveCount(context.firstPageCount + 1);
    await expect(resultLine(page)).toHaveText(`수집 실행 ${context.firstPageCount + 1}건 표시`);
    await expect(
      page.getByRole("status").filter({ hasText: /^수집을 요청했습니다/ }),
    ).toContainText(
      `수집을 요청했습니다 · 데모 데이터 · 배치 SEED · ${shortId(id)} · 작업 시작을 기다리는 중`,
    );

    // 저장된 효과: Redis(이 시험의 DB 번호)에 job 이 들어갔다. ingest_runs 행은 worker 몫이라 보지 않는다.
    const jobKey = `manual:${context.orgId}:${idempotencyKey}`;
    const job = await readIngestJob(jobKey);
    expect(job?.data).toEqual({
      source: "fixture",
      batch: "SEED",
      trigger: "MANUAL",
      jobKey,
      idempotencyKey: `${context.orgId}:${idempotencyKey}`,
      requestedBy: admin.id,
      orgId: context.orgId,
      runId: id,
    });

    await expectNoHorizontalOverflow(page, "accepted");
    await shotIngestion(page, context, "accepted", width);
    expectNoConsoleErrors(logs, context);
  });

  test("API: ADMIN 의 GET /runs 는 200 Page 모양이고 SEED run 을 저장값 그대로 싣는다(GET /runs/:id 도 같다)", async ({
    page,
  }) => {
    const context = readIngestionContext();
    const seed = context.seedRun;
    const runSchema = z.looseObject({ id: z.uuid(), startedAt: z.string() });

    const list = await page.request.get(RUNS_ENDPOINT);
    expect(list.status()).toBe(200);
    const body = z
      .strictObject({
        items: z.array(runSchema),
        pageInfo: z.strictObject({
          cursor: z.null(),
          nextCursor: z.string().nullable(),
          hasNext: z.boolean(),
        }),
      })
      .parse(await list.json());
    expect(body.items).toHaveLength(context.firstPageCount);
    expect(body.pageInfo.hasNext).toBe(body.pageInfo.nextCursor !== null);
    const started = body.items.map((item) => Date.parse(item.startedAt));
    expect(started).toEqual([...started].sort((a, b) => b - a));

    const expected = {
      id: seed.id,
      source: "fixture",
      runMode: runModeOf(seed),
      batch: "seed",
      trigger: "DEMO",
      status: seed.status,
      summary: seed.summary,
      errors: seed.errors,
      requestedBy: null,
    };
    const listed = body.items.find((item) => item.id === seed.id);
    expect(listed).toMatchObject(expected);
    expect(Date.parse(listed?.startedAt ?? "")).toBe(Date.parse(seed.startedAt));

    const detail = await page.request.get(`${RUNS_ENDPOINT}/${seed.id}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject(expected);
  });

  test("권한: 업무 ADMIN 이라도 서비스 운영자가 아니면 /admin(운영자 화면)은 404 다", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
  });
});

for (const role of ["viewer", "sales"] as const) {
  const solRole = ROLE_SOL_ROLE[role];
  test.describe(`${solRole}(${role}@soltech.invalid, 운영자 아님)`, () => {
    test.use({ storageState: ingestionStorageOf(role) });

    test(`권한: ${solRole} 는 /admin/ingestion 에서 403 안내만 보고 수집 이력을 읽지 않는다`, async ({
      page,
    }) => {
      await expectForbiddenScreen(page, role);
      // 06 §12 증거 상태명 forbidden 은 VIEWER 화면이다(스펙 §4.9).
      if (role === "viewer")
        await shotIngestion(page, readIngestionContext(), "forbidden", widthOf(page));
    });

    test(`API: ${solRole} 의 수집 API 는 403 FORBIDDEN 이다(GET 목록·GET 상세·POST, job 없음)`, async ({
      page,
    }) => {
      await expectApiForbidden(page);
    });

    test(`권한: 서비스 운영자가 아닌 ${solRole} 의 /admin 은 여전히 404 다`, async ({ page }) => {
      const response = await page.goto("/admin");
      expect(response?.status()).toBe(404);
    });
  });
}

test.describe("ADMIN 이 아닌 서비스 운영자(analyst@soltech.invalid: ANALYST + profiles.is_admin)", () => {
  test.use({ storageState: ingestionStorageOf(OPERATOR_ROLE) });

  test("권한: 운영자라 /admin 은 200(사용자 관리)이지만 업무 역할이 ADMIN 이 아니라 /admin/ingestion 은 403 안내다", async ({
    page,
  }) => {
    // 운영자로 켜졌는지 먼저 본다. 아니면 아래 403 은 운영자 시험이 아니다.
    const operatorScreen = await page.goto("/admin");
    expect(operatorScreen?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "사용자 관리", exact: true }),
    ).toBeVisible();

    await expectForbiddenScreen(page, OPERATOR_ROLE);
  });

  test("API: ADMIN 이 아닌 운영자의 수집 API 는 403 FORBIDDEN 이다(GET 목록·GET 상세·POST, job 없음)", async ({
    page,
  }) => {
    await expectApiForbidden(page);
  });
});

test.describe("로그인 전", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("API: 로그인하지 않으면 수집 목록 API 는 401 UNAUTHENTICATED 다", async ({ page }) => {
    const response = await page.request.get(RUNS_ENDPOINT);
    expect(response.status()).toBe(401);
    expect(errorSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
