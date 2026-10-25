import path from "node:path";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { readGatewayConfig, readRunMode as readAnalysisRunMode } from "@/server/analysis";
import {
  DOCUMENTS_QUEUE,
  EXTERNAL_SOURCE_KEYS,
  EXTERNAL_SERVICES,
  createExternalSourceConnector,
  type ExternalSourceKey,
  type SourceRegistry,
  type CallableSource,
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
  type IngestJobData,
  type IngestQuota,
  type IngestRunResult,
  type IngestionRepo,
  type JobQueue,
} from "@/server/ingestion";
import {
  createDeadlineReminderStore,
  createNotificationOutboxStore,
  createKakaoOutboxStore,
} from "@/server/notifications";
import { createKakaoLinkStore } from "@/server/kakao-notify";
import { getSupabaseAdmin } from "@/server/supabase";
import { readStorageSettings } from "@/server/documents";
import { probeAi } from "@/server/health";
import {
  createDependencyReporter,
  createStorageProbe,
  dependencyPublish,
  startDependencyReporter,
} from "@/worker/dependency-health";
import { createWorkerStorageClient } from "@/worker/storage-client";
import { createDocumentStorage } from "@/worker/document-storage";
import { readReconcileSettings } from "@/worker/analysis-reconcile";
import { startAnalysisRuntime } from "@/worker/analysis-runtime";
import {
  readG2bServiceKey,
  readExternalServiceKey,
  readWorkerEnv,
  type WorkerEnv,
} from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { startDocumentsReconciler } from "@/worker/documents-reconcile";
import { removeHeartbeatFile, startHeartbeat } from "@/worker/heartbeat";
import { readDeadlineSettings, startDeadlineReminders } from "@/worker/deadline-reminders";
import {
  createKakaoSender,
  readKakaoSettings,
  readNotifySettings,
  startNotifier,
} from "@/worker/notify-outbox";
import { programNoticesWorkerRegistration } from "@/worker/program-notices";
import {
  processIngestJob,
  readIngestIntervalMinutes,
  readRunMode,
  type IngestJobDeps,
  type ExternalIngestJobData,
  type RunMode,
} from "@/worker/ingest-queue";
import {
  formatIngestSchedulers,
  readIngestQueueStatus,
  type StatusRedis,
} from "@/worker/ingest-queue-status";
import { QUOTA_REDIS_OPTIONS, createRedisQuotaStore } from "@/worker/quota-store";
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
    for (const key of EXTERNAL_SOURCE_KEYS) {
      const job =
        deps.runMode === "live"
          ? deps.scheduledExternalJobs?.find((candidate) => candidate.serviceKey === key)
          : undefined;
      const schedulerId = `${key}-scheduled`;
      if (job === undefined) await queue.removeJobScheduler(schedulerId);
      else
        await queue.upsertJobScheduler(
          schedulerId,
          { every: intervalMinutes * 60_000 },
          { name: INGEST_JOB_NAME, data: job },
        );
    }
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
  registry: SourceRegistry | null;
  external: Map<ExternalSourceKey, { source: CallableSource; key: string; dailyLimit: number }>;
};

// live 모드는 기동 때 registry 와 서비스키를 확인한다. 부를 수 없는 소스면 연결을 만들기 전에 멈춘다(사유만 싣는다).
// 보조 조회 3종(07 §2.2)도 registry 항목이 있어야 한다. 같은 서비스(15129394)라 기본 URL·서비스키 env 가 목록과 같아야 한다.
async function resolveG2bSource(env: Env, registry: SourceRegistry): Promise<G2bSource> {
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
  const registry = runMode === "live" ? await loadSourceRegistry(registryFileOf(env)) : null;
  const external: IngestConfig["external"] = new Map();
  if (registry !== null) {
    for (const key of EXTERNAL_SOURCE_KEYS) {
      const callable = callableSource(registry, key);
      if (!callable.ok) continue;
      const dailyLimit = dailyQuotaOf(registry, key);
      if (dailyLimit === null || dailyLimit < 1)
        throw new Error(`수집 소스 ${key} quota.daily 미확인`);
      external.set(key, {
        source: callable.source,
        key: readExternalServiceKey(env, callable.source.serviceKeyEnv),
        dailyLimit,
      });
    }
  }
  return {
    runMode,
    intervalMinutes: readIngestIntervalMinutes(env),
    fixturesDir: fixturesDirOf(env),
    g2b: registry !== null ? await resolveG2bSource(env, registry) : null,
    registry,
    external,
  };
}

