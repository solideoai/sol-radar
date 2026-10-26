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
import { GET as getAdminAiStatus } from "./admin/ai/status/route";
import { GET as getManualGate } from "./admin/ingestion/manual-gate/route";

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
  it("reads ADMIN AI status through the company handler with JWT and service token", async () => {
    fakeSession.cookie = FAKE_USERS.admin.token;
    vi.stubEnv("AI_GATEWAY_URL", "http://ai-gateway:8000");
    const path = "/api/v1/admin/ai/status";
    const send = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === `https://acropolissg.com/redis${path}`) {
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBeNull();
        vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api");
        return getAdminAiStatus(fakeRequest(path, { headers: init?.headers }));
      }
      expect(url).toBe("http://ai-gateway:8000/health");
      return Response.json({
        status: "ok",
        runMode: "mock",
        provider: "mock",
        kevEnabled: true,
        qwen: null,
        kev: null,
        questionSets: [],
        parsers: [],
      });
    });
    vi.stubGlobal("fetch", send);
    const response = await getAdminAiStatus(fakeRequest(path));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ gateway: { healthy: true }, provider: "mock" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(tcpDeps).not.toHaveBeenCalled();
  });

  it("denies AI status for non-ADMIN and unauthenticated requests before dispatch", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    fakeSession.cookie = FAKE_USERS.sales.token;
    expect((await getAdminAiStatus(fakeRequest("/api/v1/admin/ai/status"))).status).toBe(403);
    fakeSession.cookie = null;
    expect((await getAdminAiStatus(fakeRequest("/api/v1/admin/ai/status"))).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api");
    expect(
      (
        await getAdminAiStatus(
          fakeRequest("/api/v1/admin/ai/status", {
            headers: { Authorization: `Bearer ${FAKE_USERS.admin.token}` },
          }),
        )
      ).status,
    ).toBe(401);
  });

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

// 10-26 운영 전환: 수동 수집 gate 상태 중계와 분석 원문 미확보 사전 차단.
describe("frontend → company API: manual gate and analysis source", () => {
  const GATE_PATH = "/api/v1/admin/ingestion/manual-gate";
  const gateView = {
    cooldownMinutes: 60,
    nextAvailableAt: null,
    sharedRun: null,
    daily: { used: 0, limit: 20, resetsAt: "2026-10-26T15:00:00.000Z" },
    schedule: {
      pattern: "0 */3 * * *",
      timezone: "Asia/Seoul",
      slotHoursKst: [0, 3, 6, 9, 12, 15, 18, 21],
      active: true,
      nextRunAt: "2026-10-26T06:00:00.000Z",
    },
    ingestMode: "live",
  };
  const analysisRequest = () =>
    requestAnalysis(
      fakeRequest(ANALYSIS_PATH, {
        method: "POST",
        headers: { "X-Requested-With": "sol-radar", "Idempotency-Key": KEY },
        body: "{}",
      }),
      { params: Promise.resolve({ id: BID }) },
    );
  const seedBid = (content: string, documents: Record<string, unknown>[] = []) => {
    const revisionId = "d1000000-0000-4000-8000-000000000001";
    fakeSession.tables = {
      bid_notices: [{ id: BID, latest_revision: 2 }],
      bid_revisions: [{ id: revisionId, bid_id: BID, revision: 2, content }],
      bid_documents: documents.map((row) => ({ bid_id: BID, revision_id: revisionId, ...row })),
    };
  };

  it("relays the ADMIN gate read with JWT and service token, without local Redis deps", async () => {
    fakeSession.cookie = FAKE_USERS.admin.token;
    const send = vi.fn<typeof fetch>(async () => Response.json(gateView));
    vi.stubGlobal("fetch", send);
    const response = await getManualGate(fakeRequest(GATE_PATH));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(gateView);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://acropolissg.com/redis${GATE_PATH}`);
    expect(init.method).toBe("GET");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${FAKE_USERS.admin.token}`);
    expect(headers.get("x-sol-service-token")).toBe(TOKEN);
    expect(tcpDeps).not.toHaveBeenCalled();
  });

  it("denies the gate read for non-ADMIN and unauthenticated requests before dispatch", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    fakeSession.cookie = FAKE_USERS.sales.token;
    const forbidden = await getManualGate(fakeRequest(GATE_PATH));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
    fakeSession.cookie = null;
    expect((await getManualGate(fakeRequest(GATE_PATH))).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    expect(tcpDeps).not.toHaveBeenCalled();
  });

  // 지금 분석 runtime 은 첨부 텍스트를 AI 에 넘기지 않는다(ANALYSIS_READS_ATTACHMENT_TEXT = false).
  // 그래서 본문이 없으면 파싱된 첨부가 있어도 막고, 첨부 조회도 하지 않는다. 첨부 reader 를 연결하면 PARSED·PARTIAL 줄의
  // 기대가 202 로 바뀌고, 첨부 조회가 생기므로 fake-session 에 in·not(is) 흉내도 더해야 한다.
  it.each([
    ["no attachment", "", []],
    [
      "only unparsed or unstored attachments",
      "",
      [
        { parse_status: "PENDING", text_object_key: "org/doc-1.txt" },
        { parse_status: "PARSED", text_object_key: null },
      ],
    ],
    ["a parsed attachment", "  ", [{ parse_status: "PARSED", text_object_key: "org/doc-1.txt" }]],
    ["a partial attachment", "", [{ parse_status: "PARTIAL", text_object_key: "org/doc-2.txt" }]],
  ])(
    "blocks analysis of a bid without body text (%s) before contacting the company API",
    async (_label, content, documents) => {
      fakeSession.cookie = FAKE_USERS.sales.token;
      seedBid(content, documents);
      const send = vi.fn();
      vi.stubGlobal("fetch", send);
      const result = await analysisRequest();
      expect(result.status).toBe(409);
      expect((await result.json()).error).toMatchObject({
        code: "ANALYSIS_SOURCE_MISSING",
        message: "공고 본문 미확보 · 분석 준비 중",
        details: { reason: "SOURCE_TEXT_MISSING" },
      });
      expect(send).not.toHaveBeenCalled();
      expect(tcpDeps).not.toHaveBeenCalled();
    },
  );

  it("relays analysis of a bid with body text", async () => {
    fakeSession.cookie = FAKE_USERS.sales.token;
    seedBid("과업 내용", []);
    const send = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", send);
    expect((await analysisRequest()).status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
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
