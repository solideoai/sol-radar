import { afterEach, describe, expect, it, vi } from "vitest";
import { relayRedisApi, readRedisApiReadiness } from "./redis-api-client";
import { getReadiness } from "@/server/health";

const TOKEN = "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const USER_TOKEN = "test-user-jwt";
const RUN = "c1000000-0000-4000-8000-000000000001";
const PATH = "/api/v1/bids/b1000000-0000-4000-8000-000000000001/analyses";
const INGEST_PATH = "/api/v1/admin/ingestion/runs";
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
  it("preserves hosted-not-approved status and matching error request IDs for ADMIN GET", async () => {
    const path = "/api/v1/admin/ai/status";
    const response = await relayRedisApi(new Request(`https://app.invalid${path}`), path, {
      env,
      accessToken,
      send: async () =>
        Response.json(
          {
            error: {
              code: "HOSTED_NOT_APPROVED",
              message: "hosted AI 사용 미승인",
              details: {},
              requestId: RUN,
            },
          },
          { status: 422 },
        ),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("HOSTED_NOT_APPROVED");
    expect(response.headers.get("X-Request-Id")).toBe(body.error.requestId);
  });
  it("fails closed for malformed AI status and a timed out ADMIN GET", async () => {
    const path = "/api/v1/admin/ai/status";
    const request = new Request(`https://app.invalid${path}`);
    const malformed = await relayRedisApi(request, path, {
      env,
      accessToken,
      send: async () => Response.json({ gateway: { healthy: true } }),
    });
    expect(malformed.status).toBe(503);
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const pending = relayRedisApi(request, path, {
      env: { ...env, REDIS_API_TIMEOUT_MS: "100" },
      accessToken,
      send: async (_url, init) => {
        signal = init?.signal;
        return new Promise(() => undefined);
      },
    });
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).status).toBe(503);
    expect(signal?.aborted).toBe(true);
  });
  it("preserves external ingestion sources and safe run metadata", async () => {
    for (const [source, serviceKey] of [
      ["kwater", "kwater-bid-notice"],
      ["lh", "lh-bid-notice"],
      ["kepco", "kepco-ebid-contract"],
    ]) {
      const result = await relayRedisApi(
        new Request(`https://app.invalid${INGEST_PATH}`, { method: "POST", body: "{}" }),
        INGEST_PATH,
        {
          env,
          accessToken,
          send: async () =>
            Response.json(
              {
                id: RUN,
                source,
                serviceKey,
                completeness: "UNKNOWN",
                fetchedCount: 0,
                runMode: "live",
                batch: null,
                trigger: "MANUAL",
                status: "RUNNING",
                summary: {
                  created: 0,
                  changed: 0,
                  cancelled: 0,
                  skippedDuplicate: 0,
                  quarantined: 0,
                  retried: 0,
                },
                quotaUsed: 0,
                errors: [],
                cursor: null,
                requestedBy: null,
                startedAt: "2026-10-22T00:00:00Z",
                finishedAt: null,
                privateField: "must-not-return",
              },
              { status: 202 },
            ),
        },
      );
      expect(result.status).toBe(202);
      const body = await result.json();
      expect(body).toMatchObject({ source, serviceKey, completeness: "UNKNOWN", fetchedCount: 0 });
      expect(body.privateField).toBeUndefined();
    }
  });

  // registry 사유(DISABLED)와 Worker 상태 사유(WORKER_NOT_READY·KEY_MISSING·AUTH_FAILED)를 모두 그대로 전한다.
  it.each(["DISABLED", "WORKER_NOT_READY", "KEY_MISSING", "AUTH_FAILED"])(
    "preserves a whitelisted source-readiness 503 (%s) without retrying or echoing upstream details",
    async (reason) => {
      const send = vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "https://private.invalid/?apiKey=must-not-return",
              details: {
                component: "source",
                source: "kepco",
                serviceKey: "kepco-ebid-contract",
                reason,
                requestUrl: "https://private.invalid/?apiKey=must-not-return",
              },
              requestId: RUN,
            },
          },
          { status: 503, headers: { "Set-Cookie": "must-not-return" } },
        ),
      );
      const result = await relayRedisApi(
        new Request(`https://app.invalid${INGEST_PATH}`, { method: "POST", body: "{}" }),
        INGEST_PATH,
        { env, send, accessToken },
      );
      expect(result.status).toBe(503);
      expect(send).toHaveBeenCalledTimes(1);
      expect(result.headers.get("X-Request-Id")).toBe(RUN);
      expect(result.headers.has("set-cookie")).toBe(false);
      expect(await result.json()).toEqual({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "아직 사용할 수 없는 수집 서비스입니다",
          details: {
            component: "source",
            source: "kepco",
            serviceKey: "kepco-ebid-contract",
            reason,
          },
          requestId: RUN,
        },
      });
    },
  );

  it("normalizes unrecognized source-readiness reasons instead of exposing upstream text", async () => {
    const send = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "https://private.invalid/credentials",
            details: {
              component: "source",
              source: "kepco",
              serviceKey: "kepco-ebid-contract",
              reason: "https://private.invalid/credentials",
            },
            requestId: RUN,
          },
        },
        { status: 503 },
      ),
    );
    const result = await relayRedisApi(
      new Request(`https://app.invalid${INGEST_PATH}`, { method: "POST", body: "{}" }),
      INGEST_PATH,
      { env, send, accessToken },
    );
    expect(result.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await result.json()).error.details).toEqual({ component: "redis-api" });
  });

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
  it("reports an upstream 502 without logging credentials or upstream response text", async () => {
    const diagnose = vi.fn();
    const response = await readRedisApiReadiness({
      env,
      diagnose,
      send: async () => new Response(`private ${TOKEN}`, { status: 502 }),
    });
    expect(response.httpStatus).toBe(503);
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "UPSTREAM_HTTP", httpStatus: 502 }),
    );
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain("acropolissg.com");
  });
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