function externalScheduledJob(key: ExternalSourceKey): ExternalIngestJobData {
  const common = { trigger: "SCHEDULED" as const, jobKey: `${key}:SCHEDULED` };
  if (key === "g2b-procurement-request") return { ...common, source: "g2b", serviceKey: key };
  if (key === "kwater-bid-notice" || key === "kwater-procurement-plan")
    return { ...common, source: "kwater", serviceKey: key };
  if (key === "lh-bid-notice" || key === "lh-pre-specification")
    return { ...common, source: "lh", serviceKey: key };
  return { ...common, source: "kepco", serviceKey: key };
}

// documentsQueue 가 null 이면(ingest 전용 worker) 첨부 job 을 넣지 않는다. 첨부 행은 ingest_save_revision 이
// bid_documents 에 download_status=PENDING 으로 남기고, 소비자가 생기면 live 복구 회차가 그 행을 다시 찾아 넣는다.
function ingestJobDepsOf(
  config: IngestConfig,
  documentsQueue: JobQueue | null,
  quota: IngestQuota | null,
  externalQuotas: Map<ExternalSourceKey, IngestQuota>,
  scheduledWindowCap?: IngestJobDeps["scheduledWindowCap"],
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
    scheduledExternalJobs: Array.from(config.external.keys())
      .filter((key) => {
        const source = config.external.get(key);
        const operation = EXTERNAL_SERVICES[key].operation;
        return (
          source !== undefined &&
          source.source.operations.includes(operation) &&
          (EXTERNAL_SERVICES[key].verifiedOperations as readonly string[]).includes(operation)
        );
      })
      .map(externalScheduledJob),
    externalSourceGate: (job) => {
      if (config.registry === null) return "NOT_VERIFIED";
      const callable = callableSource(config.registry, job.serviceKey);
      if (!callable.ok) return callable.reason;
      const operation = job.operation ?? EXTERNAL_SERVICES[job.serviceKey].operation;
      if (
        !callable.source.operations.includes(operation) ||
        !(EXTERNAL_SERVICES[job.serviceKey].verifiedOperations as readonly string[]).includes(
          operation,
        )
      )
        return "NOT_VERIFIED";
      return config.external.has(job.serviceKey) ? null : "NOT_VERIFIED";
    },
    createExternalConnector: async (job) => {
      const external = config.external.get(job.serviceKey);
      if (config.runMode !== "live" || external === undefined)
        throw new Error("external connector source not verified");
      return createExternalSourceConnector({
        sourceKey: job.serviceKey,
        serviceKey: external.key,
        endpoint: external.source.baseUrl,
        operation: job.operation,
        companyId: job.source === "kepco" ? job.companyId : undefined,
        requestId: job.source === "g2b" ? job.requestId : undefined,
        fetch: (url, init) => globalThis.fetch(url, init),
      });
    },
    quotaForExternal: (job) => externalQuotas.get(job.serviceKey),
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
        // ADR-047: 관련성은 보존한 revision에서 분류한다. 수집 전에 저관련 공고를 버리지 않는다.
        isInfoBizNotice: () => true,
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
    enqueueDocuments:
      documentsQueue === null
        ? async () => undefined
        : (data) => enqueueDocuments(documentsQueue, data),
    recordManualAudit: createSupabaseIngestAudit(admin),
    now: () => new Date(),
    retry,
    secrets: [
      ...(g2b === null ? [] : [g2b.serviceKey]),
      ...Array.from(config.external.values(), (value) => value.key),
    ],
    ...(quota === null ? {} : { quota }),
    ...(scheduledWindowCap === undefined ? {} : { scheduledWindowCap }),
  };
}

