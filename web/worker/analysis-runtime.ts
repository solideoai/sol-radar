import type { SupabaseClient } from "@supabase/supabase-js";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Database } from "@/lib/database.types";
import { ANALYSIS_QUEUE, EMPTY_ATTACHMENT_READER, createAnalysisStores } from "@/server/analysis";
import { getSupabaseAdmin } from "@/server/supabase";
import { createAnalysisJobDeps, createAnalysisWorker } from "@/worker/analysis-job";
import {
  readReconcileSettings,
  startReconciler,
  type ReconcileQueue,
} from "@/worker/analysis-reconcile";

// ── analysis 런타임 조립: Worker(분석 job) + 주기 복구(멈춘 run) ──
// 설정(복구 주기·gateway·실행 모드)을 모두 읽은 뒤에 Redis 연결을 만든다. 설정 오류는 키 이름만 담아 던진다.
// Worker 와 Queue 는 연결을 따로 쓴다(Worker 는 blocking 명령을 쓴다). 넘겨준 연결은 BullMQ 가 닫지 않으므로 close 가 끊는다.
// 첨부 텍스트는 C3 구현 전이라 EMPTY_ATTACHMENT_READER 다.

export type AnalysisRuntimeFactories = {
  /** 새 연결. BullMQ Worker 가 요구하는 maxRetriesPerRequest: null. */
  connection: () => IORedis;
  /** service role 클라이언트(getSupabaseAdmin). */
  supabase: () => SupabaseClient<Database>;
  queue: (connection: IORedis) => ReconcileQueue & { close(): Promise<void> };
};

/** 기본 factory. 부를 때 env 를 읽는다(조립 전에 설정 오류가 먼저 나게). */
function defaultFactories(env: Record<string, string | undefined>): AnalysisRuntimeFactories {
  return {
    connection: () => {
      const redisUrl = env.REDIS_URL?.trim();
      if (!redisUrl) throw new Error("worker env 누락: REDIS_URL");
      return new IORedis(redisUrl, { maxRetriesPerRequest: null });
    },
    supabase: () => getSupabaseAdmin(),
    queue: (connection) => {
      const queue = new Queue(ANALYSIS_QUEUE, { connection });
      // Queue 는 연결 오류를 'error' 로 내보낸다. 듣는 쪽이 없으면 프로세스가 죽는다. message 는 접속 문자열을 담을 수 있어 쓰지 않는다.
      queue.on("error", (error) => {
        console.error(`analysis queue 오류: ${error.name}`);
      });
      return queue;
    },
  };
}

/** 순서대로 모두 부르고, 던진 것이 있으면 첫 오류를 던진다. */
async function closeAll(steps: (() => unknown)[]): Promise<void> {
  const failures: { error: unknown }[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push({ error });
    }
  }
  if (failures.length > 0) throw failures[0].error;
}

/** analysis Worker + 복구를 띄운다. env 는 process.env 모양. 설정 오류는 키 이름만 담아 던진다. */
export function startAnalysisRuntime(
  env: Record<string, string | undefined>,
  factories: Partial<AnalysisRuntimeFactories> = {},
): { close(): Promise<void> } {
  const make: AnalysisRuntimeFactories = { ...defaultFactories(env), ...factories };
  const settings = readReconcileSettings(env);
  const stores = createAnalysisStores(make.supabase(), EMPTY_ATTACHMENT_READER);
  // gateway 클라이언트는 여기서 하나만 만든다(프로세스당 하나, breaker 를 job 사이에 이어 쓴다).
  const deps = createAnalysisJobDeps(env, stores);

  const workerConnection = make.connection();
  const worker = createAnalysisWorker(workerConnection, deps);
  const queueConnection = make.connection();
  const queue = make.queue(queueConnection);
  const reconciler = startReconciler({
    finder: stores.staleRuns,
    tracker: stores.tracker,
    queue,
    now: () => new Date(),
    settings,
    log: (line) => {
      console.log(line);
    },
  });

  return {
    // 복구를 먼저 멈춰 닫는 중에 job 을 다시 넣지 않게 한다.
    close: () =>
      closeAll([
        () => reconciler.stop(),
        () => worker.close(),
        () => queue.close(),
        () => workerConnection.disconnect(),
        () => queueConnection.disconnect(),
      ]),
  };
}
