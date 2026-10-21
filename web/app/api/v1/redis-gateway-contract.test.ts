import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import { POST as requestAnalysis } from "./bids/[id]/analyses/route";
import { POST as requestIngestion } from "./admin/ingestion/runs/route";
import { GET as getAnalysis } from "./analyses/[id]/route";

const { tcpDeps, authGate } = vi.hoisted(() => ({
  authGate: { wait: null as Promise<void> | null },
  tcpDeps: vi.fn(() => {
    throw new Error("frontend must not construct local queue dependencies");
  }),
}));
vi.mock("@/app/_lib/work-deps", () => ({ workDeps: tcpDeps }));
vi.mock("@/app/_lib/ingestion-deps", () => ({ ingestionDeps: tcpDeps }));
vi.mock("next/headers", async () => (await import("./_lib/fake-session")).fakeNextHeaders);
vi.mock("@supabase/ssr", async () => {
  const { fakeCookieClient } = await import("./_lib/fake-session");
  return {
    createServerClient: () => {
      const client = fakeCookieClient();
      const getClaims = client.auth.getClaims;
      client.auth.getClaims = async () => {
        if (authGate.wait) await authGate.wait;
        return getClaims();
      };
      return client;
    },
  };
});
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("./_lib/fake-session")).fakeBearerClient,
}));

const TOKEN = "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const BID = "b1000000-0000-4000-8000-000000000001";
const RUN = "c1000000-0000-4000-8000-000000000001";
const KEY = "3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c";
const ANALYSIS_PATH = `/api/v1/bids/${BID}/analyses`;
const accepted = () =>
  Response.json(
    { analysisId: RUN, status: "QUEUED", deduplicated: false, pollUrl: `/api/v1/analyses/${RUN}` },
    { status: 202 },
  );

beforeEach(() => {
  resetFakeSession();
  authGate.wait = null;
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SOL_DEPLOYMENT_ROLE", "frontend");
  vi.stubEnv("REDIS_API_BASE_URL", "https://acropolissg.com/redis");
  vi.stubEnv("REDIS_API_TOKEN", TOKEN);
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("frontend → existing company API", () => {
  it("rechecks an account suspended between frontend authentication and backend submission", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api");
      fakeSession.profileStatus = "suspended";
      return requestAnalysis(
        fakeRequest(ANALYSIS_PATH, {
          method: "POST",
          headers: init?.headers,
          body: init?.body,
        }),
        { params: Promise.resolve({ id: BID }) },
      );
    });
    vi.stubGlobal("fetch", send);
    const response = await requestAnalysis(
      fakeRequest(ANALYSIS_PATH, {
        method: "POST",
        headers: { "X-Requested-With": "sol-radar" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: BID }) },
    );
    expect(response.status).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
    expect(tcpDeps).not.toHaveBeenCalled();
  });
  it("bounds initial authentication and prevents dispatch after authentication completes late", async () => {
    vi.useFakeTimers();
    vi.stubEnv("REDIS_API_TIMEOUT_MS", "100");
    fakeSession.cookie = FAKE_USERS.sales.token;
    let finishAuth = () => {};
    authGate.wait = new Promise<void>((resolve) => {
      finishAuth = resolve;
    });
    const send = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", send);
    const pending = requestAnalysis(
      fakeRequest(ANALYSIS_PATH, {
        method: "POST",
        headers: { "X-Requested-With": "sol-radar" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: BID }) },
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(503);
    finishAuth();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("authenticates a cookie request, forwards only JWT/service token and preserves public pollUrl", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    const send = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", send);
    const result = await requestAnalysis(
      fakeRequest(ANALYSIS_PATH, {
        method: "POST",
        headers: {
          "X-Requested-With": "sol-radar",
          "Content-Type": "application/json",
          "Idempotency-Key": KEY,
          "X-Sol-Service-Token": "forged",
          "X-Sol-Org-Id": "forged-org",
          cookie: "private-refresh-cookie",
        },
        body: '{ "force": false }',
      }),
      { params: Promise.resolve({ id: BID }) },
    );
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ pollUrl: `/api/v1/analyses/${RUN}` });
    expect(tcpDeps).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://acropolissg.com/redis${ANALYSIS_PATH}`);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${FAKE_USERS.sales.token}`);
    expect(headers.get("x-sol-service-token")).toBe(TOKEN);
    expect(headers.get("idempotency-key")).toBe(KEY);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("x-sol-org-id")).toBe(false);
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{ "force": false }');
    expect(init.redirect).toBe("manual");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cookie CSRF and malformed Bearer without contacting the company API", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    for (const [headers, status] of [
      [{}, 403],
      [{ Authorization: "invalid", "X-Requested-With": "sol-radar" }, 401],
    ] as const) {
      const result = await requestAnalysis(
        fakeRequest(ANALYSIS_PATH, { method: "POST", headers }),
        { params: Promise.resolve({ id: BID }) },
      );
      expect(result.status).toBe(status);
    }
    expect(send).not.toHaveBeenCalled();
    expect(tcpDeps).not.toHaveBeenCalled();
  });

  it("does not forward a suspended account", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    fakeSession.profileStatus = "suspended";
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const result = await requestAnalysis(
      fakeRequest(ANALYSIS_PATH, {
        method: "POST",
        headers: { "X-Requested-With": "sol-radar" },
      }),
      { params: Promise.resolve({ id: BID }) },
    );
    expect(result.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("forwards ingestion 429 and Retry-After without a second local limiter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "수집 요청 제한",
              details: { retryAfterSeconds: 17 },
              requestId: KEY,
            },
          },
          { status: 429, headers: { "Retry-After": "17", "Set-Cookie": "do-not-forward" } },
        ),
      ),
    );
    const result = await requestIngestion(
      fakeRequest("/api/v1/admin/ingestion/runs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FAKE_USERS.admin.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "fixture", batch: "seed" }),
      }),
    );
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("17");
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(tcpDeps).not.toHaveBeenCalled();
  });
});

describe("company API authenticates before business work", () => {
  beforeEach(() => vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api"));

  it.each([undefined, "wrong"])(
    "rejects missing/invalid service token (%s) before DB and queue",
    async (token) => {
      const headers = new Headers({ Authorization: `Bearer ${FAKE_USERS.sales.token}` });
      if (token) headers.set("X-Sol-Service-Token", token);
      const result = await requestAnalysis(
        fakeRequest(ANALYSIS_PATH, { method: "POST", headers }),
        {
          params: Promise.resolve({ id: BID }),
        },
      );
      expect(result.status).toBe(401);
      expect(tcpDeps).not.toHaveBeenCalled();
    },
  );

  it("requires a user Bearer even with a valid service token and cookie", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    const result = await getAnalysis(
      fakeRequest(`/api/v1/analyses/${RUN}`, {
        headers: { "X-Sol-Service-Token": TOKEN },
      }),
      { params: Promise.resolve({ id: RUN }) },
    );
    expect(result.status).toBe(401);
    expect(tcpDeps).not.toHaveBeenCalled();
  });
});
