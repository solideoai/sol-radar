import "server-only";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { IngestionIdempotencyRecord, IngestionIdempotencyStore } from "@/server/ingestion";
import { readyRedis } from "./redis-client";
import { withTimeout } from "./with-timeout";

// 수동 수집(N8)의 같은 키 판정 저장소. Redis 키 idem:ingest:<orgId>:<requestId>, 값 {requestHash, runId, startedAt, requesterId}.
// 잡기는 SET NX EX 한 명령이라 동시 요청 중 하나만 이긴다. 연결과 명령 전체를 3000ms 안에 끝낸다.

const DEFAULT_TIMEOUT_MS = 3000;
const NO_REDIS_URL = "REDIS_URL 이 설정되지 않았습니다";

// requesterId 는 첫 202 를 받은 사람이다(I1). 그 전에 쓴 기록에는 없으므로 비어 있어도 읽는다.
const recordSchema = z.strictObject({
  requestHash: z.string().min(1),
  runId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }),
  requesterId: z.uuid().optional(),
});

// 저장된 값이 이 모양이 아니면 판정할 수 없다. 던져서 서비스가 503 {component:"redis"} 로 끝내게 한다.
function parseRecord(raw: string): IngestionIdempotencyRecord {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("멱등 기록이 JSON 이 아닙니다");
  }
  const parsed = recordSchema.safeParse(json);
  if (!parsed.success) throw new Error("멱등 기록의 모양이 올바르지 않습니다");
  return parsed.data;
}

export function createIdempotencyStore(options: {
  redisUrl: string | undefined;
  timeoutMs?: number;
}): IngestionIdempotencyStore {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = <T>(label: string, work: (client: Redis) => Promise<T>): Promise<T> => {
    const redisUrl = options.redisUrl;
    if (!redisUrl) return Promise.reject(new Error(NO_REDIS_URL));
    return withTimeout(readyRedis(redisUrl, timeoutMs).then(work), timeoutMs, label);
  };
  return {
    get: (key) =>
      run("멱등 키 읽기", async (client) => {
        const raw = await client.get(key);
        return raw === null ? null : parseRecord(raw);
      }),
    claim: (key, value, ttlSeconds) =>
      run("멱등 키 잡기", async (client) => {
        const result = await client.set(key, JSON.stringify(value), "EX", ttlSeconds, "NX");
        return result === "OK";
      }),
    release: (key) =>
      run("멱등 키 풀기", async (client) => {
        await client.del(key);
      }),
  };
}
