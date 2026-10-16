import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Tables } from "@/lib/database.types";

const createBrowserClient = vi.fn<(url: string, key: string, options?: object) => object>(() => ({
  from: vi.fn(),
}));
// 서버(server/supabase)와 같은 쿠키 옵션이어야 서로의 로그인 쿠키를 덮지 않는다. 시험은 운영 빌드가 아니라 Secure 가 꺼져 있다.
const COOKIE_OPTIONS = { cookieOptions: { secure: false } };
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});

describe("브라우저 DB 연결", () => {
  it("공개 URL 과 anon 키로 연결한다", async () => {
    const { getSupabaseBrowser } = await import("./supabase-browser");
    getSupabaseBrowser();
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "public-test-key",
      COOKIE_OPTIONS,
    );
  });

  it("공개 환경변수가 없으면 빈 설정으로 연결하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getSupabaseBrowser } = await import("./supabase-browser");
    expect(() => getSupabaseBrowser()).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("URL 이 없어 첫 사용에 실패해도, 설정한 뒤에는 같은 모듈로 연결된다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { getSupabaseBrowser } = await import("./supabase-browser");
    expect(() => getSupabaseBrowser()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(createBrowserClient).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    getSupabaseBrowser();
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "public-test-key",
      COOKIE_OPTIONS,
    );
  });
});

// 타입만 보는 시험이다. 아래에서 만드는 함수는 부르지 않는다 — tsc(pnpm type-check)가 이 파일을 검사할 때 걸린다.
// 클라이언트에 Database 타입이 빠지면(any) 행 타입 비교와 @ts-expect-error 가 함께 깨진다.
type BrowserClient = ReturnType<typeof import("./supabase-browser").getSupabaseBrowser>;

describe("브라우저 DB 연결의 타입", () => {
  it("profiles 를 select 하면 생성된 행 타입이 붙는다", () => {
    const selectProfiles = (client: BrowserClient) =>
      client.from("profiles").select("id, email, is_admin");
    expectTypeOf(selectProfiles)
      .returns.resolves.toHaveProperty("data")
      .toEqualTypeOf<Pick<Tables<"profiles">, "id" | "email" | "is_admin">[] | null>();
  });

  it("인자 없는 함수도 rpc 로 부르고 반환 타입이 붙는다", () => {
    const callIsAdmin = (client: BrowserClient) => client.rpc("is_admin");
    expectTypeOf(callIsAdmin)
      .returns.resolves.toHaveProperty("data")
      .toEqualTypeOf<boolean | null>();
  });

  it("없는 표·열 이름은 타입 오류다", () => {
    const misuse = (client: BrowserClient) => {
      // @ts-expect-error: 마이그레이션에 없는 표는 from() 에 넣을 수 없다
      client.from("no_such_table");
      // @ts-expect-error: 생성된 Insert 타입에 없는 열은 넣을 수 없다
      client.from("profiles").insert({ id: "x", no_such_column: 1 });
    };
    expectTypeOf(misuse).toBeFunction();
  });
});
