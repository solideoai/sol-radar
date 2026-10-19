import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { INGEST_JOB_NAME, INGEST_QUEUE } from "@/server/ingestion";
import { readWorkerEnv, type WorkerEnv } from "@/worker/env";
import { removeHeartbeatFile, startHeartbeat } from "@/worker/heartbeat";
import { processIngestJob, type IngestJobDeps } from "@/worker/ingest-queue";
import { checkReadiness, createReadinessProbes } from "@/worker/readiness";
import { SYSTEM_QUEUE, processSystemJob } from "@/worker/system-queue";

export type WorkerDeps = {
  checkReadiness: (env: WorkerEnv) => Promise<void>;
  createWorker: (env: WorkerEnv) => { close(): Promise<void> };
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
function logWorkerErrors(worker: Worker): void {
  worker.on("error", (error) => {
    const code = errorCode(error);
    console.error(code ? `worker 오류: ${error.name} ${code}` : `worker 오류: ${error.name}`);
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
 * ingest 큐 Worker(6-4). 저장소·connector·documents 큐·감사 기록은 deps 로 받는다.
 * 기동(run)에 연결하는 것은 Supabase 저장소 구현(createSupabaseIngestionRepo, 6-2)이 들어온 뒤다.
 */
export async function createIngestWorker(
  connection: IORedis,
  deps: IngestJobDeps,
  intervalMinutes: number,
): Promise<{ close(): Promise<void> }> {
  const worker = new Worker(INGEST_QUEUE, (job) => processIngestJob(job.data, deps), {
    connection,
  });
  logWorkerErrors(worker);
  const queue = new Queue(INGEST_QUEUE, { connection });
  if (deps.runMode === "live") await scheduleG2bIngest(queue, intervalMinutes);
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

export const defaultWorkerDeps: WorkerDeps = {
  checkReadiness: checkReadinessWithCodes,
  createWorker: (env) => {
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(SYSTEM_QUEUE, processSystemJob, { connection });
    logWorkerErrors(worker);
    return {
      async close() {
        await worker.close();
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
  const worker = deps.createWorker(workerEnv);
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
