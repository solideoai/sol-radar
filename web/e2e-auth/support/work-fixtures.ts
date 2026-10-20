import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { readLocalStatus } from "./local-status";
import { readInstalledAxeSource } from "./people-fixtures";

// C6 업무 화면 E2E(playwright.work.config.ts)가 같이 쓰는 값과 도우미.
// 데모 계정은 scripts/demo/plan.mjs DEMO_ACCOUNTS 의 이메일이다. 그 파일은 최상위 await 가 있는 모듈을 불러
// Playwright(CJS 변환)가 가져오지 못해 이메일만 옮겨 적는다. seed 계정을 바꾸면 여기도 고친다.
export const WORK_ROLES = ["sales", "analyst", "viewer", "outsider"] as const;
// 바깥 링크(https://evil.example)로 심은 알림의 제목. C7 알림 worker 가 같은 문구의 진짜 ANALYSIS_COMPLETE 행을
// 만들 수 있어, 시험이 이 행만 집도록 이 시험 전용 문구를 쓴다.
export const EVIL_LINK_NOTIFICATION_TITLE = "분석이 끝났습니다. (바깥 링크 시험)";

export type WorkRole = (typeof WORK_ROLES)[number];
export const DEMO_ROLE_EMAIL: Record<WorkRole, string> = {
  sales: "sales@soltech.invalid",
  analyst: "analyst@soltech.invalid",
  viewer: "viewer@soltech.invalid",
  outsider: "viewer@other.invalid",
};

// 시험이 id 로 찾는 fixture 공고. 공고번호는 FX-NN → DEMO-2026-00NN 이다.
export const BID_FIXTURES = [
  "FX-01",
  "FX-02",
  "FX-03",
  "FX-04",
  "FX-06",
  "FX-08",
  "FX-18",
] as const;
export type BidFixture = (typeof BID_FIXTURES)[number];

export type WorkContext = {
  bids: Record<BidFixture, string>;
  users: Record<WorkRole, string>;
  orgs: { org01: string; org02: string };
  preparedAt: string;
};

const WEB_ROOT = path.join(__dirname, "..", "..");
const EVIDENCE_DIR = path.join(WEB_ROOT, "..", "docs", "evidence", "phase-3");
export const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, "e2e");
export const AXE_REPORT_PATH = path.join(EVIDENCE_DIR, "axe-report.json");
export const ISOLATION_EVIDENCE_PATH = path.join(EVIDENCE_DIR, "isolation-404.json");
// 화면마다의 axe 결과. globalSetup 이 비우고, 끝에 axe-report.json 하나로 모은다(깃에서 빠진 test-results 아래).
export const AXE_PARTS_DIR = path.join(WEB_ROOT, "test-results", "work-axe");
// globalSetup 이 이번 실행의 명령 줄을 이 env 로 넘긴다. axe 스캔마다 남긴다.
export const WORK_COMMAND_ENV = "C6_WORK_E2E_COMMAND";
// 로그인 상태와 시험 맥락(공고·계정 id). 깃에서 뺀 e2e-auth/.auth/ 아래.
export const WORK_CONTEXT_PATH = path.join(WEB_ROOT, "e2e-auth", ".auth", "work-context.json");
export const storageOf = (role: WorkRole): string =>
  path.join(WEB_ROOT, "e2e-auth", ".auth", `work-${role}.json`);

const contextSchema = z.object({
  bids: z.record(z.string(), z.uuid()),
  users: z.record(z.string(), z.uuid()),
  orgs: z.object({ org01: z.uuid(), org02: z.uuid() }),
  preparedAt: z.string(),
});

export const readWorkContext = (): WorkContext => {
  const parsed = contextSchema.parse(JSON.parse(readFileSync(WORK_CONTEXT_PATH, "utf8")));
  return {
    ...parsed,
    bids: Object.fromEntries(
      BID_FIXTURES.map((key) => [key, z.uuid().parse(parsed.bids[key])]),
    ) as WorkContext["bids"],
    users: Object.fromEntries(
      WORK_ROLES.map((key) => [key, z.uuid().parse(parsed.users[key])]),
    ) as WorkContext["users"],
  };
};

