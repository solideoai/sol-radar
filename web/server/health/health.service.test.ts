import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getReadiness } from "./health.service";

// 바깥 세계만 가짜로 바꾼다. 검사 함수·시간 제한·판정은 진짜 코드를 지난다.
const world = vi.hoisted(() => ({
  pingMode: "pong" as "pong" | "hang",
  dbError: null as { message: string } | null,
}));

vi.mock("ioredis", () => {
  class FakeRedis {
    on() {
      return this;
    }
    async connect() {}
    ping() {
      return world.pingMode === "hang" ? new Promise<string>(() => {}) : Promise.resolve("PONG");
    }
    async quit() {
      return "OK";
    }
    disconnect() {}
  }
  return { default: FakeRedis, Redis: FakeRedis };
});

vi.mock("@supabase/supabase-js", () => {
  const query = () => {
    const chain = {
      select: () => chain,
      limit: () => chain,
      abortSignal: () => Promise.resolve({ error: world.dbError }),
    };
    return chain;
  };
  return { createClient: () => ({ from: query }) };
});

type Reply = "hang" | { status: number; body?: unknown };
const routes = { storage: "ok" as Reply, ai: { status: 200, body: { provider: "mock" } } as Reply };

function respond(reply: Reply) {
  if (reply === "hang") return new Promise<Response>(() => {});
  return Promise.resolve(
    new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  world.pingMode = "pong";
  world.dbError = null;
  routes.storage = { status: 200 };
  routes.ai = { status: 200, body: { provider: "mock" } };
  vi.stubEnv("REDIS_URL", "redis://fake-redis.invalid");
  vi.stubEnv("MINIO_ENDPOINT", "http://fake-minio.invalid");
  vi.stubEnv("AI_GATEWAY_URL", "http://fake-gateway.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fake-supabase.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/minio/health/live")) return respond(routes.storage);
      if (url.endsWith("/health")) return respond(routes.ai);
      return Promise.reject(new Error(`예상하지 못한 요청: ${url}`));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getReadiness", () => {
  it("모든 의존성이 정상이면 200 ok", async () => {
    const result = await getReadiness();
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({
      status: "ok",
      checks: { db: "ok", redis: "ok", storage: "ok", ai: "mock" },
    });
  });

  it("provider local 응답은 checks.ai 가 local", async () => {
    routes.ai = { status: 200, body: { provider: "local" } };
    expect((await getReadiness()).body.checks.ai).toBe("local");
  });

  it("provider hosted 응답은 checks.ai 가 hosted", async () => {
    routes.ai = { status: 200, body: { provider: "hosted" } };
    expect((await getReadiness()).body.checks.ai).toBe("hosted");
  });

  it("알 수 없는 provider 는 unavailable 이고 전체는 200 degraded", async () => {
    routes.ai = { status: 200, body: { provider: "weird" } };
    const result = await getReadiness();
    expect(result.body.checks.ai).toBe("unavailable");
    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("degraded");
  });

  it("MinIO 가 200 이 아니면 storage 가 unavailable 이고 503", async () => {
    routes.storage = { status: 503 };
    const result = await getReadiness();
    expect(result.body.checks.storage).toBe("unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("Redis PING 이 응답하지 않으면 redis 가 unavailable (제한 시간 뒤)", async () => {
    vi.useFakeTimers();
    world.pingMode = "hang";
    const pending = getReadiness();
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;
    expect(result.body.checks.redis).toBe("unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("DB 오류가 있으면 db 가 unavailable 이고 503", async () => {
    world.dbError = { message: "boom" };
    const result = await getReadiness();
    expect(result.body.checks.db).toBe("unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("멈춘 검사는 시간 제한 뒤 unavailable", async () => {
    vi.useFakeTimers();
    routes.storage = "hang";
    world.pingMode = "hang";
    let settled = false;
    const pending = getReadiness().then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(settled).toBe(true);
    const result = await pending;
    expect(result.body.checks.storage).toBe("unavailable");
    expect(result.body.checks.redis).toBe("unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("멈춘 검사가 있어도 다른 검사 결과는 유지한다", async () => {
    vi.useFakeTimers();
    routes.storage = "hang";
    const pending = getReadiness();
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;
    expect(result.body.checks).toMatchObject({ db: "ok", redis: "ok", ai: "mock" });
  });

  it("검사가 예외를 던져도 getReadiness 는 던지지 않고 unavailable 로 바꾼다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const result = await getReadiness();
    expect(result.body.checks.storage).toBe("unavailable");
    expect(result.body.checks.ai).toBe("unavailable");
    expect(result.httpStatus).toBe(503);
  });
});
