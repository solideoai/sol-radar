import { beforeEach, describe, expect, it, vi } from "vitest";
import type { authenticate, getMyLoginMethods } from "@/server/auth";
import { GET } from "./route";

// 도메인을 가짜로 바꾸고 핸들러를 직접 부른다. 실제 Supabase 는 부르지 않는다.
const domain = vi.hoisted(() => ({
  authenticate: vi.fn<typeof authenticate>(),
  getMyLoginMethods: vi.fn<typeof getMyLoginMethods>(),
}));
vi.mock("@/server/auth", () => domain);

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const ready = (role: "user" | "admin" = "user") =>
  ({ status: "ready", user: { id: USER, email: "a@example.com", role } }) as const;

const errorOf = async (response: Response) => ((await response.json()) as { error: object }).error;

beforeEach(() => {
  vi.clearAllMocks();
  domain.authenticate.mockResolvedValue(ready());
  domain.getMyLoginMethods.mockResolvedValue({
    status: "ready",
    canUnlink: true,
    methods: [
      {
        identityId: "11111111-1111-4111-8111-111111111111",
        provider: "email",
        label: "이메일",
        email: "a@example.com",
        linkedAt: "2026-10-01T00:00:00.000Z",
        lastSignInAt: "2026-10-14T00:00:00.000Z",
      },
      {
        identityId: "22222222-2222-4222-8222-222222222222",
        provider: "custom:naver",
        label: "네이버",
        email: null,
        linkedAt: "2026-10-02T00:00:00.000Z",
        lastSignInAt: null,
      },
    ],
  });
});

describe("GET /api/auth/me", () => {
  it("로그인한 사람과 연결된 로그인 수단을 API 모양으로 돌려준다", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: USER,
      email: "a@example.com",
      role: "user",
      status: "active",
      identities: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          provider: "email",
          email: "a@example.com",
          linkedAt: "2026-10-01T00:00:00.000Z",
          lastSignInAt: "2026-10-14T00:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          provider: "custom:naver",
          email: null,
          linkedAt: "2026-10-02T00:00:00.000Z",
          lastSignInAt: null,
        },
      ],
      canUnlink: true,
    });
  });

  it("로그인은 Authorization: Bearer 로만 받는다(쿠키 로그인을 받지 않는다)", async () => {
    await GET();
    expect(domain.authenticate).toHaveBeenCalledWith("bearer");
  });

  it("역할은 DB 에서 읽은 판정을 그대로 싣는다", async () => {
    domain.authenticate.mockResolvedValue(ready("admin"));
    expect(await (await GET()).json()).toMatchObject({ role: "admin" });
  });

  it("로그인하지 않았으면 401 unauthenticated 와 WWW-Authenticate: Bearer 이고, 로그인 수단을 읽지 않는다", async () => {
    domain.authenticate.mockResolvedValue({ status: "unauthenticated" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({
      code: "unauthenticated",
      message: expect.any(String),
    });
    expect(domain.getMyLoginMethods).not.toHaveBeenCalled();
  });

  it("정지된 회원은 403 suspended 이고, 로그인 수단을 읽지 않는다", async () => {
    domain.authenticate.mockResolvedValue({ status: "suspended" });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code: "suspended" });
    expect(domain.getMyLoginMethods).not.toHaveBeenCalled();
  });

  it("DB 설정이 없으면 503 not_configured 다", async () => {
    domain.authenticate.mockResolvedValue({ status: "no-database" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code: "not_configured" });
  });

  it("문지기를 지난 뒤 정지·탈퇴됐으면(로그인 수단이 signed-out) 401 이다", async () => {
    domain.getMyLoginMethods.mockResolvedValue({ status: "signed-out" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
  });
});
