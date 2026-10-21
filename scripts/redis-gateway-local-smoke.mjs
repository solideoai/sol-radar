// 로컬 전용: Docker/운영 DB 없이 임시 Redis·가짜 HTTP 의존성·빌드한 Next를 검사한다.
// 실행: pnpm -C web exec node --conditions=react-server --import tsx ../scripts/redis-gateway-local-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdtemp, rm, access, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const Redis = requireWeb("ioredis");
const { Queue, Worker } = requireWeb("bullmq");
const { createAnalysisRateLimiter } = await import(
  new URL("../web/app/_lib/rate-limit.ts", import.meta.url)
);
const { createIdempotencyStore } = await import(
  new URL("../web/app/_lib/idempotency-store.ts", import.meta.url)
);
const { createAnalysisQueue, createQueueCache } = await import(
  new URL("../web/app/_lib/analysis-queue.ts", import.meta.url)
);
const { sharedRedis } = await import(new URL("../web/app/_lib/redis-client.ts", import.meta.url));
const { createRedisQuotaStore } = await import(
  new URL("../web/worker/quota-store.ts", import.meta.url)
);
const { analysisJobDataSchema, ANALYSIS_QUEUE } = await import(
  new URL("../web/server/analysis/index.ts", import.meta.url)
);
const { quotaState } = await import(new URL("../web/server/ingestion/index.ts", import.meta.url));
const webDir = fileURLToPath(new URL("../web/", import.meta.url));
const standaloneDir = join(webDir, ".next/standalone/web");
await access(join(standaloneDir, "server.js"));
// Dockerfile과 같은 실제 정적 파일 배치. 존재하는 asset도 Proxy가 막는지 본다.
await cp(join(webDir, ".next/static"), join(standaloneDir, ".next/static"), { recursive: true });
const chunk = (await readdir(join(webDir, ".next/static/chunks"))).find((name) =>
  name.endsWith(".js"),
);
assert.ok(chunk);
const assetPath = `/_next/static/chunks/${chunk}`;
const folder = await mkdtemp(join(tmpdir(), "sol-redis-gateway-"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

const redisPort = await freePort();
const redisUrl = `redis://127.0.0.1:${redisPort}`;
let redisProcess;
let nextProcess;
let worker;
let queue;
let consumer;
let redis;
let dependencies;
let nextFailure = false;
try {
  redisProcess = spawn(
    "redis-server",
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(redisPort),
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      folder,
    ],
    { stdio: "ignore", env: { PATH: process.env.PATH } },
  );
  redisProcess.on("error", () => {
    nextFailure = true;
  });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 1000 });
  redis.on("error", () => undefined);
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await redis.ping();
      break;
    } catch {
      await pause(50);
    }
  }
  assert.equal(await redis.ping(), "PONG");
  const orgId = randomUUID();
  const now = Date.now();
  const limiter = createAnalysisRateLimiter({ redisUrl, now: () => now });
  const analysisHits = await Promise.all(Array.from({ length: 40 }, () => limiter.hit(orgId)));
  assert.equal(analysisHits.filter((hit) => hit.allowed).length, 30);
  const ingestLimiter = createAnalysisRateLimiter({
    redisUrl,
    keyPrefix: "ingest",
    limitPerMinute: 5,
    now: () => now,
  });
  const ingestHits = await Promise.all(Array.from({ length: 10 }, () => ingestLimiter.hit(orgId)));
  assert.equal(ingestHits.filter((hit) => hit.allowed).length, 5);

  const key = `idem:ingest:${orgId}:${randomUUID()}`;
  const record = {
    requestHash: "local-smoke",
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    requesterId: randomUUID(),
  };
  const idempotency = createIdempotencyStore({ redisUrl });
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => idempotency.claim(key, record, 86400)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.deepEqual(await idempotency.get(key), record);
  assert.ok((await redis.ttl(key)) > 86300);

  const quota = createRedisQuotaStore(redis, { dailyLimit: 100 });
  await Promise.all(Array.from({ length: 20 }, () => quota.add("local-smoke", new Date(now), 1)));
  assert.equal(await quota.get("local-smoke", new Date(now)), 20);
  await quota.markExhausted("local-smoke", new Date(now));
  assert.equal(quotaState(await quota.get("local-smoke", new Date(now)), 100), "EXHAUSTED");

  consumer = new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker(ANALYSIS_QUEUE, async (job) => analysisJobDataSchema.parse(job.data), {
    connection: consumer,
  });
  worker.on("error", () => {
    nextFailure = true;
  });
  await worker.waitUntilReady();
  const data = { orgId, scoreRunId: randomUUID(), idempotencyKey: `${orgId}:${randomUUID()}` };
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LOCAL_QUEUE_TIMEOUT")), 5000);
    worker.once("completed", (_job, value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  queue = new Queue(ANALYSIS_QUEUE, { connection: redis });
  const queueCache = createQueueCache(() => queue);
  await createAnalysisQueue({ redisUrl, queueCache }).enqueue(data);
  assert.deepEqual(await received, data);

  dependencies = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(request.url === "/health" ? JSON.stringify({ provider: "mock" }) : "{}");
  });
  await new Promise((resolve) => dependencies.listen(0, "127.0.0.1", resolve));
  const dependencyUrl = `http://127.0.0.1:${dependencies.address().port}`;
  const gatewayPort = await freePort();
  const token = "local-smoke-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    SOL_DEPLOYMENT_ROLE: "redis-api",
    HOSTNAME: "127.0.0.1",
    PORT: String(gatewayPort),
    REDIS_URL: redisUrl,
    REDIS_API_TOKEN: token,
    REDIS_API_TOKEN_PREVIOUS: "",
    NEXT_PUBLIC_SUPABASE_URL: dependencyUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-smoke-anon",
    SUPABASE_SERVICE_ROLE_KEY: "",
    AI_GATEWAY_URL: dependencyUrl,
    SOL_RUN_MODE: "mock",
  };
  nextProcess = spawn(process.execPath, ["server.js"], {
    cwd: standaloneDir,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  nextProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  nextProcess.on("error", () => {
    nextFailure = true;
  });
  const base = `http://127.0.0.1:${gatewayPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (nextProcess.exitCode !== null || nextFailure) throw new Error("LOCAL_NEXT_START_FAILED");
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).status === 401) {
        ready = true;
        break;
      }
    } catch {
      /* 로컬 서버가 기동 중이면 다시 확인한다. */
    }
    await pause(100);
  }
  assert.equal(ready, true);
  const headers = { "X-Sol-Service-Token": token };
  const dependencyReport = JSON.stringify({
    checkedAt: Date.now(),
    scope: {
      runMode: "mock",
      supabaseUrl: dependencyUrl,
      rawBucket: "bid-documents",
      parsedBucket: "bid-parsed",
    },
    storage: "ok",
    ai: "mock",
  });
  await redis.set("sol-radar:dependency-health", dependencyReport, "PX", 120000);
  const health = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).checks, {
    db: "ok",
    redis: "ok",
    storage: "ok",
    ai: "mock",
  });
  const deniedPaths = [
    "/",
    "/api/v1/bids",
    "/api/v1/team-members",
    "/api/people",
    "/_next/static/nonexistent.js",
    "/health/live",
    "/redis/health",
    assetPath,
    `/_next/image?url=${encodeURIComponent("/icon.svg")}&w=64&q=75`,
  ];
  for (const path of deniedPaths) {
    assert.equal(
      (await fetch(`${base}${path}`, { headers, redirect: "manual" })).status,
      404,
      path,
    );
  }
  const redirects = [];
  for (const path of ["/account", "/favicon.ico", "/health/", "//health"]) {
    const response = await fetch(`${base}${path}`, { headers, redirect: "manual" });
    assert.equal(response.status, 308, path);
    const destination = new URL(response.headers.get("Location"), base);
    assert.equal(destination.origin, base);
    const followed = await fetch(destination, { headers, redirect: "manual" });
    assert.equal(followed.status, destination.pathname === "/health" ? 200 : 404, path);
    redirects.push({ path, status: response.status, destinationStatus: followed.status });
  }
  assert.equal(
    (await fetch(`${base}/health`, { headers: { "X-Sol-Service-Token": "invalid" } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/api/v1/admin/ingestion/runs`, { method: "POST", headers, body: "{}" }))
      .status,
    401,
  );
  assert.equal(
    (
      await fetch(`${base}/dashboard`, {
        method: "POST",
        headers: { ...headers, "Next-Action": "test-only" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/v1/bids/${randomUUID()}/analyses`, {
        method: "POST",
        headers: {
          ...headers,
          Authorization: "Bearer invalid.jwt.test",
          "Next-Action": "test-only",
        },
        body: "{}",
      })
    ).status,
    401,
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      scope: "local-only",
      redisPort,
      gatewayPort,
      bind: "127.0.0.1",
      analysisAllowed: 30,
      ingestAllowed: 5,
      idempotencyWinners: 1,
      quota: "EXHAUSTED",
      queueRoundTrip: "PASS",
      httpHealth: 200,
      unauthenticated: 401,
      deniedPaths: deniedPaths.length + 1,
      configurationRedirects: redirects,
      nextActionAuthorization: 401,
      dockerOrCloudChanges: false,
    }),
  );
} finally {
  await stop(nextProcess);
  if (dependencies) await new Promise((resolve) => dependencies.close(resolve));
  if (worker) await worker.close();
  if (queue) await queue.close();
  consumer?.disconnect();
  sharedRedis(redisUrl).disconnect();
  redis?.disconnect();
  await stop(redisProcess);
  await rm(folder, { recursive: true, force: true });
}
