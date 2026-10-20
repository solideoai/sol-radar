import path from "node:path";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { readGatewayConfig, readRunMode as readAnalysisRunMode } from "@/server/analysis";
import {
  DOCUMENTS_QUEUE,
  G2B_AUX_OPERATIONS,
  G2B_BID_NOTICE_SERVICE_ID,
  INGEST_JOB_NAME,
  INGEST_QUEUE,
  callableSource,
  createFixtureConnector,
  createG2bAuxFetcher,
  createOfficialApiConnector,
  createPendingDocumentFinder,
  createSupabaseIngestAudit,
  createSupabaseIngestionRepo,
  dailyQuotaOf,
  enqueueDocuments,
  loadFixtureManifest,
  loadSourceRegistry,
  type IngestQuota,
  type JobQueue,
} from "@/server/ingestion";
import { createNotificationOutboxStore } from "@/server/notifications";
import { getSupabaseAdmin } from "@/server/supabase";
import { readReconcileSettings } from "@/worker/analysis-reconcile";
import { startAnalysisRuntime } from "@/worker/analysis-runtime";
import { readG2bServiceKey, readWorkerEnv, type WorkerEnv } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { startDocumentsReconciler } from "@/worker/documents-reconcile";
import { removeHeartbeatFile, startHeartbeat } from "@/worker/heartbeat";
import { readNotifySettings, startNotifier } from "@/worker/notify-outbox";
import {
  processIngestJob,
  readIngestIntervalMinutes,
  readRunMode,
  type IngestJobDeps,
  type RunMode,
} from "@/worker/ingest-queue";
import { createRedisQuotaStore } from "@/worker/quota-store";
import { checkReadiness, createReadinessProbes } from "@/worker/readiness";
import { SYSTEM_QUEUE, processSystemJob } from "@/worker/system-queue";

type Env = Record<string, string | undefined>;

export type Closable = { close(): Promise<void> };
/** 2단계: 받은 Redis 연결로 Worker·Queue 를 만든다 */
export type StartWorkers = (connection: IORedis) => Promise<Closable>;
/** 1단계(Redis 전): env·설정을 읽고 검증한다. 틀리면 던진다. 2단계 시작 함수를 돌려준다 */
export type WorkerRegistration = (rawEnv: Env) => Promise<StartWorkers>;

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
    // 이름도 공용 규칙으로 거른다. 개행·값이 섞인 이름이 로그 줄을 깨거나 값을 싣지 않게 한다.
    const name = errorNameOf(error);
    const code = errorCode(error);
    console.error(code ? `${label} 오류: ${name} ${code}` : `${label} 오류: ${name}`);
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

/**
 * 8-1: live 면 g2b 반복 일정을 걸고, 아니면 지운다(없어도 오류 아님). Redis 가 appendonly·named volume 이라 live 때 건
 * 일정이 남으면 fixture 대체 중에도 30분마다 RUN_MODE_MISMATCH 로 실패한 run 이 쌓인다.
 */
export async function syncG2bSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  runMode: RunMode,
  intervalMinutes: number,
): Promise<void> {
  if (runMode === "live") await scheduleG2bIngest(queue, intervalMinutes);
  else await queue.removeJobScheduler(G2B_SCHEDULER_ID);
}

// 시작이 실패했을 때 이미 만든 것을 닫는다. 원인 오류를 가리지 않으려고 닫는 중의 오류는 버린다.
const closeQuietly = async (closables: readonly Closable[]): Promise<void> => {
  for (const closable of [...closables].reverse()) {
    await closable.close().catch(() => undefined);
  }
};

/**
 * 거꾸로 모두 닫는다. 하나가 던져도 나머지를 닫고, 끝에 닫는 순서로 처음 던진 오류를 던진다.
 * 한 등록의 close 실패로 뒤 등록(Redis 연결·Worker)이 열린 채 남지 않게 한다.
 */
