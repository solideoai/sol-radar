import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";

type CookieMethods = {
  getAll: () => unknown;
  setAll: (cookies: { name: string; value: string; options: object }[]) => void;
};

type SessionResult = { data: { session: { access_token: string } | null }; error: unknown };
type ClaimsResult = { data: { claims: Record<string, unknown> } | null; error: unknown };

// 두 통로(Bearer·쿠키)의 클라이언트가 같이 쓰는 가짜 auth. 실제 Supabase Auth 는 부르지 않는다.
const auth = {
  getSession: vi.fn(async (): Promise<SessionResult> => ({ data: { session: null }, error: null })),
  getClaims: vi.fn<(jwt?: string) => Promise<ClaimsResult>>(async () => ({
    data: null,
    error: null,
  })),
};
const createClient = vi.fn<(...args: unknown[]) => object>(() => ({ from: vi.fn(), auth }));
const createServerClient = vi.fn<
  (url: string, key: string, options: { cookies: CookieMethods }) => object
>(() => ({ from: vi.fn(), auth }));
const cookieStore = { getAll: vi.fn(() => [{ name: "sb-token", value: "abc" }]), set: vi.fn() };
const cookies = vi.fn(async () => cookieStore);
// 요청 헤더. 기본은 Authorization 이 없는 화면 요청이다.
const requestHeaders = { get: vi.fn<(name: string) => string | null>(() => null) };
const withAuthorization = (value: string) =>
  requestHeaders.get.mockImplementation((name) =>
    name.toLowerCase() === "authorization" ? value : null,
  );