// 10-26 운영 전환: 수동 수집 gate 상태 GET 과 새 거절 코드가 frontend 중계를 지나 그대로 전해지는가.
describe("manual ingestion gate relay", () => {
  const GATE_PATH = "/api/v1/admin/ingestion/manual-gate";
  const ISO = "2026-10-26T05:10:00.000Z";
  const gateView = {
    cooldownMinutes: 60,
    nextAvailableAt: ISO,
    sharedRun: { runId: RUN, requestedAt: "2026-10-26T04:10:00.000Z", until: ISO, mine: true },
    daily: { used: 1, limit: 20, resetsAt: "2026-10-26T15:00:00.000Z" },
    schedule: {
      pattern: "0 */3 * * *",
      timezone: "Asia/Seoul",
      slotHoursKst: [0, 3, 6, 9, 12, 15, 18, 21],
      active: true,
      nextRunAt: "2026-10-26T06:00:00.000Z",
    },
    ingestMode: "live",
  };
  const errorOf = (code: string, details: object) => ({
    error: { code, message: "거절", details, requestId: RUN },
  });

  it("reads the gate with GET, JWT and service token only, and strips unknown fields", async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ ...gateView, secretField: "must-not-return" }),
    );
    const result = await relayRedisApi(new Request(`https://app.invalid${GATE_PATH}`), GATE_PATH, {
      env,
      accessToken,
      send,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(gateView);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://acropolissg.com/redis${GATE_PATH}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${USER_TOKEN}`);
    expect(headers.get("x-sol-service-token")).toBe(TOKEN);
    expect(headers.has("idempotency-key")).toBe(false);
  });

  it("passes worker service states through the gate relay", async () => {
    const services = {
      "lh-bid-notice": { state: "KEY_MISSING", scheduled: false },
      "kwater-bid-notice": { state: "NOT_CALLABLE", reason: "DISABLED", scheduled: false },
    };
    const result = await relayRedisApi(new Request(`https://app.invalid${GATE_PATH}`), GATE_PATH, {
      env,
      accessToken,
      send: async () => Response.json({ ...gateView, services }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ...gateView, services });
  });

  // redis-api 가 웹보다 새 버전이어도(새 서비스·새 상태) 판정 전체를 거절하지 않는다. [지금 불러오기]가 막히면 안 된다.
  it("keeps the gate when worker service states come from a newer redis-api", async () => {
    const relay = (services: unknown) =>
      relayRedisApi(new Request(`https://app.invalid${GATE_PATH}`), GATE_PATH, {
        env,
        accessToken,
        send: async () => Response.json({ ...gateView, services }),
      });
    const newer = await relay({
      "lh-bid-notice": { state: "READY", scheduled: true },
      "kwater-bid-notice": { state: "PAUSED_BY_OPERATOR", scheduled: false },
      "new-agency-notice": { state: "READY", scheduled: true },
    });
    expect(newer.status).toBe(200);
    expect(await newer.json()).toEqual({
      ...gateView,
      services: { "lh-bid-notice": { state: "READY", scheduled: true } },
    });
    const malformed = await relay("not-an-object");
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toEqual({ ...gateView, services: null });
  });

  it("fails closed for a malformed gate body or an upstream Redis outage", async () => {
    for (const upstream of [
      Response.json({ ...gateView, ingestMode: "prod" }),
      Response.json({ ...gateView, sharedRun: { ...gateView.sharedRun, mine: undefined } }),
      Response.json(errorOf("SERVICE_UNAVAILABLE", { component: "redis" }), { status: 503 }),
    ]) {
      const result = await relayRedisApi(
        new Request(`https://app.invalid${GATE_PATH}`),
        GATE_PATH,
        { env, accessToken, send: async () => upstream },
      );
      expect(result.status).toBe(503);
      expect((await result.json()).error.details).toEqual({ component: "redis-api" });
    }
  });

  it("passes the scheduler-inactive 503 through without retrying", async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json(
        errorOf("SERVICE_UNAVAILABLE", {
          component: "ingest-worker",
          reason: "SCHEDULER_INACTIVE",
        }),
        { status: 503 },
      ),
    );
    const result = await relayRedisApi(
      new Request(`https://app.invalid${INGEST_PATH}`, { method: "POST", body: "{}" }),
      INGEST_PATH,
      { env, accessToken, send },
    );
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "수집 Worker 가 아직 켜지지 않았습니다",
        details: { component: "ingest-worker", reason: "SCHEDULER_INACTIVE" },
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [INGEST_PATH, 429, "MANUAL_COOLDOWN", { nextAvailableAt: ISO, retryAfterSeconds: 2400 }],
    [
      INGEST_PATH,
      429,
      "MANUAL_DAILY_LIMIT",
      { limit: 20, nextAvailableAt: ISO, retryAfterSeconds: 9 },
    ],
    [
      INGEST_PATH,
      409,
      "MANUAL_SHARED_RUN",
      { runId: RUN, requestedAt: ISO, nextAvailableAt: ISO, retryAfterSeconds: 600, mine: false },
    ],
    [PATH, 409, "ANALYSIS_SOURCE_MISSING", { reason: "SOURCE_TEXT_MISSING" }],
  ])("passes %s %i %s with its details", async (path, status, code, details) => {
    const result = await relayRedisApi(
      new Request(`https://app.invalid${path}`, { method: "POST", body: "{}" }),
      path,
      {
        env,
        accessToken,
        send: async () =>
          Response.json(errorOf(code, details), {
            status,
            headers: status === 429 ? { "Retry-After": "2400" } : {},
          }),
      },
    );
    expect(result.status).toBe(status);
    expect((await result.json()).error).toMatchObject({ code, details });
    expect(result.headers.get("retry-after")).toBe(status === 429 ? "2400" : null);
  });
});
