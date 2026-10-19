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

type AnalysisJobData = ReturnType<typeof analysisJobDataSchema.parse>;
type AddJob = (name: string, data: AnalysisJobData, opts: JobsOptions) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 3000;

// 접속 문자열의 `//사용자:비밀@` 를 가린다(09 비밀 로그 금지). 로그에는 이 값만 쓴다.
export function describeQueueError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/[^/@\s]*@/g, "//***@");
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`큐 등록이 ${timeoutMs}ms 안에 끝나지 않았습니다`)),
      timeoutMs,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createAnalysisQueue(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
  addJob?: AddJob;
}): AnalysisQueue {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let queue: Queue | null = null;
  const defaultAdd: AddJob = async (name, data, opts) => {
    if (!options.redisUrl) throw new Error("REDIS_URL 이 설정되지 않았습니다");
    queue ??= new Queue(ANALYSIS_QUEUE, { connection: sharedRedis(options.redisUrl) });
    return queue.add(name, data, opts);
  };
  const add = options.addJob ?? defaultAdd;
  return {
    async enqueue(job) {
      // 다른 조직 접두어의 키는 여기서 거른다. jobId 는 worker 복구와 같은 규칙이라 같은 run 은 한 번만 들어간다.
      const data = analysisJobDataSchema.parse(job);
      if (!options.redisUrl && !options.addJob) throw new Error("REDIS_URL 이 설정되지 않았습니다");
      await withTimeout(
        add(ANALYSIS_JOB, data, { ...ANALYSIS_JOB_OPTIONS, jobId: toAnalysisJobId(data) }),
        timeoutMs,
      );
    },
  };
}
