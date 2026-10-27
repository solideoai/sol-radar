import "server-only";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  INGEST_QUEUE,
  INGEST_SCHEDULER_ID,
  MANUAL_INGEST_COOLDOWN_MS,
  MANUAL_INGEST_DAILY_LIMIT,
  MANUAL_INGEST_SHARED_MS,
  manualIngestDayKey,
  nextKstMidnightAfter,
  parseSourceReadiness,
  SOURCE_READINESS_KEY,
  type IngestSchedulerReader,
  type ManualIngestEntry,
  type ManualIngestGate,
  type SourceReadinessReader,
} from "@/server/ingestion";
import { describeQueueError } from "./analysis-queue";
import { readyRedis, sharedRedis } from "./redis-client";
import { withTimeout } from "./with-timeout";

// 수동 수집 gate 의 Redis 구현(redis-api 역할만 REDIS_URL 을 가진다). 키 세 개:
//   ingest:manual:user:<userId>   사용자 쿨다운(1시간, PX)
//   ingest:manual:shared          전역 공유 실행(10분, PX)
//   ingest:manual:daily:<YYYYMMDD> 한국시간 날짜별 접수 수(그날 자정 + 하루 뒤 만료)
// 값은 {runId, requestedAt, userId} JSON 이다(userId 는 mine 판정용, 응답·로그에 싣지 않는다).
// 세 검사와 설정을 Lua 한 번으로 해서 여러 탭·여러 사용자가 동시에 눌러도 하나만 접수한다.
// 연결·명령 전체를 3000ms 안에 끝내고, 오류는 던진다(서비스가 503 {component:"redis"} 로 접수하지 않는다).

const DEFAULT_TIMEOUT_MS = 3000;
const NO_REDIS_URL = "REDIS_URL 이 설정되지 않았습니다";
const DAY_MS = 24 * 60 * 60_000;

const userKeyOf = (userId: string) => `ingest:manual:user:${userId}`;
const SHARED_KEY = "ingest:manual:shared";
const dailyKeyOf = (dayKey: string) => `ingest:manual:daily:${dayKey}`;

// KEYS 사용자·공유·하루, ARGV 값·사용자 TTL(ms)·공유 TTL(ms)·하루 상한·하루 키 TTL(ms).
// 사용자 → 공유 → 하루 순서로 보고, 걸리면 그 값을 돌려준다. 모두 비었을 때만 셋을 함께 쓴다.
const CLAIM_SCRIPT = `local user = redis.call('GET', KEYS[1])
if user then return {'USER_COOLDOWN', user} end
local shared = redis.call('GET', KEYS[2])
if shared then return {'SHARED_RUN', shared} end
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
if used >= tonumber(ARGV[4]) then return {'DAILY_LIMIT', tostring(used)} end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3])
local count = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[5])
return {'CLAIMED', tostring(count)}`;

// 자기가 남긴 값(같은 JSON)일 때만 지운다. 지운 것이 있을 때만 그날 카운터를 하나 되돌린다(0 밑으로 내리지 않는다).
const RELEASE_SCRIPT = `local owned = 0
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) owned = 1 end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) owned = 1 end
if owned == 1 and tonumber(redis.call('GET', KEYS[3]) or '0') > 0 then redis.call('DECR', KEYS[3]) end
return owned`;

const entrySchema = z.strictObject({
  runId: z.uuid(),
  requestedAt: z.iso.datetime({ offset: true }),
  userId: z.uuid(),
});

// 키 순서를 고정해 직렬화한다. release 가 글자 그대로 비교한다.
const serialize = (entry: ManualIngestEntry): string =>
  JSON.stringify({ runId: entry.runId, requestedAt: entry.requestedAt, userId: entry.userId });

// 저장된 값이 이 모양이 아니면 판정할 수 없다. 던져서 서비스가 503 으로 끝내게 한다.
function parseEntry(raw: string): ManualIngestEntry {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("수동 수집 gate 값이 JSON 이 아닙니다");
  }
  const parsed = entrySchema.safeParse(json);
  if (!parsed.success) throw new Error("수동 수집 gate 값의 모양이 올바르지 않습니다");
  return parsed.data;
}

const isStringPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string";

const countOf = (raw: string | null): number => {
  if (raw === null) return 0;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0)
    throw new Error("수동 수집 하루 카운터가 숫자가 아닙니다");
  return count;
};