// ── 로컬 service role ──

export type LocalAdmin = {
  call: (method: string, pathname: string, body?: unknown) => Promise<unknown>;
  apiUrl: string;
  serviceKey: string;
};

/**
 * 로컬 Supabase(supabase status)의 service role 로 REST·Auth admin 을 부른다. E2E 지원 코드에서만 쓴다(people-read 관례).
 * 로컬이 아닌 주소는 readLocalStatus 가 거절한다. .env 파일은 읽지 않는다. 오류 문장에 쿼리(이메일·id)를 싣지 않는다.
 */
export function localAdmin(): LocalAdmin {
  const status = readLocalStatus();
  const apiUrl = status.API_URL;
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!serviceKey)
    throw new Error("로컬 Supabase status 에 service role 값이 없다(pnpm db:start).");
  const call = async (method: string, pathname: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${apiUrl}${pathname}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`로컬 ${method} ${pathname.split("?")[0]} HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  return { call, apiUrl, serviceKey };
}

// ── 증거 ──

/** 증거 JSON 을 저장소 Prettier 설정으로 맞춰 쓴다(루트 format:check 가 docs/evidence 도 본다). */
export async function writeEvidenceJson(file: string, data: unknown) {
  const options = (await resolveConfig(file)) ?? {};
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, await format(JSON.stringify(data), { ...options, filepath: file }));
}

const seoulDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now).replaceAll("-", "");

/** 06 §12 파일명: YYYYMMDD-phase3-<route>-<state>-<width>.png */
export const screenshotPath = (route: string, state: string, width: 1440 | 1280) =>
  path.join(SCREENSHOT_DIR, `${seoulDate()}-phase3-${route}-${state}-${width}.png`);

export async function shot(page: Page, route: string, state: string, width: 1440 | 1280) {
  expect(page.viewportSize()?.width, `${route}-${state} 는 ${width}px 에서 찍는다`).toBe(width);
  // 상단바 AI 지표는 마운트 뒤 /health/ready 를 읽어 채운다. 첫 값("확인 중")이 증거에 찍히지 않게 기다린다.
  await expect(page.locator('[data-slot="topbar-status"] [data-indicator="ai"]')).not.toHaveText(
    /확인 중/,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: screenshotPath(route, state, width),
    // 화면 크기(1440×900·1280×800) 그대로 찍는다. 전체 페이지로 찍으면 고정된 사이드바·상단바가 중간에 겹쳐 보인다.
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

const nodeSchema = z.object({
  target: z.array(z.unknown()),
  failureSummary: z.string().optional(),
});
const violationSchema = z.object({
  id: z.string(),
  impact: z.string().nullable().optional(),
  help: z.string(),
  nodes: z.array(nodeSchema),
});
export const axeScanSchema = z.object({
  state: z.string(),
  project: z.string(),
  width: z.number().nullable(),
  scannedAt: z.string(),
  command: z.string(),
  path: z.string(),
  axeVersion: z.string(),
  violations: z.array(violationSchema),
});

/**
 * 지금 화면에 axe-core(설치본, eslint-plugin-jsx-a11y 의존)를 돌려 위반 0 을 단언한다(people assertAxe 방식, CSP nonce 그대로).
 * 결과는 axe-report.json 으로 모은다. 단언은 soft 라 같은 시험의 나머지 확인은 이어서 돈다(실패는 그대로 실패다).
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
  const info = test.info();
  const parsed = z
    .object({ axeVersion: z.string(), violations: z.array(violationSchema.loose()) })
    .parse(result);
  const scan = axeScanSchema.parse({
    state,
    project: info.project.name,
    width: page.viewportSize()?.width ?? null,
    path: new URL(page.url()).pathname + new URL(page.url()).search,
    axeVersion: parsed.axeVersion,
    scannedAt: new Date().toISOString(),
    command: process.env[WORK_COMMAND_ENV] ?? "(명령 줄 없음: globalSetup 밖)",
    violations: parsed.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    })),
  });
  mkdirSync(AXE_PARTS_DIR, { recursive: true });
  const file = `${info.project.name}-${state}`.replace(/[^a-zA-Z0-9-]+/g, "_");
  writeFileSync(path.join(AXE_PARTS_DIR, `${file}.json`), JSON.stringify(scan, null, 2));
  await info.attach(`axe-${state}`, {
    body: JSON.stringify(scan),
    contentType: "application/json",
  });
  expect.soft(scan.violations, `axe 위반(${state})`).toEqual([]);
}

// ── 화면 도우미 ──

export const widthOf = (page: Page): 1440 | 1280 => {
  const width = page.viewportSize()?.width;
  if (width !== 1440 && width !== 1280)
    throw new Error(`이 시험은 1440·1280 폭에서만 돈다(${width})`);
  return width;
};

export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export const fontSizeOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).fontSize);

/** 표의 행마다 상세 링크의 공고 id 와 "SOL Score" 칸의 글자를 읽는다. */
export async function tableRows(table: Locator): Promise<Array<{ id: string; score: string }>> {
  return table.evaluate((element) => {
    const heads = [...element.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    const scoreIndex = heads.indexOf("SOL Score");
    return [...element.querySelectorAll("tbody tr")].map((row) => {
      const href = row.querySelector<HTMLAnchorElement>('a[href^="/bids/"]')?.getAttribute("href");
      const id = href?.split("?")[0].split("/")[2] ?? "";
      const cells = [...row.querySelectorAll("td")];
      const score = scoreIndex < 0 ? "" : (cells[scoreIndex]?.textContent?.trim() ?? "");
      return { id, score };
    });
  });
}

export const topbar = (page: Page) => page.locator('[data-slot="topbar-status"]');

// 공고 상세의 구역들(스펙 §5.4).
export const decisionRail = (page: Page) =>
  page.getByRole("complementary", { name: "참여 판단", exact: true });
export const analysisBand = (page: Page) =>
  page.locator("section", { has: page.locator("#analysis-band-title") });
export const qualificationSection = (page: Page) =>
  page.locator("section", { has: page.getByRole("heading", { level: 2, name: /^필수자격/ }) });
export const kevSection = (page: Page) =>
  page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: "Kev 참고 지표", exact: true }),
  });

/** 표에서 공고 id 로 행 하나를 찾는다(상세 링크는 ?list= 가 붙을 수 있다). */
export const rowOf = (page: Page, table: Locator, id: string) =>
  table.locator("tbody tr", { has: page.locator(`a[href^="/bids/${id}"]`) });

/** Kev 선택지 분포(%, 반올림). 화면의 meter 세 개(aria-valuenow 0~1)를 읽는다. */
export async function kevDistribution(page: Page): Promise<Record<string, number>> {
  const options = ["BID", "WATCH", "NO-BID"] as const;
  const values = await Promise.all(
    options.map(async (option) => {
      const meter = kevSection(page).getByRole("meter", { name: `${option} 선택지`, exact: true });
      await expect(meter).toBeVisible();
      return Math.round(Number(await meter.getAttribute("aria-valuenow")) * 100);
    }),
  );
  return Object.fromEntries(options.map((option, index) => [option, values[index]]));
}

/**
 * 키보드 Tab 으로 locator 까지 초점을 옮긴다. 툴팁(Base UI)은 키보드 초점(focus-visible)에서 열리고
 * element.focus() 만으로는 열리지 않는다(status-badge.browser.test 도 userEvent.tab 을 쓴다).
 */
export async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab ${limit}번 안에 초점이 닿지 않았다`);
}

/** 필터 막대의 Select 하나를 고른다(Base UI Select: combobox + option). */
export async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
