import type { SupabaseClient } from "@supabase/supabase-js";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Database } from "@/lib/database.types";
import { ANALYSIS_QUEUE, createAnalysisStores } from "@/server/analysis";
import {
  createAttachmentTextReader,
  readAttachmentTextSettings,
  readStorageSettings,
} from "@/server/documents";
import { getSupabaseAdmin } from "@/server/supabase";
import { createAnalysisJobDeps, createAnalysisWorker } from "@/worker/analysis-job";
import {
  readReconcileSettings,
  startReconciler,
  type ReconcileQueue,
} from "@/worker/analysis-reconcile";
import { errorNameOf } from "@/worker/error-name";

// ── analysis 런타임 조립: Worker(분석 job) + 주기 복구(멈춘 run) ──
// 설정(복구 주기·gateway·실행 모드)을 모두 읽은 뒤에 Redis 연결을 만든다. 설정 오류는 키 이름만 담아 던진다.
// Worker 와 Queue 는 연결을 따로 쓴다(Worker 는 blocking 명령을 쓴다). 넘겨준 연결은 BullMQ 가 닫지 않으므로 close 가 끊는다.
// 첨부 텍스트는 documents worker 가 bid-parsed 에 저장한 PARSED·PARTIAL 텍스트를 읽는다(문서당·전체 글자 상한, 2026-10-27).

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
      // Queue 는 연결 오류를 'error' 로 내보낸다. 듣는 쪽이 없으면 프로세스가 죽는다. message 는 접속 문자열을 담을 수 있어 쓰지 않고,
      // 이름도 공용 규칙으로 거른다(개행·값이 섞인 이름이 로그 줄을 깨지 않게).
      queue.on("error", (error) => {
        console.error(`analysis queue 오류: ${errorNameOf(error)}`);
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

/** 기동 중에 던지면 만든 것을 거꾸로 닫는다. 닫는 중 오류는 버린다(원래 오류를 던져야 한다). */
async function closeQuietly(steps: (() => unknown)[]): Promise<void> {
  for (const step of steps) {
    try {
      await step();
    } catch {
      // 닫기 실패는 버린다. 원래 기동 오류가 이유를 말한다.
    }
  }
}

/**
 * analysis Worker + 복구를 띄운다. env 는 process.env 모양. 설정 오류는 키 이름만 담아 던진다.
 * 연결·Worker·Queue·복구를 만들다 중간에 던지면 앞서 만든 것을 거꾸로 닫고(기다리지 않는다) 원래 오류를 다시 던진다.
 */
export function startAnalysisRuntime(
  env: Record<string, string | undefined>,
  factories: Partial<AnalysisRuntimeFactories> = {},
): { close(): Promise<void> } {
  const make: AnalysisRuntimeFactories = { ...defaultFactories(env), ...factories };
  const settings = readReconcileSettings(env);
  const attachmentSettings = readAttachmentTextSettings(env, readStorageSettings(env).parsedBucket);
  const supabase = make.supabase();
  const attachments = createAttachmentTextReader(supabase, attachmentSettings, (line) => {
    console.log(line);
  });
  const stores = createAnalysisStores(supabase, attachments);
  // gateway 클라이언트는 여기서 하나만 만든다(프로세스당 하나, breaker 를 job 사이에 이어 쓴다).
  const deps = createAnalysisJobDeps(env, stores);

  // 만든 것을 닫는 단계. 만든 순서대로 쌓고, 기동이 실패하면 거꾸로 닫는다.
  const created: (() => unknown)[] = [];
  const track = <T>(made: T, close: (made: T) => unknown): T => {
    created.push(() => close(made));
    return made;
  };

  try {
    const workerConnection = track(make.connection(), (made) => made.disconnect());
    const worker = track(createAnalysisWorker(workerConnection, deps), (made) => made.close());
    const queueConnection = track(make.connection(), (made) => made.disconnect());
    const queue = track(make.queue(queueConnection), (made) => made.close());
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
    return runtimeOf({ reconciler, worker, queue, workerConnection, queueConnection });
  } catch (error) {
    // 기동은 동기라 닫기를 기다리지 않는다. closeQuietly 는 reject 하지 않는다.
    void closeQuietly(created.toReversed());
    throw error;
  }
}

function runtimeOf(parts: {
  reconciler: { stop(): Promise<void> };
  worker: { close(): Promise<void> };
  queue: { close(): Promise<void> };
  workerConnection: IORedis;
  queueConnection: IORedis;
}): { close(): Promise<void> } {
  const { reconciler, worker, queue, workerConnection, queueConnection } = parts;
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
