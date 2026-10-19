import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  AXE_PARTS_DIR,
  AXE_REPORT_PATH,
  BID_FIXTURES,
  DEMO_ROLE_EMAIL,
  WORK_CONTEXT_PATH,
  WORK_ROLES,
  axeScanSchema,
  localAdmin,
  storageOf,
  type LocalAdmin,
  type WorkContext,
  type WorkRole,
} from "./work-fixtures";

// C6 업무 화면 E2E(pnpm -C web test:e2e:work)의 globalSetup. 공용 로컬 Supabase 위에 데모 상태를 처음부터 다시 만든다.
// 순서는 ADR-030 B22 그대로다: (Compose 는 미리 떠 있다) → demo:reset → 모드 확인 → demo:preanalyze.
// 조건이 하나라도 맞지 않으면 건너뛰지 않고 이유를 적고 실패한다.
//
// 필요한 것(실행하는 사람이 준비한다. 값은 이 파일이 찍지 않는다):
//   - 로컬 Supabase(pnpm db:start). service role 은 이 지원 코드에서만, 로컬 status 로만 읽는다(people-read 관례).
//   - Compose 의 redis·ai-gateway(mock)·worker. pnpm demo:preanalyze 가 `docker compose exec worker` 로 돈다.
//     격리 프로젝트로 띄웠으면 COMPOSE_PROJECT_NAME 을 같은 값으로 넘긴다.
//   - 웹 서버 env: API_CURSOR_SECRET(32자 이상), REDIS_URL, AI_GATEWAY_URL, MINIO_ENDPOINT, SOL_RUN_MODE=mock.
//     웹 서버(playwright.work.config.ts webServer)는 이 프로세스의 env 를 그대로 받는다.
//   - DEMO_SEED_PASSWORD 가 든 env 파일. 기본은 저장소 루트 .env.local, 다른 곳이면 DEMO_SEED_ENV_FILE 로 경로를 준다.
//     이 파일은 demo:reset 만 읽는다(테스트 코드는 열지 않는다). 주소·service role 은 그 파일이 아니라 로컬 status 값을
//     자식 env 로 넘긴다 — demo:reset 은 셸 env 를 파일보다 먼저 쓰므로(scripts/demo/plan.mjs resolveSeedEnv) 늘 로컬에 쓴다.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SEED_LINE =
  /^seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true$/m;
const PREANALYZE_LINE = /^preanalyze: targets=18 completed=18 partial=0 failed=0$/m;

function fail(reason: string): never {
  throw new Error(`C6 업무 E2E 준비 실패: ${reason}`);
}

const tail = (text: string, lines = 12) => text.trim().split("\n").slice(-lines).join("\n");

function requireEnv() {
  const runMode = (process.env.SOL_RUN_MODE ?? "mock").trim() || "mock";
  if (runMode !== "mock")
    fail(`SOL_RUN_MODE 가 mock 이 아니다(${runMode}). 사전 분석은 mock 모드에서만 돈다(B22).`);
  const cursor = process.env.API_CURSOR_SECRET ?? "";
  if (cursor.length < 32) fail("API_CURSOR_SECRET 이 없거나 32자보다 짧다(웹 서버 env).");
  for (const key of ["REDIS_URL", "AI_GATEWAY_URL", "MINIO_ENDPOINT"] as const)
    if (!process.env[key])
      fail(`${key} 가 없다(웹 서버 env, /health/ready 가 ok 여야 상단바가 맞다).`);
  const seedEnvFile = process.env.DEMO_SEED_ENV_FILE ?? path.join(REPO_ROOT, ".env.local");
  if (!existsSync(seedEnvFile))
    fail(
      "DEMO_SEED_PASSWORD 가 든 env 파일이 없다. 루트 .env.local 이나 DEMO_SEED_ENV_FILE 경로를 준비한다.",
    );
  return { gatewayUrl: String(process.env.AI_GATEWAY_URL).replace(/\/+$/, ""), seedEnvFile };
}