// 호출 예산 카운터(07 §2.2)는 live 에서만 만든다. 공유 연결을 duplicate 해 BullMQ 의 blocking 명령 뒤에 줄 서지 않게 한다.
// 공유 연결의 maxRetriesPerRequest: null 을 그대로 물려받으면 Redis 장애 때 예산 확인이 끝없이 기다린다. 바로 실패하는 옵션으로 덮는다.
// 예산 카운터용 복제 연결의 오류. 리스너가 없으면 ioredis 가 "Unhandled error event" 로 접속 주소를 찍는다.
// 이름·코드만 남긴다(보안 검토 10-25 낮음 2). 예약 실패 자체는 quota 저장소가 fail-closed 로 처리한다.
function quietQuotaErrors(quotaConnection: IORedis, label: string): IORedis {
  quotaConnection.on("error", (error: unknown) => {
    const code = errorCode(error);
    console.error(`${label} 연결 오류: ${errorNameOf(error)}${code ? ` ${code}` : ""}`);
  });
  return quotaConnection;
}

function createIngestQuota(
  connection: IORedis,
  g2b: G2bSource,
): { quota: IngestQuota; close: Closable } {
  const quotaConnection = quietQuotaErrors(
    connection.duplicate(QUOTA_REDIS_OPTIONS),
    "g2b 호출 예산",
  );
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

export type IngestRegistrationOptions = {
  /** documents 큐에 첨부 job 을 넣고 첨부 복구 회차를 돌린다(전체 worker). 끄면 첨부 행은 DB 에 PENDING 으로만 남는다 */
  documents: boolean;
  /** 정기 g2b 창의 상한(수집 주기의 배수). 없으면 상한 없음(전체 worker) */
  scheduledWindowCapIntervals?: number;
  /** 주면 기동 때 ingest 큐 Job Scheduler 목록과 창을 자른 회차를 이 함수로 남긴다(키 값 없음) */
  log?: (line: string) => void;
};

// 기동 로그용이라 읽기에 실패해도 기동은 계속한다. 오류 이름·코드만 남긴다.
async function logIngestSchedulers(redis: StatusRedis, log: (line: string) => void) {
  try {
    const { schedulers } = await readIngestQueueStatus(redis);
    for (const line of formatIngestSchedulers(schedulers)) log(line);
  } catch (error) {
    const code = errorCode(error);
    log(
      `ingest 큐 Job Scheduler 목록을 읽지 못했다: ${errorNameOf(error)}${code ? ` ${code}` : ""}`,
    );
  }
}

// 1단계에서 실행 모드·간격·registry·서비스키를 읽는다. 틀리면 Redis 연결을 만들기 전에 기동을 멈춘다.
export const createIngestWorkerRegistration =
  (options: IngestRegistrationOptions): WorkerRegistration =>
  async (rawEnv) => {
    const config = await readIngestConfig(rawEnv);
    const { log, scheduledWindowCapIntervals } = options;
    const scheduledWindowCap =
      scheduledWindowCapIntervals === undefined
        ? undefined
        : {
            maxMs: config.intervalMinutes * scheduledWindowCapIntervals * 60_000,
            log: log ?? (() => undefined),
          };
    return async (connection) => {
      const quotaParts = config.g2b === null ? null : createIngestQuota(connection, config.g2b);
      const closeQuota: Closable = quotaParts?.close ?? { close: async () => undefined };
      const externalQuotaConnection =
        config.external.size > 0
          ? quietQuotaErrors(connection.duplicate(QUOTA_REDIS_OPTIONS), "외부 호출 예산")
          : null;
      const externalQuotas = new Map<ExternalSourceKey, IngestQuota>();
      if (externalQuotaConnection !== null)
        for (const [key, source] of config.external)
          externalQuotas.set(key, {
            serviceId: EXTERNAL_SERVICES[key].serviceId,
            dailyLimit: source.dailyLimit,
            store: createRedisQuotaStore(externalQuotaConnection, {
              dailyLimit: source.dailyLimit,
            }),
          });
      const closeExternalQuota: Closable = {
        close: async () => {
          externalQuotaConnection?.disconnect();
        },
      };
      const documentsQueue = options.documents ? new Queue(DOCUMENTS_QUEUE, { connection }) : null;
      if (documentsQueue !== null) logErrors(documentsQueue, "documents queue");
      const closeDocuments: Closable = { close: async () => documentsQueue?.close() };
      try {
        const ingest = await createIngestWorker(
          connection,
          ingestJobDepsOf(
            config,
            documentsQueue,
            quotaParts?.quota ?? null,
            externalQuotas,
            scheduledWindowCap,
          ),
          config.intervalMinutes,
        );
        const documents =
          documentsQueue === null
            ? null
            : startDocumentsReconciler({
                finder: createPendingDocumentFinder(getSupabaseAdmin()),
                queue: documentsQueue,
                // C6': mock·fixture 는 데모 공고만, live 는 실제 공고만 복구한다
                isDemo: config.runMode !== "live",
                log: (line) => {
                  console.log(line);
                },
              });
        if (log !== undefined) await logIngestSchedulers(connection, log);
        // closeAll은 거꾸로 모두 닫는다: 복구 회차 → ingest(Worker·큐) → documents 큐 → 예산 카운터 연결.
        return {
          close: () =>
            closeAll([
              closeQuota,
              closeExternalQuota,
              closeDocuments,
              ingest,
              ...(documents === null ? [] : [{ close: () => documents.stop() }]),
            ]),
        };
      } catch (error) {
        await closeQuietly([closeQuota, closeExternalQuota, closeDocuments]);
        throw error;
      }
    };
  };

/** 전체 worker 의 ingest 등록. 첨부 job·복구 회차를 돌리고 정기 창에 상한이 없다 */
export const ingestWorkerRegistration: WorkerRegistration = createIngestWorkerRegistration({
  documents: true,
});

/** 1회 수집 결과. quotaUsed 는 이 run 의 ingest_runs.quota_used(이어 간 run 이면 앞 시도 포함), 모르면 null */
export type IngestOnceResult = IngestRunResult & { quotaUsed: number | null };

/**
 * 일정을 만들지 않고 이 프로세스에서 g2b 수집을 1회 돈다(ingest 전용 worker 의 --once). live 에서만 쓴다.
 * 호출 예산은 정기 수집과 같은 Redis 카운터(F08 예약)를 쓰고, 첨부 job 은 넣지 않는다.
 */
export async function runG2bIngestOnce(
  rawEnv: Env,
  connection: IORedis,
  data: IngestJobData,
): Promise<IngestOnceResult> {
  const config = await readIngestConfig(rawEnv);
  if (config.g2b === null) throw new Error("g2b 1회 수집은 SOL_RUN_MODE=live 에서만 한다");
  const quotaParts = createIngestQuota(connection, config.g2b);
  try {
    const deps = ingestJobDepsOf(config, null, quotaParts.quota, new Map());
    let quotaUsed: number | null = null;
    const track = (value: number | undefined) => {
      if (value !== undefined) quotaUsed = value;
    };
    const repo: IngestionRepo = {
      ...deps.repo,
      startRun: async (input) => {
        const started = await deps.repo.startRun(input);
        track(started.quotaUsed);
        return started;
      },
      saveCheckpoint: async (runId, checkpoint) => {
        track(checkpoint.quotaUsed);
        await deps.repo.saveCheckpoint(runId, checkpoint);
      },
      finishRun: async (runId, result) => {
        track(result.quotaUsed);
        await deps.repo.finishRun(runId, result);
      },
    };
    const result = await processIngestJob(data, { ...deps, repo });
    return { ...result, quotaUsed };
  } finally {
    await quotaParts.close.close();
  }
}

/** --check 용. 기동 1단계(registry·서비스키 env 이름·간격)를 돌려 해석한 소스 이름만 돌려준다. Redis·외부 API 는 부르지 않는다 */
export async function describeIngestConfig(rawEnv: Env): Promise<{
  intervalMinutes: number;
  registryFile: string;
  g2bSources: string[];
  externalSources: string[];
}> {
  const registryFile = registryFileOf(rawEnv);
  const config = await readIngestConfig(rawEnv).catch((error: unknown) => {
    const code = errorCode(error);
    // 파일을 못 읽은 경우는 경로와 코드만 싣는다(내용·env 값 없음).
    if (code === "ENOENT" || code === "EACCES" || code === "EISDIR")
      throw new Error(`수집 소스 registry 를 읽을 수 없다: ${registryFile} (${code})`);
    throw error;
  });
  return {
    intervalMinutes: config.intervalMinutes,
    registryFile,
    g2bSources:
      config.g2b === null
        ? []
        : [G2B_BID_NOTICE_SOURCE, ...G2B_AUX_OPERATIONS.map(({ registryKey }) => registryKey)],
    externalSources: Array.from(config.external.keys()),
  };
}

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
  const kakaoSettings = readKakaoSettings(rawEnv);
  return async () => {
    const admin = getSupabaseAdmin();
    const now = () => new Date();
    const notifier = startNotifier({
      store: createNotificationOutboxStore(admin),
      kakao: {
        store: createKakaoOutboxStore(admin),
        sender: createKakaoSender(kakaoSettings, {
          links: createKakaoLinkStore(admin),
          fetch: (input, init) => globalThis.fetch(input, init),
          now,
          sleep: (ms) =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, ms);
            }),
        }),
        siteUrl: kakaoSettings.siteUrl,
      },
      now,
      log: (line) => {
        console.log(line);
      },
      settings,
    });
    return { close: () => notifier.stop() };
  };
};

