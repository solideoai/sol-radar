import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

// N8 /admin/ingestion E2E(playwright.ingestion.config.ts)가 같이 쓰는 값과 도우미.
// 데모 계정은 scripts/demo/plan.mjs DEMO_ACCOUNTS 의 이메일이다. 그 파일은 Playwright(CJS 변환)가 가져오지 못해
// 이메일만 옮겨 적는다(work-fixtures.ts 와 같은 사정). seed 계정을 바꾸면 여기도 고친다.

// ── 대상: N8 전용 격리 Supabase ──
// 공용 로컬 Supabase(54321)는 다른 세션의 기준선이라 쓰지 않는다. 이 주소가 아니면 준비 단계가 멈춘다.
export const N8_SUPABASE_API_URL = "http://127.0.0.1:59731";
// 격리 Supabase 의 작업 폴더(supabase status --workdir). 실행하는 사람이 env 로 준다.
export const N8_SUPABASE_WORKDIR_ENV = "N8_SUPABASE_WORKDIR";

export const INGESTION_PATH = "/admin/ingestion";
export const RUNS_ENDPOINT = "/api/v1/admin/ingestion/runs";
export const CSRF_HEADERS = { "X-Requested-With": "sol-radar" } as const;

// analyst 는 이 시험 동안만 서비스 운영자(profiles.is_admin)로 켠다(ADMIN 이 아닌 운영자). 나머지 셋은 운영자가 아니다.
export const INGESTION_ROLES = ["admin", "sales", "analyst", "viewer"] as const;
export type IngestionRole = (typeof INGESTION_ROLES)[number];
export const OPERATOR_ROLE = "analyst" satisfies IngestionRole;
export const ROLE_EMAIL: Record<IngestionRole, string> = {
  admin: "admin@soltech.invalid",
  sales: "sales@soltech.invalid",
  analyst: "analyst@soltech.invalid",
  viewer: "viewer@soltech.invalid",
};
export const ROLE_SOL_ROLE: Record<IngestionRole, "ADMIN" | "SALES" | "ANALYST" | "VIEWER"> = {
  admin: "ADMIN",
  sales: "SALES",
  analyst: "ANALYST",
  viewer: "VIEWER",
};

// demo:reset 의 SEED 수집 run(web/server/ingestion seed-fixture-bids.ts DEMO_RESET_SEED_JOB_KEY).
export const SEED_RUN_JOB_KEY = "fixture:SEED:demo-reset";
export const FIRST_PAGE_SIZE = 20;

// ── 로그인 상태·시험 맥락(깃에서 뺀 e2e-auth/.auth/ 아래) ──

const WEB_ROOT = path.join(__dirname, "..", "..");
const AUTH_DIR = path.join(WEB_ROOT, "e2e-auth", ".auth");
export const INGESTION_CONTEXT_PATH = path.join(AUTH_DIR, "ingestion-context.json");
export const ingestionStorageOf = (role: IngestionRole): string =>
  path.join(AUTH_DIR, `ingestion-${role}.json`);

const summarySchema = z.object({
  created: z.number().int(),
  changed: z.number().int(),
  cancelled: z.number().int(),
  skippedDuplicate: z.number().int(),
  quarantined: z.number().int(),
  retried: z.number().int(),
});
export type IngestSummary = z.infer<typeof summarySchema>;
export const SUMMARY_KEYS = [
  "created",
  "changed",
  "cancelled",
  "skippedDuplicate",
  "quarantined",
  "retried",
] as const satisfies readonly (keyof IngestSummary)[];

