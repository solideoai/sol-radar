import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ authenticate: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyEmployment: vi.fn() }));
vi.mock("@/server/organization", () => ({ getMyBusinessAccess: vi.fn() }));

import { authenticate } from "@/server/auth";
import { getMyBusinessAccess } from "@/server/organization";
import { getMyEmployment } from "@/server/profile";
import { apiError, requireBusinessUser, serviceResponse } from "./http";

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

describe("apiError 헤더", () => {
  it("호출자가 X-Request-Id 를 줘도 봉투 requestId 와 헤더가 같다", async () => {
    const response = apiError(400, "VALIDATION_ERROR", "x", {}, { "X-Request-Id": "forged" });
    const body = await response.json();
    expect(response.headers.get("X-Request-Id")).toBe(body.error.requestId);
    expect(body.error.requestId).not.toBe("forged");
  });
});

const USER_ID = "u1";
const ORG = {
  id: "o1",
  isPersonal: false,
  solRole: "SALES",
};

function mockAccess(access: unknown) {
  vi.mocked(authenticate).mockResolvedValue({ status: "ok", user: { id: USER_ID } } as never);
  vi.mocked(getMyEmployment).mockResolvedValue({
    status: "ready",
    state: { profileComplete: true },
  } as never);
  vi.mocked(getMyBusinessAccess).mockResolvedValue(access as never);
}
const request = () => new Request("http://x.test/api/v1/bids");

async function rejected(access: unknown) {
  mockAccess(access);
  const result = await requireBusinessUser(request());
  if (result.ok) throw new Error("통과하면 안 된다");
  return { status: result.response.status, body: await result.response.json() };
}

describe("requireBusinessUser", () => {
  it("signed-out 은 401", async () => {
    const { status, body } = await rejected({ status: "signed-out" });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("no-org 는 403 FORBIDDEN 과 조직 상태 경로", async () => {
    const { status, body } = await rejected({ status: "no-org", userId: USER_ID });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.details).toEqual({
      reason: "ORGANIZATION_REQUIRED",
      organizationStatePath: "/auth/organization-state",
    });
  });

  it("multiple-orgs 는 403 UNSUPPORTED_ACCOUNT_STATE", async () => {
    const { status, body } = await rejected({ status: "multiple-orgs", userId: USER_ID });
    expect(status).toBe(403);
    expect(body.error.code).toBe("UNSUPPORTED_ACCOUNT_STATE");
  });

  it("forbidden 은 403 FORBIDDEN", async () => {
    const { status, body } = await rejected({ status: "forbidden" });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("개인 조직은 403 FORBIDDEN", async () => {
    const { status, body } = await rejected({
      status: "ready",
      userId: USER_ID,
      current: { ...ORG, isPersonal: true },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("userId 가 다르면 403 FORBIDDEN", async () => {
    const { status, body } = await rejected({ status: "ready", userId: "other", current: ORG });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("no-database 는 503 {component:db}", async () => {
    const { status, body } = await rejected({ status: "no-database" });
    expect(status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details).toEqual({ component: "db" });
  });

  it("업무 조직 멤버는 통과하고 컨텍스트를 돌려준다", async () => {
    mockAccess({ status: "ready", userId: USER_ID, current: ORG });
    const result = await requireBusinessUser(request());
    expect(result).toEqual({ ok: true, ctx: { orgId: "o1", userId: USER_ID, role: "SALES" } });
  });
});
