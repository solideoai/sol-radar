import { describe, expect, it, vi } from "vitest";
import { createRedisQuotaStore, QUOTA_KEY_TTL_SECONDS, type QuotaRedis } from "./quota-store";

// Redis 서버에 연결하지 않는다. EVAL 전송 계약만 검사하며 실제 Lua/TTL 실행 검증을 대체하지 않는다.
function port(evalResult: unknown = 1) {
  const evalCommand = vi.fn(async () => evalResult);
  const get = vi.fn(async () => null as string | null);
  const incrby = vi.fn();
  const expire = vi.fn();
  const redis = { eval: evalCommand, get, incrby, expire } as unknown as QuotaRedis;
  return { redis, evalCommand, get, incrby, expire };
}

describe("Redis atomic quota reservation port", () => {
  it("sends the check/increment/TTL as one EVAL on the existing KST key", async () => {
    const p = port();
    const store = createRedisQuotaStore(p.redis, { dailyLimit: 7 });
    expect(await store.reserve("15129394", new Date("2026-10-22T14:59:59Z"))).toBe(true);
    expect(p.evalCommand).toHaveBeenCalledTimes(1);
    const [script, ...args] = p.evalCommand.mock.calls[0] as unknown as [string, ...unknown[]];
    expect(args).toEqual([1, "quota:15129394:20261022", 7, QUOTA_KEY_TTL_SECONDS]);
    expect(script).toContain("redis.call('GET'");
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('EXPIRE'");
    expect(p.get).not.toHaveBeenCalled();
    expect(p.incrby).not.toHaveBeenCalled();
    expect(p.expire).not.toHaveBeenCalled();
  });

  it("shares one reservation key across distinct Worker clients and isolates KST days", async () => {
    const p = port();
    const first = createRedisQuotaStore(p.redis, { dailyLimit: 1 });
    const second = createRedisQuotaStore(p.redis, { dailyLimit: 1 });
    p.evalCommand.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const before = new Date("2026-10-22T14:59:59Z");
    expect(
      await Promise.all([first.reserve("15129394", before), second.reserve("15129394", before)]),
    ).toEqual([true, false]);
    expect(await first.reserve("15129394", new Date("2026-10-22T15:00:00Z"))).toBe(true);
    const args = p.evalCommand.mock.calls as unknown as unknown[][];
    expect(args.map((call) => call[2])).toEqual([
      "quota:15129394:20261022",
      "quota:15129394:20261022",
      "quota:15129394:20261023",
    ]);
    expect(args.every((call) => call[4] === 172800)).toBe(true);
  });

  it("treats an expired/missing key as zero for status and does not accept malformed counters", async () => {
    const p = port();
    const store = createRedisQuotaStore(p.redis, { dailyLimit: 2 });
    const at = new Date("2026-10-22T03:00:00Z");
    expect(await store.get("15129394", at)).toBe(0);
    p.get.mockResolvedValueOnce("invalid");
    expect(await store.get("15129394", at)).toBeNaN();
    p.evalCommand.mockResolvedValueOnce(0);
    expect(await store.reserve("15129394", at)).toBe(false);
  });

  it("rejects failed or unexpected EVAL results instead of granting a reservation", async () => {
    const p = port("1");
    const store = createRedisQuotaStore(p.redis, { dailyLimit: 2 });
    const at = new Date("2026-10-22T03:00:00Z");
    await expect(store.reserve("15129394", at)).rejects.toThrow("invalid reservation result");
    p.evalCommand.mockRejectedValueOnce(new Error("test connection unavailable"));
    await expect(store.reserve("15129394", at)).rejects.toThrow("test connection unavailable");
  });

  it("marks provider exhaustion in one atomic command without a GET/INCR race", async () => {
    const p = port();
    const store = createRedisQuotaStore(p.redis, { dailyLimit: 10 });
    await store.markExhausted("15129394", new Date("2026-10-22T03:00:00Z"));
    expect(p.evalCommand).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "quota:15129394:20261022",
      10,
      QUOTA_KEY_TTL_SECONDS,
    );
    expect(p.get).not.toHaveBeenCalled();
    expect(p.incrby).not.toHaveBeenCalled();
  });
});
