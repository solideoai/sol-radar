import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { z } from "zod";
import {
  PROGRAMS_CONTEXT_PATH,
  PROGRAMS_ROLE,
  PROGRAMS_STORAGE_PATH,
  PROGRAMS_SUPABASE_API_URL,
  PROGRAMS_SUPABASE_WORKDIR_ENV,
  programsContextSchema,
  readMssRecording,
} from "./programs-fixtures";
import { readLocalStatus } from "./local-status";

// 부처 지원사업 공고 /bids/programs E2E(pnpm -C web test:e2e:programs)의 globalSetup.
// 부처 공고 전용 격리 로컬 Supabase 에 demo:reset 하나와 부처 공고 적재(중기부 녹음 재생) 하나만 넣고 돈다.
// Compose·worker 컨테이너·demo:preanalyze 를 부르지 않는다. 적재는 worker 등록 함수(web/worker/program-notices.ts)를
// 이 저장소의 tsx 로 한 번 돌린다(support/program-notices-load.ts). 실호출은 없다(SOL_RUN_MODE=mock 은 녹음만 재생한다).
// 조건이 하나라도 맞지 않으면 건너뛰지 않고 이유를 적고 실패한다. 값(주소 외의 키·비밀번호)은 찍지 않는다.
//
// 실행하는 사람이 준비하는 env(웹 서버 webServer 는 이 프로세스의 env 를 그대로 받는다):
//   - PROGRAMS_SUPABASE_WORKDIR  격리 Supabase 의 작업 폴더(절대 경로). 주소·키는 그 폴더의
//                                `supabase status -o env --workdir` 로만 읽는다. API_URL 이 http://127.0.0.1:59771 이 아니면 멈춘다.
//                                기본 `supabase status`(공용 54321)는 읽지 않는다.
//   - NEXT_PUBLIC_SUPABASE_URL   위 status 의 API_URL(http://127.0.0.1:59771).
//   - NEXT_PUBLIC_SUPABASE_ANON_KEY  위 status 의 ANON_KEY(또는 PUBLISHABLE_KEY).
//                                두 값은 빌드에도 박힌다. 같은 env 로 `pnpm -C web build` 를 먼저 돌린다(번들에 그 주소가 없으면 멈춘다).
//   - API_CURSOR_SECRET          32자 이상(웹 서버 목록 커서 서명. /bids 가 읽는다).
//   - SOL_RUN_MODE=fixture       웹 서버와 demo:reset 의 실행 모드(N8 과 같다). 부처 공고 적재 자식만 mock 으로 돈다.
//   - (넣지 않는다) SUPABASE_SERVICE_ROLE_KEY — 웹 서버에 관리 키를 주지 않는다. 있으면 멈춘다.
//                                관리 키는 status 에서 읽어 demo:reset·적재 자식 프로세스의 env 로만 넘긴다.
//   - (넣지 않는다) REDIS_URL·MINIO_ENDPOINT — 이 화면들은 쓰지 않는다. 없으면 /health/ready 가 503 이라, 상단바의 그 응답
//                                콘솔 문장 하나만 감시에서 빼고 시험 주석에 남긴다(programs-fixtures.ts expectNoConsoleErrors).
//   - (선택) DEMO_SEED_PASSWORD   demo:reset 이 데모 계정에 거는 비밀번호. 없으면 실행마다 무작위 값이다(로그인은 magiclink 로 해서
//                                비밀번호를 쓰지 않는다). env 파일은 읽지 않는다(demo:reset 에 --env-file /dev/null).
//   - (선택) E2E_PORT             기본 3230(격리 Supabase 의 site_url 이 http://localhost:3230 이다).
//
// 데이터: demo:reset 이 데모 조직·계정·나라장터 공고 19건을 처음 상태로 만든다(/bids 링크 줄 확인용).
// 부처 공고는 program_notices 를 비운 뒤 중기부 녹음(fixtures/recorded/program-notices/mss/, 20건)을 재생해 적재한다.
// 적재 뒤 program_notices 행 수가 녹음의 <item 수와 같고 program_notice_runs 최신 행이 이번 회차의 mss SUCCEEDED 인지 본다.
// 시험은 읽기만 한다(두 폭 프로젝트가 함께 돌아도 서로의 단언을 깨지 않는다). 정리할 것이 없어 globalTeardown 이 없다.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const WEB_ROOT = path.join(__dirname, "..", "..");
const SEED_LINE =
  /^seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true$/m;
// support/program-notices-load.ts 의 마지막 줄.
const LOAD_LINE = /^program-notices-load: .+$/m;
const LOADER = "e2e-auth/support/program-notices-load.ts";

