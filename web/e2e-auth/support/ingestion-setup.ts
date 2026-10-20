import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { Redis } from "ioredis";
import { z } from "zod";
import {
  FIRST_PAGE_SIZE,
  INGESTION_CONTEXT_PATH,
  INGESTION_ROLES,
  N8_REDIS_KEY_PATTERNS,
  N8_SUPABASE_API_URL,
  N8_SUPABASE_WORKDIR_ENV,
  OPERATOR_ROLE,
  ROLE_EMAIL,
  ROLE_SOL_ROLE,
  SEED_RUN_JOB_KEY,
  SUMMARY_KEYS,
  ingestionContextSchema,
  ingestionStorageOf,
  n8RedisTarget,
  seedRunSchema,
  type IngestionContext,
  type IngestionRole,
  type SeedRun,
} from "./ingestion-fixtures";
import { readLocalStatus } from "./local-status";

// N8 /admin/ingestion E2E(pnpm -C web test:e2e:ingestion)의 globalSetup.
// N8 전용 격리 로컬 Supabase 에 demo:reset 하나만 넣고 돈다. Compose·worker·demo:preanalyze 를 부르지 않는다
// (C6 의 work-setup.ts 는 `docker compose exec worker` 로 사전 분석을 부르고, 그 worker 는 클라우드를 가리킬 수 있다).
// 조건이 하나라도 맞지 않으면 건너뛰지 않고 이유를 적고 실패한다. 값(주소 외의 키·비밀번호)은 찍지 않는다.
//
// 실행하는 사람이 준비하는 env(웹 서버 webServer 는 이 프로세스의 env 를 그대로 받는다):
//   - N8_SUPABASE_WORKDIR        N8 격리 Supabase 의 작업 폴더(절대 경로). 주소·키는 그 폴더의
//                                `supabase status -o env --workdir` 로만 읽는다. API_URL 이 http://127.0.0.1:59731 이 아니면 멈춘다.
//                                기본 `supabase status`(공용 54321)는 읽지 않는다.
//   - NEXT_PUBLIC_SUPABASE_URL   위 status 의 API_URL(http://127.0.0.1:59731).
//   - NEXT_PUBLIC_SUPABASE_ANON_KEY  위 status 의 ANON_KEY.
//                                두 값은 빌드에도 박힌다. 같은 env 로 `pnpm -C web build` 를 먼저 돌린다(번들에 N8 주소가 없으면 멈춘다).
//   - API_CURSOR_SECRET          32자 이상(목록 커서 서명).
//   - REDIS_URL                  호스트 redis 의 0 이 아닌 DB 번호(예: redis://127.0.0.1:6379/5). 그 DB 에 이 시험 밖의
//                                연결(worker 등)이 있으면 멈춘다. 시작과 끝에 그 DB 의 N8 키(idem:ingest:*·rate:ingest:*·bull:ingest:*)만 지운다.
//   - SOL_RUN_MODE=fixture       수동 수집은 fixture 소스만 받는다(g2b 비활성).
//   - (넣지 않는다) SUPABASE_SERVICE_ROLE_KEY — 웹 서버에 필요 없다. 있고 N8 값이 아니면 멈춘다.
//   - (선택) MINIO_ENDPOINT       없으면 /health/ready 가 503 이라, 상단바의 그 응답 콘솔 문장 하나만 감시에서 빼고 시험 주석에 남긴다.
//   - (선택) DEMO_SEED_PASSWORD   demo:reset 이 데모 계정에 거는 비밀번호. 없으면 실행마다 무작위 값이다(로그인은 magiclink 로 해서
//                                비밀번호를 쓰지 않는다). env 파일은 읽지 않는다(demo:reset 에 --env-file /dev/null).
//   - (선택) E2E_PORT             기본 3210(N8 Supabase 의 site_url 이 http://localhost:3210 이다).
//
// 데이터: demo:reset 이 데모 조직·계정·공고 19건·SEED 수집 run(FX-12 격리 1건, 재시도 2회)을 처음 상태로 만든다.
// analyst 계정은 이 실행 동안만 서비스 운영자(profiles.is_admin)로 켜고(ADMIN 이 아닌 운영자), 끝에 원래 값으로 되돌린다.
// 이 시험은 ingest_runs 행을 만들지 않는다(수동 수집은 Redis 에 job 만 넣고, 소비하는 worker 가 없다).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const WEB_ROOT = path.join(__dirname, "..", "..");
const SEED_LINE =
  /^seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true$/m;

