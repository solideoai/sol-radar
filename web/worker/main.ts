import path from "node:path";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  DOCUMENTS_QUEUE,
  INGEST_JOB_NAME,
  INGEST_QUEUE,
  callableSource,
  createFixtureConnector,
  createOfficialApiConnector,
  createSupabaseIngestAudit,
  createSupabaseIngestionRepo,
  enqueueDocuments,
  loadFixtureManifest,
  loadSourceRegistry,
  type JobQueue,
} from "@/server/ingestion";
import { getSupabaseAdmin } from "@/server/supabase";
import { readG2bServiceKey, readWorkerEnv, type WorkerEnv } from "@/worker/env";
import { removeHeartbeatFile, startHeartbeat } from "@/worker/heartbeat";
import {
  processIngestJob,
  readIngestIntervalMinutes,
  readRunMode,
  type IngestJobDeps,
  type RunMode,
} from "@/worker/ingest-queue";
import { checkReadiness, createReadinessProbes } from "@/worker/readiness";
import { SYSTEM_QUEUE, processSystemJob } from "@/worker/system-queue";

type Env = Record<string, string | undefined>;
type Closable = { close(): Promise<void> };

export type WorkerDeps = {
  checkReadiness: (env: WorkerEnv) => Promise<void>;
  // 두 번째 인자는 기동에 받은 env 전체다. 실행 모드·수집 간격·fixture·registry 경로를 읽는다.
  createWorker: (env: WorkerEnv, rawEnv: Env) => Closable | Promise<Closable>;
  startHeartbeat: (file: string) => { stop(): void };
};

// 오류 코드(ECONNREFUSED·NOAUTH 등)는 비밀이 아니라 로그에 남겨도 된다. message 는 접속 문자열을 담을 수 있어 쓰지 않는다.
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(error.code)
    ? error.code
    : null;
}

// 준비 확인 오류는 실패한 쪽 이름만 싣는다. 원인을 가리는 코드만 덧붙인다.
async function checkReadinessWithCodes(env: WorkerEnv): Promise<void> {
  const probes = createReadinessProbes(env);
  const codes: string[] = [];
  const track = (side: string, probe: () => Promise<unknown>) => async () => {
    try {
      return await probe();
    } catch (error) {
      const code = errorCode(error);
      if (code) codes.push(`${side}: ${code}`);
      throw error;
    }
  };
  try {
    await checkReadiness({
      pingRedis: track("redis", probes.pingRedis),
      pingSupabase: track("supabase", probes.pingSupabase),
    });
  } catch (error) {
    if (error instanceof Error && codes.length > 0) {
      throw new Error(`${error.message} (${codes.join(", ")})`);
    }
    throw error;
  }
}

// 오류 이름과 코드만 남긴다. message·job data 는 접속 문자열·요청자 id 를 담을 수 있다.
type ErrorEmitter = { on(event: "error", listener: (error: Error) => void): unknown };

function logErrors(target: ErrorEmitter, label: string): void {
  target.on("error", (error) => {
    const code = errorCode(error);
    console.error(code ? `${label} 오류: ${error.name} ${code}` : `${label} 오류: ${error.name}`);
  });
}

export const G2B_SCHEDULER_ID = "g2b-scheduled";