async function closeAll(closables: readonly Closable[]): Promise<void> {
  const failures: unknown[] = [];
  for (const closable of [...closables].reverse()) {
    try {
      await closable.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/** ingest 큐 Worker(6-4). 저장소·connector·documents 큐·감사 기록은 deps 로 받는다. */
export async function createIngestWorker(
  connection: IORedis,
  deps: IngestJobDeps,
  intervalMinutes: number,
): Promise<Closable> {
  const worker = new Worker(INGEST_QUEUE, (job) => processIngestJob(job.data, deps), {
    connection,
  });
  logErrors(worker, "ingest worker");
  const queue = new Queue(INGEST_QUEUE, { connection });
  logErrors(queue, "ingest queue");
  try {
    await syncG2bSchedule(queue, deps.runMode, intervalMinutes);
  } catch (error) {
    await closeQuietly([{ close: () => worker.close() }, { close: () => queue.close() }]);
    throw error;
  }
  // closeAll 은 거꾸로 닫는다: worker → queue. worker 가 던져도 queue 를 닫고 처음 오류를 던진다.
  return {
    close: () => closeAll([{ close: () => queue.close() }, { close: () => worker.close() }]),
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

/** dailyLimit 은 registry quota.daily(07 §2.2 호출 예산). 없으면 기동을 멈춘다 */
type G2bSource = { endpoint: string; serviceKey: string; dailyLimit: number };
type IngestConfig = {
  runMode: RunMode;
  intervalMinutes: number;
  fixturesDir: string;
  g2b: G2bSource | null;
};

// live 모드는 기동 때 registry 와 서비스키를 확인한다. 부를 수 없는 소스면 연결을 만들기 전에 멈춘다(사유만 싣는다).
// 보조 조회 3종(07 §2.2)도 registry 항목이 있어야 한다. 같은 서비스(15129394)라 기본 URL·서비스키 env 가 목록과 같아야 한다.
async function resolveG2bSource(env: Env): Promise<G2bSource> {
  const registry = await loadSourceRegistry(registryFileOf(env));
  const callable = callableSource(registry, G2B_BID_NOTICE_SOURCE);
  if (!callable.ok) {
    throw new Error(`수집 소스 ${G2B_BID_NOTICE_SOURCE} 를 부를 수 없다: ${callable.reason}`);
  }
  for (const { registryKey, operation } of G2B_AUX_OPERATIONS) {
    const aux = callableSource(registry, registryKey);
    if (!aux.ok) throw new Error(`수집 소스 ${registryKey} 를 부를 수 없다: ${aux.reason}`);
    const isSameService =
      aux.source.baseUrl === callable.source.baseUrl &&
      aux.source.serviceKeyEnv === callable.source.serviceKeyEnv &&
      aux.source.operations.includes(operation);
    if (!isSameService) {
      throw new Error(
        `수집 소스 ${registryKey} 는 ${G2B_BID_NOTICE_SOURCE} 와 같은 서비스여야 한다`,
      );
    }
  }
  const dailyLimit = dailyQuotaOf(registry, G2B_BID_NOTICE_SOURCE);
  if (dailyLimit === null) {
    throw new Error(`수집 소스 ${G2B_BID_NOTICE_SOURCE} 의 quota.daily 가 registry 에 없다`);
  }
  return {
    endpoint: callable.source.baseUrl,
    serviceKey: readG2bServiceKey(env, callable.source.serviceKeyEnv),
    dailyLimit,
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

function ingestJobDepsOf(
  config: IngestConfig,
  documentsQueue: JobQueue,
  quota: IngestQuota | null,
): IngestJobDeps {
  const admin = getSupabaseAdmin();
  const { g2b, fixturesDir } = config;
  const retry = {
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  };
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
    // 보조 조회 3종(07 §2.2). 목록과 같은 서비스·서비스키·재시도 규칙이다.
    createG2bAuxFetcher: async () => {
      if (g2b === null) throw new Error("g2b 보조 조회는 live 모드에서만 만든다");
      return createG2bAuxFetcher({
        endpoint: g2b.endpoint,
        serviceKey: g2b.serviceKey,
        fetch: (url, init) => globalThis.fetch(url, init),
        retry,
      });
    },
    enqueueDocuments: (data) => enqueueDocuments(documentsQueue, data),
    recordManualAudit: createSupabaseIngestAudit(admin),
    now: () => new Date(),
    retry,
    secrets: g2b === null ? [] : [g2b.serviceKey],
    ...(quota === null ? {} : { quota }),
  };
}

// 호출 예산 카운터(07 §2.2)는 live 에서만 만든다. 공유 연결을 duplicate 해 BullMQ 의 blocking 명령 뒤에 줄 서지 않게 한다.
function createIngestQuota(
  connection: IORedis,
  g2b: G2bSource,
): { quota: IngestQuota; close: Closable } {
  const quotaConnection = connection.duplicate();
  return {
    quota: {
      store: createRedisQuotaStore(quotaConnection, { dailyLimit: g2b.dailyLimit }),
      serviceId: G2B_BID_NOTICE_SERVICE_ID,
      dailyLimit: g2b.dailyLimit,
    },
    close: {
      close: async () => {
        quotaConnection.disconnect();
      },
    },
  };
}

// ── worker 등록(8-4). 새 worker(분석 등)는 등록 함수 하나를 WORKER_REGISTRATIONS 에 더해 붙인다 ──

export const systemWorkerRegistration: WorkerRegistration = async () => async (connection) => {
  const worker = new Worker(SYSTEM_QUEUE, processSystemJob, { connection });
  logErrors(worker, "worker");
  return { close: () => worker.close() };
};

// 1단계에서 실행 모드·간격·registry·서비스키를 읽는다. 틀리면 Redis 연결을 만들기 전에 기동을 멈춘다.
export const ingestWorkerRegistration: WorkerRegistration = async (rawEnv) => {
  const config = await readIngestConfig(rawEnv);
  return async (connection) => {
    const quotaParts = config.g2b === null ? null : createIngestQuota(connection, config.g2b);
    const closeQuota: Closable = quotaParts?.close ?? { close: async () => undefined };
    const documentsQueue = new Queue(DOCUMENTS_QUEUE, { connection });
    logErrors(documentsQueue, "documents queue");
    const closeDocuments: Closable = { close: () => documentsQueue.close() };
    try {
      const ingest = await createIngestWorker(
        connection,
        ingestJobDepsOf(config, documentsQueue, quotaParts?.quota ?? null),
        config.intervalMinutes,
      );
      const documents = startDocumentsReconciler({
        finder: createPendingDocumentFinder(getSupabaseAdmin()),
        queue: documentsQueue,
        // C6': mock·fixture 는 데모 공고만, live 는 실제 공고만 복구한다
        isDemo: config.runMode !== "live",
        log: (line) => {
          console.log(line);
        },
      });
      // closeAll은 거꾸로 모두 닫는다: 복구 회차 → ingest(Worker·큐) → documents 큐 → 예산 카운터 연결.
      return {
        close: () =>
          closeAll([closeQuota, closeDocuments, ingest, { close: () => documents.stop() }]),
      };
    } catch (error) {
      await closeQuietly([closeQuota, closeDocuments]);
      throw error;
    }
  };
};

// 1단계에서 복구 주기·gateway·실행 모드를 읽는다(오류는 키 이름만 싣는다). 틀리면 Redis 연결을 만들기 전에 기동을 멈춘다.
// 2단계의 runtime 은 공유 연결을 duplicate 한 자기 연결을 쓰고 close 때 그것만 끊는다. 공유 연결은 기본 createWorker 가 끊는다.
export const analysisWorkerRegistration: WorkerRegistration = async (rawEnv) => {
  readReconcileSettings(rawEnv);
  readGatewayConfig(rawEnv);
  readAnalysisRunMode(rawEnv);
  return async (connection) =>
    startAnalysisRuntime(rawEnv, { connection: () => connection.duplicate() });
};

// 인앱 알림 outbox 주기 처리(C7, docs/13-NOTIFICATIONS.md). 1단계에서 폴링 간격을 읽는다(틀리면 Redis 연결 전에 멈춘다).
// 2단계는 service role 저장으로 주기 처리를 시작한다. 큐가 아니라 outbox_events 표를 읽으므로 공유 Redis 연결은
// 쓰지도 끊지도 않는다(공유 연결은 기본 createWorker 가 끊는다). close 는 타이머를 멈추고 진행 중 회차를 최대 5초 기다린다.
export const notifyWorkerRegistration: WorkerRegistration = async (rawEnv) => {
  const settings = readNotifySettings(rawEnv);
  return async () => {
    const notifier = startNotifier({
      store: createNotificationOutboxStore(getSupabaseAdmin()),
      now: () => new Date(),
      log: (line) => {
        console.log(line);
      },
      settings,
    });
    return { close: () => notifier.stop() };
  };
};

export const WORKER_REGISTRATIONS: readonly WorkerRegistration[] = [
  systemWorkerRegistration,
  ingestWorkerRegistration,
  analysisWorkerRegistration,
  notifyWorkerRegistration,
];

/**
 * 등록 순서대로 시작한다. 하나가 던지면 이미 시작한 것을 거꾸로 닫고(닫는 중 오류는 버린다) 시작 오류를 다시 던진다.
 * 돌려준 close 도 거꾸로 닫는다. 한 등록의 close 가 던져도 나머지를 모두 닫고 처음 던진 오류를 던진다.
 */
export async function startRegistered(
  connection: IORedis,
  starts: readonly StartWorkers[],
): Promise<Closable> {
  const started: Closable[] = [];
  for (const start of starts) {
    try {
      started.push(await start(connection));
    } catch (error) {
      await closeQuietly(started);
      throw error;
    }
  }
  return { close: () => closeAll(started) };
}

export const defaultWorkerDeps: WorkerDeps = {
  checkReadiness: checkReadinessWithCodes,
  createWorker: async (env, rawEnv) => {
    // 1단계: 모든 등록의 설정 검증이 통과해야 Redis 에 연결한다.
    const starts = await Promise.all(WORKER_REGISTRATIONS.map((register) => register(rawEnv)));
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
    try {
      const workers = await startRegistered(connection, starts);
      return {
        async close() {
          // 등록의 close 가 던져도 공유 연결은 끊는다. 오류는 끊은 뒤 그대로 던진다.
          try {
            await workers.close();
          } finally {
            connection.disconnect();
          }
        },
      };
    } catch (error) {
      connection.disconnect();
      throw error;
    }
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