function fail(reason: string): never {
  throw new Error(`N8 수집 관리 E2E 준비 실패: ${reason}`);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "알 수 없는 오류";

const tail = (text: string, lines = 12) => text.trim().split("\n").slice(-lines).join("\n");

// ── N8 격리 Supabase ──

type N8Supabase = { apiUrl: string; anonKeys: string[]; serviceKey: string };

// readLocalStatus 의 격리 모드를 쓴다: 그 작업 폴더의 status 만 읽고, API origin 이 기대값과 다르면 던진다.
function readN8Supabase(): N8Supabase {
  const workdir = process.env[N8_SUPABASE_WORKDIR_ENV]?.trim() ?? "";
  if (workdir === "")
    fail(
      `${N8_SUPABASE_WORKDIR_ENV} 가 없다. N8 격리 Supabase 의 작업 폴더(supabase status --workdir 경로)를 준다.`,
    );
  let status: Record<string, string>;
  try {
    status = readLocalStatus({
      env: {
        SOL_RADAR_TEST_SUPABASE_WORKDIR: workdir,
        SOL_RADAR_TEST_SUPABASE_API_URL: N8_SUPABASE_API_URL,
      },
    });
  } catch (error) {
    fail(`N8 격리 Supabase status 를 읽지 못했다(${messageOf(error)}).`);
  }
  const apiUrl = URL.canParse(status.API_URL ?? "") ? new URL(status.API_URL).origin : "";
  if (apiUrl !== N8_SUPABASE_API_URL)
    fail(
      `N8 격리 Supabase 의 API_URL 이 ${N8_SUPABASE_API_URL} 이 아니다. 다른 DB 에 쓰지 않게 멈춘다.`,
    );
  const anonKeys = [status.ANON_KEY, status.PUBLISHABLE_KEY].filter(
    (key): key is string => typeof key === "string" && key !== "",
  );
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY || "";
  if (anonKeys.length === 0 || serviceKey === "")
    fail("N8 격리 Supabase status 에 anon 키나 service role 값이 없다.");
  return { apiUrl, anonKeys, serviceKey };
}

// 웹 서버(webServer)는 이 프로세스의 env 를 그대로 받는다. 그 값이 N8 을 가리키는지 먼저 본다.
function requireWebEnv(n8: N8Supabase) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!URL.canParse(url) || new URL(url).origin !== n8.apiUrl)
    fail("웹 서버 env NEXT_PUBLIC_SUPABASE_URL 이 N8 격리 Supabase 주소가 아니다.");
  if (!n8.anonKeys.includes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""))
    fail("웹 서버 env NEXT_PUBLIC_SUPABASE_ANON_KEY 가 N8 status 의 anon 키가 아니다.");
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (service !== "" && service !== n8.serviceKey)
    fail(
      "env 에 N8 이 아닌 SUPABASE_SERVICE_ROLE_KEY 가 있다. 웹 서버가 다른 DB 의 관리 키를 받지 않게 비우고 돌린다.",
    );
  if ((process.env.API_CURSOR_SECRET ?? "").trim().length < 32)
    fail("API_CURSOR_SECRET 이 없거나 32자보다 짧다(웹 서버 env, 목록 커서 서명).");
  const runMode = (process.env.SOL_RUN_MODE ?? "").trim();
  if (runMode !== "fixture")
    fail(
      `SOL_RUN_MODE 가 fixture 가 아니다(${runMode || "없음"}). 수동 수집 시험은 fixture 모드에서 돈다.`,
    );
  try {
    return n8RedisTarget(process.env.REDIS_URL);
  } catch (error) {
    fail(messageOf(error));
  }
}

// NEXT_PUBLIC_* 는 빌드 때 번들에 박힌다(브라우저 Supabase 클라이언트·세션 갱신·CSP). 박힌 주소가 N8 인지 본다.
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function requireBuild(n8: N8Supabase) {
  const nextDir = path.join(WEB_ROOT, ".next");
  if (!existsSync(path.join(nextDir, "BUILD_ID")))
    fail("빌드가 없다. 위 env 를 넣은 채로 `pnpm -C web build` 를 먼저 돌린다.");
  const files = [
    ...filesUnder(path.join(nextDir, "static")),
    ...filesUnder(path.join(nextDir, "server")),
  ];
  if (!files.some((file) => readFileSync(file, "utf8").includes(n8.apiUrl)))
    fail(
      "빌드 번들에 N8 Supabase 주소가 없다(다른 주소로 빌드됐다). 위 env 를 넣은 채로 `pnpm -C web build` 를 다시 돌린다.",
    );
}

