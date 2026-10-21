import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { readInstalledAxeSource } from "./people-fixtures";

// 부처 지원사업 공고 /bids/programs E2E(playwright.programs.config.ts)가 같이 쓰는 값과 도우미.
// 준비 단계(programs-setup.ts)와 시험(program-notices.spec.ts)이 같은 값을 보게 여기에 둔다(N8 ingestion-fixtures 관례).
// 데모 계정은 scripts/demo/plan.mjs DEMO_ACCOUNTS 의 이메일이다. 그 파일은 Playwright(CJS 변환)가 가져오지 못해
// 이메일만 옮겨 적는다(work-fixtures.ts 와 같은 사정). seed 계정을 바꾸면 여기도 고친다.

// ── 대상: 부처 공고 전용 격리 Supabase ──
// 공용 로컬 Supabase(54321)는 다른 세션의 기준선이라 쓰지 않는다. 이 주소가 아니면 준비 단계가 멈춘다.
export const PROGRAMS_SUPABASE_API_URL = "http://127.0.0.1:59771";
// 격리 Supabase 의 작업 폴더(supabase status --workdir). 실행하는 사람이 env 로 준다.
export const PROGRAMS_SUPABASE_WORKDIR_ENV = "PROGRAMS_SUPABASE_WORKDIR";

// 업무 화면을 읽기만 하는 역할 하나로 본다(VIEWER). /bids·/bids/programs 는 업무 역할이면 누구나 같다(requireWork).
export const PROGRAMS_ROLE = { email: "viewer@soltech.invalid", solRole: "VIEWER" } as const;

// ── 녹음(중기부 사업공고 RSS) ──
// 적재는 이 녹음 하나만 재생한다(worker mock 모드, 저장소 밖 호출 없음). 기업마당 녹음은 없다.

const WEB_ROOT = path.join(__dirname, "..", "..");
const REPO_ROOT = path.join(WEB_ROOT, "..");
export const MSS_RECORDING_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "recorded",
  "program-notices",
  "mss",
  "rss-310.20261021.masked.json",
);

const recordingSchema = z.object({ source: z.literal("mss"), body: z.string().min(1) });
const ITEM_OPEN = /<item[\s>]/g;
const ITEM_BLOCK = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
const TITLE_CDATA = /<title\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title\s*>/i;

/**
 * 보이는 글자로 맞춘다: 공백 문자(줄바꿈·탭·U+00A0 NBSP 포함) 묶음을 빈칸 하나로, 앞뒤 공백은 뺀다.
 * 녹음 제목에는 NBSP 가 섞여 있고(「2026년 스마트제조혁신 유공」 … 모집 추가 공고), 저장 전 평문화(text.ts htmlToPlainText)가
 * 그것을 빈칸으로 바꾼다. 사람 눈에는 같은 글자라 기대값과 화면 글자 양쪽에 같은 규칙을 건다.
 */
export const visibleText = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * 녹음 본문의 `<item` 수와 항목 제목(CDATA 안 글자, visibleText 로 맞춘다). 화면이 보일 행 수·제목의 기준이다.
 * 제목은 해석기(mss-rss.ts)를 거치지 않고 녹음에서 바로 읽는다 — 화면 값과 독립인 기대값이어야 한다.
 */
export function readMssRecording(): { itemCount: number; titles: string[] } {
  const { body } = recordingSchema.parse(JSON.parse(readFileSync(MSS_RECORDING_PATH, "utf8")));
  const titles = [...body.matchAll(ITEM_BLOCK)].map((match) => {
    const title = visibleText(TITLE_CDATA.exec(match[1])?.[1] ?? "");
    if (!title) throw new Error("녹음 항목에 CDATA 제목이 없다(녹음 모양이 바뀌었다).");
    return title;
  });
  return { itemCount: body.match(ITEM_OPEN)?.length ?? 0, titles };
}

// ── 로그인 상태·시험 맥락(깃에서 뺀 e2e-auth/.auth/ 아래) ──

const AUTH_DIR = path.join(WEB_ROOT, "e2e-auth", ".auth");
export const PROGRAMS_CONTEXT_PATH = path.join(AUTH_DIR, "programs-context.json");
export const PROGRAMS_STORAGE_PATH = path.join(AUTH_DIR, "programs-viewer.json");

export const programsContextSchema = z.object({
  // 녹음의 <item 수와 적재 뒤 program_notices 행 수(준비 단계가 둘이 같은지 이미 봤다).
  recordedItems: z.number().int().min(1),
  storedNotices: z.number().int().min(1),
  // 이번 적재의 program_notice_runs 최신 행(mss, SUCCEEDED).
  latestRun: z.object({
    source: z.literal("mss"),
    status: z.literal("SUCCEEDED"),
    runMode: z.literal("MOCK"),
    savedCount: z.number().int(),
    startedAt: z.string(),
  }),
  // 준비 단계에서 본 /health/ready 가 200 이었는지. 아니면 상단바의 그 응답 하나를 콘솔 감시에서 뺀다.
  healthReady: z.boolean(),
  preparedAt: z.string(),
});
export type ProgramsContext = z.infer<typeof programsContextSchema>;

export const readProgramsContext = (): ProgramsContext =>
  programsContextSchema.parse(JSON.parse(readFileSync(PROGRAMS_CONTEXT_PATH, "utf8")));

// ── 화면 도우미 ──

