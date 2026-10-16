import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { setUserStatus } from "@/server/admin";
import type { authenticate } from "@/server/auth";
import { PATCH } from "./route";

// 도메인을 가짜로 바꾸고 핸들러를 직접 부른다. 실제 Supabase 는 부르지 않는다.
const domain = vi.hoisted(() => ({
  authenticate: vi.fn<typeof authenticate>(),
  setUserStatus: vi.fn<typeof setUserStatus>(),
}));
vi.mock("@/server/auth", () => ({ authenticate: domain.authenticate }));
vi.mock("@/server/admin", () => ({ setUserStatus: domain.setUserStatus }));

const ADMIN = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const TARGET = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

const call = (id: string, body: string) =>
  PATCH(
    new NextRequest(`http://localhost/api/admin/users/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
const suspend = (id = TARGET) => call(id, JSON.stringify({ status: "suspended" }));

beforeEach(() => {
  vi.clearAllMocks();
  domain.authenticate.mockResolvedValue({
    status: "ready",
    user: { id: ADMIN, email: "admin@example.com", role: "admin" },
  });
  domain.setUserStatus.mockResolvedValue({ status: "saved" });
});

describe("PATCH /api/admin/users/:id/status", () => {
  it("운영자는 회원을 정지하고, 바뀐 상태를 돌려준다", async () => {
    const response = await suspend();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ id: TARGET, status: "suspended" });
    expect(domain.setUserStatus).toHaveBeenCalledWith(TARGET, "suspended");
    expect(domain.authenticate).toHaveBeenCalledWith("bearer");
  });

  it("경로의 id 와 본문의 status 만 도메인에 넘긴다(다른 필드는 읽지 않는다)", async () => {
    await call(TARGET, JSON.stringify({ status: "active", userId: ADMIN, isAdmin: true }));
    expect(domain.setUserStatus.mock.calls[0]).toEqual([TARGET, "active"]);
  });

  it("대문자 id 로 불러도 응답의 id 는 소문자다", async () => {
    const response = await suspend(TARGET.toUpperCase());
    expect(await response.json()).toEqual({ id: TARGET, status: "suspended" });
  });

  it("운영자가 아니면 403 forbidden 이고 도메인을 부르지 않는다", async () => {
    domain.authenticate.mockResolvedValue({
      status: "ready",
      user: { id: ADMIN, email: null, role: "user" },
    });
    const response = await suspend();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
    expect(domain.setUserStatus).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "unauthenticated" } as const, 401, "unauthenticated"],
    [{ status: "suspended" } as const, 403, "suspended"],
    [{ status: "no-database" } as const, 503, "not_configured"],
  ])("문지기가 %o 면 %i %s 이고 도메인을 부르지 않는다", async (auth, status, code) => {
    domain.authenticate.mockResolvedValue(auth);
    const response = await suspend();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
    expect(await errorOf(response)).toMatchObject({ code, message: expect.any(String) });
    expect(domain.setUserStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["self", 409, "self"],
    ["admin-target", 409, "admin_target"],
    ["not-found", 404, "not_found"],
    ["invalid", 400, "invalid"],
    ["forbidden", 403, "forbidden"],
    ["signed-out", 403, "forbidden"],
    ["no-database", 503, "not_configured"],
  ] as const)("도메인이 %s 면 %i %s 다", async (result, status, code) => {
    domain.setUserStatus.mockResolvedValue({ status: result });
    const response = await suspend();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code, message: expect.any(String) });
  });

  it.each(["[]", "null", '"suspended"', "{", ""])(
    "본문 %j 은 JSON 객체가 아니라 status 없이 넘어가고, 도메인의 invalid 가 400 이 된다",
    async (body) => {
      domain.setUserStatus.mockResolvedValue({ status: "invalid" });
      const response = await call(TARGET, body);
      expect(domain.setUserStatus.mock.calls[0]).toEqual([TARGET, undefined]);
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toMatchObject({ code: "invalid" });
    },
  );
});
