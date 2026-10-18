import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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

it.each([
  "/auth/callback?code=private",
  "/auth/confirm?token_hash=private",
  "/api/v1/me/employment",
  "/",
])("비업무 경로 %s의 쿼리는 전달하지 않는다", async (path) => {
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
});

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

it("matcher 는 /health/* 를 프록시에서 빼고 화면 경로는 거친다", () => {
  const matcher = config.matcher[0];
  // Next 의 matcher 는 path-to-regexp 형식이지만 이 식은 정규식과 같아 ^...$ 로 감싸 검사한다.
  const pattern = new RegExp(`^${matcher}$`);
  expect(pattern.test("/health/ready")).toBe(false);
  expect(pattern.test("/health/live")).toBe(false);
  expect(pattern.test("/dashboard")).toBe(true);
  expect(pattern.test("/healthy-team/dashboard")).toBe(true);
});
