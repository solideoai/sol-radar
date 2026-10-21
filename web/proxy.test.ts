import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
const { refreshed } = vi.hoisted(() => ({ refreshed: { enabled: false } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string; options: object }[],
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        if (refreshed.enabled)
          options.cookies.setAll(
            [{ name: "sb-test-session", value: "refreshed-test", options: { path: "/" } }],
            { "Cache-Control": "private, no-store" },
          );
        return { data: null, error: null };
      },
    },
  }),
}));
import { config, proxy } from "./proxy";
afterEach(() => vi.unstubAllEnvs());

it.each(["/", "/api/people", "/api/v1/team-members", "/_next/static/private.js", "/health/live"])(
  "redis-api rejects non-allowlisted path %s before rendering or session refresh",
  async (path) => {
    vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api");
    vi.stubEnv("REDIS_API_TOKEN", "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz");
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(404);
    expect(response.headers.has("content-security-policy")).toBe(false);
  },
);

it("redis-api health requires service authentication and a valid token reaches the handler", async () => {
  const token = "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
  vi.stubEnv("SOL_DEPLOYMENT_ROLE", "redis-api");
  vi.stubEnv("REDIS_API_TOKEN", token);
  expect((await proxy(new NextRequest("http://localhost/health"))).status).toBe(401);
  const allowed = await proxy(
    new NextRequest("http://localhost/health", {
      headers: { "X-Sol-Service-Token": token },
    }),
  );
  expect(allowed.headers.get("x-middleware-next")).toBe("1");
});

it("an unknown deployment role fails closed", async () => {
  vi.stubEnv("SOL_DEPLOYMENT_ROLE", "invalid-role");
  expect((await proxy(new NextRequest("http://localhost/api/v1/bids"))).status).toBe(503);
});
it("실제 요청 경로를 전달하고 외부 입력 헤더를 덮어쓴다", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  try {
    const response = await proxy(
      new NextRequest("http://localhost/alpha/tasks?q=hello", {
        headers: { "x-sol-radar-path": "https://evil.test" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-sol-radar-path")).toBe(
      "/alpha/tasks?q=hello",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each(["/auth/callback?code=private", "/auth/confirm?token_hash=private", "/"])(
  "비업무 경로 %s의 쿼리는 전달하지 않는다",
  async (path) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    try {
      const response = await proxy(
        new NextRequest(`http://localhost${path}`, {
          headers: { "x-sol-radar-path": "/forged/tasks" },
        }),
      );
      expect(response.headers.get("x-middleware-request-x-sol-radar-path")).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it("세션 갱신 뒤에도 업무 경로·쿠키·CSP를 함께 전달하고 경로를 공개 응답 헤더로 내보내지 않는다", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  refreshed.enabled = true;
  try {
    const response = await proxy(
      new NextRequest("http://localhost/alpha/settings?link=linked", {
        headers: {
          cookie: "sb-test-session=old-test",
          "x-sol-radar-path": "/forged/tasks",
          "x-nonce": "forged",
        },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-sol-radar-path")).toBe(
      "/alpha/settings?link=linked",
    );
    expect(response.headers.get("x-sol-radar-path")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-test-session=refreshed-test",
    );
    expect(response.cookies.get("sb-test-session")?.value).toBe("refreshed-test");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
    expect(response.headers.get("content-security-policy")).toContain(
      response.headers.get("x-middleware-request-x-nonce"),
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("forged");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  } finally {
    refreshed.enabled = false;
    vi.unstubAllEnvs();
  }
});

it.each(["/health/ready", "/api/v1/bids", "/_next/static/file.js", "/dashboard"])(
  "matcher includes %s so redis-api can deny routes before their handlers",
  (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  },
);

it.each([
  "/health/ready",
  "/health/live",
  "/api/v1/me/employment",
  "/_next/static/file.js",
  "/icon.svg",
])("standalone keeps API/health/assets %s outside cookie refresh and CSP", async (path) => {
  vi.stubEnv("SOL_DEPLOYMENT_ROLE", "standalone");
  const response = await proxy(new NextRequest(`http://localhost${path}`));
  expect(response.headers.has("content-security-policy")).toBe(false);
  expect(response.headers.has("x-middleware-request-x-sol-radar-path")).toBe(false);
});
