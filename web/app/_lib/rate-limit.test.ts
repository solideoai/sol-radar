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

// N8 수집 관리(계획서 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1-4·§2): 수동 수집은 조직당 5회/분이고 분석과 따로 센다.
// 옵션 이름은 keyPrefix, 값은 키 "rate:<keyPrefix>:<orgId>:<분 창>" 의 가운데 조각이다. 주지 않으면 분석 값(analysis·30회)이다.
describe("createAnalysisRateLimiter — 키 접두어·한도 옵션(N8)", () => {
  const AT = 60_000 * 5 + 43_000; // 5번째 분 창, 창 끝까지 17초

  function recordingCounter() {
    const counts = new Map<string, number>();
    const calls: [string, number][] = [];
    const counter = async (key: string, ttlSeconds: number) => {
      calls.push([key, ttlSeconds]);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    };
    return { counter, calls };
  }

  it("접두어를 주지 않으면 분석 키 rate:analysis:<org>:<분 창> 을 TTL 60초로 센다", async () => {
    const { counter, calls } = recordingCounter();
    const limiter = createAnalysisRateLimiter({ redisUrl: "redis://h", counter, now: () => AT });

    await limiter.hit("org-1");

    expect(calls).toEqual([["rate:analysis:org-1:5", 60]]);
  });

  it("keyPrefix ingest 면 rate:ingest:<org>:<분 창> 으로 센다", async () => {
    const { counter, calls } = recordingCounter();
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter,
      now: () => AT,
      keyPrefix: "ingest",
      limitPerMinute: 5,
    });

    await limiter.hit("org-1");

    expect(calls).toEqual([["rate:ingest:org-1:5", 60]]);
  });

  it("keyPrefix 만 주면 한도는 기본 30 그대로다", async () => {
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter: memoryCounter(),
      now: () => AT,
      keyPrefix: "ingest",
    });
    for (let i = 0; i < 30; i += 1) expect((await limiter.hit("org")).allowed).toBe(true);

    expect(await limiter.hit("org")).toEqual({ allowed: false, retryAfterSeconds: 17 });
  });

  it("keyPrefix ingest·limitPerMinute 5 면 조직당 5회까지 허용하고 6번째를 retryAfterSeconds 와 함께 막는다", async () => {
    const limiter = createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter: memoryCounter(),
      now: () => AT,
      keyPrefix: "ingest",
      limitPerMinute: 5,
    });
    for (let i = 0; i < 5; i += 1) expect((await limiter.hit("org")).allowed).toBe(true);

    expect(await limiter.hit("org")).toEqual({ allowed: false, retryAfterSeconds: 17 });
  });

  // 같은 조직·같은 Redis(카운터 공유) 위의 두 제한기
  const pairOn = (counter: (key: string, ttlSeconds: number) => Promise<number>) => ({
    ingest: createAnalysisRateLimiter({
      redisUrl: "redis://h",
      counter,
      now: () => AT,
      keyPrefix: "ingest",
      limitPerMinute: 5,
    }),
    analysis: createAnalysisRateLimiter({ redisUrl: "redis://h", counter, now: () => AT }),
  });

  it("분석 30회를 다 써도 같은 조직의 수집 첫 호출은 허용한다", async () => {
    const { ingest, analysis } = pairOn(memoryCounter());
    for (let i = 0; i < 30; i += 1) await analysis.hit("org");

    expect(await ingest.hit("org")).toEqual({ allowed: true });
  });

  it("수집 5회를 다 써도 같은 조직의 분석은 30회를 모두 허용한다", async () => {
    const { ingest, analysis } = pairOn(memoryCounter());
    for (let i = 0; i < 5; i += 1) await ingest.hit("org");

    for (let i = 0; i < 30; i += 1) expect((await analysis.hit("org")).allowed).toBe(true);
  });
});
