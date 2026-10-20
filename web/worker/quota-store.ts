import type IORedis from "ioredis";
import { quotaKey, validateCalls, validateDailyLimit, type QuotaStore } from "@/server/ingestion";

// ── Redis 호출 예산 카운터(07 §2.2). 키 quota:{serviceId}:{YYYYMMDD}(KST), INCRBY + TTL 2일 ──
// 같은 서비스를 부르는 worker 가 여럿이어도 한 카운터를 본다. KST 날짜가 바뀌면 키가 바뀌어 0 부터 센다.
export type QuotaRedis = Pick<IORedis, "get" | "set" | "incrby" | "expire">;

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
