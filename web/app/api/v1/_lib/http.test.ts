import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ authenticate: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyEmployment: vi.fn() }));
vi.mock("@/server/organization", () => ({ getMyBusinessAccess: vi.fn() }));

import { serviceResponse } from "./http";

describe("serviceResponse", () => {
  it("성공은 상태와 본문을 그대로 낸다", async () => {
    const response = serviceResponse({ ok: true, status: 202, data: { a: 1 } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ a: 1 });
  });

  it("429 는 Retry-After 와 오류 봉투를 낸다", async () => {
    const response = serviceResponse({
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      message: "너무 많습니다",
      details: { retryAfterSeconds: 17 },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("다른 오류에는 Retry-After 가 없다", () => {
    const response = serviceResponse({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "없음",
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