/** live 모드의 g2b 일정 실행(6-4). 같은 id 로 다시 부르면 간격만 바뀐다(upsert). 반복 job 의 data 는 고정이다. */
export async function scheduleG2bIngest(
  queue: Pick<Queue, "upsertJobScheduler">,
  intervalMinutes: number,
): Promise<void> {
  await queue.upsertJobScheduler(
    G2B_SCHEDULER_ID,
    { every: intervalMinutes * 60_000 },
    {
      name: INGEST_JOB_NAME,
      data: { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" },
    },
  );
}

/** ingest 큐 Worker(6-4). 저장소·connector·documents 큐·감사 기록은 deps 로 받는다. */
export async function createIngestWorker(
  connection: IORedis,
  deps: IngestJobDeps,
  intervalMinutes: number,
): Promise<{ close(): Promise<void> }> {
  const worker = new Worker(INGEST_QUEUE, (job) => processIngestJob(job.data, deps), {
    connection,
  });
  logErrors(worker, "ingest worker");
  const queue = new Queue(INGEST_QUEUE, { connection });
  logErrors(queue, "ingest queue");
  if (deps.runMode === "live") await scheduleG2bIngest(queue, intervalMinutes);
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

// ── ingest 연결(6-6). 규칙은 ingest-queue.ts, 여기는 env·Supabase·registry·서비스키를 잇기만 한다 ──
const G2B_BID_NOTICE_SOURCE = "g2b-bid-notice";

// worker 이미지(web/ 컨텍스트)에는 fixtures·infra/sources 가 없다. Compose 가 볼륨과 env 로 경로를 준다.
const fixturesDirOf = (env: Env): string =>
  env.FIXTURES_DIR?.trim() || path.resolve(process.cwd(), "../fixtures");
const registryFileOf = (env: Env): string =>
  env.SOURCES_REGISTRY_FILE?.trim() ||
  path.resolve(process.cwd(), "../infra/sources/registry.yaml");

type G2bSource = { endpoint: string; serviceKey: string };
type IngestConfig = {
  runMode: RunMode;
  intervalMinutes: number;
  fixturesDir: string;
  g2b: G2bSource | null;
};

// live 모드는 기동 때 registry 와 서비스키를 확인한다. 부를 수 없는 소스면 연결을 만들기 전에 멈춘다(사유만 싣는다).
async function resolveG2bSource(env: Env): Promise<G2bSource> {
  const callable = callableSource(
    await loadSourceRegistry(registryFileOf(env)),
    G2B_BID_NOTICE_SOURCE,
  );
  if (!callable.ok) {
    throw new Error(`수집 소스 ${G2B_BID_NOTICE_SOURCE} 를 부를 수 없다: ${callable.reason}`);
  }
  return {
    endpoint: callable.source.baseUrl,
    serviceKey: readG2bServiceKey(env, callable.source.serviceKeyEnv),
  };
}

async function readIngestConfig(env: Env): Promise<IngestConfig> {
  const runMode = readRunMode(env);
  return {
    runMode,
    intervalMinutes: readIngestIntervalMinutes(env),
    fixturesDir: fixturesDirOf(env),
    g2b: runMode === "live" ? await resolveG2bSource(env) : null,
  };
}

function ingestJobDepsOf(config: IngestConfig, documentsQueue: JobQueue): IngestJobDeps {
  const admin = getSupabaseAdmin();
  const { g2b, fixturesDir } = config;
  return {
    repo: createSupabaseIngestionRepo(admin),
    runMode: config.runMode,
    createFixtureConnector: async (batch) =>
      createFixtureConnector({
        fixturesDir,
        batch,
        manifest: await loadFixtureManifest(fixturesDir),
      }),
    createG2bConnector: async () => {
      // live 가 아닌 모드는 g2b 수집을 RUN_MODE_MISMATCH 로 거절해 여기까지 오지 않는다.
      if (g2b === null) throw new Error("g2b connector 는 live 모드에서만 만든다");
      return createOfficialApiConnector({
        endpoint: g2b.endpoint,
        serviceKey: g2b.serviceKey,
        fetch: (url, init) => globalThis.fetch(url, init),
      });
    },
    enqueueDocuments: (data) => enqueueDocuments(documentsQueue, data),
    recordManualAudit: createSupabaseIngestAudit(admin),
    now: () => new Date(),
    retry: {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
    },
    secrets: g2b === null ? [] : [g2b.serviceKey],
  };
}

export const defaultWorkerDeps: WorkerDeps = {
  checkReadiness: checkReadinessWithCodes,
  createWorker: async (env, rawEnv) => {
    // env·registry·서비스키를 먼저 읽는다. 틀렸으면 Redis 연결을 만들기 전에 기동을 멈춘다.
    const config = await readIngestConfig(rawEnv);
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
    const systemWorker = new Worker(SYSTEM_QUEUE, processSystemJob, { connection });
    logErrors(systemWorker, "worker");
    const documentsQueue = new Queue(DOCUMENTS_QUEUE, { connection });
    logErrors(documentsQueue, "documents queue");
    const ingest = await createIngestWorker(
      connection,
      ingestJobDepsOf(config, documentsQueue),
      config.intervalMinutes,
    );
    return {
      async close() {
        await ingest.close();
        await systemWorker.close();
        await documentsQueue.close();
        connection.disconnect();
      },
    };
  },
  startHeartbeat: (file) => startHeartbeat(file),
};

export async function startWorker(
  env: Record<string, string | undefined> = process.env,
  deps: WorkerDeps = defaultWorkerDeps,
): Promise<{ close(): Promise<void> }> {
  const workerEnv = readWorkerEnv(env);
  // 준비 확인보다 먼저 지워, 기동에 실패한 worker 가 이전 heartbeat 로 건강해 보이지 않게 한다.
  removeHeartbeatFile(workerEnv.heartbeatFile);
  await deps.checkReadiness(workerEnv);
  const worker = await deps.createWorker(workerEnv, env);
  const heartbeat = deps.startHeartbeat(workerEnv.heartbeatFile);
  return {
    async close() {
      heartbeat.stop();
      await worker.close();
    },
  };
}

async function run(): Promise<void> {
  if (process.argv.includes("--check")) {
    console.log("worker modules loaded");
    return;
  }
  try {
    const handle = await startWorker();
    console.log("worker started");
    const shutdown = () => {
      handle.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (error) {
    // 메시지는 키 이름·구성요소 이름만 담는다(readWorkerEnv·checkReadiness).
    console.error(error instanceof Error ? error.message : "worker 기동 실패");
    process.exit(1);
  }
}

// 테스트가 불러올 때는 자동 기동하지 않는다.
if (/[\\/]worker[\\/]main\.ts$/.test(process.argv[1] ?? "")) {
  void run();
}