export const seedRunSchema = z.object({
  id: z.uuid(),
  source: z.literal("fixture"),
  batch: z.literal("SEED"),
  trigger: z.literal("DEMO"),
  status: z.string(),
  runMode: z.enum(["LIVE", "FIXTURE", "MOCK"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  summary: summarySchema,
  // ingest_errors 저장값 그대로(source_key·error_code·result_code·redacted_detail).
  errors: z.array(
    z.object({
      sourceKey: z.string(),
      errorCode: z.string(),
      resultCode: z.string().nullable(),
      detail: z.string(),
    }),
  ),
});
export type SeedRun = z.infer<typeof seedRunSchema>;

// 계정 id 와 화면에 보이는 이름(profiles.display_name, 202 본문 requestedBy.name).
const userSchema = z.object({ id: z.uuid(), name: z.string().min(1) });

export const ingestionContextSchema = z.object({
  orgId: z.uuid(),
  users: z.object({
    admin: userSchema,
    sales: userSchema,
    analyst: userSchema,
    viewer: userSchema,
  }),
  seedRun: seedRunSchema,
  // 화면 첫 쪽에 보일 run 수(전체 run 수와 20 중 작은 값). 이 시험은 ingest_runs 행을 만들지 않는다.
  firstPageCount: z.number().int().min(1),
  // 준비 단계에서 본 /health/ready 가 200 이었는지. 아니면 상단바의 그 응답 하나를 콘솔 감시에서 뺀다(watchConsole).
  healthReady: z.boolean(),
  preparedAt: z.string(),
});
export type IngestionContext = z.infer<typeof ingestionContextSchema>;

export const readIngestionContext = (): IngestionContext =>
  ingestionContextSchema.parse(JSON.parse(readFileSync(INGESTION_CONTEXT_PATH, "utf8")));

// ── Redis(호스트 redis 의 별도 DB 번호) ──

// 이 시험이 Redis 에 남기는 키. 준비 단계와 끝 정리가 이 셋만 지운다(같은 DB 의 다른 키는 건드리지 않는다).
export const N8_REDIS_KEY_PATTERNS = ["idem:ingest:*", "rate:ingest:*", "bull:ingest:*"] as const;

/**
 * REDIS_URL 이 루프백의 0 이 아닌 DB 번호인지 본다(예: redis://127.0.0.1:6379/5). 아니면 던진다.
 * 기본 DB(0)는 Compose worker 가 쓰는 큐일 수 있어 막는다. 주소·비밀번호는 오류 문장에 싣지 않는다.
 */
export function n8RedisTarget(value: string | undefined): { url: string; db: number } {
  const url = (value ?? "").trim();
  if (!URL.canParse(url)) throw new Error("REDIS_URL 이 없거나 주소가 아니다.");
  const parsed = new URL(url);
  if (parsed.protocol !== "redis:")
    throw new Error("REDIS_URL 은 redis:// 여야 한다(이 시험은 호스트 redis 만 쓴다).");
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname))
    throw new Error("REDIS_URL 이 루프백(127.0.0.1)이 아니다.");
  const match = /^\/(\d{1,2})$/.exec(parsed.pathname);
  const db = match === null ? 0 : Number(match[1]);
  if (db < 1 || db > 15)
    throw new Error("REDIS_URL 에 0 이 아닌 DB 번호가 없다(예: redis://127.0.0.1:6379/5).");
  return { url, db };
}