/** 가로 넘침이 없다: document.documentElement.scrollWidth <= innerWidth(디자인 스펙 §11-1). */
export async function expectNoHorizontalOverflow(page: Page, state: string) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(size.scrollWidth, `${state} 가로 넘침(scrollWidth ≤ innerWidth)`).toBeLessThanOrEqual(
    size.innerWidth,
  );
}

/**
 * 상단바 AI 지표가 이 환경의 기대값으로 정해졌는지 본다(증거에 첫 값이 찍히지 않게, N8 expectTopbarAiSettled 와 같다).
 * - /health/ready 200: 첫 값 "확인 중"이 응답 값으로 바뀐다.
 * - /health/ready 503(이 격리 환경: Redis·MinIO·AI gateway 없음): 상단바는 마지막 값(첫 값 null)을 지키고 실패 툴팁을 붙인다
 *   (components/topbar-status.tsx). 글자는 "AI: 확인 중" 그대로이고 지표가 초점을 받는다(tabindex=0) — 응답을 받아 실패로 정해진 상태다.
 */
export async function expectTopbarAiSettled(page: Page, context: ProgramsContext) {
  const ai = page.locator('[data-slot="topbar-status"] [data-indicator="ai"]');
  if (context.healthReady) {
    await expect(ai).not.toHaveText(/확인 중/);
    return;
  }
  await expect(ai).toHaveText("AI: 확인 중");
  await expect(ai).toHaveAttribute("tabindex", "0");
}

// ── 증거 스크린샷(docs/evidence/program-notices/YYYYMMDD-task9-<route>-<state>-<width>.png) ──

const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "evidence", "program-notices");

const seoulDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now).replaceAll("-", "");

export async function shotPrograms(
  page: Page,
  context: ProgramsContext,
  name: string,
  width: 1440 | 1280,
) {
  expect(page.viewportSize()?.width, `${name} 는 ${width}px 에서 찍는다`).toBe(width);
  await expectTopbarAiSettled(page, context);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${seoulDate()}-task9-${name}-${width}.png`),
    // 화면 크기 그대로 찍는다(전체 페이지로 찍으면 고정된 사이드바·상단바가 겹쳐 보인다).
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

// ── axe(접근성) ──

const violationSchema = z.looseObject({
  id: z.string(),
  impact: z.string().nullable().optional(),
  help: z.string(),
  nodes: z.array(
    z.looseObject({ target: z.array(z.unknown()), failureSummary: z.string().optional() }),
  ),
});

/**
 * 지금 화면에 axe-core(설치본, eslint-plugin-jsx-a11y 의존)를 돌려 위반 0 을 단언한다.
 * C6 work-fixtures assertNoAxe·people assertAxe 와 같은 규칙 묶음이다(axe.run(document) 기본 규칙, CSP nonce 그대로).
 * 결과는 시험 첨부로 남긴다. 단언은 soft 라 같은 시험의 나머지 확인은 이어서 돈다(실패는 그대로 실패다).
 */
export async function assertNoAxe(page: Page, state: string) {
  const source = readInstalledAxeSource();
  await page.evaluate((content) => {
    if (Reflect.get(window, "axe")) return;
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    const script = document.createElement("script");
    if (nonce) script.nonce = nonce;
    script.textContent = content;
    document.head.append(script);
  }, source);
  const result: unknown = await page.evaluate(async () => {
    const axe = Reflect.get(window, "axe") as {
      version: string;
      run: (context: Document) => Promise<{ violations: unknown[] }>;
    };
    return { axeVersion: axe.version, violations: (await axe.run(document)).violations };
  });
  const parsed = z
    .object({ axeVersion: z.string(), violations: z.array(violationSchema) })
    .parse(result);
  const violations = parsed.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  }));
  const url = new URL(page.url());
  await test.info().attach(`axe-${state}`, {
    body: JSON.stringify({
      state,
      path: url.pathname + url.search,
      width: page.viewportSize()?.width ?? null,
      axeVersion: parsed.axeVersion,
      violations,
    }),
    contentType: "application/json",
  });
  expect.soft(violations, `axe 위반(${state})`).toEqual([]);
}

// ── 콘솔 감시 ──

type ConsoleEntry = { kind: "console" | "pageerror"; text: string; url: string };
export type ConsoleWatch = { entries: ConsoleEntry[] };

// 이 격리 웹 서버에는 Redis·MinIO·AI gateway 가 없어 /health/ready 가 503 이다(db·redis·storage 중 하나라도 없으면 503).
// 상단바가 그 응답을 읽을 때 브라우저가 "Failed to load resource" 를 콘솔 오류로 남긴다. 이 화면의 결함이 아니라
// 시험 환경의 빈 의존성이라, 준비 단계에서 /health/ready 가 200 이 아니었을 때만 그 한 가지를 뺀다(N8 관례).
// 이 화면들(/bids·/bids/programs)은 Redis·MinIO 를 쓰지 않는다. 그래서 웹 서버에 REDIS_URL·MINIO_ENDPOINT 를 주지 않는다.
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
export function expectNoConsoleErrors(watch: ConsoleWatch, context: ProgramsContext) {
  const ignored = context.healthReady ? [] : watch.entries.filter(isReadinessNoise);
  if (ignored.length > 0)
    test.info().annotations.push({
      type: "console-ignored",
      description: `/health/ready 503 콘솔 문장 ${ignored.length}건(웹 서버에 Redis·MinIO·AI gateway 가 없다)`,
    });
  const errors = watch.entries.filter((entry) => !ignored.includes(entry));
  expect(errors, "콘솔 오류·잡히지 않은 예외").toEqual([]);
}