function fail(reason: string): never {
  throw new Error(`부처 공고 E2E 준비 실패: ${reason}`);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "알 수 없는 오류";

const tail = (text: string, lines = 12) => text.trim().split("\n").slice(-lines).join("\n");

// ── 격리 Supabase ──

type ProgramsSupabase = { apiUrl: string; anonKeys: string[]; serviceKey: string };

// readLocalStatus 의 격리 모드를 쓴다: 그 작업 폴더의 status 만 읽고, API origin 이 기대값과 다르면 던진다.
function readProgramsSupabase(): ProgramsSupabase {
  const workdir = process.env[PROGRAMS_SUPABASE_WORKDIR_ENV]?.trim() ?? "";
  if (workdir === "")
    fail(
      `${PROGRAMS_SUPABASE_WORKDIR_ENV} 가 없다. 격리 Supabase 의 작업 폴더(supabase status --workdir 경로)를 준다.`,
    );
  let status: Record<string, string>;
  try {
    status = readLocalStatus({
      env: {
        SOL_RADAR_TEST_SUPABASE_WORKDIR: workdir,
        SOL_RADAR_TEST_SUPABASE_API_URL: PROGRAMS_SUPABASE_API_URL,
      },
    });
  } catch (error) {
    fail(`격리 Supabase status 를 읽지 못했다(${messageOf(error)}).`);
  }
  const apiUrl = URL.canParse(status.API_URL ?? "") ? new URL(status.API_URL).origin : "";
  if (apiUrl !== PROGRAMS_SUPABASE_API_URL)
    fail(
      `격리 Supabase 의 API_URL 이 ${PROGRAMS_SUPABASE_API_URL} 이 아니다. 다른 DB 에 쓰지 않게 멈춘다.`,
    );
  const anonKeys = [status.ANON_KEY, status.PUBLISHABLE_KEY].filter(
    (key): key is string => typeof key === "string" && key !== "",
  );
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY || "";
  if (anonKeys.length === 0 || serviceKey === "")
    fail("격리 Supabase status 에 anon 키나 service role 값이 없다.");
  return { apiUrl, anonKeys, serviceKey };
}

// 웹 서버(webServer)는 이 프로세스의 env 를 그대로 받는다. 그 값이 격리 Supabase 를 가리키는지 먼저 본다.
function requireWebEnv(target: ProgramsSupabase) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!URL.canParse(url) || new URL(url).origin !== target.apiUrl)
    fail("웹 서버 env NEXT_PUBLIC_SUPABASE_URL 이 격리 Supabase 주소가 아니다.");
  if (!target.anonKeys.includes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""))
    fail("웹 서버 env NEXT_PUBLIC_SUPABASE_ANON_KEY 가 격리 status 의 anon 키가 아니다.");
  if ((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") !== "")
    fail(
      "env 에 SUPABASE_SERVICE_ROLE_KEY 가 있다. 웹 서버가 관리 키를 받지 않게 비우고 돌린다(적재 자식에만 따로 넘긴다).",
    );
  if ((process.env.API_CURSOR_SECRET ?? "").trim().length < 32)
    fail("API_CURSOR_SECRET 이 없거나 32자보다 짧다(웹 서버 env, 목록 커서 서명).");
  const runMode = (process.env.SOL_RUN_MODE ?? "").trim();
  if (runMode !== "fixture")
    fail(
      `SOL_RUN_MODE 가 fixture 가 아니다(${runMode || "없음"}). 웹 서버·demo:reset 은 fixture 모드에서 돈다.`,
    );
}

// NEXT_PUBLIC_* 는 빌드 때 번들에 박힌다(브라우저 Supabase 클라이언트·세션 갱신·CSP). 박힌 주소가 격리 Supabase 인지 본다.
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function requireBuild(target: ProgramsSupabase) {
  const nextDir = path.join(WEB_ROOT, ".next");
  if (!existsSync(path.join(nextDir, "BUILD_ID")))
    fail("빌드가 없다. 위 env 를 넣은 채로 `pnpm -C web build` 를 먼저 돌린다.");
  const files = [
    ...filesUnder(path.join(nextDir, "static")),
    ...filesUnder(path.join(nextDir, "server")),
  ];
  if (!files.some((file) => readFileSync(file, "utf8").includes(target.apiUrl)))
    fail(
      "빌드 번들에 격리 Supabase 주소가 없다(다른 주소로 빌드됐다). 위 env 를 넣은 채로 `pnpm -C web build` 를 다시 돌린다.",
    );
}

// ── demo:reset ──

// 주소·service role 은 격리 status 값으로만 넘긴다. env 파일은 읽지 않게 /dev/null 을 준다(셸 env 가 파일보다 먼저지만,
// 파일에 다른 값이 있어도 아예 열지 않는다). 실행 모드는 웹 서버와 같은 fixture 다.
function runDemoReset(target: ProgramsSupabase): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: target.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: target.serviceKey,
    DEMO_SEED_PASSWORD:
      process.env.DEMO_SEED_PASSWORD?.trim() || randomBytes(24).toString("base64url"),
    SOL_RUN_MODE: "fixture",
  };
  const result = spawnSync("pnpm", ["demo:reset", "--", "--env-file", "/dev/null"], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 900_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const line = output.match(SEED_LINE)?.[0];
  if (result.status !== 0 || line === undefined)
    fail(
      `pnpm demo:reset 가 기대한 마지막 줄을 내지 않았다(exit ${result.status}).\n${tail(output)}`,
    );
  return line;
}

