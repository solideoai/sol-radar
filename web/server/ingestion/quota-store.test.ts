import { describe, expect, it } from "vitest";
import { quotaKey, quotaState } from "./quota";
import { createMemoryQuotaStore, validateCalls, validateDailyLimit } from "./quota-store";

// C8 M1 호출 예산 포트(07 §2.2)의 메모리 구현. Redis 구현(web/worker/quota-store.ts)과 같은 계약을 따라야 한다:
// 키는 quota:{serviceId}:{KST YYYYMMDD}, add 는 더한 뒤 값을 돌려주고, markExhausted 는 값을 한도 이상으로 올린다.
const SERVICE = "15129394";
const AT = new Date("2026-10-19T03:00:00.000Z");
// KST 로 다음 날(UTC 15:00 = KST 00:00)
const NEXT_DAY = new Date("2026-10-19T15:00:00.000Z");

describe("createMemoryQuotaStore", () => {
  it("기록이 없으면 0 이다", async () => {
    await expect(createMemoryQuotaStore({ dailyLimit: 1000 }).get(SERVICE, AT)).resolves.toBe(0);
  });

  it("add 는 더한 뒤 값을 돌려주고 get 이 같은 값을 읽는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await expect(store.add(SERVICE, AT, 4)).resolves.toBe(4);
    await expect(store.add(SERVICE, AT, 3)).resolves.toBe(7);
    await expect(store.get(SERVICE, AT)).resolves.toBe(7);
  });

  it("KST 날짜가 바뀌면 다른 키라 0 부터 센다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await store.add(SERVICE, AT, 999);
    await expect(store.get(SERVICE, NEXT_DAY)).resolves.toBe(0);
    expect([...store.used.keys()]).toEqual([quotaKey(SERVICE, AT)]);
  });

  it("서비스마다 따로 센다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await store.add(SERVICE, AT, 5);
    await expect(store.get("15129437", AT)).resolves.toBe(0);
  });

  it("markExhausted 는 값을 한도로 올려 상태가 EXHAUSTED 가 된다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await store.add(SERVICE, AT, 266);
    await store.markExhausted(SERVICE, AT);
    const used = await store.get(SERVICE, AT);
    expect([used, quotaState(used, 1000)]).toEqual([1000, "EXHAUSTED"]);
  });

  it("markExhausted 는 이미 한도를 넘은 값을 내리지 않는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await store.add(SERVICE, AT, 1003);
    await store.markExhausted(SERVICE, AT);
    await expect(store.get(SERVICE, AT)).resolves.toBe(1003);
  });

  it("add 에 0 을 주면 값이 바뀌지 않는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    await store.add(SERVICE, AT, 2);
    await expect(store.add(SERVICE, AT, 0)).resolves.toBe(2);
  });

  it.each([-1, 1.5, Number.NaN])(
    "add 의 calls 가 0 이상 정수가 아니면(%s) 던진다",
    async (calls) => {
      const store = createMemoryQuotaStore({ dailyLimit: 1000 });
      await expect(store.add(SERVICE, AT, calls)).rejects.toThrow("calls");
    },
  );

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])(
    "dailyLimit 이 0 이상 정수가 아니면(%s) 만들 때 던진다",
    (limit) => {
      expect(() => createMemoryQuotaStore({ dailyLimit: limit })).toThrow("dailyLimit");
    },
  );
});

describe("validateDailyLimit · validateCalls", () => {
  it("0 이상 정수는 그대로 돌려준다", () => {
    expect([validateDailyLimit(0, "x"), validateDailyLimit(1000, "x"), validateCalls(0)]).toEqual([
      0, 1000, 0,
    ]);
  });

  it("오류 메시지에 호출자 이름이 들어간다", () => {
    expect(() => validateDailyLimit(-1, "RedisQuotaStore")).toThrow("RedisQuotaStore");
  });
});
