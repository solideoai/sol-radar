import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import { aiStatusSchema } from "@/server/health";
import { GET } from "./route";

// 05 §2 GET /api/v1/admin/ai/status 계약 시험. 인증·가입 완료·업무 조직 확인은 진짜 코드가 돌고
// Supabase SDK 전송만 fake-session 이 바꾼다(bids-contract.test.ts 머리와 같은 방식).
// gateway 는 AI_GATEWAY_URL + 전역 fetch 가짜로 바꾼다. 가짜 Supabase 는 fetch 를 쓰지 않는다.
// 근거: 05 79행(ADMIN 만)·385행 AiStatus·501행 422 HOSTED_NOT_APPROVED·684행(값은 gateway /health 에서만)·§5 오류 표.

vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
}));

const GATEWAY = "http://fake-gateway.invalid:8000";
const PROMPT_HASH = "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e";
// AI_PROVIDER=mock gateway 의 실제 /health 모양(services/ai/src/sol_ai/app.py)
const MOCK_HEALTH = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: { model: "fixture", promptHash: PROMPT_HASH },
  kev: { modelId: "mock", registryMatch: null },
  questionSets: ["kev-qs/v0.1"],
  parsers: [
    { format: "PDF", parserId: null },
    { format: "HWPX", parserId: null },
    { format: "HWP", parserId: null },
  ],
};

type Reply = "hang" | "refuse" | { status: number; body: unknown };
const gateway = { reply: { status: 200, body: MOCK_HEALTH } as Reply };

