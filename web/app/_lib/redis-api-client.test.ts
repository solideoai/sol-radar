import { afterEach, describe, expect, it, vi } from "vitest";
import { relayRedisApi, readRedisApiReadiness } from "./redis-api-client";
import { getReadiness } from "@/server/health";

const TOKEN = "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const USER_TOKEN = "test-user-jwt";
const RUN = "c1000000-0000-4000-8000-000000000001";
const PATH = "/api/v1/bids/b1000000-0000-4000-8000-000000000001/analyses";
const env = { REDIS_API_BASE_URL: "https://acropolissg.com/redis/", REDIS_API_TOKEN: TOKEN };
const accessToken = async () => USER_TOKEN;
const accepted = (extra: object = {}) =>
  Response.json(
    {
      analysisId: RUN,
      status: "QUEUED",
      deduplicated: false,
      pollUrl: `/api/v1/analyses/${RUN}`,
      ...extra,
    },
    { status: 202 },
  );
const request = (body = "{}") =>
  new Request(`https://app.invalid${PATH}`, { method: "POST", body });
afterEach(() => vi.useRealTimers());

describe("Redis HTTPS client boundary", () => {
  it("replays the same key/body when a 202 response stream fails after headers", async () => {
    const attempts: RequestInit[] = [];
    const send: typeof fetch = async (_url, init) => {
      attempts.push(init ?? {});
      if (attempts.length > 1) return accepted();
      let chunkSent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunkSent) controller.error(new TypeError("socket closed after headers"));
            else {
              chunkSent = true;
              controller.enqueue(new TextEncoder().encode('{"analysisId":'));
            }
          },
        }),
        { status: 202 },
      );
    };
    const result = await relayRedisApi(request('{ "force": false }'), PATH, {
      env,
      send,
      accessToken,
    });
    expect(result.status).toBe(202);
    expect(attempts).toHaveLength(2);
    expect(new Headers(attempts[1].headers).get("Idempotency-Key")).toBe(
      new Headers(attempts[0].headers).get("Idempotency-Key"),
    );
    expect(attempts[1].body).toEqual(attempts[0].body);
  });
  it("retries a lost response with one stable generated key and the same bytes", async () => {
    const attempts: RequestInit[] = [];
    const send: typeof fetch = async (_url, init) => {
      attempts.push(init ?? {});
      if (attempts.length === 1) throw new Error("response lost");
      return accepted();
    };
    const result = await relayRedisApi(request('{ "force": false }'), PATH, {
      env,
      send,
      accessToken,
    });
    expect(result.status).toBe(202);
    expect(attempts).toHaveLength(2);
    const keys = attempts.map((a) => new Headers(a.headers).get("Idempotency-Key"));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(attempts[1].body).toEqual(attempts[0].body);
  });

  it.each([502, 503, 504])(
    "retries %i at most once, then normalizes to a safe 503",
    async (status) => {
      const send = vi.fn(async () => new Response(`<html>${TOKEN}</html>`, { status }));
      const result = await relayRedisApi(request(), PATH, { env, send, accessToken });
      expect(result.status).toBe(503);
      expect(send).toHaveBeenCalledTimes(2);
      expect(await result.text()).not.toContain(TOKEN);
    },
  );

  it.each([400, 401, 403, 404, 409, 429])(
    "does not automatically replay %i and keeps request ID consistent",
    async (status) => {
      const send = vi.fn(async () =>
        Response.json(
          {
            error: { code: "VALIDATION_ERROR", message: "검증 실패", details: {}, requestId: RUN },
          },
          { status },
        ),
      );
      const result = await relayRedisApi(request(), PATH, { env, send, accessToken });
      expect(result.status).toBe(status);
      expect(send).toHaveBeenCalledTimes(1);
      expect(result.headers.get("X-Request-Id")).toBe((await result.json()).error.requestId);
    },
  );

  it.each([
    () => new Response("<html>bad gateway</html>", { status: 200 }),
    () => accepted({ pollUrl: "https://evil.invalid/leak" }),
    () => accepted({ analysisId: TOKEN }),
    () => new Response(null, { status: 307, headers: { Location: "https://evil.invalid" } }),
    () => Response.json({ error: { message: TOKEN } }, { status: 401 }),
  ])("fails closed for invalid response or redirects", async (response) => {
    const result = await relayRedisApi(request(), PATH, {
      env,
      accessToken,
      send: async () => response(),
    });
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(TOKEN);
    expect(result.headers.has("location")).toBe(false);
  });

  it("caps body size without calling upstream", async () => {
    const send = vi.fn();
    const result = await relayRedisApi(request("a".repeat(16 * 1024 + 1)), PATH, {
      env,
      send,
      accessToken,
    });
    expect(result.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("caps response streams and strips unknown success fields", async () => {
    const tooLarge = await relayRedisApi(request(), PATH, {
      env,
      accessToken,
      send: async () => new Response("a".repeat(1024 * 1024 + 1), { status: 202 }),
    });
    expect(tooLarge.status).toBe(503);
    const safe = await relayRedisApi(request(), PATH, {
      env,
      accessToken,
      send: async () => accepted({ secret: "must-not-return" }),
    });
    expect((await safe.json()).secret).toBeUndefined();
  });

  it("aborts a hung request within the single total deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const pending = relayRedisApi(request(), PATH, {
      env: { ...env, REDIS_API_TIMEOUT_MS: "100" },
      accessToken,
      send: async (_url, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => undefined);
      },
    });
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).status).toBe(503);
    expect(signal?.aborted).toBe(true);
  });

  it("never relays arbitrary paths, GETs or missing users", async () => {
    const send = vi.fn();
    expect(
      (await relayRedisApi(request(), "//evil.invalid", { env, send, accessToken })).status,
    ).toBe(404);
    expect(
      (
        await relayRedisApi(new Request(`https://app.invalid${PATH}`), PATH, {
          env,
          send,
          accessToken,
        })
      ).status,
    ).toBe(404);
    expect(
      (await relayRedisApi(request(), PATH, { env, send, accessToken: async () => null })).status,
    ).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels an unfinished incoming body at the deadline without a late upstream send", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const init = { method: "POST", body, duplex: "half" };
    const send = vi.fn();
    const pending = relayRedisApi(new Request(`https://app.invalid${PATH}`, init), PATH, {
      env: { ...env, REDIS_API_TIMEOUT_MS: "100" },
      accessToken,
      send,
    });
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).status).toBe(503);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("remote readiness does not need Redis TCP", () => {
  const healthy = { status: "ok", checks: { db: "ok", redis: "ok", storage: "ok", ai: "mock" } };
  it("preserves degraded readiness when only the backend AI probe times out", async () => {
    vi.useFakeTimers();
    const pending = readRedisApiReadiness({
      env,
      send: async () => {
        const result = await getReadiness({
          db: async () => "ok",
          redis: async () => "ok",
          storage: async () => "ok",
          ai: () => new Promise(() => undefined),
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Response.json(result.body, { status: result.httpStatus });
      },
    });
    await vi.advanceTimersByTimeAsync(2101);
    expect(await pending).toEqual({
      httpStatus: 200,
      body: {
        status: "degraded",
        checks: { db: "ok", redis: "ok", storage: "ok", ai: "unavailable" },
      },
    });
  });
  it("sends only the service token to /redis/health", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json(healthy));
    const result = await readRedisApiReadiness({ env, send });
    expect(result).toEqual({ httpStatus: 200, body: healthy });
    expect(send.mock.calls[0]?.[0]).toBe("https://acropolissg.com/redis/health");
    const init = send.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(new Headers(init.headers).get("X-Sol-Service-Token")).toBe(TOKEN);
  });
  it.each([401, 502])("%i produces unavailable instead of normal health", async (status) => {
    expect(
      (await readRedisApiReadiness({ env, send: async () => new Response("error", { status }) }))
        .httpStatus,
    ).toBe(503);
  });
  it("rejects internally inconsistent health", async () => {
    const result = await readRedisApiReadiness({
      env,
      send: async () =>
        Response.json({ ...healthy, checks: { ...healthy.checks, redis: "unavailable" } }),
    });
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
  });
});
