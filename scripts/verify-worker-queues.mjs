// Opt-in 큐 소비 검증(10-25 live 수집 계획 B1 §7b). 일회용 Redis 컨테이너 하나를 이름을 지정해 만들고 끝나면 그 이름만 지운다.
// Redis URL·.env 를 받지 않고, 외부 API·Supabase 를 부르지 않는다(fetch 를 막고 저장소·Supabase 는 가짜다).
// 실행: pnpm -C web exec node --conditions=react-server --import tsx ../scripts/verify-worker-queues.mjs
//
// 확인하는 것
// 1. ingest 전용 Worker 가 쓰는 ingest Worker(createIngestWorker)와 analysis runtime(startAnalysisRuntime)을 같은 Redis 에 함께 띄우고
//    ingest·analysis job 을 하나씩 넣으면, 각 job 이 맞는 Worker 에서 정확히 한 번 처리된다.
// 2. 재기동해도 g2b-scheduled Job Scheduler 는 하나다. --status 의 읽기 전용 판독(readIngestQueueStatus)이 BullMQ 와 같은 값을 낸다.
// 3. removeJobScheduler 뒤 Job Scheduler 가 0개다(--unschedule).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const Redis = requireWeb("ioredis");
const { Job, Queue } = requireWeb("bullmq");
const { createIngestWorker, G2B_SCHEDULER_ID } = await import("../web/worker/main.ts");
const { startAnalysisRuntime } = await import("../web/worker/analysis-runtime.ts");
const { readIngestQueueStatus } = await import("../web/worker/ingest-queue-status.ts");
const { createMemoryIngestionRepo } =
  await import("../web/server/ingestion/ingestion.repo.memory.ts");
const { createMemoryQuotaStore } = await import("../web/server/ingestion/quota-store.ts");
const { INGEST_QUEUE, INGEST_JOB_NAME } =
  await import("../web/server/ingestion/ingestion.queue.ts");
const { ANALYSIS_QUEUE, ANALYSIS_JOB } =
  await import("../web/server/analysis/analysis-job.model.ts");

assert.equal(process.argv.length, 2, "이 스크립트는 연결 인자를 받지 않는다");
assert.equal(process.env.DOCKER_HOST, undefined, "DOCKER_HOST 를 바꾼 환경은 지원하지 않는다");
let realHttpAttempts = 0;
globalThis.fetch = async () => {
  realHttpAttempts += 1;
  throw new Error("이 검증에서 실제 HTTP 는 금지다");
};

const name = `sol-radar-queuecheck-${randomUUID().slice(0, 8)}`;
// 다른 작업이 쓰는 포트·운영 Redis 포트는 쓰지 않는다.
const FORBIDDEN_PORTS = new Set([6379, 6380, 3200, 16380, 56321, 56322]);
const clients = [];
const closers = [];
let containerCreated = false;

function docker(...args) {
  console.log(`$ docker ${args.join(" ")}`);
  return execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
}

function connect(port) {
  const client = new Redis({ host: "127.0.0.1", port, maxRetriesPerRequest: null });
  client.on("error", () => undefined);
  clients.push(client);
  return client;
}

async function waitFor(label, check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`시간 초과: ${label}`);
    await pause(100);
  }
}

// Supabase 가짜: 어떤 메서드를 부르든 같은 체인을 돌려주고, await 하면 빈 결과다(분석 복구 회차가 읽는다).
function supabaseStub() {
  const chain = new Proxy(() => chain, {
    get: (_target, property) =>
      property === "then" ? (resolve) => resolve({ data: [], error: null }) : chain,
    apply: () => chain,
  });
  return chain;
}