// ── 부처 공고 적재(worker 등록 함수를 자식 프로세스로 한 번) ──

// 자식 env 에만 관리 키·격리 주소·mock 모드·녹음 경로를 준다. 이 프로세스(=웹 서버)의 env 는 바꾸지 않는다.
// 설정 파일은 SOURCES_REGISTRY_FILE 옆 program-notices.yaml 이다. 주기·설정 파일 덮어쓰기 env 는 지워 저장소 기본을 쓴다.
function runProgramNoticesLoad(target: ProgramsSupabase): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: target.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: target.serviceKey,
    SOL_RUN_MODE: "mock",
    FIXTURES_DIR: path.join(REPO_ROOT, "fixtures"),
    SOURCES_REGISTRY_FILE: path.join(REPO_ROOT, "infra", "sources", "registry.yaml"),
  };
  delete env.PROGRAM_NOTICES_CONFIG_FILE;
  delete env.PROGRAM_NOTICES_INTERVAL_MINUTES;
  const result = spawnSync(
    "pnpm",
    ["-C", "web", "exec", "node", "--conditions=react-server", "--import", "tsx", LOADER],
    {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const line = output.match(LOAD_LINE)?.[0];
  if (result.status !== 0 || line === undefined)
    fail(`부처 공고 적재가 결과 줄을 내지 않았다(exit ${result.status}).\n${tail(output)}`);
  return line;
}

// ── 격리 service role(이 지원 코드에서만) ──

type ProgramsAdmin = {
  call: (method: string, pathname: string, body?: unknown) => Promise<unknown>;
};

function programsAdmin(target: ProgramsSupabase): ProgramsAdmin {
  return {
    call: async (method, pathname, body) => {
      const response = await fetch(`${target.apiUrl}${pathname}`, {
        method,
        headers: {
          apikey: target.serviceKey,
          Authorization: `Bearer ${target.serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // 오류 문장에 쿼리(이메일·id)를 싣지 않는다.
      if (!response.ok)
        throw new Error(`격리 ${method} ${pathname.split("?")[0]} HTTP ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
  };
}

const noticeRowsSchema = z.array(z.object({ id: z.uuid(), source: z.string() }));

/** 적재 전 program_notices 를 비운다(격리 DB 라 괜찮다). 시험의 행 수가 녹음 항목 수와 같아야 해서 남은 행을 지운다. */
async function clearProgramNotices(admin: ProgramsAdmin) {
  await admin.call("DELETE", "/rest/v1/program_notices?id=not.is.null&select=id");
  const left = noticeRowsSchema.parse(
    await admin.call("GET", "/rest/v1/program_notices?select=id,source"),
  );
  if (left.length !== 0) fail(`program_notices 를 비우지 못했다(남은 행 ${left.length}).`);
}

const runRowSchema = z.object({
  source: z.string(),
  status: z.string(),
  run_mode: z.string(),
  error_code: z.string().nullable(),
  fetched_count: z.number().int(),
  saved_count: z.number().int(),
  dropped_count: z.number().int(),
  started_at: z.string(),
});

/** 적재 뒤 확인: 행 수 = 녹음 <item 수, 모두 mss. program_notice_runs 최신 행 = 이번 회차의 mss SUCCEEDED. */
async function requireLoaded(admin: ProgramsAdmin, loadStartedAt: Date, recordedItems: number) {
  const rows = noticeRowsSchema.parse(
    await admin.call("GET", "/rest/v1/program_notices?select=id,source"),
  );
  if (rows.length !== recordedItems)
    fail(`program_notices 가 ${rows.length}건이다. 녹음 항목 수 ${recordedItems}건과 다르다.`);
  if (rows.some((row) => row.source !== "mss"))
    fail("program_notices 에 mss 가 아닌 행이 있다(기업마당 녹음은 없다).");

  const [latest] = z
    .array(runRowSchema)
    .parse(
      await admin.call(
        "GET",
        "/rest/v1/program_notice_runs?select=source,status,run_mode,error_code,fetched_count,saved_count,dropped_count,started_at&order=started_at.desc&limit=1",
      ),
    );
  if (latest === undefined) fail("program_notice_runs 에 행이 없다.");
  if (Date.parse(latest.started_at) < loadStartedAt.getTime())
    fail("program_notice_runs 최신 행이 이번 적재 전의 것이다(이번 회차가 run 을 남기지 않았다).");
  if (
    latest.source !== "mss" ||
    latest.status !== "SUCCEEDED" ||
    latest.run_mode !== "MOCK" ||
    latest.error_code !== null ||
    latest.fetched_count !== recordedItems ||
    latest.saved_count !== recordedItems ||
    latest.dropped_count !== 0
  )
    fail(
      `program_notice_runs 최신 행이 기대와 다르다(source=${latest.source} status=${latest.status} run_mode=${latest.run_mode} error=${latest.error_code ?? "-"} fetched=${latest.fetched_count} saved=${latest.saved_count} dropped=${latest.dropped_count}).`,
    );
  return {
    storedNotices: rows.length,
    latestRun: {
      source: latest.source,
      status: latest.status,
      runMode: latest.run_mode,
      savedCount: latest.saved_count,
      startedAt: latest.started_at,
    },
  };
}

// 업무 역할 하나(VIEWER)의 로그인 상태를 저장한다(N8 과 같은 방식). 비밀번호를 쓰지 않는다:
// 격리 service role 로 magiclink 토큰을 만들고 앱의 /auth/confirm 으로 실제 세션 쿠키를 받는다.
// 웹 서버가 격리가 아닌 Supabase 를 보면 토큰 확인이 실패해 여기서 멈춘다.
async function saveStorageState(admin: ProgramsAdmin, baseURL: string) {
  const link = z.object({ hashed_token: z.string().min(1) }).parse(
    await admin.call("POST", "/auth/v1/admin/generate_link", {
      type: "magiclink",
      email: PROGRAMS_ROLE.email,
    }),
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const page = await context.newPage();
    await page.goto(
      `/auth/confirm?type=email&next=%2Fdashboard&token_hash=${encodeURIComponent(link.hashed_token)}`,
    );
    await page
      .waitForURL(/\/dashboard$/, { timeout: 30_000 })
      .catch(() =>
        fail(
          `${PROGRAMS_ROLE.solRole} 로그인 뒤 /dashboard 로 가지 않았다(지금 ${new URL(page.url()).pathname}). 웹 서버가 격리 Supabase 를 보는지 확인한다.`,
        ),
      );
    await page.getByRole("heading", { level: 1, name: "대시보드", exact: true }).waitFor();
    mkdirSync(path.dirname(PROGRAMS_STORAGE_PATH), { recursive: true });
    await context.storageState({ path: PROGRAMS_STORAGE_PATH });
    await context.close();
  } finally {
    await browser.close();
  }
}

async function readinessIsOk(baseURL: string): Promise<boolean> {
  const response = await fetch(new URL("/health/ready", baseURL), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return response?.status === 200;
}

export default async function programsSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) fail("baseURL 이 없다(playwright.programs.config.ts).");

  // 1) 대상 확인: 격리 status → 웹 서버 env → 빌드 → 녹음. 무엇이든 쓰기 전에 본다.
  const target = readProgramsSupabase();
  requireWebEnv(target);
  requireBuild(target);
  const recording = readMssRecording();
  if (recording.itemCount !== recording.titles.length)
    fail(`녹음의 <item 수(${recording.itemCount})와 제목 수(${recording.titles.length})가 다르다.`);

  // 2) 데모 seed(demo:reset 하나). 확인 줄은 N8 과 같은 마지막 줄이다.
  console.log(`programs-setup: ${runDemoReset(target)}`);

  // 3) 부처 공고: 비우기 → 적재(중기부 녹음 재생) → 행 수·run 확인.
  const admin = programsAdmin(target);
  await clearProgramNotices(admin);
  // run 의 started_at 은 적재 자식이 이 기계의 시계로 찍는다(collect.service deps.now). 그래서 이 시각과 바로 비교한다.
  const loadStartedAt = new Date();
  console.log(`programs-setup: ${runProgramNoticesLoad(target)}`);
  const loaded = await requireLoaded(admin, loadStartedAt, recording.itemCount);

  // 4) 로그인 상태·시험 맥락.
  await saveStorageState(admin, baseURL);
  const context = programsContextSchema.parse({
    recordedItems: recording.itemCount,
    ...loaded,
    healthReady: await readinessIsOk(baseURL),
    preparedAt: new Date().toISOString(),
  });
  writeFileSync(PROGRAMS_CONTEXT_PATH, `${JSON.stringify(context, null, 2)}\n`);
}