export function createRedisManualIngestGate(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
}): ManualIngestGate {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = <T>(label: string, work: (client: Redis) => Promise<T>): Promise<T> => {
    const redisUrl = options.redisUrl;
    if (!redisUrl) return Promise.reject(new Error(NO_REDIS_URL));
    return withTimeout(readyRedis(redisUrl, timeoutMs).then(work), timeoutMs, label);
  };
  return {
    claim: ({ userId, runId, at }) =>
      run("수동 수집 gate 잡기", async (client) => {
        const dayKey = manualIngestDayKey(at);
        const entry = { runId, requestedAt: at.toISOString(), userId };
        // 하루 키는 그날이 지나면 쓰지 않는다. 확인할 수 있게 하루 더 두고 지운다.
        const dailyTtlMs = nextKstMidnightAfter(at).getTime() - at.getTime() + DAY_MS;
        const reply: unknown = await client.eval(
          CLAIM_SCRIPT,
          3,
          userKeyOf(userId),
          SHARED_KEY,
          dailyKeyOf(dayKey),
          serialize(entry),
          String(MANUAL_INGEST_COOLDOWN_MS),
          String(MANUAL_INGEST_SHARED_MS),
          String(MANUAL_INGEST_DAILY_LIMIT),
          String(dailyTtlMs),
        );
        if (!isStringPair(reply)) throw new Error("수동 수집 gate 응답 모양이 올바르지 않습니다");
        const [status, value] = reply;
        switch (status) {
          case "CLAIMED":
            return { status, ticket: { userId, dayKey, entry } };
          case "USER_COOLDOWN":
          case "SHARED_RUN":
            return { status, entry: parseEntry(value) };
          case "DAILY_LIMIT":
            return { status, used: countOf(value) };
          default:
            throw new Error("수동 수집 gate 응답 상태를 알 수 없습니다");
        }
      }),

    release: ({ userId, dayKey, entry }) =>
      run("수동 수집 gate 풀기", async (client) => {
        await client.eval(
          RELEASE_SCRIPT,
          3,
          userKeyOf(userId),
          SHARED_KEY,
          dailyKeyOf(dayKey),
          serialize(entry),
        );
      }),

    read: ({ userId, at }) =>
      run("수동 수집 gate 읽기", async (client) => {
        const [user, shared, daily] = await client.mget(
          userKeyOf(userId),
          SHARED_KEY,
          dailyKeyOf(manualIngestDayKey(at)),
        );
        return {
          user: user === null || user === undefined ? null : parseEntry(user),
          shared: shared === null || shared === undefined ? null : parseEntry(shared),
          dailyUsed: countOf(daily ?? null),
        };
      }),
  };
}

// ── 정기 수집 Job Scheduler 읽기 ──
// worker 가 ingest 큐에 거는 Job Scheduler(id g2b-scheduled)가 있는지와 다음 실행 시각을 읽는다.
// getJobScheduler(id) 는 ZSCORE·HGETALL 읽기만 한다(여럿을 읽는 getJobSchedulers 와 달리 깨진 일정을 지우지 않는다).
// Queue 는 meta 를 쓰지 않게(skipMetasUpdate) 만들고 URL 당 하나만 둔다. 실패한 Queue 는 닫고 버린다(ingest-queue.ts 와 같다).

type SchedulerQueue = Pick<Queue, "getJobScheduler" | "close">;
const schedulerQueues = new Map<string, SchedulerQueue>();

function schedulerQueueFor(url: string): SchedulerQueue {
  const found = schedulerQueues.get(url);
  if (found) return found;
  const queue = new Queue(INGEST_QUEUE, { connection: sharedRedis(url), skipMetasUpdate: true });
  queue.on("error", (error) => {
    console.error(
      JSON.stringify({ event: "ingest_scheduler_read_error", message: describeQueueError(error) }),
    );
  });
  schedulerQueues.set(url, queue);
  return queue;
}

function dropSchedulerQueue(url: string, queue: SchedulerQueue): void {
  if (schedulerQueues.get(url) === queue) schedulerQueues.delete(url);
  queue.close().catch(() => {});
}

export function createIngestSchedulerReader(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
}): IngestSchedulerReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async read() {
      const redisUrl = options.redisUrl;
      if (!redisUrl) throw new Error(NO_REDIS_URL);
      const queue = schedulerQueueFor(redisUrl);
      try {
        const scheduler = await withTimeout(
          readyRedis(redisUrl, timeoutMs).then(() => queue.getJobScheduler(INGEST_SCHEDULER_ID)),
          timeoutMs,
          "정기 수집 일정 읽기",
        );
        if (scheduler === undefined) return { active: false, nextRunAt: null };
        const next = scheduler.next;
        return {
          active: true,
          nextRunAt:
            typeof next === "number" && Number.isFinite(next) ? new Date(next).toISOString() : null,
        };
      } catch (error) {
        dropSchedulerQueue(redisUrl, queue);
        throw error;
      }
    },
  };
}

// ── 외부 수집 서비스 상태 읽기 ──
// ingest Worker 가 기동·인증 실패 때 남긴 서비스별 상태(키 SOURCE_READINESS_KEY, 값 JSON)를 GET 한 번으로 읽는다.
// 키가 없거나 모양이 다르면 null(새 Worker 가 아직 남기지 않았다). Redis 오류는 던진다(3000ms 안에 끝낸다).
export function createSourceReadinessReader(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
}): SourceReadinessReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async read() {
      const redisUrl = options.redisUrl;
      if (!redisUrl) throw new Error(NO_REDIS_URL);
      const raw = await withTimeout(
        readyRedis(redisUrl, timeoutMs).then((client) => client.get(SOURCE_READINESS_KEY)),
        timeoutMs,
        "외부 수집 서비스 상태 읽기",
      );
      return parseSourceReadiness(raw);
    },
  };
}
