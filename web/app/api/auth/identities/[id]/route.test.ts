import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { authenticate, unlinkMyLoginMethod } from "@/server/auth";
import { DELETE } from "./route";

// 도메인을 가짜로 바꾸고 핸들러를 직접 부른다. 실제 Supabase 는 부르지 않는다.
const domain = vi.hoisted(() => ({
  authenticate: vi.fn<typeof authenticate>(),
  unlinkMyLoginMethod: vi.fn<typeof unlinkMyLoginMethod>(),
}));
vi.mock("@/server/auth", () => domain);

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const IDENTITY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const errorOf = async (response: Response) => ((await response.json()) as { error: object }).error;

const call = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/auth/identities/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  domain.authenticate.mockResolvedValue({
    status: "ready",
    user: { id: USER, email: "a@example.com", role: "user" },
  });
  domain.unlinkMyLoginMethod.mockResolvedValue({ status: "unlinked" });
});

describe("DELETE /api/auth/identities/:id", () => {
  it("경로의 id 로 해제하고 본문 없이 204 다", async () => {
    const response = await call(IDENTITY);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(domain.unlinkMyLoginMethod).toHaveBeenCalledWith(IDENTITY);
    expect(domain.authenticate).toHaveBeenCalledWith("bearer");
  });

  it("마지막 로그인 수단이면 409 last_identity 다", async () => {
    domain.unlinkMyLoginMethod.mockResolvedValue({ status: "last-method" });
    const response = await call(IDENTITY);
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code: "last_identity" });
  });

  it.each(["not-found", "invalid"] as const)(
    "내 것이 아니거나 없거나 모양이 틀린 id(%s)는 404 not_found 다",
    async (status) => {
      domain.unlinkMyLoginMethod.mockResolvedValue({ status });
      const response = await call("not-a-uuid");
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toMatchObject({ code: "not_found" });
    },
  );

  it("해제하는 사이에 로그인이 사라졌으면(signed-out) 401 이다", async () => {
    domain.unlinkMyLoginMethod.mockResolvedValue({ status: "signed-out" });
    const response = await call(IDENTITY);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
  });

  it.each([
    [{ status: "unauthenticated" } as const, 401, "unauthenticated"],
    [{ status: "suspended" } as const, 403, "suspended"],
    [{ status: "no-database" } as const, 503, "not_configured"],
  ])("문지기가 %o 면 %i %s 이고 해제하지 않는다", async (auth, status, code) => {
    domain.authenticate.mockResolvedValue(auth);
    const response = await call(IDENTITY);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
    expect(await errorOf(response)).toMatchObject({ code, message: expect.any(String) });
    expect(domain.unlinkMyLoginMethod).not.toHaveBeenCalled();
  });
});