// ── Redis(별도 DB 번호) ──

async function withRedis<T>(url: string, run: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    return await run(redis);
  } finally {
    redis.disconnect();
  }
}

const clientFieldsOf = (line: string): Record<string, string> =>
  Object.fromEntries(
    line
      .trim()
      .split(" ")
      .map((pair) => {
        const at = pair.indexOf("=");
        return at < 0 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
      }),
  );

// 이 DB 번호를 쓰는 다른 연결(예: 같은 DB 를 보는 worker)이 있으면 멈춘다. worker 가 이 시험의 job 을 소비하면
// 그 worker 의 Supabase(클라우드일 수 있다)에 ingest_runs 를 쓴다. 웹 서버는 아직 Redis 에 붙지 않았다(/health/live 만 불렀다).
async function requireNoOtherClients(redis: Redis, db: number) {
  const me = String(await redis.call("CLIENT", "ID"));
  const list = String(await redis.call("CLIENT", "LIST"));
  const others = list
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(clientFieldsOf)
    .filter((client) => client.db === String(db) && client.id !== me);
  if (others.length > 0)
    fail(
      `Redis DB ${db} 에 이 시험 밖의 연결이 ${others.length}개 있다. 그 연결이 수집 job 을 소비할 수 있어 멈춘다. 아무도 쓰지 않는 DB 번호를 준다.`,
    );
}

/** 이 DB 의 N8 키(idem:ingest:*·rate:ingest:*·bull:ingest:*)만 지운다. 지운 수를 돌려준다. */
async function deleteN8Keys(redis: Redis): Promise<number> {
  let deleted = 0;
  for (const pattern of N8_REDIS_KEY_PATTERNS) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      if (keys.length > 0) deleted += await redis.unlink(...keys);
    } while (cursor !== "0");
  }
  return deleted;
}

// ── demo:reset ──

// 주소·service role 은 N8 status 값으로만 넘긴다. env 파일은 읽지 않게 /dev/null 을 준다(셸 env 가 파일보다 먼저지만,
// 파일에 다른 값이 있어도 아예 열지 않는다). 실행 모드는 웹 서버와 같은 fixture 로 SEED run 을 남긴다.
function runDemoReset(n8: N8Supabase): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: n8.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: n8.serviceKey,
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

// ── N8 service role(이 지원 코드에서만) ──

type N8Admin = { call: (method: string, pathname: string, body?: unknown) => Promise<unknown> };

