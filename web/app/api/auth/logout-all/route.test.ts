import { beforeEach, describe, expect, it, vi } from "vitest";
import type { authenticate, signOutEverywhere } from "@/server/auth";
import { POST } from "./route";

// 도메인을 가짜로 바꾸고 핸들러를 직접 부른다. 실제 Supabase 는 부르지 않는다.
const domain = vi.hoisted(() => ({
  authenticate: vi.fn<typeof authenticate>(),
  signOutEverywhere: vi.fn<typeof signOutEverywhere>(),
}));
vi.mock("@/server/auth", () => domain);

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const errorOf = async (response: Response) => ((await response.json()) as { error: object }).error;

beforeEach(() => {
  vi.clearAllMocks();
  domain.authenticate.mockResolvedValue({
    status: "ready",
    user: { id: USER, email: null, role: "user" },
  });
  domain.signOutEverywhere.mockResolvedValue({ status: "done" });
});

describe("POST /api/auth/logout-all", () => {
  it("모든 기기의 세션을 끊고 본문 없이 204 다", async () => {
    const response = await POST();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(domain.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(domain.authenticate).toHaveBeenCalledWith("bearer");
  });

  it("끊는 사이에 로그인이 사라졌으면(signed-out) 401 이다", async () => {
    domain.signOutEverywhere.mockResolvedValue({ status: "signed-out" });
    const response = await POST();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
  });

  it.each([
    [{ status: "unauthenticated" } as const, 401, "unauthenticated"],
    [{ status: "suspended" } as const, 403, "suspended"],
    [{ status: "no-database" } as const, 503, "not_configured"],
  ])("문지기가 %o 면 %i %s 이고 세션을 건드리지 않는다", async (auth, status, code) => {
    domain.authenticate.mockResolvedValue(auth);
    const response = await POST();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
    expect(await errorOf(response)).toMatchObject({ code, message: expect.any(String) });
    expect(domain.signOutEverywhere).not.toHaveBeenCalled();
  });
});