async function requireMockGateway(gatewayUrl: string) {
  const response = await fetch(`${gatewayUrl}/health`, {
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (response === null || response.status !== 200)
    fail(`AI gateway(${gatewayUrl}/health)에 닿지 않는다. Compose 의 ai-gateway 를 먼저 띄운다.`);
  const body = z.object({ provider: z.string() }).safeParse(await response.json());
  if (!body.success || body.data.provider !== "mock")
    fail("AI gateway provider 가 mock 이 아니다. AI_PROVIDER=mock 으로 띄운다(유료 API 금지).");
}

function run(label: string, args: string[], env: NodeJS.ProcessEnv, pattern: RegExp) {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 900_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !pattern.test(output))
    fail(`${label} 가 기대한 마지막 줄을 내지 않았다(exit ${result.status}).\n${tail(output)}`);
  return output.match(pattern)?.[0] ?? "";
}

async function readContext(admin: LocalAdmin): Promise<WorkContext> {
  const bids = z
    .array(z.object({ id: z.uuid(), notice_id: z.string() }))
    .parse(await admin.call("GET", "/rest/v1/bid_notices?select=id,notice_id&is_demo=eq.true"));
  const bidIds = Object.fromEntries(
    BID_FIXTURES.map((fixture) => {
      const noticeId = `DEMO-2026-00${fixture.slice(3)}`;
      const found = bids.filter((bid) => bid.notice_id === noticeId);
      if (found.length !== 1)
        fail(`${fixture}(${noticeId}) 데모 공고가 한 건이 아니다(${found.length}).`);
      return [fixture, found[0].id];
    }),
  ) as WorkContext["bids"];
  const users = z
    .object({ users: z.array(z.object({ id: z.uuid(), email: z.string() })) })
    .parse(await admin.call("GET", "/auth/v1/admin/users?page=1&per_page=1000")).users;
  const accounts = Object.fromEntries(
    WORK_ROLES.map((role) => {
      const found = users.filter((user) => user.email === DEMO_ROLE_EMAIL[role]);
      if (found.length !== 1) fail(`데모 계정 ${role} 이 한 건이 아니다(${found.length}).`);
      return [role, found[0].id];
    }),
  ) as WorkContext["users"];
  const memberships = z
    .array(z.object({ user_id: z.uuid(), org_id: z.uuid(), sol_role: z.string() }))
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/memberships?select=user_id,org_id,sol_role&user_id=in.(${Object.values(accounts).join(",")})`,
      ),
    );
  const orgOf = (role: WorkRole) => {
    const rows = memberships.filter((row) => row.user_id === accounts[role]);
    if (rows.length !== 1) fail(`데모 계정 ${role} 의 조직이 하나가 아니다(${rows.length}).`);
    return rows[0];
  };
  const expectedRole: Record<WorkRole, string> = {
    sales: "SALES",
    analyst: "ANALYST",
    viewer: "VIEWER",
    outsider: "VIEWER",
  };
  for (const role of WORK_ROLES)
    if (orgOf(role).sol_role !== expectedRole[role])
      fail(`데모 계정 ${role} 의 sol_role 이 ${expectedRole[role]} 가 아니다.`);
  const org01 = orgOf("sales").org_id;
  const org02 = orgOf("outsider").org_id;
  if (org01 === org02 || orgOf("viewer").org_id !== org01 || orgOf("analyst").org_id !== org01)
    fail("데모 계정의 조직 배치가 19 §1 과 다르다.");
  return {
    bids: bidIds,
    users: accounts,
    orgs: { org01, org02 },
    preparedAt: new Date().toISOString(),
  };
}

// C7 알림(b3)이 아직 없어 sales 알림 2건을 로컬 service role 로 넣는다(C7 문구). 하나는 바깥 주소 링크다(장부 O1).
async function seedSalesNotifications(admin: LocalAdmin, context: WorkContext) {
  const now = Date.now();
  const tag = now.toString(36);
  const row = (
    n: number,
    type: string,
    bid: string,
    title: string,
    link: string,
    minutesAgo: number,
  ) => ({
    org_id: context.orgs.org01,
    user_id: context.users.sales,
    type,
    channel: "IN_APP",
    status: "SENT",
    idempotency_key: `e2e-c6-work:${tag}:${n}`,
    payload: { bidId: bid, title, message: "E2E 데모 알림", link },
    sent_at: new Date(now - minutesAgo * 60_000).toISOString(),
    created_at: new Date(now - minutesAgo * 60_000).toISOString(),
  });
  await admin.call("POST", "/rest/v1/notifications", [
    row(
      1,
      "REVIEW_ASSIGNED",
      context.bids["FX-01"],
      "결정 담당으로 지정되었습니다.",
      `/bids/${context.bids["FX-01"]}`,
      1,
    ),
    row(
      2,
      "ANALYSIS_COMPLETE",
      context.bids["FX-04"],
      "분석이 끝났습니다.",
      "https://evil.example",
      3,
    ),
  ]);
}

// 역할마다 로그인 상태를 저장한다. 데모 계정 비밀번호는 .env.local 에만 있어 쓰지 않는다.
// service role 로 magiclink 토큰을 만들고 앱의 /auth/confirm(이메일 링크 확인) 경로로 실제 세션 쿠키를 받는다. 비밀번호는 바뀌지 않는다.
async function saveStorageStates(admin: LocalAdmin, baseURL: string) {
  const browser = await chromium.launch();
  try {
    for (const role of WORK_ROLES) {
      const link = z.object({ hashed_token: z.string().min(1) }).parse(
        await admin.call("POST", "/auth/v1/admin/generate_link", {
          type: "magiclink",
          email: DEMO_ROLE_EMAIL[role],
        }),
      );
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
            `${role} 로그인 뒤 /dashboard 로 가지 않았다(지금 ${new URL(page.url()).pathname}).`,
          ),
        );
      await page.getByRole("heading", { level: 1, name: "대시보드", exact: true }).waitFor();
      await context.storageState({ path: storageOf(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// 화면마다 남긴 axe 결과를 docs/evidence/phase-3/axe-report.json 하나로 모은다.
// 이번 실행에서 돈 프로젝트의 결과는 새것으로 바꾸고, 돌지 않은 프로젝트(예: --project 로 하나만 돌림)의 지난 결과는
// 그대로 둔다. 각 결과에 찍은 시각(scannedAt)이 있어 언제 것인지 보인다.
const reportSchema = z.object({ scans: z.array(axeScanSchema) });

async function mergeAxeReport() {
  if (!existsSync(AXE_PARTS_DIR)) return;
  const fresh = readdirSync(AXE_PARTS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) =>
      axeScanSchema.parse(JSON.parse(readFileSync(path.join(AXE_PARTS_DIR, name), "utf8"))),
    );
  if (fresh.length === 0) return;
  const ran = new Set(fresh.map((scan) => scan.project));
  const previous = existsSync(AXE_REPORT_PATH)
    ? reportSchema.safeParse(JSON.parse(readFileSync(AXE_REPORT_PATH, "utf8")))
    : null;
  const kept = previous?.success
    ? previous.data.scans.filter((scan) => !ran.has(scan.project))
    : [];
  const scans = [...kept, ...fresh].sort((a, b) =>
    `${a.project}/${a.state}`.localeCompare(`${b.project}/${b.state}`),
  );
  const violations = scans.reduce((sum, scan) => sum + scan.violations.length, 0);
  const nodes = scans.reduce(
    (sum, scan) => sum + scan.violations.reduce((count, v) => count + v.nodes.length, 0),
    0,
  );
  const report = {
    schemaVersion: "sol-axe-report/v0.1",
    generatedAt: new Date().toISOString(),
    command: "pnpm -C web test:e2e:work",
    axeVersion: fresh[0].axeVersion,
    totals: { scans: scans.length, violations, nodes },
    scans,
  };
  // 저장소 Prettier 설정으로 맞춰 쓴다(루트 format:check 가 docs/evidence 도 본다).
  const options = (await resolveConfig(AXE_REPORT_PATH)) ?? {};
  mkdirSync(path.dirname(AXE_REPORT_PATH), { recursive: true });
  writeFileSync(
    AXE_REPORT_PATH,
    await format(JSON.stringify(report), { ...options, filepath: AXE_REPORT_PATH }),
  );
}

export default async function workSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) fail("baseURL 이 없다(playwright.work.config.ts).");
  const { gatewayUrl, seedEnvFile } = requireEnv();
  await requireMockGateway(gatewayUrl);
  const admin = localAdmin();

  // 자식 env: 주소·service role 은 로컬 status 값으로 덮는다(env 파일의 값보다 먼저 쓰인다). 값은 찍지 않는다.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: admin.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: admin.serviceKey,
    SOL_RUN_MODE: "mock",
  };
  const seedLine = run(
    "pnpm demo:reset",
    ["demo:reset", "--", "--env-file", seedEnvFile],
    childEnv,
    SEED_LINE,
  );
  await requireMockGateway(gatewayUrl);
  const preanalyzeLine = run(
    "pnpm demo:preanalyze",
    ["demo:preanalyze"],
    childEnv,
    PREANALYZE_LINE,
  );

  const context = await readContext(admin);
  await seedSalesNotifications(admin, context);
  mkdirSync(path.dirname(WORK_CONTEXT_PATH), { recursive: true });
  writeFileSync(
    WORK_CONTEXT_PATH,
    `${JSON.stringify({ ...context, seedLine, preanalyzeLine }, null, 2)}\n`,
  );
  await saveStorageStates(admin, baseURL);

  rmSync(AXE_PARTS_DIR, { recursive: true, force: true });
  mkdirSync(AXE_PARTS_DIR, { recursive: true });
  return () => mergeAxeReport();
}