function n8Admin(n8: N8Supabase): N8Admin {
  return {
    call: async (method, pathname, body) => {
      const response = await fetch(`${n8.apiUrl}${pathname}`, {
        method,
        headers: {
          apikey: n8.serviceKey,
          Authorization: `Bearer ${n8.serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // 오류 문장에 쿼리(이메일·id)를 싣지 않는다.
      if (!response.ok)
        throw new Error(`N8 ${method} ${pathname.split("?")[0]} HTTP ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
  };
}

type PreparedData = Omit<IngestionContext, "healthReady" | "preparedAt"> & {
  operatorWasAdmin: boolean;
};

async function readPrepared(admin: N8Admin): Promise<PreparedData> {
  const users = z
    .object({ users: z.array(z.object({ id: z.uuid(), email: z.string() })) })
    .parse(await admin.call("GET", "/auth/v1/admin/users?page=1&per_page=1000")).users;
  const idOf = (role: IngestionRole): string => {
    const found = users.filter((user) => user.email.toLowerCase() === ROLE_EMAIL[role]);
    if (found.length !== 1) fail(`데모 계정 ${role} 이 한 건이 아니다(${found.length}).`);
    return found[0].id;
  };
  const ids = Object.fromEntries(INGESTION_ROLES.map((role) => [role, idOf(role)])) as Record<
    IngestionRole,
    string
  >;
  const idList = Object.values(ids).join(",");

  const memberships = z
    .array(z.object({ user_id: z.uuid(), org_id: z.uuid(), sol_role: z.string() }))
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/memberships?select=user_id,org_id,sol_role&user_id=in.(${idList})`,
      ),
    );
  const orgIds = new Set<string>();
  for (const role of INGESTION_ROLES) {
    const rows = memberships.filter((row) => row.user_id === ids[role]);
    if (rows.length !== 1) fail(`데모 계정 ${role} 의 조직이 하나가 아니다(${rows.length}).`);
    if (rows[0].sol_role !== ROLE_SOL_ROLE[role])
      fail(`데모 계정 ${role} 의 sol_role 이 ${ROLE_SOL_ROLE[role]} 가 아니다.`);
    orgIds.add(rows[0].org_id);
  }
  if (orgIds.size !== 1) fail("데모 계정 넷이 같은 조직(org-01)에 있지 않다.");

  const profiles = z
    .array(z.object({ id: z.uuid(), display_name: z.string().nullable(), is_admin: z.boolean() }))
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/profiles?select=id,display_name,is_admin&id=in.(${idList})`,
      ),
    );
  const profileOf = (role: IngestionRole) => {
    const found = profiles.find((profile) => profile.id === ids[role]);
    if (found === undefined || !found.display_name)
      fail(`데모 계정 ${role} 의 프로필 이름이 없다.`);
    return { ...found, display_name: found.display_name };
  };
  // "/admin 404" 시험의 전제: 운영자로 켤 analyst 밖의 셋은 운영자가 아니다(데모 seed 는 운영자를 만들지 않는다).
  for (const role of INGESTION_ROLES)
    if (role !== OPERATOR_ROLE && profileOf(role).is_admin)
      fail(`데모 계정 ${role} 가 이미 서비스 운영자다(is_admin). 데모 seed 기준선과 다르다.`);

  return {
    orgId: [...orgIds][0],
    users: Object.fromEntries(
      INGESTION_ROLES.map((role) => [role, { id: ids[role], name: profileOf(role).display_name }]),
    ) as IngestionContext["users"],
    seedRun: await readSeedRun(admin),
    firstPageCount: Math.min(await countRuns(admin), FIRST_PAGE_SIZE),
    operatorWasAdmin: profileOf(OPERATOR_ROLE).is_admin,
  };
}

const runRowSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  batch: z.string().nullable(),
  trigger: z.string(),
  status: z.string(),
  run_mode: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()),
});

