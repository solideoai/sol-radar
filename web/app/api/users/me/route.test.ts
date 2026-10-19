import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { authenticate } from "@/server/auth";
import type { deleteMyAccount, getMyProfile, updateMyDisplayName } from "@/server/profile";
import { DELETE, GET, PATCH } from "./route";

// 도메인을 가짜로 바꾸고 핸들러를 직접 부른다. 실제 Supabase 는 부르지 않는다.
const domain = vi.hoisted(() => ({
  authenticate: vi.fn<typeof authenticate>(),
  getMyProfile: vi.fn<typeof getMyProfile>(),
  updateMyDisplayName: vi.fn<typeof updateMyDisplayName>(),
  deleteMyAccount: vi.fn<typeof deleteMyAccount>(),
}));
vi.mock("@/server/auth", () => ({ authenticate: domain.authenticate }));
vi.mock("@/server/profile", () => ({
  getMyProfile: domain.getMyProfile,
  updateMyDisplayName: domain.updateMyDisplayName,
  deleteMyAccount: domain.deleteMyAccount,
}));

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;
const patch = (body: string) =>
  PATCH(
    new NextRequest("http://localhost/api/users/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
const profile = (isAdmin = false) =>
  ({
    status: "ready",
    profile: {
      email: null,
      displayName: "홍길동",
      avatarUrl: "https://img.example/a.png",
      role: isAdmin ? "운영자" : "회원",
      isAdmin,
      joinedAt: "2026-10-14T06:00:00.000Z",
      employment: null,
      profileComplete: false,
    },
  }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  domain.authenticate.mockResolvedValue({
    status: "ready",
    user: { id: USER, email: null, role: "user" },
  });
  domain.getMyProfile.mockResolvedValue(profile());
  domain.updateMyDisplayName.mockResolvedValue({ status: "saved" });
  domain.deleteMyAccount.mockResolvedValue({ status: "deleted" });
});

// 세 메서드가 같은 문지기를 지난다.
const guardCases = [
  [{ status: "unauthenticated" } as const, 401, "unauthenticated"],
  [{ status: "suspended" } as const, 403, "suspended"],
  [{ status: "no-database" } as const, 503, "not_configured"],
] as const;

const expectGuardResponse = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
  expect(await errorOf(response)).toMatchObject({ code, message: expect.any(String) });
};

describe("GET /api/users/me", () => {
  it("내 프로필을 API 모양으로 돌려주고, id 는 토큰의 사람이다", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: USER,
      email: null,
      displayName: "홍길동",
      avatarUrl: "https://img.example/a.png",
      role: "user",
      status: "active",
      joinedAt: "2026-10-14T06:00:00.000Z",
    });
    expect(domain.authenticate).toHaveBeenCalledWith("bearer");
  });

  it("운영자의 역할은 admin 이다", async () => {
    domain.getMyProfile.mockResolvedValue(profile(true));
    expect(await (await GET()).json()).toMatchObject({ role: "admin" });
  });

  it("문지기를 지난 뒤 프로필이 정지면 403 suspended 다", async () => {
    domain.getMyProfile.mockResolvedValue({ status: "suspended" });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: "suspended" });
  });

  it.each(["missing", "signed-out", "no-database"] as const)(
    "프로필이 %s 면(탈퇴 직후의 토큰 등) 401 이다",
    async (status) => {
      domain.getMyProfile.mockResolvedValue({ status });
      const response = await GET();
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
    },
  );

  it.each(guardCases)(
    "문지기가 %o 면 %i %s 이고 프로필을 읽지 않는다",
    async (auth, status, code) => {
      domain.authenticate.mockResolvedValue(auth);
      await expectGuardResponse(await GET(), status, code);
      expect(domain.getMyProfile).not.toHaveBeenCalled();
    },
  );
});

describe("PATCH /api/users/me", () => {
  it("displayName 만 도메인에 넘기고, 고친 뒤의 프로필을 돌려준다", async () => {
    const response = await patch(
      JSON.stringify({
        displayName: "새 이름",
        role: "admin",
        status: "active",
        avatarUrl: "https://evil.example/x.png",
        id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
        isAdmin: true,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(domain.updateMyDisplayName).toHaveBeenCalledTimes(1);
    expect(domain.updateMyDisplayName.mock.calls[0]).toEqual(["새 이름"]);
    expect(await response.json()).toMatchObject({ id: USER, displayName: "홍길동", role: "user" });
  });

  it.each(["[]", '["새 이름"]', "null", '"새 이름"', "42", "true", "{", ""])(
    "본문 %j 은 JSON 객체가 아니라 400 invalid 이고 도메인을 부르지 않는다",
    async (body) => {
      const response = await patch(body);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await errorOf(response)).toMatchObject({ code: "invalid" });
      expect(domain.updateMyDisplayName).not.toHaveBeenCalled();
    },
  );

  it("displayName 이 없으면 undefined 를 넘기고, 도메인의 invalid 를 400 과 그 메시지로 보인다", async () => {
    domain.updateMyDisplayName.mockResolvedValue({
      status: "invalid",
      message: "표시 이름을 입력하세요",
    });
    const response = await patch(JSON.stringify({ name: "홍길동" }));
    expect(domain.updateMyDisplayName.mock.calls[0]).toEqual([undefined]);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: "invalid", message: "표시 이름을 입력하세요" });
  });

  it("저장하는 사이에 로그인이 사라졌으면(signed-out) 401 이다", async () => {
    domain.updateMyDisplayName.mockResolvedValue({ status: "signed-out" });
    const response = await patch(JSON.stringify({ displayName: "새 이름" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
  });

  it.each(guardCases)("문지기가 %o 면 %i %s 이고 저장하지 않는다", async (auth, status, code) => {
    domain.authenticate.mockResolvedValue(auth);
    await expectGuardResponse(
      await patch(JSON.stringify({ displayName: "새 이름" })),
      status,
      code,
    );
    expect(domain.updateMyDisplayName).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/users/me", () => {
  it("마지막 업무 ADMIN이면 409 sole_admin과 안내를 돌려준다", async () => {
    domain.deleteMyAccount.mockResolvedValue({ status: "sole-admin" });
    const response = await DELETE();
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "sole_admin" });
  });
  it("탈퇴하면 본문 없이 204 다", async () => {
    const response = await DELETE();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(domain.deleteMyAccount).toHaveBeenCalledTimes(1);
  });

  it("다른 멤버가 있는 팀의 유일한 owner 면 409 sole_owner 다", async () => {
    domain.deleteMyAccount.mockResolvedValue({ status: "sole-owner" });
    const response = await DELETE();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await errorOf(response)).toMatchObject({ code: "sole_owner" });
  });

  it("DB 가 정지된 회원이라 거절하면 403 suspended 다", async () => {
    domain.deleteMyAccount.mockResolvedValue({ status: "suspended" });
    const response = await DELETE();
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: "suspended" });
  });

  it("지우는 사이에 로그인이 사라졌으면(signed-out) 401 이다", async () => {
    domain.deleteMyAccount.mockResolvedValue({ status: "signed-out" });
    const response = await DELETE();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it.each(guardCases)("문지기가 %o 면 %i %s 이고 지우지 않는다", async (auth, status, code) => {
    domain.authenticate.mockResolvedValue(auth);
    await expectGuardResponse(await DELETE(), status, code);
    expect(domain.deleteMyAccount).not.toHaveBeenCalled();
  });
});
