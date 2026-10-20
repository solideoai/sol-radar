import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalysisRateLimiter } from "./rate-limit";

afterEach(() => vi.useRealTimers());

function memoryCounter() {
  const counts = new Map<string, number>();
  return async (key: string) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  };
}

describe("createAnalysisRateLimiter", () => {
  it("조직당 분당 30회까지 허용하고 31번째를 막는다", async () => {
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter: memoryCounter(),
      now: () => 60_000 * 5 + 43_000,
    });
    for (let i = 0; i < 30; i += 1) expect((await limiter.hit("org")).allowed).toBe(true);
    const blocked = await limiter.hit("org");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 17 });
  });

  it("다음 분의 첫 호출은 허용한다", async () => {
    let now = 60_000 * 5 + 43_000;
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter: memoryCounter(),
      now: () => now,
    });
    for (let i = 0; i < 31; i += 1) await limiter.hit("org");
    now = 60_000 * 6;
    expect((await limiter.hit("org")).allowed).toBe(true);
  });

  it("조직마다 따로 센다", async () => {
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter: memoryCounter(),
      limitPerMinute: 1,
      now: () => 0,
    });
    await limiter.hit("a");
    expect((await limiter.hit("b")).allowed).toBe(true);
  });

  it("Redis 주소도 counter 도 없으면 던진다", async () => {
    const limiter = createAnalysisRateLimiter({ redisUrl: undefined });
    await expect(limiter.hit("org")).rejects.toThrow();
  });

  it("counter 가 제한 시간을 넘기면 거부한다", async () => {
    vi.useFakeTimers();
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      timeoutMs: 3000,
      counter: () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 5000)),
    });
    const result = expect(limiter.hit("org")).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await result;
  });
});
