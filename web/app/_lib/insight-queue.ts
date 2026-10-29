import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import {
  INSIGHT_JOB,
  INSIGHT_QUEUE,
  insightJobDataSchema,
  insightJobId,
  type InsightJobData,
} from "@/server/insight";
import { describeQueueError } from "./analysis-queue";
import { sharedRedis } from "./redis-client";
import { withTimeout } from "./with-timeout";

// 추천 분석(ADR-066) 큐 생산자. 소비자는 Analysis Worker 의 insight Worker 다.
// job 은 한 번만 시도한다. 실패는 worker 가 행을 FAILED 로 닫고, 사용자는 [다시 요청]으로 새 행을 만든다(C4).
const INSIGHT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: 100,
} as const satisfies JobsOptions;

type AddJob = (name: string, data: InsightJobData, opts: JobsOptions) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 3000;

// Queue 는 URL 당 하나만 둔다(analysis-queue 와 같은 이유: 인스턴스마다 공유 client 에 listener 가 붙는다).
const queues = new Map<string, Queue>();

function queueFor(url: string): Queue {
  const found = queues.get(url);
  if (found) return found;
  const queue = new Queue(INSIGHT_QUEUE, { connection: sharedRedis(url) });
  // 오류 원문(접속 정보 포함 가능)이 그대로 console 로 나가지 않게 한 줄로 줄여 남긴다.
  queue.on("error", (error) => {
    console.error(
      JSON.stringify({ event: "insight_queue_error", message: describeQueueError(error) }),
    );
  });
  queues.set(url, queue);
  return queue;
}

// 실패한 Queue 는 닫고 버린다. bullmq 의 초기화 실패는 인스턴스에 눌어붙어 다음 요청도 막는다.
function dropQueue(url: string, queue: Queue): void {
  if (queues.get(url) === queue) queues.delete(url);
  queue.close().catch(() => {});
}

/** 같은 행은 같은 jobId(insightJobId)라 PENDING 을 다시 넣어도 job 은 하나다. */
export function createInsightQueue(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
  addJob?: AddJob;
}): (data: InsightJobData) => Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (job) => {
    const data = insightJobDataSchema.parse(job);
    const opts = { ...INSIGHT_JOB_OPTIONS, jobId: insightJobId(data.insightId) };
    if (options.addJob) {
      await withTimeout(options.addJob(INSIGHT_JOB, data, opts), timeoutMs, "큐 등록");
      return;
    }
    if (!options.redisUrl) throw new Error("REDIS_URL 이 설정되지 않았습니다");
    const queue = queueFor(options.redisUrl);
    try {
      await withTimeout(queue.add(INSIGHT_JOB, data, opts), timeoutMs, "큐 등록");
    } catch (error) {
      dropQueue(options.redisUrl, queue);
      throw error;
    }
  };
}
