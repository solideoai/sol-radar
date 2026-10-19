import "server-only";
import type { AnalysisRateLimiter } from "@/server/bids";
import { readyRedis } from "./redis-client";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT_PER_MINUTE = 30;
const CONNECT_TIMEOUT_MS = 3000;

// 증가와 만료를 한 번에 건다. 따로 보내면 만료가 빠진 키가 영구히 남을 수 있다.
const INCR_WITH_TTL = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

// 조직당 분당 호출 수 제한(고정 창). 창 번호가 키에 들어가 분이 바뀌면 새로 센다.
export function createAnalysisRateLimiter(options: {
  redisUrl: string | undefined;
  limitPerMinute?: number;
  now?: () => number;
  counter?: (key: string, ttlSeconds: number) => Promise<number>;
}): AnalysisRateLimiter {
  const limit = options.limitPerMinute ?? DEFAULT_LIMIT_PER_MINUTE;
  const now = options.now ?? Date.now;
  const counter =
    options.counter ??
    (async (key: string, ttlSeconds: number) => {
      if (!options.redisUrl) throw new Error("REDIS_URL 이 설정되지 않았습니다");
      const client = await readyRedis(options.redisUrl, CONNECT_TIMEOUT_MS);
      const count = await client.eval(INCR_WITH_TTL, 1, key, String(ttlSeconds));
      if (typeof count !== "number") throw new Error("속도 제한 카운터 응답이 숫자가 아닙니다");
      return count;
    });
  return {
    async hit(orgId) {
      const at = now();
      const count = await counter(`rate:analysis:${orgId}:${Math.floor(at / WINDOW_MS)}`, 60);
      if (count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSeconds: 60 - Math.floor((at % WINDOW_MS) / 1000) };
    },
  };
}
