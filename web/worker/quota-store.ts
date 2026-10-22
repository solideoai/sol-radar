import type IORedis from "ioredis";
import type { RedisOptions } from "ioredis";
import { quotaKey, validateCalls, validateDailyLimit, type QuotaStore } from "@/server/ingestion";

// ── Redis 호출 예산 카운터(07 §2.2). 키 quota:{serviceId}:{YYYYMMDD}(KST), Lua 예약 + TTL 2일 ──
// 같은 서비스를 부르는 worker 가 여럿이어도 한 카운터를 본다. KST 날짜가 바뀌면 키가 바뀌어 0 부터 센다.
export type QuotaRedis = Pick<IORedis, "get" | "eval" | "incrby" | "expire">;

/**
 * 예산 카운터 연결 옵션. BullMQ 공유 연결(maxRetriesPerRequest: null = 무한 대기)을 duplicate 할 때 덮어쓴다.
 * Redis 에 닿지 못하면 예산 확인이 기다리지 않고 바로 실패해야 수집이 "예산을 모르면 부르지 않는다" 쪽으로 닫힌다.
 * - enableOfflineQueue: false — 끊긴 동안 보낸 명령을 줄에 세우지 않고 바로 거절한다.
 * - maxRetriesPerRequest: 1 — 연결 재시도가 계속될 때 대기 중인 명령을 제한한다.
 * - autoResendUnfulfilledCommands: false — 응답이 유실된 예약 EVAL을 재전송하지 않는다.
 * - commandTimeout — 연결은 됐는데 응답이 없으면 이 시간 안에 실패한다.
 */
export const QUOTA_REDIS_OPTIONS = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  autoResendUnfulfilledCommands: false,
  commandTimeout: 2_000,
} as const satisfies Partial<RedisOptions>;

/** 키는 KST 날짜별이라 그날이 지나면 쓰지 않는다. 이틀 뒤 지운다 */
export const QUOTA_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

const COUNTER = /^\d+$/;

// 한 EVAL 안에서 검사·증가·만료 설정을 끝낸다. GET/INCR 분리 시 여러 Worker가 마지막 1회를 함께 쓴다.
const RESERVE_CALL = `
local raw = redis.call('GET', KEYS[1])
local used = 0
if raw then
  if not string.match(raw, '^%d+$') then return 0 end
  used = tonumber(raw)
  if not used or used > 9007199254740991 then return 0 end
end
if used >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const EXHAUST_CALLS = `
local raw = redis.call('GET', KEYS[1])
local used = raw and tonumber(raw) or nil
local limit = tonumber(ARGV[1])
if not used or used < limit then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
else
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 1
`;

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

    async reserve(serviceId, at) {
      const result = await redis.eval(
        RESERVE_CALL,
        1,
        quotaKey(serviceId, at),
        dailyLimit,
        QUOTA_KEY_TTL_SECONDS,
      );
      if (result !== 0 && result !== 1) throw new Error("QuotaStore: invalid reservation result");
      return result === 1;
    },

    async add(serviceId, at, calls) {
      const key = quotaKey(serviceId, at);
      const used = await redis.incrby(key, validateCalls(calls));
      await redis.expire(key, QUOTA_KEY_TTL_SECONDS);
      return used;
    },

    async markExhausted(serviceId, at) {
      await redis.eval(
        EXHAUST_CALLS,
        1,
        quotaKey(serviceId, at),
        dailyLimit,
        QUOTA_KEY_TTL_SECONDS,
      );
    },
  };
}
