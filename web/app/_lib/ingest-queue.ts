import "server-only";
import { Queue } from "bullmq";
import {
  INGEST_QUEUE,
  enqueueIngestRun,
  ingestJobDataSchemaAt,
  type IngestJobData,
  type JobQueue,
} from "@/server/ingestion";
import { describeQueueError } from "./analysis-queue";
import { sharedRedis } from "./redis-client";
import { withTimeout } from "./with-timeout";

// 수동 수집(N8)의 "ingest" 큐 producer. 분석 큐(analysis-queue.ts)와 같은 규칙이다:
// URL 당 Queue 하나, 3000ms 제한, 실패한 Queue 는 닫고 버린다, 오류 원문의 접속 비밀은 가린다.

const DEFAULT_TIMEOUT_MS = 3000;
const NO_REDIS_URL = "REDIS_URL 이 설정되지 않았습니다";

type IngestQueueHandle = JobQueue & { close: () => Promise<void> };

function createBullQueue(url: string): IngestQueueHandle {
  const queue = new Queue(INGEST_QUEUE, { connection: sharedRedis(url) });
  queue.on("error", (error) => {
    console.error(
      JSON.stringify({ event: "ingest_queue_error", message: describeQueueError(error) }),
    );
  });
  return {
    add: (name, data, opts) => queue.add(name, data, opts),
    close: () => queue.close(),
  };
}

// Queue 는 URL 당 하나만 둔다. 인스턴스마다 공유 client 에 listener 가 붙고 close() 에서만 떼어진다.
const cached = new Map<string, IngestQueueHandle>();

function queueFor(url: string): IngestQueueHandle {
  const found = cached.get(url);
  if (found) return found;
  const created = createBullQueue(url);
  cached.set(url, created);
  return created;
}

// bullmq 의 초기화 실패는 인스턴스에 눌어붙어 다음 요청도 막는다. 실패한 Queue 는 닫고 버린다.
function drop(url: string, queue: IngestQueueHandle): void {
  if (cached.get(url) === queue) cached.delete(url);
  queue.close().catch(() => {});
}

export type IngestQueue = { enqueue(data: IngestJobData): Promise<void> };

export function createIngestQueue(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
  now?: () => Date;
  /** 시험용 가짜 큐. 주면 Redis 를 쓰지 않는다 */
  queue?: JobQueue;
}): IngestQueue {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  return {
    async enqueue(data) {
      // job 스키마(strict·window 미래 검사)를 먼저 건다. 틀린 data 때문에 멀쩡한 Queue 를 버리지 않는다.
      const at = now();
      const parsed = ingestJobDataSchemaAt(at).parse(data);
      if (options.queue) {
        await withTimeout(enqueueIngestRun(options.queue, parsed, at), timeoutMs, "큐 등록");
        return;
      }
      if (!options.redisUrl) throw new Error(NO_REDIS_URL);
      const queue = queueFor(options.redisUrl);
      try {
        await withTimeout(enqueueIngestRun(queue, parsed, at), timeoutMs, "큐 등록");
      } catch (error) {
        drop(options.redisUrl, queue);
        throw error;
      }
    },
  };
}