// isAuthError·오류 클래스는 진짜를 쓴다(4xx 인증 오류와 5xx·네트워크 오류를 가르는 규칙을 보려고).
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (...args: unknown[]) => createClient(...args),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, options: { cookies: CookieMethods }) =>
    createServerClient(url, key, options),
}));
vi.mock("next/headers", () => ({ cookies: () => cookies(), headers: async () => requestHeaders }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // 앞 시험이 바꾼 헤더·세션·클레임을 지운다(clearAllMocks 는 호출 기록만 지운다).
  requestHeaders.get.mockReset().mockImplementation(() => null);
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  auth.getClaims.mockReset().mockResolvedValue({ data: null, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "admin-test-key");
});

describe("서버 DB 연결 경계", () => {
  it("기본 연결은 공개 키와 요청의 로그인 쿠키로 요청마다 새로 만든다", async () => {
    const { getSupabase } = await import("./client");
    const first = await getSupabase();
    const second = await getSupabase();
    expect(first).not.toBe(second);
    expect(createServerClient.mock.calls.map((args) => args[1])).toEqual([
      "public-test-key",
      "public-test-key",
    ]);
    expect(createServerClient.mock.calls[0][2].cookies.getAll()).toEqual([
      { name: "sb-token", value: "abc" },
    ]);
  });

  it("관리자 연결은 비밀 키를 쓰고 기본 연결과 섞이지 않는다", async () => {
    const { getSupabase, getSupabaseAdmin } = await import("./client");
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin());
    expect(await getSupabase()).not.toBe(getSupabaseAdmin());
    expect(createClient.mock.calls.map((args) => args[1])).toEqual(["admin-test-key"]);
  });

  it("서버 컴포넌트처럼 쿠키를 쓸 수 없는 곳에서도 토큰 갱신이 화면을 깨지 않는다", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    const { getSupabase } = await import("./client");
    await getSupabase();
    const { setAll } = createServerClient.mock.calls[0][2].cookies;
    expect(() => setAll([{ name: "sb-token", value: "new", options: {} }])).not.toThrow();
  });

  it("설정이 없을 때 import는 가능하고 실제 접근은 명시적으로 실패한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { getSupabase, isSupabaseConfigured } = await import("./client");
    expect(createServerClient).not.toHaveBeenCalled();
    expect(isSupabaseConfigured()).toBe(false);
    await expect(getSupabase()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("공개 주소와 anon 키가 둘 다 있어야 설정된 것으로 본다", async () => {
    const { isSupabaseConfigured } = await import("./client");
    expect(isSupabaseConfigured()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("요청마다 그 요청의 쿠키만 싣는다 — 다른 사람의 로그인이 섞이지 않는다", async () => {
    const storeOf = (value: string) => ({
      getAll: vi.fn(() => [{ name: "sb-token", value }]),
      set: vi.fn(),
    });
    const alice = storeOf("alice-token");
    const bob = storeOf("bob-token");
    cookies.mockResolvedValueOnce(alice).mockResolvedValueOnce(bob);
    const { getSupabase } = await import("./client");
    await getSupabase();
    await getSupabase();
    const [first, second] = createServerClient.mock.calls.map((args) => args[2].cookies);
    expect(first.getAll()).toEqual([{ name: "sb-token", value: "alice-token" }]);
    expect(second.getAll()).toEqual([{ name: "sb-token", value: "bob-token" }]);
    second.setAll([{ name: "sb-token", value: "bob-new", options: { path: "/" } }]);
    expect(bob.set).toHaveBeenCalledWith("sb-token", "bob-new", { path: "/" });
    expect(alice.set).not.toHaveBeenCalled();
  });

  it("anon 키가 없으면 첫 사용에서 실패하고, 설정한 뒤에는 같은 모듈로 다시 연결된다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getSupabase } = await import("./client");
    await expect(getSupabase()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(createServerClient).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    await getSupabase();
    expect(createServerClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "public-test-key",
      expect.anything(),
    );
  });

  it("관리자 키가 없으면 실패를 캐시하지 않고, 설정한 뒤 한 번만 만든다", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getSupabaseAdmin } = await import("./client");
    expect(() => getSupabaseAdmin()).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(createClient).not.toHaveBeenCalled();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "admin-test-key");
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin());
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("서버 DB 연결의 타입", () => {
  // 타입만 본다(tsc 가 검사한다). 제네릭이 빠지면 표·열 이름 검사와 행 타입이 조용히 any 로 풀린다.
  it("기본·관리자 연결 모두 생성된 Database 타입이 붙은 클라이언트를 돌려준다", () => {
    type Client = typeof import("./client");
    expectTypeOf<Awaited<ReturnType<Client["getSupabase"]>>>().toEqualTypeOf<
      SupabaseClient<Database>
    >();
    expectTypeOf<ReturnType<Client["getSupabaseAdmin"]>>().toEqualTypeOf<
      SupabaseClient<Database>
    >();
  });
});

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
// 이 프로젝트(https://test.supabase.co)의 Auth 가 로그인한 사람에게 준 토큰의 클레임.
const validClaims = (overrides: Record<string, unknown> = {}) => ({
  data: {
    claims: {
      iss: "https://test.supabase.co/auth/v1",
      aud: "authenticated",
      role: "authenticated",
      sub: USER,
      email: "a@example.com",
      ...overrides,
    },
  },
  error: null,
});
const cookieSession = (accessToken: string): SessionResult => ({
  data: { session: { access_token: accessToken } },
  error: null,
});

describe("Bearer 로 온 요청의 DB 연결", () => {
  it("Authorization: Bearer 가 있으면 그 토큰을 Authorization 헤더로 싣고 쿠키를 읽지 않는다", async () => {
    withAuthorization("Bearer header-token");
    const { getSupabase } = await import("./client");
    await getSupabase();
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0];
    expect([url, key]).toEqual(["https://test.supabase.co", "public-test-key"]);
    expect(options).toMatchObject({
      global: { headers: { Authorization: "Bearer header-token" } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(cookies).not.toHaveBeenCalled();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("Bearer 연결도 요청마다 새로 만들고, 요청마다 그 요청의 토큰만 싣는다", async () => {
    const { getSupabase } = await import("./client");
    withAuthorization("Bearer alice-token");
    const first = await getSupabase();
    withAuthorization("Bearer bob-token");
    const second = await getSupabase();
    expect(first).not.toBe(second);
    expect(createClient.mock.calls.map((args) => args[2])).toMatchObject([
      { global: { headers: { Authorization: "Bearer alice-token" } } },
      { global: { headers: { Authorization: "Bearer bob-token" } } },
    ]);
  });

  it("Bearer 가 아닌 Authorization(Basic 등)이면 지금처럼 쿠키 연결이다", async () => {
    withAuthorization("Basic dXNlcjpwYXNz");
    const { getSupabase } = await import("./client");
    await getSupabase();
    expect(createClient).not.toHaveBeenCalled();
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });
});

describe("getAuthContext", () => {
  it.each(["invalid.jwt.test", "bm90LWpzb24.e30.c2ln", "bnVsbA.e30.c2ln"])(
    "rejects JWT decoding failures before the SDK (%s)",
    async (token) => {
      withAuthorization(`Bearer ${token}`);
      auth.getClaims.mockImplementation(async () => {
        throw new Error("Invalid UTF-8 sequence");
      });
      const { getAuthContext } = await import("./client");
      await expect(getAuthContext("bearer")).resolves.toBeNull();
      expect(auth.getClaims).not.toHaveBeenCalled();
    },
  );
  it("쿠키 세션의 토큰을 getClaims 로 확인하고 그 사람과 토큰을 돌려준다", async () => {
    auth.getSession.mockResolvedValue(cookieSession("cookie-token"));
    auth.getClaims.mockResolvedValue(validClaims());
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext()).resolves.toEqual({
      claims: { userId: USER, email: "a@example.com" },
      accessToken: "cookie-token",
    });
    expect(auth.getClaims).toHaveBeenCalledWith("cookie-token");
  });

  it('"bearer" 는 헤더의 토큰을 확인하고 쿠키 세션을 읽지 않는다', async () => {
    withAuthorization("Bearer header-token");
    auth.getClaims.mockResolvedValue(validClaims());
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toEqual({
      claims: { userId: USER, email: "a@example.com" },
      accessToken: "header-token",
    });
    expect(auth.getClaims).toHaveBeenCalledWith("header-token");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it('"bearer" 는 헤더가 없으면 쿠키 세션이 있어도 null 이다 — API 는 쿠키 로그인을 받지 않는다', async () => {
    auth.getSession.mockResolvedValue(cookieSession("cookie-token"));
    auth.getClaims.mockResolvedValue(validClaims());
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toBeNull();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.getClaims).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it('"bearer" 는 모양이 틀린 Authorization(Basic)이면 쿠키 세션이 있어도 null 이다', async () => {
    withAuthorization("Basic dXNlcjpwYXNz");
    auth.getSession.mockResolvedValue(cookieSession("cookie-token"));
    auth.getClaims.mockResolvedValue(validClaims());
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toBeNull();
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it("기본(request)도 Bearer 헤더가 있으면 쿠키 대신 헤더의 토큰을 쓴다", async () => {
    withAuthorization("Bearer header-token");
    auth.getSession.mockResolvedValue(cookieSession("cookie-token"));
    auth.getClaims.mockResolvedValue(validClaims());
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext()).resolves.toMatchObject({ accessToken: "header-token" });
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("세션이 없으면 null 이고 getClaims 를 부르지 않는다", async () => {
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext()).resolves.toBeNull();
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it("쿠키 세션을 읽다 난 4xx 인증 오류는 로그인 전과 같다", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthSessionMissingError(),
    });
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext()).resolves.toBeNull();
  });

  it("쿠키 세션을 읽다 난 네트워크 오류는 삼키지 않고 올린다", async () => {
    const down = new AuthRetryableFetchError("fetch failed", 0);
    auth.getSession.mockResolvedValue({ data: { session: null }, error: down });
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext()).rejects.toBe(down);
  });

  it.each([
    ["서명이 틀린 토큰(AuthInvalidJwtError)", new AuthInvalidJwtError("Invalid JWT signature")],
    ["만료된 토큰(401)", new AuthApiError("JWT expired", 401, "bad_jwt")],
    ["Auth 가 거절한 토큰(403)", new AuthApiError("forbidden", 403, "bad_jwt")],
  ])("getClaims 의 %s 는 로그인하지 않은 것과 같다(null)", async (_, error) => {
    withAuthorization("Bearer header-token");
    auth.getClaims.mockResolvedValue({ data: null, error });
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toBeNull();
  });

  it.each([
    ["Auth 서버 오류(500)", new AuthApiError("Internal Server Error", 500, "unexpected_failure")],
    ["네트워크 오류(status 0)", new AuthRetryableFetchError("fetch failed", 0)],
    ["Auth 오류가 아닌 예외", new Error("boom")],
  ])("getClaims 의 %s 는 로그인 전으로 보지 않고 올린다", async (_, error) => {
    withAuthorization("Bearer header-token");
    auth.getClaims.mockResolvedValue({ data: null, error });
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).rejects.toBe(error);
  });

  it.each([
    ["다른 프로젝트가 준 토큰", { iss: "https://other.supabase.co/auth/v1" }],
    ["anon 키", { role: "anon" }],
    ["service_role 키", { role: "service_role" }],
    ["sub 가 uuid 가 아닌 토큰", { sub: "not-a-uuid" }],
    ["대상이 authenticated 가 아닌 토큰", { aud: "anon" }],
  ])("서명이 맞아도 %s 은 null 이다", async (_, overrides) => {
    withAuthorization("Bearer header-token");
    auth.getClaims.mockResolvedValue(validClaims(overrides));
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toBeNull();
  });

  it("getClaims 가 오류도 클레임도 없이 돌아오면 null 이다", async () => {
    withAuthorization("Bearer header-token");
    const { getAuthContext } = await import("./client");
    await expect(getAuthContext("bearer")).resolves.toBeNull();
  });

  it("getAuthClaims 는 확인한 사람만 돌려준다(토큰은 빼고)", async () => {
    withAuthorization("Bearer header-token");
    auth.getClaims.mockResolvedValue(validClaims({ email: "" }));
    const { getAuthClaims } = await import("./client");
    await expect(getAuthClaims()).resolves.toEqual({ userId: USER, email: null });
  });
});

describe("unlinkAuthIdentity", () => {
  const IDENTITY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    );

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("200 이면 unlinked 이고, 그 사람의 토큰과 anon 키로 Auth 의 DELETE /user/identities/{id} 를 부른다", async () => {
    reply(200, {});
    const { unlinkAuthIdentity } = await import("./client");
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).resolves.toBe("unlinked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://test.supabase.co/auth/v1/user/identities/${IDENTITY}`);
    expect(init).toMatchObject({
      method: "DELETE",
      headers: { apikey: "public-test-key", Authorization: "Bearer user-token" },
      cache: "no-store",
    });
  });

  it("Supabase 주소 끝의 / 는 주소에 // 로 남지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co/");
    reply(200, {});
    const { unlinkAuthIdentity } = await import("./client");
    await unlinkAuthIdentity("user-token", IDENTITY);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://test.supabase.co/auth/v1/user/identities/${IDENTITY}`,
    );
  });

  it("id 는 경로 한 칸으로만 들어간다(/ · ? 를 인코딩한다)", async () => {
    reply(200, {});
    const { unlinkAuthIdentity } = await import("./client");
    await unlinkAuthIdentity("user-token", "../admin?x=1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://test.supabase.co/auth/v1/user/identities/..%2Fadmin%3Fx%3D1",
    );
  });

  it("422 single_identity_not_deletable 이면 last-method 다", async () => {
    reply(422, { code: 422, error_code: "single_identity_not_deletable", msg: "…" });
    const { unlinkAuthIdentity } = await import("./client");
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).resolves.toBe("last-method");
  });

  it("404 면 본문이 무엇이든(JSON 이 아니어도) not-found 다", async () => {
    const { unlinkAuthIdentity } = await import("./client");
    reply(404, { error_code: "something_else" });
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).resolves.toBe("not-found");
    fetchMock.mockResolvedValue(new Response("not json", { status: 404 }));
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).resolves.toBe("not-found");
  });

  it("상태 코드가 404 가 아니어도 error_code 가 identity_not_found 면 not-found 다", async () => {
    reply(422, { error_code: "identity_not_found" });
    const { unlinkAuthIdentity } = await import("./client");
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).resolves.toBe("not-found");
  });

  it.each([
    [500, { error_code: "unexpected_failure" }],
    [401, { error_code: "bad_jwt" }],
    [422, { error_code: "manual_linking_disabled" }],
    [400, undefined],
  ])("그 밖의 응답(%i)은 던지고, 메시지에 토큰을 싣지 않는다", async (status, body) => {
    reply(status, body);
    const { unlinkAuthIdentity } = await import("./client");
    const error = await unlinkAuthIdentity("user-token", IDENTITY).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(`Auth ${status}`);
    expect(String(error)).not.toContain("user-token");
  });

  it("네트워크 오류는 그대로 올린다", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { unlinkAuthIdentity } = await import("./client");
    await expect(unlinkAuthIdentity("user-token", IDENTITY)).rejects.toThrow("fetch failed");
  });
});