// ingest 처리기: 실제 processIngestJob 에 메모리 저장소·빈 응답 connector·메모리 예산을 준다. startRun 의 jobKey 를 센다.
function ingestDeps(runs) {
  const repo = createMemoryIngestionRepo();
  return {
    repo: {
      ...repo,
      startRun: async (input) => {
        runs.push(input.jobKey);
        return repo.startRun(input);
      },
    },
    runMode: "live",
    quota: {
      store: createMemoryQuotaStore({ dailyLimit: 1000 }),
      serviceId: "15129394",
      dailyLimit: 1000,
    },
    scheduledExternalJobs: [],
    createFixtureConnector: async () => {
      throw new Error("fixture connector 를 만들지 않는다");
    },
    createG2bConnector: async () => ({
      source: "g2b",
      fetchPage: async () => ({
        ok: true,
        page: { records: [], nextCursor: null, rateLimitInfo: null },
      }),
    }),
    enqueueDocuments: async () => undefined,
    recordManualAudit: async () => undefined,
    now: () => new Date(),
    retry: { sleep: async () => undefined, random: () => 0 },
    secrets: [],
  };
}

try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::6379",
    "redis:7-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  containerCreated = true;
  const binding = docker("port", name, "6379/tcp").split("\n")[0];
  const port = Number(binding.split(":").at(-1));
  assert.ok(binding.startsWith("127.0.0.1:"), `loopback 에만 열려야 한다: ${binding}`);
  assert.ok(Number.isSafeInteger(port) && !FORBIDDEN_PORTS.has(port), `금지 포트: ${port}`);
  console.log(`일회용 Redis ${name} = 127.0.0.1:${port}`);

  const admin = connect(port);
  await waitFor("Redis PING", async () => (await admin.ping().catch(() => null)) === "PONG");
  const ingestQueue = new Queue(INGEST_QUEUE, { connection: admin });
  const analysisQueue = new Queue(ANALYSIS_QUEUE, { connection: admin });
  closers.push(
    () => ingestQueue.close(),
    () => analysisQueue.close(),
  );

  // 1) 두 소비자를 함께 띄운다.
  const runs = [];
  let ingest = await createIngestWorker(connect(port), ingestDeps(runs), 60);
  const analysis = startAnalysisRuntime(
    { SOL_RUN_MODE: "mock", AI_GATEWAY_URL: "http://127.0.0.1:9", REDIS_URL: "unused" },
    { connection: () => connect(port), supabase: supabaseStub },
  );
  closers.push(() => analysis.close());

  const to = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const window = { from: new Date(to.getTime() - 3_600_000).toISOString(), to: to.toISOString() };
  const onceJobKey = `g2b:ONCE:${window.from}:${window.to}`;
  await ingestQueue.add(
    INGEST_JOB_NAME,
    { source: "g2b", trigger: "SCHEDULED", jobKey: onceJobKey, window },
    { jobId: "queuecheck-ingest" },
  );
  // 검증 실패 경로(ANALYSIS_JOB_INVALID)로 처리되는 analysis job. 저장소·gateway 를 부르기 전에 끝난다.
  await analysisQueue.add(
    ANALYSIS_JOB,
    { queuecheck: true },
    { jobId: "queuecheck-analysis", attempts: 3 },
  );

  const finished = async (queue, id) => {
    const job = await Job.fromId(queue, id);
    return job?.finishedOn ? job : null;
  };
  const ingestJob = await waitFor("ingest job 처리", () =>
    finished(ingestQueue, "queuecheck-ingest"),
  );
  const analysisJob = await waitFor("analysis job 처리", () =>
    finished(analysisQueue, "queuecheck-analysis"),
  );
  await waitFor("첫 정기 회차 처리", () => runs.some((key) => key.startsWith("g2b:SCHEDULED:")));
  await pause(500);

  assert.equal(await ingestJob.getState(), "completed");
  assert.equal(ingestJob.attemptsStarted, 1);
  assert.equal(ingestJob.returnvalue?.status, "SUCCEEDED");
  assert.equal(runs.filter((key) => key === onceJobKey).length, 1);
  console.log(
    `PASS ingest job: ingest Worker 가 1회 처리(state=completed, attemptsStarted=1, run jobKey=${onceJobKey})`,
  );
  assert.equal(await analysisJob.getState(), "failed");
  assert.equal(analysisJob.attemptsStarted, 1);
  assert.equal(analysisJob.failedReason, "ANALYSIS_JOB_INVALID");
  console.log(
    "PASS analysis job: analysis runtime 이 1회 처리(state=failed, attemptsStarted=1, failedReason=ANALYSIS_JOB_INVALID, 재시도 없음)",
  );
  // ingest 처리기가 받은 것은 ingest job 뿐이다(analysis job 이 들어왔다면 jobKey 없는 data 로 거절 run 이 생긴다).
  assert.deepEqual(
    runs.filter((key) => key !== onceJobKey && !key.startsWith("g2b:SCHEDULED:")),
    [],
  );
  const ingestJobs = await ingestQueue.getJobs([
    "completed",
    "failed",
    "active",
    "wait",
    "delayed",
  ]);
  const analysisJobs = await analysisQueue.getJobs([
    "completed",
    "failed",
    "active",
    "wait",
    "delayed",
  ]);
  const processedIngest = ingestJobs.filter((job) => job.finishedOn);
  assert.ok(processedIngest.every((job) => job.attemptsStarted === 1));
  assert.deepEqual(
    analysisJobs.map((job) => job.id),
    ["queuecheck-analysis"],
  );
  console.log(
    `PASS 교차 소비 없음: ingest 큐 처리 ${processedIngest.length}건(${processedIngest
      .map((job) => job.id)
      .join(
        ", ",
      )}) 모두 attemptsStarted=1, analysis 큐 job 1건, ingest 처리기 run jobKey=${JSON.stringify(runs)}`,
  );

  // 2) 재기동: 같은 id upsert 라 Job Scheduler 는 하나다. 읽기 전용 판독이 BullMQ 와 같은 값을 낸다.
  const scheduledBefore = runs.filter((key) => key.startsWith("g2b:SCHEDULED:")).length;
  await ingest.close();
  ingest = await createIngestWorker(connect(port), ingestDeps(runs), 60);
  closers.push(() => ingest.close());
  await pause(1_500);
  const schedulers = await ingestQueue.getJobSchedulers();
  assert.deepEqual(
    schedulers.map(({ key, every }) => ({ key, every })),
    [{ key: G2B_SCHEDULER_ID, every: 3_600_000 }],
  );
  const status = await readIngestQueueStatus(admin);
  assert.deepEqual(
    status.schedulers.map(({ id, every }) => ({ id, every })),
    [{ id: G2B_SCHEDULER_ID, every: 3_600_000 }],
  );
  assert.equal(status.schedulers[0].next, new Date(schedulers[0].next).toISOString());
  const bullCounts = await ingestQueue.getJobCounts(...Object.keys(status.counts));
  assert.deepEqual(status.counts, bullCounts);
  const scheduledAfter = runs.filter((key) => key.startsWith("g2b:SCHEDULED:")).length;
  console.log(
    `PASS 재기동: Job Scheduler 1개(${G2B_SCHEDULER_ID}, every=3600000, next=${status.schedulers[0].next}), 재기동 직후 추가 정기 회차 ${scheduledAfter - scheduledBefore}건`,
  );
  console.log(
    `PASS --status 판독 = BullMQ getJobCounts·getJobSchedulers: ${JSON.stringify(status.counts)}`,
  );

  // 3) --unschedule 과 같은 호출.
  await ingestQueue.removeJobScheduler(G2B_SCHEDULER_ID);
  assert.deepEqual((await readIngestQueueStatus(admin)).schedulers, []);
  console.log("PASS removeJobScheduler 뒤 Job Scheduler 0개");

  assert.equal(realHttpAttempts, 0);
  console.log("PASS 외부 HTTP 시도 0건, Supabase 는 가짜, Redis 는 일회용 컨테이너만 사용");
  console.log("ALL WORKER QUEUE CHECKS PASSED");
} finally {
  for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined);
  for (const client of clients) client.disconnect();
  if (containerCreated) docker("rm", "--force", name);
  console.log(`CLEANUP: ${name} 컨테이너 삭제`);
}
