import { describe, expect, it, vi } from "vitest";
import { quotaKey, quotaState } from "@/server/ingestion";
import {
  QUOTA_KEY_TTL_SECONDS,
  createRedisQuotaStore,
  type QuotaRedis,
} from "@/worker/quota-store";

// C8 M1 Redis 호출 예산 카운터(07 §2.2). ioredis 의 get·set·incrby·expire 만 흉내 낸다. 실제 Redis 는 부르지 않는다.
const SERVICE = "15129394";
const AT = new Date("2026-10-19T03:00:00.000Z");
const KEY = quotaKey(SERVICE, AT);
const LIMIT = 1000;

type Command = [name: string, ...args: (string | number)[]];

const fakeRedis = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const ttl = new Map<string, number>();
  const commands: Command[] = [];
  const redis: QuotaRedis = {
    get: vi.fn(async (key: string) => {
      commands.push(["get", key]);
      return values.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string | number, ...rest: unknown[]) => {
      commands.push(["set", key, String(value), ...rest.map(String)]);
      values.set(key, String(value));
      if (rest[0] === "EX" && typeof rest[1] === "number") ttl.set(key, rest[1]);
      return "OK";
    }),
    incrby: vi.fn(async (key: string, increment: number | string) => {
      commands.push(["incrby", key, Number(increment)]);
      const current = values.get(key);
      if (current !== undefined && !/^-?\d+$/.test(current)) {
        throw new Error("ERR value is not an integer or out of range");
      }
      const next = Number(current ?? "0") + Number(increment);
      values.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number | string) => {
      commands.push(["expire", key, Number(seconds)]);
      ttl.set(key, Number(seconds));
      return 1;
    }),
  } as unknown as QuotaRedis;
  return { redis, values, ttl, commands };
};

describe("createRedisQuotaStore", () => {
  it("키가 없으면 0 이다", async () => {
    const { redis } = fakeRedis();
    await expect(
      createRedisQuotaStore(redis, { dailyLimit: LIMIT }).get(SERVICE, AT),
    ).resolves.toBe(0);
  });

  it("add 는 quota:{serviceId}:{KST 날짜} 키에 INCRBY 하고 TTL 2일을 걸고 더한 뒤 값을 돌려준다", async () => {
    const { redis, commands, ttl } = fakeRedis();
    const store = createRedisQuotaStore(redis, { dailyLimit: LIMIT });

    const used = await store.add(SERVICE, AT, 4);

    expect([used, KEY, commands, ttl.get(KEY)]).toEqual([
      4,
      "quota:15129394:20261019",
      [
        ["incrby", KEY, 4],
        ["expire", KEY, QUOTA_KEY_TTL_SECONDS],
      ],
      2 * 24 * 60 * 60,
    ]);
  });

  it("add 를 거듭하면 누적된다(다른 worker 가 더한 값 위에 더한다)", async () => {
    const { redis } = fakeRedis({ [KEY]: "260" });
    const store = createRedisQuotaStore(redis, { dailyLimit: LIMIT });
    await expect(store.add(SERVICE, AT, 3)).resolves.toBe(263);
    await expect(store.get(SERVICE, AT)).resolves.toBe(263);
  });

  it("숫자가 아닌 값이 들어 있으면 NaN 을 돌려주고 quotaState 는 EXHAUSTED 다(메우지 않는다)", async () => {
    const { redis } = fakeRedis({ [KEY]: "garbage" });
    const used = await createRedisQuotaStore(redis, { dailyLimit: LIMIT }).get(SERVICE, AT);
    expect([Number.isNaN(used), quotaState(used, LIMIT)]).toEqual([true, "EXHAUSTED"]);
  });

  it("markExhausted 는 한도까지의 차이만 INCRBY 해 값을 한도로 올린다", async () => {
    const { redis, commands, values } = fakeRedis({ [KEY]: "266" });
    const store = createRedisQuotaStore(redis, { dailyLimit: LIMIT });

    await store.markExhausted(SERVICE, AT);

    expect([values.get(KEY), commands]).toEqual([
      "1000",
      [
        ["get", KEY],
        ["incrby", KEY, 734],
        ["expire", KEY, QUOTA_KEY_TTL_SECONDS],
      ],
    ]);
  });

  it("markExhausted 는 이미 한도를 넘은 값을 내리지 않는다(INCRBY 없이 TTL 만 다시 건다)", async () => {
    const { redis, commands, values } = fakeRedis({ [KEY]: "1003" });

    await createRedisQuotaStore(redis, { dailyLimit: LIMIT }).markExhausted(SERVICE, AT);

    expect([values.get(KEY), commands.map(([name]) => name)]).toEqual(["1003", ["get", "expire"]]);
  });

  it("markExhausted 는 키가 없으면 0 에서 한도만큼 올린다", async () => {
    const { redis, values } = fakeRedis();
    await createRedisQuotaStore(redis, { dailyLimit: LIMIT }).markExhausted(SERVICE, AT);
    expect(values.get(KEY)).toBe("1000");
  });

  it("markExhausted 는 읽을 수 없는 값이면 SET 으로 한도를 덮고 TTL 을 건다", async () => {
    const { redis, values, ttl, commands } = fakeRedis({ [KEY]: "garbage" });

    await createRedisQuotaStore(redis, { dailyLimit: LIMIT }).markExhausted(SERVICE, AT);

    expect([values.get(KEY), ttl.get(KEY), commands.map(([name]) => name)]).toEqual([
      "1000",
      QUOTA_KEY_TTL_SECONDS,
      ["get", "set"],
    ]);
  });

  it("calls 가 0 이상 정수가 아니면 Redis 를 부르기 전에 던진다", async () => {
    const { redis, commands } = fakeRedis();
    await expect(
      createRedisQuotaStore(redis, { dailyLimit: LIMIT }).add(SERVICE, AT, -1),
    ).rejects.toThrow("calls");
    expect(commands).toEqual([]);
  });

  it("dailyLimit 이 0 이상 정수가 아니면 만들 때 던진다", () => {
    expect(() => createRedisQuotaStore(fakeRedis().redis, { dailyLimit: -1 })).toThrow(
      "RedisQuotaStore",
    );
  });
});