// 6-6: demo:reset 이 파일에서 읽은 env 로 관리자 연결을 만든다. 모듈 변수에 담지 않는다(getSupabaseAdmin 캐시와 따로).
describe("createSupabaseAdminClient", () => {
  const INPUT = { url: "https://demo-reset.supabase.co", serviceRoleKey: "service-role-from-file" };

  it("받은 url·serviceRoleKey 로 세션을 저장·갱신하지 않는 클라이언트를 만든다", async () => {
    const { createSupabaseAdminClient } = await import("./client");
    expect(createSupabaseAdminClient(INPUT)).toBeDefined();
    expect(createClient).toHaveBeenCalledWith(
      "https://demo-reset.supabase.co",
      "service-role-from-file",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      }),
    );
  });

  it("process.env 의 주소·키가 아니라 받은 값을 쓴다", async () => {
    const { createSupabaseAdminClient } = await import("./client");
    createSupabaseAdminClient(INPUT);
    const [url, key] = createClient.mock.calls[0] ?? [];
    expect([url, key]).not.toContain("https://test.supabase.co");
    expect([url, key]).not.toContain("admin-test-key");
  });

  it("두 번 부르면 다른 클라이언트다(모듈 변수에 담지 않는다)", async () => {
    const { createSupabaseAdminClient } = await import("./client");
    const first = createSupabaseAdminClient(INPUT);
    const second = createSupabaseAdminClient(INPUT);
    expect(first).not.toBe(second);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("getSupabaseAdmin 의 캐시와 섞이지 않는다(getSupabaseAdmin 은 env 키를 그대로 쓴다)", async () => {
    const { createSupabaseAdminClient, getSupabaseAdmin } = await import("./client");
    const fromFile = createSupabaseAdminClient(INPUT);
    const fromEnv = getSupabaseAdmin();
    expect(fromEnv).not.toBe(fromFile);
    expect(createClient.mock.calls.at(-1)?.[1]).toBe("admin-test-key");
  });

  it.each([
    ["빈 url", { url: "", serviceRoleKey: "service-role-SECRET-value" }],
    ["빈 키", { url: "https://SECRET-host.supabase.co", serviceRoleKey: "" }],
  ])("%s 면 Error 를 던지고 메시지에 받은 값이 없다", async (_name, input) => {
    const { createSupabaseAdminClient } = await import("./client");
    // 함수가 없어서 난 TypeError 를 "값 없는 오류"로 잘못 세지 않게 먼저 확인한다.
    expect(createSupabaseAdminClient).toBeTypeOf("function");
    const message = (() => {
      try {
        createSupabaseAdminClient(input);
        return "던지지 않았다";
      } catch (error) {
        return error instanceof Error ? error.message : "Error 가 아니다";
      }
    })();
    expect(message).not.toBe("던지지 않았다");
    expect(message).not.toBe("Error 가 아니다");
    expect(message).not.toContain("SECRET");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("배럴(@/server/supabase)로 공개한다", async () => {
    const barrel = await import("./index");
    expect(typeof barrel.createSupabaseAdminClient).toBe("function");
  });

  it("생성된 Database 타입이 붙은 클라이언트를 돌려준다", async () => {
    const { createSupabaseAdminClient } = await import("./client");
    expectTypeOf(createSupabaseAdminClient).returns.toEqualTypeOf<SupabaseClient<Database>>();
  });
});
