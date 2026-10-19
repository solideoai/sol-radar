import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { PING_JOB, SYSTEM_QUEUE } from "@/worker/system-queue";

export const PING_TIMEOUT_MS = 10_000;

// removeOnComplete: true 는 waitUntilFinished 가 결과를 읽기 전에 job 을 지워 "Missing key" 로 경합한다. 잠시 남겼다가 지운다.
export const PING_JOB_OPTIONS = {
  removeOnComplete: { age: 60 },
  removeOnFail: { age: 60 },
} as const;

// 연결·add·대기 어디서 멈추든 전체 시간 안에 끝내려는 상한. Redis 가 죽어 있으면 ioredis 가 무한 재시도한다.
export function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ping timeout")), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("ping failed"));
      },
    );
  });
}

// Supabase 키는 필요 없다. REDIS_URL 만 읽는다.
async function ping(redisUrl: string): Promise<number> {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", () => undefined);
  const queue = new Queue(SYSTEM_QUEUE, { connection });
  const eventsConnection = connection.duplicate();
  eventsConnection.on("error", () => undefined);
  const events = new QueueEvents(SYSTEM_QUEUE, { connection: eventsConnection });
  events.on("error", () => undefined);
  queue.on("error", () => undefined);
  try {
    await events.waitUntilReady();
    const startedAt = Date.now();
    const job = await queue.add(PING_JOB, {}, PING_JOB_OPTIONS);
    await job.waitUntilFinished(events, PING_TIMEOUT_MS);
    return Date.now() - startedAt;
  } finally {
    await events.close();
    await queue.close();
    connection.disconnect();
  }
}

async function run(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    console.error("worker env 누락: REDIS_URL");
    process.exit(1);
  }
  try {
    const elapsedMs = await withDeadline(ping(redisUrl), PING_TIMEOUT_MS);
    console.log(`queue round-trip ok ${elapsedMs}ms`);
    process.exit(0);
  } catch {
    console.error("queue round-trip 실패");
    process.exit(1);
  }
}

if (/[\\/]worker[\\/]ping\.ts$/.test(process.argv[1] ?? "")) {
  void run();
}
