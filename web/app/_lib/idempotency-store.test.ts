import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdempotencyStore } from "./idempotency-store";

// 수동 수집(N8) 같은 키 판정 저장소(계획 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1 7·9번, §2 idempotency-store.ts).
// 값 {requestHash, runId, startedAt, requesterId}, 잡기는 SET NX EX 한 명령, 연결과 명령 전체 3000ms 제한.
// requesterId(첫 202 를 받은 사람)는 보안 점검 후속 I1(2026-10-20)에서 더했다. 그 전에 쓴 기록에는 없다(하위 호환으로 읽는다).
// 가짜 Redis: 공용 연결(readyRedis)을 명령을 기록하는 가짜 클라이언트로 바꾼다. 실제 Redis 에 붙지 않는다.

const redis = vi.hoisted(() => ({
  client: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  ready: vi.fn(),
}));
vi.mock("./redis-client", () => ({ readyRedis: redis.ready, sharedRedis: vi.fn() }));

const REDIS_URL = "redis://redis:6379";
const KEY = "idem:ingest:9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d:req-1";
// requesterId 를 더하기 전(I1 이전)에 쓴 기록
const LEGACY_RECORD = {
  requestHash: "5f2c9e0b7a",
  runId: "a8000000-0000-4000-8000-000000000001",
  startedAt: "2026-10-20T03:04:05.000Z",
};
const RECORD = { ...LEGACY_RECORD, requesterId: "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f" };
const TTL = 86_400;

const never = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  redis.ready.mockResolvedValue(redis.client);
  redis.client.set.mockResolvedValue("OK");
  redis.client.get.mockResolvedValue(null);
  redis.client.del.mockResolvedValue(1);
});
afterEach(() => vi.useRealTimers());

// SET 의 옵션 인자(key·value 뒤)에서 NX 하나와 EX <ttl> 하나만 있는지 본다. 순서는 Redis 가 가리지 않는다.
function expectSetNxEx(args: unknown[], ttlSeconds: number) {
  const options = args.slice(2);
  expect(options.filter((option) => option === "NX")).toHaveLength(1);
  const ex = options.indexOf("EX");
  expect(ex).toBeGreaterThanOrEqual(0);
  expect(options[ex + 1]).toBe(ttlSeconds);
  expect(options).toHaveLength(3);
}

describe("createIdempotencyStore — claim", () => {
  it("SET key <JSON 값> NX EX <ttl> 한 명령으로 잡는다", async () => {
    const store = createIdempotencyStore({ redisUrl: REDIS_URL });

    await store.claim(KEY, RECORD, TTL);

    expect(redis.client.set).toHaveBeenCalledTimes(1);
    const args = redis.client.set.mock.calls[0] ?? [];
    expect(args[0]).toBe(KEY);
    expect(JSON.parse(String(args[1]))).toEqual(RECORD);
    expectSetNxEx(args, TTL);
  });

  it('Redis 가 "OK" 면 처음 잡은 것이라 true 다', async () => {
    redis.client.set.mockResolvedValue("OK");

    expect(await createIdempotencyStore({ redisUrl: REDIS_URL }).claim(KEY, RECORD, TTL)).toBe(
      true,
    );
  });

  it("Redis 가 null(이미 있음) 이면 false 다", async () => {
    redis.client.set.mockResolvedValue(null);

    expect(await createIdempotencyStore({ redisUrl: REDIS_URL }).claim(KEY, RECORD, TTL)).toBe(
      false,
    );
  });

  it("SET 이 던지면 claim 도 던진다(서비스가 503 redis 로 끝낸다)", async () => {
    redis.client.set.mockRejectedValue(new Error("READONLY"));

    await expect(
      createIdempotencyStore({ redisUrl: REDIS_URL }).claim(KEY, RECORD, TTL),
    ).rejects.toThrow("READONLY");
  });
});

