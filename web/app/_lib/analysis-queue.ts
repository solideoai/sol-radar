import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  ANALYSIS_QUEUE,
  analysisJobDataSchema,
  toAnalysisJobId,
} from "@/server/analysis";
import type { AnalysisQueue } from "@/server/bids";
import { sharedRedis } from "./redis-client";
import { withTimeout } from "./with-timeout";

type AnalysisJobData = ReturnType<typeof analysisJobDataSchema.parse>;
type AddJob = (name: string, data: AnalysisJobData, opts: JobsOptions) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 3000;
const NO_REDIS_URL = "REDIS_URL 이 설정되지 않았습니다";

// 접속 문자열의 `//사용자:비밀@` 를 가린다(09 비밀 로그 금지). 로그에는 이 값만 쓴다.
export function describeQueueError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/[^/@\s]*@/g, "//***@");
}

// 캐시가 다루는 Queue 의 최소 모양(시험에서 가짜로 바꾼다).
export type QueueHandle = {
  add: (name: string, data: AnalysisJobData, opts: JobsOptions) => Promise<unknown>;
  close: () => Promise<void>;
};

// Queue 는 URL 당 하나만 둔다. 인스턴스마다 공유 client 에 listener 가 붙고 close() 에서만 떼어진다.
export type QueueCache = {
  get: (url: string) => QueueHandle;
  drop: (url: string, queue: QueueHandle) => void;
};

export function createQueueCache(factory: (url: string) => QueueHandle): QueueCache {
  const cached = new Map<string, QueueHandle>();
  return {
    get(url) {
      const found = cached.get(url);
      if (found) return found;
      const created = factory(url);
      cached.set(url, created);
      return created;
    },
    // 실패한 Queue 는 닫고 버린다. bullmq 의 초기화 실패는 인스턴스에 눌어붙어 다음 요청도 막는다.
    drop(url, queue) {
      if (cached.get(url) === queue) cached.delete(url);
      queue.close().catch(() => {});
    },
  };
}

function createBullQueue(url: string): QueueHandle {
  const queue = new Queue(ANALYSIS_QUEUE, { connection: sharedRedis(url) });
  // 오류 원문(접속 정보 포함 가능)이 그대로 console 로 나가지 않게 한 줄로 줄여 남긴다.
  queue.on("error", (error) => {
    console.error(
      JSON.stringify({ event: "analysis_queue_error", message: describeQueueError(error) }),
    );
  });
  return {
    add: (name, data, opts) => queue.add(name, data, opts),
    close: () => queue.close(),
  };
}

const defaultCache = createQueueCache(createBullQueue);

export function createAnalysisQueue(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
  addJob?: AddJob;
  queueCache?: QueueCache;
}): AnalysisQueue {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = options.queueCache ?? defaultCache;
  return {
    async enqueue(job) {
      // 다른 조직 접두어의 키는 여기서 거른다. jobId 는 worker 복구와 같은 규칙이라 같은 run 은 한 번만 들어간다.
      const data = analysisJobDataSchema.parse(job);
      const opts = { ...ANALYSIS_JOB_OPTIONS, jobId: toAnalysisJobId(data) };
      if (options.addJob) {
        await withTimeout(options.addJob(ANALYSIS_JOB, data, opts), timeoutMs, "큐 등록");
        return;
      }
      if (!options.redisUrl) throw new Error(NO_REDIS_URL);
      const queue = cache.get(options.redisUrl);
      try {
        await withTimeout(queue.add(ANALYSIS_JOB, data, opts), timeoutMs, "큐 등록");
      } catch (error) {
        cache.drop(options.redisUrl, queue);
        throw error;
      }
    },
  };
}