/** 이 시험의 Redis DB 에서 수동 수집 job 하나를 읽는다(BullMQ jobId = encodeURIComponent(jobKey)). */
export async function readIngestJob(jobKey: string): Promise<Job | null> {
  const { url } = n8RedisTarget(process.env.REDIS_URL);
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  connection.on("error", () => {});
  const queue = new Queue("ingest", { connection });
  try {
    return (await queue.getJob(encodeURIComponent(jobKey))) ?? null;
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

/**
 * 이 조직의 수동 수집 속도 제한 횟수(rate:ingest:<orgId>:<창>)를 지운다. 속도 제한(조직당 분당 5회)은 이 시험의 대상이 아니고
 * (계약 시험이 본다), 두 폭 프로젝트·반복 실행(--repeat-each)의 앞선 요청 횟수가 다음 시험에 남지 않게 한다.
 */
export async function resetIngestRateLimit(orgId: string): Promise<void> {
  const { url } = n8RedisTarget(process.env.REDIS_URL);
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  redis.on("error", () => {});
  try {
    const keys = await redis.keys(`rate:ingest:${orgId}:*`);
    if (keys.length > 0) await redis.unlink(...keys);
  } finally {
    redis.disconnect();
  }
}

// ── 화면 도우미 ──

const KST_MINUTE = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 표의 시작 시각 글자 `2026-10-20 14:03`(서울, N8 스펙 §3.4). */
export function kstMinute(iso: string): string {
  const parts = Object.fromEntries(
    KST_MINUTE.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export const shortId = (id: string): string => id.slice(0, 8);

/** 행 시작 단추의 접근성 이름(N8 스펙 §4.5). */
export const startButtonName = (startedAt: string, id: string): string =>
  `${kstMinute(startedAt)} 시작 수집 실행 ${shortId(id)} 자세히 보기`;

export const historyTable = (page: Page) =>
  page.getByRole("table", { name: "수집 실행 이력. 최근 실행이 위에 있습니다." });

/** 가로 넘침이 없다: document.documentElement.scrollWidth <= innerWidth. */
export async function expectNoHorizontalOverflow(page: Page, state: string) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(size.scrollWidth, `${state} 가로 넘침(scrollWidth ≤ innerWidth)`).toBeLessThanOrEqual(
    size.innerWidth,
  );
}

// ── 증거 스크린샷(06 §12 파일명: YYYYMMDD-phase3-<route>-<state>-<width>.png) ──

const EVIDENCE_DIR = path.join(WEB_ROOT, "..", "docs", "evidence", "phase-3", "admin-ingestion");

const seoulDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now).replaceAll("-", "");

// 상단바 지표는 마운트 뒤 /health/ready·/api/v1/dashboard/summary 를 한 번 읽는다((work) 레이아웃이 initialAi: null 로 넘긴다).
// 이 두 응답을 기다리면 화면의 클라이언트 효과가 한 바퀴 돈 것이다. goto 전에 불러 둔다(응답을 놓치지 않게).
export const waitForTopbarReads = (page: Page) =>
  Promise.all(
    ["/health/ready", "/api/v1/dashboard/summary"].map((pathname) =>
      page.waitForResponse((response) => new URL(response.url()).pathname === pathname),
    ),
  );

/**
 * 상단바 AI 지표가 이 환경의 기대값으로 정해졌는지 본다(증거에 첫 값이 찍히지 않게).
 * - /health/ready 200(저장소가 있는 환경): 첫 값 "확인 중"이 응답 값(AI: mock·local·unavailable…)으로 바뀐다.
 * - /health/ready 503(이 격리 환경: MinIO 없음): C6 상단바는 503 이면 마지막 값을 지키고 실패 툴팁
 *   "상태를 확인하지 못했습니다"를 붙인다(components/topbar-status.tsx readAi·AiModeIndicator,
 *   components/topbar-status.browser.test.tsx "health 가 503 이면 마지막 값을 유지하고 …"). 첫 값이 null 이라
 *   글자는 "AI: 확인 중" 그대로이고, 툴팁이 붙어 지표가 초점을 받는다(tabindex=0) — 응답을 받아 실패로 정해진 상태다.
 */
export async function expectTopbarAiSettled(page: Page, context: IngestionContext) {
  const ai = page.locator('[data-slot="topbar-status"] [data-indicator="ai"]');
  if (context.healthReady) {
    await expect(ai).not.toHaveText(/확인 중/);
    return;
  }
  await expect(ai).toHaveText("AI: 확인 중");
  await expect(ai).toHaveAttribute("tabindex", "0");
}

export async function shotIngestion(
  page: Page,
  context: IngestionContext,
  state: string,
  width: 1440 | 1280,
) {
  expect(page.viewportSize()?.width, `${state} 는 ${width}px 에서 찍는다`).toBe(width);
  await expectTopbarAiSettled(page, context);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${seoulDate()}-phase3-admin-ingestion-${state}-${width}.png`),
    // 화면 크기 그대로 찍는다(전체 페이지로 찍으면 고정된 사이드바·상단바가 겹쳐 보인다).
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

// ── 콘솔 감시 ──

type ConsoleEntry = { kind: "console" | "pageerror"; text: string; url: string };
export type ConsoleWatch = { entries: ConsoleEntry[] };

// 저장소(MinIO)·AI gateway 없이 띄운 서버는 /health/ready 가 503 이다(db·redis·storage 중 하나라도 없으면 503).
// 상단바가 그 응답을 읽을 때 브라우저가 "Failed to load resource" 를 콘솔 오류로 남긴다. 이 화면의 결함이 아니라
// 시험 환경의 빈 의존성이라, 준비 단계에서 /health/ready 가 200 이 아니었을 때만 그 한 가지를 빼고 시험 주석에 적는다.
const isReadinessNoise = (entry: ConsoleEntry): boolean =>
  entry.kind === "console" &&
  entry.text.startsWith("Failed to load resource") &&
  URL.canParse(entry.url) &&
  new URL(entry.url).pathname === "/health/ready";

/** 이 페이지의 콘솔 오류(console.error·네트워크 실패 문장)와 잡히지 않은 예외를 모은다. */
export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { entries: [] };
  page.on("console", (message) => {
    if (message.type() === "error")
      watch.entries.push({ kind: "console", text: message.text(), url: message.location().url });
  });
  page.on("pageerror", (error) =>
    watch.entries.push({ kind: "pageerror", text: error.message, url: page.url() }),
  );
  return watch;
}

/** 콘솔 오류 0 을 단언한다. /health/ready 503 은 준비 단계에서 200 이 아니었을 때만 빼고 주석으로 남긴다. */
export function expectNoConsoleErrors(watch: ConsoleWatch, context: IngestionContext) {
  const ignored = context.healthReady ? [] : watch.entries.filter(isReadinessNoise);
  if (ignored.length > 0)
    test.info().annotations.push({
      type: "console-ignored",
      description: `/health/ready 503 콘솔 문장 ${ignored.length}건(서버에 저장소·AI 의존성이 없다)`,
    });
  const errors = watch.entries.filter((entry) => !ignored.includes(entry));
  expect(errors, "콘솔 오류·잡히지 않은 예외").toEqual([]);
}