export const deadlineWorkerRegistration: WorkerRegistration = async (rawEnv) => {
  const settings = readDeadlineSettings(rawEnv);
  return async () => {
    const reminders = startDeadlineReminders({
      store: createDeadlineReminderStore(getSupabaseAdmin()),
      now: () => new Date(),
      log: (line) => {
        console.log(line);
      },
      settings,
    });
    return { close: () => reminders.stop() };
  };
};

export const WORKER_REGISTRATIONS: readonly WorkerRegistration[] = [
  systemWorkerRegistration,
  ingestWorkerRegistration,
  analysisWorkerRegistration,
  notifyWorkerRegistration,
  deadlineWorkerRegistration,
  programNoticesWorkerRegistration,
  async (rawEnv) => {
    const settings = readStorageSettings(rawEnv);
    return async (connection) => {
      const redis = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 3_000 });
      redis.on("error", () => {});
      const reporter = startDependencyReporter(
        createDependencyReporter({
          scope: {
            runMode: rawEnv.SOL_RUN_MODE?.trim() || "mock",
            supabaseUrl: rawEnv.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") || "",
            ...settings,
          },
          now: Date.now,
          storage: createStorageProbe(createWorkerStorageClient(rawEnv, 5_000), settings),
          ai: () => probeAi(rawEnv.AI_GATEWAY_URL),
          publish: dependencyPublish(redis),
        }),
      );
      return {
        async close() {
          try {
            await reporter.close();
          } finally {
            redis.disconnect();
          }
        },
      };
    };
  },
  async (rawEnv) => {
    const settings = readStorageSettings(rawEnv);
    return async () => {
      const storage = createDocumentStorage(createWorkerStorageClient(rawEnv), settings);
      let running: Promise<unknown> | null = null;
      const tick = () => {
        if (running) return;
        running = storage
          .reconcile()
          .catch(() => {
            console.error("worker storage reconcile 실패");
          })
          .finally(() => {
            running = null;
          });
      };
      tick();
      const timer = setInterval(tick, 10 * 60_000);
      return {
        async close() {
          clearInterval(timer);
          await running;
        },
      };
    };
  },
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

/**
 * 등록 목록으로 createWorker 를 만든다. 전체 worker(main.ts)와 ingest 전용 worker(ingest-only-main.ts)가 같이 쓴다.
 * 모든 등록이 Redis 연결 하나를 같이 쓰고, close 때 그 연결을 끊는다.
 */
export const createRegisteredWorker =
  (registrations: readonly WorkerRegistration[]): WorkerDeps["createWorker"] =>
  async (env, rawEnv) => {
    // 1단계: 모든 등록의 설정 검증이 통과해야 Redis 에 연결한다.
    const starts = await Promise.all(registrations.map((register) => register(rawEnv)));
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
  };

export const defaultWorkerDeps: WorkerDeps = {
  checkReadiness: checkReadinessWithCodes,
  createWorker: createRegisteredWorker(WORKER_REGISTRATIONS),
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