function respond(reply: Reply): Promise<Response> {
  if (reply === "hang") return new Promise<Response>(() => {});
  if (reply === "refuse") return Promise.reject(new TypeError("fetch failed"));
  return Promise.resolve(
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(() =>
  respond(gateway.reply),
);
const fetchedUrls = () => fetchMock.mock.calls.map(([input]) => String(input));

type SendOptions = { user?: FakeUser | null; via?: "cookie" | "bearer"; token?: string };

// 쿠키 세션이 기본이다. GET 이라 CSRF 헤더는 달지 않는다.
function send(options: SendOptions = {}): Promise<Response> {
  const user = options.user === undefined ? FAKE_USERS.admin : options.user;
  const via = options.via ?? "cookie";
  const headers: Record<string, string> = {};
  if (via === "bearer") headers.Authorization = `Bearer ${options.token ?? user?.token ?? ""}`;
  fakeSession.cookie = via === "cookie" ? (user?.token ?? null) : null;
  return GET(fakeRequest("/api/v1/admin/ai/status", { method: "GET", headers }));
}

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({
    code,
    message: expect.any(String),
    requestId: response.headers.get("X-Request-Id"),
    details: expect.any(Object),
  });
  return body.error;
}

beforeEach(() => {
  resetFakeSession();
  gateway.reply = { status: 200, body: MOCK_HEALTH };
  fetchMock.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SOL_RUN_MODE", "mock");
  vi.stubEnv("AI_GATEWAY_URL", GATEWAY);
  // 시험을 돌리는 셸의 값이 새어 들지 않게 비워 둔다(빈 값은 "지정 안 함"과 같다).
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("AI_HOSTED_APPROVED", "");
  vi.stubEnv("KEV_ENABLED", "");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/v1/admin/ai/status — 인증", () => {
  it("세션이 없으면 401 UNAUTHENTICATED 이고 gateway 를 부르지 않는다", async () => {
    await errorOf(await send({ user: null }), 401, "UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("모르는 Bearer 토큰은 401 UNAUTHENTICATED 이고 쿠키로 대체하지 않는다", async () => {
    fakeSession.cookie = FAKE_USERS.admin.token;
    const response = await GET(
      fakeRequest("/api/v1/admin/ai/status", {
        method: "GET",
        headers: { Authorization: "Bearer token-unknown" },
      }),
    );
    await errorOf(response, 401, "UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 05 §5 ACCOUNT_DISABLED: profiles.status='suspended' 면 토큰이 유효해도 막는다.
  it.each(["cookie", "bearer"] as const)(
    "정지된 ADMIN(%s)은 403 ACCOUNT_DISABLED 이고 gateway 를 부르지 않는다",
    async (via) => {
      fakeSession.profileStatus = "suspended";
      await errorOf(await send({ via }), 403, "ACCOUNT_DISABLED");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/v1/admin/ai/status — 역할", () => {
  it("ADMIN(쿠키)은 200 이고 본문이 aiStatusSchema 와 정확히 같다", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(aiStatusSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      runMode: "mock",
      provider: "mock",
      hostedApproved: false,
      gateway: { url: GATEWAY, healthy: true, runMode: "mock" },
      qwen: { model: "fixture", runtime: null, healthy: true },
      kev: { enabled: true, healthy: true, modelId: "mock", registryMatch: null },
      questionSetVersion: "kev-qs/v0.1",
      parsers: [],
    });
  });

  it("ADMIN 응답은 Cache-Control: no-store 이고 X-Request-Id 가 있다", async () => {
    const response = await send();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ADMIN(Bearer)도 200 이다", async () => {
    const response = await send({ via: "bearer" });
    expect(response.status).toBe(200);
  });

  it("값은 gateway /health 한 번에서만 읽는다(Kev·Qwen 을 직접 부르지 않는다)", async () => {
    await send();
    expect(fetchedUrls()).toEqual([`${GATEWAY}/health`]);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it.each([
    ["SALES", FAKE_USERS.sales],
    ["ANALYST", FAKE_USERS.analyst],
    ["VIEWER", FAKE_USERS.viewer],
  ])(
    "%s 는 403 FORBIDDEN 이고 details.required 가 [ADMIN] 이며 gateway 를 부르지 않는다",
    async (_role, user) => {
      const error = await errorOf(await send({ user }), 403, "FORBIDDEN");
      expect(error.details).toEqual({ required: ["ADMIN"] });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("다른 조직의 VIEWER 도 403 FORBIDDEN 이다", async () => {
    const error = await errorOf(await send({ user: FAKE_USERS.otherViewer }), 403, "FORBIDDEN");
    expect(error.details).toEqual({ required: ["ADMIN"] });
  });

  // 05 §1 현재 조직: 개인 조직은 업무 멤버십 수에 들지 않는다. 개인 조직의 sol_role=ADMIN 으로는 열리지 않는다.
  it("개인 조직의 ADMIN 은 403 FORBIDDEN(업무 조직 필요)이고 gateway 를 부르지 않는다", async () => {
    fakeSession.personalOrg = true;
    const error = await errorOf(await send(), 403, "FORBIDDEN");
    expect(error.details).toMatchObject({ reason: "ORGANIZATION_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/admin/ai/status — gateway 불가", () => {
  it("gateway 연결이 실패해도 200 이고 gateway.healthy=false 다", async () => {
    gateway.reply = "refuse";
    const response = await send();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(aiStatusSchema.safeParse(body).success).toBe(true);
    expect(body.gateway).toMatchObject({ url: GATEWAY, healthy: false, runMode: null });
    expect(body.qwen.healthy).toBeNull();
    expect(body.kev).toMatchObject({ enabled: true, healthy: null, modelId: null });
  });

  it("gateway 가 500 이면 200 이고 gateway.healthy=false 다", async () => {
    gateway.reply = { status: 500, body: { detail: "boom" } };
    const response = await send();
    expect(response.status).toBe(200);
    expect((await response.json()).gateway.healthy).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gateway 응답이 스키마에 맞지 않으면 200 이고 gateway.healthy=false 다", async () => {
    gateway.reply = { status: 200, body: { ...MOCK_HEALTH, provider: "openai" } };
    const response = await send();
    expect(response.status).toBe(200);
    expect((await response.json()).gateway.healthy).toBe(false);
  });

  it("gateway 가 멈추면 2초 뒤 200 이고 gateway.healthy=false 다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    gateway.reply = "hang";
    const pending = send();
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect((await response.json()).gateway.healthy).toBe(false);
  });

  it("gateway 가 죽어 있으면 kev.enabled 는 KEV_ENABLED 를 따른다", async () => {
    gateway.reply = "refuse";
    vi.stubEnv("KEV_ENABLED", "false");
    const body = await (await send()).json();
    expect(body.kev.enabled).toBe(false);
  });

  it("AI_GATEWAY_URL 에 계정 정보가 있으면 부르지 않고 url 에 계정 정보·쿼리가 없다", async () => {
    vi.stubEnv("AI_GATEWAY_URL", "http://svc:s3cret@fake-gateway.invalid:8000/?k=s3cret#s3cret");
    const response = await send();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("svc");
    expect(JSON.parse(text).gateway).toMatchObject({ url: GATEWAY, healthy: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gateway 가 준 모르는 필드는 응답에 싣지 않는다", async () => {
    gateway.reply = { status: 200, body: { ...MOCK_HEALTH, modelPath: "/srv/models/secret" } };
    const text = await (await send()).text();
    expect(text).not.toContain("modelPath");
    expect(text).not.toContain("/srv/models/secret");
  });
});

describe("GET /api/v1/admin/ai/status — hosted 승인(422)", () => {
  it("AI_PROVIDER=hosted 이고 미승인이면 422 HOSTED_NOT_APPROVED 이고 gateway 를 부르지 않는다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "fixture");
    vi.stubEnv("AI_PROVIDER", "hosted");
    vi.stubEnv("AI_HOSTED_APPROVED", "false");
    const error = await errorOf(await send(), 422, "HOSTED_NOT_APPROVED");
    expect(error.details).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gateway 가 hosted 를 알리고 web 이 미승인이면 422 HOSTED_NOT_APPROVED 다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "fixture");
    gateway.reply = {
      status: 200,
      body: { ...MOCK_HEALTH, runMode: "fixture", provider: "hosted" },
    };
    await errorOf(await send(), 422, "HOSTED_NOT_APPROVED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hosted 이고 승인이면 200 이고 provider 는 hosted, hostedApproved 는 true 다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "fixture");
    vi.stubEnv("AI_PROVIDER", "hosted");
    vi.stubEnv("AI_HOSTED_APPROVED", "true");
    gateway.reply = {
      status: 200,
      body: { ...MOCK_HEALTH, runMode: "fixture", provider: "hosted" },
    };
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "hosted", hostedApproved: true });
  });

  it("ADMIN 이 아니면 hosted 미승인이어도 403 이 422 보다 먼저다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "fixture");
    vi.stubEnv("AI_PROVIDER", "hosted");
    await errorOf(await send({ user: FAKE_USERS.sales }), 403, "FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/admin/ai/status — 실행 모드 오류", () => {
  it("SOL_RUN_MODE 가 틀리면 ADMIN 은 500 INTERNAL_ERROR 이고 값이 응답에 실리지 않는다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "turbo-s3cret");
    const response = await send();
    await errorOf(response.clone(), 500, "INTERNAL_ERROR");
    expect(await response.text()).not.toContain("turbo-s3cret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SOL_RUN_MODE 가 틀려도 ADMIN 이 아니면 403 이 먼저다", async () => {
    vi.stubEnv("SOL_RUN_MODE", "turbo");
    await errorOf(await send({ user: FAKE_USERS.viewer }), 403, "FORBIDDEN");
  });
});