describe("createIdempotencyStore — get", () => {
  it("키가 없으면 null 이다", async () => {
    redis.client.get.mockResolvedValue(null);

    expect(await createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY)).toBeNull();
    expect(redis.client.get).toHaveBeenCalledWith(KEY);
  });

  it("저장된 JSON 을 {requestHash, runId, startedAt, requesterId} 로 읽는다", async () => {
    redis.client.get.mockResolvedValue(JSON.stringify(RECORD));

    expect(await createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY)).toEqual(RECORD);
  });

  it("requesterId 가 없는 옛 기록도 읽고, requesterId 는 비어 있다(하위 호환: 재현의 requestedBy null)", async () => {
    redis.client.get.mockResolvedValue(JSON.stringify(LEGACY_RECORD));

    const read = await createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY);

    expect(read).toMatchObject(LEGACY_RECORD);
    // 없음(undefined)이든 null 이든 사람을 가리키지 않아야 한다
    expect(read).not.toHaveProperty("requesterId", expect.anything());
  });

  it("startedAt 이 +00:00 오프셋이어도 읽는다", async () => {
    const record = { ...RECORD, startedAt: "2026-10-20T03:04:05.123456+00:00" };
    redis.client.get.mockResolvedValue(JSON.stringify(record));

    expect(await createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY)).toEqual(record);
  });

  it.each<[string, string]>([
    ["JSON 이 아님", "{not json"],
    ["객체가 아님", JSON.stringify("text")],
    [
      "requestHash 없음",
      JSON.stringify({
        runId: RECORD.runId,
        startedAt: RECORD.startedAt,
        requesterId: RECORD.requesterId,
      }),
    ],
    ["requestHash 빈 문자열", JSON.stringify({ ...RECORD, requestHash: "" })],
    ["runId 가 UUID 아님", JSON.stringify({ ...RECORD, runId: "run-1" })],
    ["startedAt 이 시각 아님", JSON.stringify({ ...RECORD, startedAt: "어제" })],
    // 재현 때 이 값으로 구성원 이름을 찾는다(profiles.id 는 uuid). 깨진 값은 판정하지 않고 503 redis 로 끝낸다
    ["requesterId 가 UUID 아님", JSON.stringify({ ...RECORD, requesterId: "user-1" })],
    ["requesterId 가 문자열 아님", JSON.stringify({ ...RECORD, requesterId: 42 })],
    ["모르는 키", JSON.stringify({ ...RECORD, extra: 1 })],
  ])("저장값의 모양이 틀리면(%s) 던진다", async (_label, raw) => {
    redis.client.get.mockResolvedValue(raw);

    await expect(createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY)).rejects.toThrow();
  });
});

describe("createIdempotencyStore — release", () => {
  it("DEL key 로 푼다", async () => {
    await createIdempotencyStore({ redisUrl: REDIS_URL }).release(KEY);

    expect(redis.client.del).toHaveBeenCalledTimes(1);
    expect(redis.client.del).toHaveBeenCalledWith(KEY);
  });

  it("DEL 이 던지면 release 도 던진다", async () => {
    redis.client.del.mockRejectedValue(new Error("connection lost"));

    await expect(createIdempotencyStore({ redisUrl: REDIS_URL }).release(KEY)).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("createIdempotencyStore — 연결·제한 시간", () => {
  it("공용 연결을 기본 제한 3000ms 로 연다", async () => {
    await createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY);

    expect(redis.ready).toHaveBeenCalledWith(REDIS_URL, 3000);
  });

  it("Redis 주소가 없으면 세 명령 모두 연결하지 않고 던진다", async () => {
    const store = createIdempotencyStore({ redisUrl: undefined });

    await expect(store.get(KEY)).rejects.toThrow();
    await expect(store.claim(KEY, RECORD, TTL)).rejects.toThrow();
    await expect(store.release(KEY)).rejects.toThrow();
    expect(redis.ready).not.toHaveBeenCalled();
  });

  it("명령이 3000ms 안에 끝나지 않으면 던진다(2999ms 에는 아직 기다린다)", async () => {
    vi.useFakeTimers();
    redis.client.set.mockReturnValue(never());
    const settled = vi.fn();

    const claim = createIdempotencyStore({ redisUrl: REDIS_URL }).claim(KEY, RECORD, TTL);
    claim.then(settled, settled);
    const result = expect(claim).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
  });

  it("연결이 3000ms 안에 준비되지 않아도 던진다", async () => {
    vi.useFakeTimers();
    redis.ready.mockReturnValue(never());

    const result = expect(
      createIdempotencyStore({ redisUrl: REDIS_URL }).get(KEY),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(redis.client.get).not.toHaveBeenCalled();
  });

  it("timeoutMs 를 주면 그 값으로 연결하고 자른다", async () => {
    vi.useFakeTimers();
    redis.client.del.mockReturnValue(never());

    const result = expect(
      createIdempotencyStore({ redisUrl: REDIS_URL, timeoutMs: 50 }).release(KEY),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(redis.ready).toHaveBeenCalledWith(REDIS_URL, 50);
  });
});
