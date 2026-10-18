import { Worker } from "bullmq";
import IORedis from "ioredis";
import { readWorkerEnv, type WorkerEnv } from "@/worker/env";
import { startHeartbeat } from "@/worker/heartbeat";
import { checkReadiness, createReadinessProbes } from "@/worker/readiness";
import { SYSTEM_QUEUE, processSystemJob } from "@/worker/system-queue";

export type WorkerDeps = {
  checkReadiness: (env: WorkerEnv) => Promise<void>;
  createWorker: (env: WorkerEnv) => { close(): Promise<void> };
  startHeartbeat: (file: string) => { stop(): void };
};

export const defaultWorkerDeps: WorkerDeps = {
  checkReadiness: (env) => checkReadiness(createReadinessProbes(env)),
  createWorker: (env) => {
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(SYSTEM_QUEUE, processSystemJob, { connection });
    worker.on("error", (error) => console.error(`worker 오류: ${error.name}`));
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
