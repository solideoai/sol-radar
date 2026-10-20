import type IORedis from "ioredis";
import type { RedisOptions } from "ioredis";
import { quotaKey, validateCalls, validateDailyLimit, type QuotaStore } from "@/server/ingestion";

// ── Redis 호출 예산 카운터(07 §2.2). 키 quota:{serviceId}:{YYYYMMDD}(KST), INCRBY + TTL 2일 ──
// 같은 서비스를 부르는 worker 가 여럿이어도 한 카운터를 본다. KST 날짜가 바뀌면 키가 바뀌어 0 부터 센다.
export type QuotaRedis = Pick<IORedis, "get" | "set" | "incrby" | "expire">;

/**
 * 예산 카운터 연결 옵션. BullMQ 공유 연결(maxRetriesPerRequest: null = 무한 대기)을 duplicate 할 때 덮어쓴다.
 * Redis 에 닿지 못하면 예산 확인이 기다리지 않고 바로 실패해야 수집이 "예산을 모르면 부르지 않는다" 쪽으로 닫힌다.
 * - enableOfflineQueue: false — 끊긴 동안 보낸 명령을 줄에 세우지 않고 바로 거절한다.
 * - maxRetriesPerRequest: 1 — 보내던 중 끊기면 한 번만 다시 보낸다.
 * - commandTimeout — 연결은 됐는데 응답이 없으면 이 시간 안에 실패한다.
 */
export const QUOTA_REDIS_OPTIONS = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 2_000,
} as const satisfies Partial<RedisOptions>;

/** 키는 KST 날짜별이라 그날이 지나면 쓰지 않는다. 이틀 뒤 지운다 */
export const QUOTA_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

const COUNTER = /^\d+$/;

export function createRedisQuotaStore(
  redis: QuotaRedis,
  options: { dailyLimit: number },
): QuotaStore {
  const dailyLimit = validateDailyLimit(options.dailyLimit, "RedisQuotaStore");

  // 숫자가 아닌 값(다른 프로그램이 쓴 키 등)은 NaN 으로 돌려준다. quotaState 가 EXHAUSTED 로 닫는다. 메우지 않는다.
  const usedOf = async (key: string): Promise<number> => {
    const value = await redis.get(key);
    if (value === null) return 0;
    return COUNTER.test(value) ? Number(value) : Number.NaN;
  };

  return {
    get: (serviceId, at) => usedOf(quotaKey(serviceId, at)),

    async add(serviceId, at, calls) {
      const key = quotaKey(serviceId, at);
      const used = await redis.incrby(key, validateCalls(calls));
      await redis.expire(key, QUOTA_KEY_TTL_SECONDS);
      return used;
    },

    async markExhausted(serviceId, at) {
      const key = quotaKey(serviceId, at);
      const used = await usedOf(key);
      if (Number.isNaN(used)) {
        // 읽을 수 없는 값은 한도로 덮는다(어차피 EXHAUSTED 였다).
        await redis.set(key, String(dailyLimit), "EX", QUOTA_KEY_TTL_SECONDS);
        return;
      }
      // 한도까지의 차이만 더한다. SET 으로 덮으면 그사이 다른 worker 가 더한 값이 사라진다. 이미 넘었으면 그대로 둔다.
      if (used < dailyLimit) await redis.incrby(key, dailyLimit - used);
      await redis.expire(key, QUOTA_KEY_TTL_SECONDS);
    },
  };
}