// demo:reset 이 남긴 SEED 수집 run 과 그 오류 행(저장값 그대로).
async function readSeedRun(admin: N8Admin): Promise<SeedRun> {
  const runs = z
    .array(runRowSchema)
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/ingest_runs?select=id,source,batch,trigger,status,run_mode,started_at,finished_at,summary&job_key=eq.${encodeURIComponent(SEED_RUN_JOB_KEY)}`,
      ),
    );
  if (runs.length !== 1) fail(`demo:reset 의 SEED 수집 run 이 한 건이 아니다(${runs.length}).`);
  const [run] = runs;
  const errors = z
    .array(
      z.object({
        source_key: z.string(),
        error_code: z.string(),
        result_code: z.string().nullable(),
        redacted_detail: z.string(),
      }),
    )
    .parse(
      await admin.call(
        "GET",
        `/rest/v1/ingest_errors?select=source_key,error_code,result_code,redacted_detail&ingest_run_id=eq.${run.id}&order=created_at.asc,id.asc`,
      ),
    );
  const countOf = (key: string): number => {
    const value = run.summary[key];
    return typeof value === "number" ? value : 0;
  };
  return seedRunSchema.parse({
    id: run.id,
    source: run.source,
    batch: run.batch,
    trigger: run.trigger,
    status: run.status,
    runMode: run.run_mode,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    summary: Object.fromEntries(SUMMARY_KEYS.map((key) => [key, countOf(key)])),
    errors: errors.map((error) => ({
      sourceKey: error.source_key,
      errorCode: error.error_code,
      resultCode: error.result_code,
      detail: error.redacted_detail,
    })),
  });
}

async function countRuns(admin: N8Admin): Promise<number> {
  return z
    .array(z.object({ id: z.uuid() }))
    .parse(await admin.call("GET", "/rest/v1/ingest_runs?select=id")).length;
}

// 서비스 운영자 표시(profiles.is_admin). 화면 역할로는 못 바꾸고(protect_is_admin) 관리 키는 통과한다(db-seed.mjs 와 같다).
async function setOperator(admin: N8Admin, userId: string, value: boolean) {
  const rows = z.array(z.object({ is_admin: z.boolean() })).parse(
    await admin.call("PATCH", `/rest/v1/profiles?id=eq.${userId}&select=is_admin`, {
      is_admin: value,
    }),
  );
  if (rows.length !== 1 || rows[0].is_admin !== value)
    fail(`${OPERATOR_ROLE} 계정의 운영자 표시를 ${value} 로 바꾸지 못했다.`);
}

// 역할마다 로그인 상태를 저장한다(work-setup 과 같은 방식). 비밀번호를 쓰지 않는다:
// N8 service role 로 magiclink 토큰을 만들고 앱의 /auth/confirm 으로 실제 세션 쿠키를 받는다.
// 웹 서버가 N8 이 아닌 Supabase 를 보면 토큰 확인이 실패해 여기서 멈춘다.
async function saveStorageStates(admin: N8Admin, baseURL: string) {
  const browser = await chromium.launch();
  try {
    for (const role of INGESTION_ROLES) {
      const link = z.object({ hashed_token: z.string().min(1) }).parse(
        await admin.call("POST", "/auth/v1/admin/generate_link", {
          type: "magiclink",
          email: ROLE_EMAIL[role],
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
            `${role} 로그인 뒤 /dashboard 로 가지 않았다(지금 ${new URL(page.url()).pathname}). 웹 서버가 N8 Supabase 를 보는지 확인한다.`,
          ),
        );
      await page.getByRole("heading", { level: 1, name: "대시보드", exact: true }).waitFor();
      await context.storageState({ path: ingestionStorageOf(role) });
      await context.close();
    }
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

export default async function ingestionSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) fail("baseURL 이 없다(playwright.ingestion.config.ts).");

  // 1) 대상 확인: N8 status → 웹 서버 env → 빌드 → Redis DB. 무엇이든 쓰기 전에 본다.
  const n8 = readN8Supabase();
  const redisTarget = requireWebEnv(n8);
  requireBuild(n8);
  await withRedis(redisTarget.url, async (redis) => {
    await requireNoOtherClients(redis, redisTarget.db);
    await deleteN8Keys(redis);
  });

  // 2) N8 에 데모 seed(demo:reset 하나).
  runDemoReset(n8);

  // 3) 확인·운영자 켜기·로그인 상태.
  const admin = n8Admin(n8);
  const { operatorWasAdmin, ...prepared } = await readPrepared(admin);
  const operatorId = prepared.users[OPERATOR_ROLE].id;
  const restoreOperator = () => setOperator(admin, operatorId, operatorWasAdmin);
  await setOperator(admin, operatorId, true);
  try {
    const context = ingestionContextSchema.parse({
      ...prepared,
      healthReady: await readinessIsOk(baseURL),
      preparedAt: new Date().toISOString(),
    });
    mkdirSync(path.dirname(INGESTION_CONTEXT_PATH), { recursive: true });
    await saveStorageStates(admin, baseURL);
    writeFileSync(INGESTION_CONTEXT_PATH, `${JSON.stringify(context, null, 2)}\n`);
  } catch (error) {
    const restoreError = await restoreOperator().then(
      () => null,
      (reason: unknown) => reason,
    );
    if (restoreError !== null)
      throw new Error(
        `${messageOf(error)} / 그리고 ${OPERATOR_ROLE} 운영자 표시를 되돌리지 못했다: ${messageOf(restoreError)}`,
      );
    throw error;
  }

  // globalTeardown: 시험이 실패해도 돈다. 운영자 표시를 되돌리고 Redis 의 N8 키를 지운다.
  // 하나가 실패해도 다른 하나는 하고, 실패한 이유로 실행을 실패시킨다.
  return async () => {
    const problems: string[] = [];
    await restoreOperator().catch((error: unknown) =>
      problems.push(`운영자 표시 되돌리기: ${messageOf(error)}`),
    );
    await withRedis(redisTarget.url, deleteN8Keys).catch((error: unknown) =>
      problems.push(`Redis N8 키 지우기: ${messageOf(error)}`),
    );
    if (problems.length > 0) fail(`정리 실패 — ${problems.join(" / ")}`);
  };
}
