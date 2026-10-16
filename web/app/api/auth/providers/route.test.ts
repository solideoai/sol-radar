import { beforeEach, describe, expect, it, vi } from "vitest";

// 문지기를 부르지 않는 공개 주소다. 부르면 실패하게 둔다.
const authenticate = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ authenticate }));

// 켠 제공자는 모듈을 읽을 때 정해진다(NEXT_PUBLIC_ 은 빌드 때 박힌다). 시험마다 새로 읽는다.
const load = async (enabled: Partial<Record<"GOOGLE" | "KAKAO" | "NAVER", string>>) => {
  vi.resetModules();
  (["GOOGLE", "KAKAO", "NAVER"] as const).forEach((name) =>
    vi.stubEnv(`NEXT_PUBLIC_AUTH_${name}`, enabled[name] ?? ""),
  );
  return (await import("./route")).GET;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/providers", () => {
  it("켜 둔 제공자를 구글 → 카카오 → 네이버 순으로, Supabase 제공자 이름과 함께 돌려준다", async () => {
    const GET = await load({ NAVER: "true", GOOGLE: "true", KAKAO: "true" });
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [
        { id: "google", supabaseProvider: "google" },
        { id: "kakao", supabaseProvider: "kakao" },
        { id: "naver", supabaseProvider: "custom:naver" },
      ],
    });
  });

  it("값이 정확히 true 인 제공자만 켠다", async () => {
    const GET = await load({ GOOGLE: "true", KAKAO: "1", NAVER: "TRUE" });
    expect(await GET().json()).toEqual({
      providers: [{ id: "google", supabaseProvider: "google" }],
    });
  });

  it("아무것도 켜지 않았으면 빈 목록이다", async () => {
    const GET = await load({});
    expect(await GET().json()).toEqual({ providers: [] });
  });

  it("로그인 없이 열리는 공개 주소다(문지기를 부르지 않는다)", async () => {
    const GET = await load({ GOOGLE: "true" });
    GET();
    expect(authenticate).not.toHaveBeenCalled();
  });

  // docs/boilerplate/AUTH-API.md "모든 응답은 Cache-Control: no-store 입니다."
  it("응답은 Cache-Control: no-store 다", async () => {
    const GET = await load({ GOOGLE: "true" });
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
