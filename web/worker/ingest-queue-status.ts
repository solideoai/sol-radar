import { QueueKeys } from "bullmq";
import type IORedis from "ioredis";
import { INGEST_QUEUE } from "@/server/ingestion";

// ── ingest 큐 상태 읽기(10-25 live 수집 계획 B1, --status 와 기동 로그) ──
// BullMQ 6.3.16 의 키 배치(QueueKeys, 접두어 bull)를 읽기 명령(LLEN·ZCARD·ZRANGE·HMGET)으로만 본다.
// Queue 를 만들면 meta 를 쓰고(setQueueMeta), getJobCounts·getJobSchedulers 도 옛 표식·깨진 일정을 지우는 쓰기를 할 수 있다.

export type IngestJobCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  prioritized: number;
};
export type IngestSchedulerInfo = {
  id: string;
  every: number | null;
  pattern: string | null;
  /** 다음 실행 예정(ISO). 점수가 숫자가 아니면 null */
  next: string | null;
};
export type IngestQueueStatus = { counts: IngestJobCounts; schedulers: IngestSchedulerInfo[] };

export type StatusRedis = Pick<IORedis, "llen" | "zcard" | "zrange" | "hmget">;

const isoOfMillis = (raw: string | undefined): string | null => {
  const millis = Number(raw);
  return raw !== undefined && Number.isFinite(millis) ? new Date(millis).toISOString() : null;
};
const numberOrNull = (raw: string | null): number | null =>
  raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

// ZRANGE … WITHSCORES 는 [id, 점수, id, 점수 …] 로 온다.
const pairsOf = (flat: readonly string[]): [string, string | undefined][] =>
  flat.flatMap((value, index) => (index % 2 === 0 ? [[value, flat[index + 1]]] : []));

export async function readIngestQueueStatus(redis: StatusRedis): Promise<IngestQueueStatus> {
  const keys = new QueueKeys().getKeys(INGEST_QUEUE);
  const [waiting, active, paused, delayed, failed, completed, prioritized, repeat] =
    await Promise.all([
      redis.llen(keys.wait),
      redis.llen(keys.active),
      redis.llen(keys.paused),
      redis.zcard(keys.delayed),
      redis.zcard(keys.failed),
      redis.zcard(keys.completed),
      redis.zcard(keys.prioritized),
      redis.zrange(keys.repeat, 0, "-1", "WITHSCORES"),
    ]);
  const schedulers = await Promise.all(
    pairsOf(repeat).map(async ([id, score]) => {
      const [every, pattern] = await redis.hmget(`${keys.repeat}:${id}`, "every", "pattern");
      return { id, every: numberOrNull(every), pattern, next: isoOfMillis(score) };
    }),
  );
  return {
    counts: { waiting, active, delayed, failed, completed, paused, prioritized },
    schedulers,
  };
}

/** 로그 줄. id·주기·다음 예정만 싣는다(job data·키 값 없음) */
export const formatIngestSchedulers = (schedulers: readonly IngestSchedulerInfo[]): string[] => [
  `ingest 큐 Job Scheduler ${schedulers.length}개`,
  ...schedulers.map(
    ({ id, every, pattern, next }) =>
      `  id=${id} every=${every ?? "-"}${pattern === null ? "" : ` pattern=${pattern}`} next=${next ?? "-"}`,
  ),
];

export const formatIngestQueueStatus = ({ counts, schedulers }: IngestQueueStatus): string[] => [
  `ingest 큐 job 수: ${Object.entries(counts)
    .map(([state, count]) => `${state}=${count}`)
    .join(" ")}`,
  ...formatIngestSchedulers(schedulers),
];
