import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetAll = (
  cookies: { name: string; value: string; options: object }[],
  headers: Record<string, string>,
) => void;

// getClaims 가 불리면 Supabase 가 토큰을 갱신한 것처럼 setAll 을 부른다.
const refreshed = {
  cookies: [] as { name: string; value: string; options: object }[],
  headers: {} as Record<string, string>,
};
const createServerClient = vi.fn(
  (_url: string, _key: string, options: { cookies: { setAll: SetAll } }) => ({
    auth: {
      getClaims: vi.fn(async () => {
        if (refreshed.cookies.length) options.cookies.setAll(refreshed.cookies, refreshed.headers);
        return { data: null, error: null };
      }),
    },
  }),
);
vi.mock("@supabase/ssr", () => ({ createServerClient }));

beforeEach(() => {
  vi.clearAllMocks();
  refreshed.cookies = [];
  refreshed.headers = {};
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});

describe("요청마다 로그인 토큰 갱신", () => {
  it("Supabase 설정이 없으면 연결하지 않고 그대로 통과시킨다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { refreshSession } = await import("./session");
    const response = await refreshSession(new NextRequest("http://localhost/"));
    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("갱신된 토큰을 응답 쿠키에 싣고 캐시 금지 헤더를 붙인다", async () => {
    refreshed.cookies = [{ name: "sb-token", value: "new-token", options: { path: "/" } }];
    refreshed.headers = { "Cache-Control": "private, no-store" };
    const { refreshSession } = await import("./session");
    const response = await refreshSession(
      new NextRequest("http://localhost/", { headers: { cookie: "sb-token=old-token" } }),
    );
    expect(response.cookies.get("sb-token")?.value).toBe("new-token");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("anon 키가 없어도 연결하지 않고 통과시킨다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { refreshSession } = await import("./session");
    const response = await refreshSession(new NextRequest("http://localhost/"));
    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("getClaims 로 갱신한 쿠키를 뒤따르는 서버 렌더의 요청과 브라우저 응답 양쪽에 속성까지 싣는다", async () => {
    const options = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 3600 };
    refreshed.cookies = [{ name: "sb-token", value: "new-token", options }];
    refreshed.headers = { "Cache-Control": "private, no-store", Expires: "0" };
    const { refreshSession } = await import("./session");
    const response = await refreshSession(
      new NextRequest("http://localhost/", { headers: { cookie: "sb-token=old-token" } }),
    );
    const client = createServerClient.mock.results[0].value;
    expect(client.auth.getClaims).toHaveBeenCalledTimes(1);
    // 요청 쪽: Next 가 서버 렌더에 넘길 요청 쿠키
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-token=new-token");
    expect(response.headers.get("x-middleware-request-cookie")).not.toContain("old-token");
    // 응답 쪽: 브라우저가 저장할 쿠키와 그 속성
    expect(response.cookies.get("sb-token")).toMatchObject({ value: "new-token", ...options });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
  });

  it("요청마다 그 요청의 쿠키로 따로 갱신한다 — 앞 요청의 토큰이 다음 응답에 남지 않는다", async () => {
    const { refreshSession } = await import("./session");
    refreshed.cookies = [{ name: "sb-token", value: "alice-new", options: { path: "/" } }];
    const alice = await refreshSession(
      new NextRequest("http://localhost/", { headers: { cookie: "sb-token=alice-old" } }),
    );
    refreshed.cookies = [];
    const bob = await refreshSession(
      new NextRequest("http://localhost/", { headers: { cookie: "sb-token=bob-old" } }),
    );
    expect(createServerClient).toHaveBeenCalledTimes(2);
    expect(alice.cookies.get("sb-token")?.value).toBe("alice-new");
    expect(bob.cookies.getAll()).toEqual([]);
    expect(bob.headers.get("x-middleware-request-cookie") ?? "").not.toContain("alice");
  });

  it("갱신할 것이 없으면 쿠키를 건드리지 않는다", async () => {
    const { refreshSession } = await import("./session");
    const response = await refreshSession(new NextRequest("http://localhost/"));
    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(response.cookies.getAll()).toEqual([]);
  });
});

// proxy.ts 가 CSP 와 nonce 를 뒤따르는 서버 렌더에 넘기는 길(스펙 3장 5번). Next 는 NextResponse.next 의 요청 헤더를
// x-middleware-override-headers(이름 목록)와 x-middleware-request-<이름>(값)으로 서버 렌더에 옮긴다.
describe("요청 헤더 넘기기(forwardHeaders)", () => {
  const FORWARD = {
    "x-nonce": "bm9uY2UtYQ==",
    "content-security-policy": "script-src 'self' 'nonce-bm9uY2UtYQ=='",
  };
  const forwarded = (response: Response, name: string) =>
    response.headers.get(`x-middleware-request-${name}`);
  const overridden = (response: Response) =>
    (response.headers.get("x-middleware-override-headers") ?? "").split(",");

  it("Supabase 설정이 없어도 넘길 헤더를 서버 렌더의 요청에 싣는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { refreshSession } = await import("./session");
    const response = await refreshSession(new NextRequest("http://localhost/"), FORWARD);
    expect(forwarded(response, "x-nonce")).toBe(FORWARD["x-nonce"]);
    expect(forwarded(response, "content-security-policy")).toBe(FORWARD["content-security-policy"]);
    expect(overridden(response)).toEqual(
      expect.arrayContaining(["x-nonce", "content-security-policy"]),
    );
  });

  it("토큰을 갱신해 응답을 새로 만든 뒤에도 넘길 헤더와 갱신된 쿠키가 함께 실린다", async () => {
    refreshed.cookies = [{ name: "sb-token", value: "new-token", options: { path: "/" } }];
    const { refreshSession } = await import("./session");
    const response = await refreshSession(
      new NextRequest("http://localhost/", { headers: { cookie: "sb-token=old-token" } }),
      FORWARD,
    );
    expect(forwarded(response, "x-nonce")).toBe(FORWARD["x-nonce"]);
    expect(forwarded(response, "content-security-policy")).toBe(FORWARD["content-security-policy"]);
    expect(forwarded(response, "cookie")).toContain("sb-token=new-token");
    expect(response.cookies.get("sb-token")?.value).toBe("new-token");
  });

  it("브라우저가 같은 이름의 헤더를 보내도 넘길 값으로 덮는다 — 남이 정한 nonce 가 서버 렌더에 닿지 않는다", async () => {
    for (const configured of [true, false]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", configured ? "https://test.supabase.co" : "");
      const { refreshSession } = await import("./session");
      const response = await refreshSession(
        new NextRequest("http://localhost/", {
          headers: {
            "x-nonce": "ZXZpbA==",
            "content-security-policy": "script-src 'nonce-ZXZpbA=='",
          },
        }),
        FORWARD,
      );
      expect(forwarded(response, "x-nonce"), String(configured)).toBe(FORWARD["x-nonce"]);
      expect(forwarded(response, "content-security-policy"), String(configured)).toBe(
        FORWARD["content-security-policy"],
      );
    }
  });

  it("요청의 다른 헤더는 그대로 넘긴다", async () => {
    const { refreshSession } = await import("./session");
    const response = await refreshSession(
      new NextRequest("http://localhost/", { headers: { "accept-language": "ko-KR" } }),
      FORWARD,
    );
    expect(forwarded(response, "accept-language")).toBe("ko-KR");
  });

  it("넘길 헤더를 주지 않으면 nonce·CSP 헤더를 만들지 않는다", async () => {
    const { refreshSession } = await import("./session");
    const response = await refreshSession(new NextRequest("http://localhost/"));
    expect(forwarded(response, "x-nonce")).toBeNull();
    expect(forwarded(response, "content-security-policy")).toBeNull();
  });
});
