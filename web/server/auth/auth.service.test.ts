import { describe, expect, it, vi } from "vitest";
import type { AuthRepo } from "./auth.repo";
import {
  authenticate,
  completeOAuthSignIn,
  confirmEmailLink,
  getMyLoginMethods,
  signOutEverywhere,
  unlinkMyLoginMethod,
} from "./auth.service";

// 저장 자리에 가짜를 꽂는다. 실제 Supabase Auth 는 부르지 않는다.
const fakeRepo = (overrides: Partial<AuthRepo> = {}): AuthRepo => ({
  isConfigured: () => true,
  verifyLink: vi.fn(async () => true),
  exchangeCode: vi.fn(async () => true),
  currentSession: vi.fn(async () => null),
  accountOf: vi.fn(async () => null),
  listIdentities: vi.fn(async () => []),
  unlinkIdentity: vi.fn(async () => "unlinked" as const),
  signOutEverywhere: vi.fn(async () => undefined),
  ...overrides,
});
const params = (query: string) => new URLSearchParams(query);

describe("confirmEmailLink", () => {
  it("맞는 링크면 토큰을 확인하고 next 로 보낸다", async () => {
    const repo = fakeRepo();
    await expect(
      confirmEmailLink(params("token_hash=abc&type=recovery&next=/auth/password"), repo),
    ).resolves.toBe("/auth/password");
    expect(repo.verifyLink).toHaveBeenCalledWith("abc", "recovery");
  });

  it("틀린 링크는 Supabase 에 묻지 않고 안내 화면으로 보낸다", async () => {
    const repo = fakeRepo();
    await expect(confirmEmailLink(params("type=email"), repo)).resolves.toBe(
      "/auth/login?link=invalid",
    );
    expect(repo.verifyLink).not.toHaveBeenCalled();
  });

  it("만료됐거나 이미 쓴 토큰이면 next 가 아니라 안내 화면으로 보낸다", async () => {
    const repo = fakeRepo({ verifyLink: vi.fn(async () => false) });
    await expect(
      confirmEmailLink(params("token_hash=abc&type=email&next=/posts"), repo),
    ).resolves.toBe("/auth/login?link=invalid");
  });

  it("DB 설정이 없으면 확인하지 않는다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(confirmEmailLink(params("token_hash=abc&type=email"), repo)).resolves.toBe(
      "/auth/login?link=invalid",
    );
    expect(repo.verifyLink).not.toHaveBeenCalled();
  });
});

describe("completeOAuthSignIn", () => {
  it("코드를 세션으로 바꾸고 next 로 보낸다", async () => {
    const repo = fakeRepo();
    await expect(completeOAuthSignIn(params("code=abc&next=/acme/dashboard"), repo)).resolves.toBe(
      "/acme/dashboard",
    );
    expect(repo.exchangeCode).toHaveBeenCalledWith("abc");
  });

  it("코드가 없거나 제공자가 오류를 돌려줬으면 바꾸지 않고 안내 화면으로 보낸다", async () => {
    const repo = fakeRepo();
    await expect(completeOAuthSignIn(params("error=access_denied"), repo)).resolves.toBe(
      "/auth/login?link=oauth-failed",
    );
    expect(repo.exchangeCode).not.toHaveBeenCalled();
  });

  it("교환이 실패하면(다른 브라우저·만료·이미 씀) next 가 아니라 안내 화면으로 보낸다", async () => {
    const repo = fakeRepo({ exchangeCode: vi.fn(async () => false) });
    await expect(completeOAuthSignIn(params("code=abc&next=/acme/tasks"), repo)).resolves.toBe(
      "/auth/login?link=oauth-failed",
    );
  });

  it("next 가 바깥 주소면 로그인은 마치고 계정 화면으로 보낸다", async () => {
    const repo = fakeRepo();
    await expect(
      completeOAuthSignIn(params("code=abc&next=https://evil.example"), repo),
    ).resolves.toBe("/auth/login");
  });

  it("DB 설정이 없으면 교환하지 않는다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(completeOAuthSignIn(params("code=abc"), repo)).resolves.toBe(
      "/auth/login?link=oauth-failed",
    );
    expect(repo.exchangeCode).not.toHaveBeenCalled();
  });
});

describe("completeOAuthSignIn 의 연결 흐름", () => {
  it("연결 흐름에서 코드 교환에 성공하면 next 에 ?link=linked 를 붙여 보낸다", async () => {
    const repo = fakeRepo();
    await expect(
      completeOAuthSignIn(params("code=abc&next=/acme/settings&flow=link"), repo),
    ).resolves.toBe("/acme/settings?link=linked");
    expect(repo.exchangeCode).toHaveBeenCalledWith("abc");
  });

  it("next 에 검색어가 있으면 거기에 link=linked 를 더한다", async () => {
    const repo = fakeRepo();
    await expect(
      completeOAuthSignIn(
        params(`code=abc&next=${encodeURIComponent("/acme/settings?tab=account")}&flow=link`),
        repo,
      ),
    ).resolves.toBe("/acme/settings?tab=account&link=linked");
  });

  it("로그인 흐름의 성공에는 link 표시를 붙이지 않는다", async () => {
    const repo = fakeRepo();
    await expect(completeOAuthSignIn(params("code=abc&next=/acme/settings"), repo)).resolves.toBe(
      "/acme/settings",
    );
  });

  it("연결 흐름에서 코드 교환이 실패하면 마이페이지로 돌아가 failed 를 보인다", async () => {
    const repo = fakeRepo({ exchangeCode: vi.fn(async () => false) });
    await expect(
      completeOAuthSignIn(params("code=abc&next=/acme/settings&flow=link"), repo),
    ).resolves.toBe("/acme/settings?link=failed");
  });

  it("연결 흐름에서 DB 설정이 없으면 교환하지 않고 failed 다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(
      completeOAuthSignIn(params("code=abc&next=/acme/settings&flow=link"), repo),
    ).resolves.toBe("/acme/settings?link=failed");
    expect(repo.exchangeCode).not.toHaveBeenCalled();
  });

  it.each(["identity_already_exists", "manual_linking_disabled"])(
    "연결 흐름에서 제공자·Supabase 가 %s 로 돌려보내면 교환하지 않고 그 이유를 보인다",
    async (errorCode) => {
      const repo = fakeRepo();
      await expect(
        completeOAuthSignIn(
          params(`error=server_error&error_code=${errorCode}&next=/acme/settings&flow=link`),
          repo,
        ),
      ).resolves.toBe(`/acme/settings?link=${errorCode}`);
      expect(repo.exchangeCode).not.toHaveBeenCalled();
    },
  );

  it("정지된 계정(user_banned)은 어느 흐름이든 로그인 화면의 정지 안내다", async () => {
    const repo = fakeRepo();
    await expect(
      completeOAuthSignIn(params("error=access_denied&error_code=user_banned"), repo),
    ).resolves.toBe("/auth/login?link=suspended");
    await expect(
      completeOAuthSignIn(
        params("error=access_denied&error_code=user_banned&next=/acme/settings&flow=link"),
        repo,
      ),
    ).resolves.toBe("/auth/login?link=suspended");
    expect(repo.exchangeCode).not.toHaveBeenCalled();
  });
});

// ── 요청한 사람 ──

const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const session = { claims: { userId: USER, email: "a@example.com" }, accessToken: "user-token" };
const active = { is_admin: false, status: "active" };
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const identities = [
  { identity_id: ID_B, provider: "google", created_at: "2026-10-02T00:00:00.000Z" },
  { identity_id: ID_A, provider: "email", created_at: "2026-10-01T00:00:00.000Z" },
];
// 로그인했고 활동 중이며, 로그인 수단이 둘인 사람.
const signedInRepo = (overrides: Partial<AuthRepo> = {}) =>
  fakeRepo({
    currentSession: vi.fn(async () => session),
    accountOf: vi.fn(async () => active),
    listIdentities: vi.fn(async () => identities),
    ...overrides,
  });

describe("authenticate", () => {
  it("확인한 토큰의 사람을 DB 의 역할과 함께 돌려준다", async () => {
    const repo = signedInRepo();
    await expect(authenticate("bearer", repo)).resolves.toEqual({
      status: "ready",
      user: { id: USER, email: "a@example.com", role: "user" },
    });
    expect(repo.accountOf).toHaveBeenCalledWith(USER);
  });

  it("운영자면 role 이 admin 이다", async () => {
    const repo = signedInRepo({
      accountOf: vi.fn(async () => ({ is_admin: true, status: "active" })),
    });
    await expect(authenticate("bearer", repo)).resolves.toMatchObject({
      status: "ready",
      user: { role: "admin" },
    });
  });

  it("어디서 토큰을 읽을지(bearer·request)를 저장에 그대로 넘기고, 기본은 request 다", async () => {
    const repo = signedInRepo();
    await authenticate("bearer", repo);
    await authenticate(undefined, repo);
    expect(vi.mocked(repo.currentSession).mock.calls).toEqual([["bearer"], ["request"]]);
  });

  it("DB 설정이 없으면 no-database 이고 토큰을 읽지 않는다", async () => {
    const repo = signedInRepo({ isConfigured: () => false });
    await expect(authenticate("bearer", repo)).resolves.toEqual({ status: "no-database" });
    expect(repo.currentSession).not.toHaveBeenCalled();
  });

  it("믿을 토큰이 없으면 unauthenticated 이고 DB 를 읽지 않는다", async () => {
    const repo = signedInRepo({ currentSession: vi.fn(async () => null) });
    await expect(authenticate("bearer", repo)).resolves.toEqual({ status: "unauthenticated" });
    expect(repo.accountOf).not.toHaveBeenCalled();
  });

  it("토큰은 맞는데 프로필 행이 없으면(탈퇴 직후) unauthenticated 다", async () => {
    const repo = signedInRepo({ accountOf: vi.fn(async () => null) });
    await expect(authenticate("bearer", repo)).resolves.toEqual({ status: "unauthenticated" });
  });

  it("정지된 회원은 토큰이 유효해도 suspended 다", async () => {
    const repo = signedInRepo({
      accountOf: vi.fn(async () => ({ is_admin: true, status: "suspended" })),
    });
    await expect(authenticate("bearer", repo)).resolves.toEqual({ status: "suspended" });
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = signedInRepo({
      accountOf: vi.fn(async () => Promise.reject(new Error("db down"))),
    });
    await expect(authenticate("bearer", repo)).rejects.toThrow("db down");
  });
});

describe("getMyLoginMethods", () => {
  it("그 사람의 토큰으로 Auth 에 물은 로그인 수단을 연결한 순서대로 돌려준다", async () => {
    const repo = signedInRepo();
    const result = await getMyLoginMethods(repo);
    expect(repo.listIdentities).toHaveBeenCalledWith("user-token");
    expect(result).toMatchObject({ status: "ready", canUnlink: true });
    expect(result.status === "ready" && result.methods.map((method) => method.label)).toEqual([
      "이메일",
      "구글",
    ]);
  });

  it("로그인 수단이 하나면 canUnlink 가 false 다", async () => {
    const repo = signedInRepo({ listIdentities: vi.fn(async () => [identities[0]]) });
    await expect(getMyLoginMethods(repo)).resolves.toMatchObject({
      status: "ready",
      canUnlink: false,
    });
  });

  it.each([
    ["DB 설정이 없으면", { isConfigured: () => false }],
    ["로그인 전이면", { currentSession: vi.fn(async () => null) }],
    ["프로필 행이 없으면", { accountOf: vi.fn(async () => null) }],
    [
      "정지된 회원이면",
      { accountOf: vi.fn(async () => ({ is_admin: false, status: "suspended" })) },
    ],
  ])("%s signed-out 이고 Auth 에 묻지 않는다", async (_, overrides) => {
    const repo = signedInRepo(overrides);
    await expect(getMyLoginMethods(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.listIdentities).not.toHaveBeenCalled();
  });
});

describe("unlinkMyLoginMethod", () => {
  it("내 로그인 수단이고 둘 이상이면 그 사람의 토큰으로 해제한다", async () => {
    const repo = signedInRepo();
    await expect(unlinkMyLoginMethod(ID_B, repo)).resolves.toEqual({ status: "unlinked" });
    expect(repo.listIdentities).toHaveBeenCalledWith("user-token");
    expect(repo.unlinkIdentity).toHaveBeenCalledWith("user-token", ID_B);
  });

  it("대문자 id 도 소문자로 맞춰 내 것과 비교하고 해제한다", async () => {
    const repo = signedInRepo();
    await expect(unlinkMyLoginMethod(ID_B.toUpperCase(), repo)).resolves.toEqual({
      status: "unlinked",
    });
    expect(repo.unlinkIdentity).toHaveBeenCalledWith("user-token", ID_B);
  });

  it.each([["not-a-uuid"], [""], [undefined], [42], [{ id: ID_B }]])(
    "모양이 틀린 id(%j)는 invalid 이고 로그인도 Auth 도 부르지 않는다",
    async (input) => {
      const repo = signedInRepo();
      await expect(unlinkMyLoginMethod(input, repo)).resolves.toEqual({ status: "invalid" });
      expect(repo.currentSession).not.toHaveBeenCalled();
      expect(repo.listIdentities).not.toHaveBeenCalled();
      expect(repo.unlinkIdentity).not.toHaveBeenCalled();
    },
  );

  it("내 것이 아닌 id 는 not-found 이고 해제를 부르지 않는다", async () => {
    const repo = signedInRepo();
    await expect(
      unlinkMyLoginMethod("99999999-9999-4999-8999-999999999999", repo),
    ).resolves.toEqual({ status: "not-found" });
    expect(repo.unlinkIdentity).not.toHaveBeenCalled();
  });

  it("마지막 하나면 last-method 이고 해제를 부르지 않는다", async () => {
    const repo = signedInRepo({ listIdentities: vi.fn(async () => [identities[0]]) });
    await expect(unlinkMyLoginMethod(ID_B, repo)).resolves.toEqual({ status: "last-method" });
    expect(repo.unlinkIdentity).not.toHaveBeenCalled();
  });

  it("로그인 수단이 하나뿐일 때 남의 id 를 보내면 last-method 가 아니라 not-found 다", async () => {
    const repo = signedInRepo({ listIdentities: vi.fn(async () => [identities[0]]) });
    await expect(unlinkMyLoginMethod(ID_A, repo)).resolves.toEqual({ status: "not-found" });
    expect(repo.unlinkIdentity).not.toHaveBeenCalled();
  });

  it.each(["not-found", "last-method"] as const)(
    "Auth 가 %s 로 거절하면 그대로 돌려준다",
    async (refusal) => {
      const repo = signedInRepo({ unlinkIdentity: vi.fn(async () => refusal) });
      await expect(unlinkMyLoginMethod(ID_B, repo)).resolves.toEqual({ status: refusal });
    },
  );

  it.each([
    ["정지된 회원", { accountOf: vi.fn(async () => ({ is_admin: false, status: "suspended" })) }],
    ["로그인 전", { currentSession: vi.fn(async () => null) }],
    ["프로필 행이 없는 토큰", { accountOf: vi.fn(async () => null) }],
    ["DB 설정이 없는 프로젝트", { isConfigured: () => false }],
  ])("%s 은 signed-out 이고 Auth 에 묻지도 해제하지도 않는다", async (_, overrides) => {
    const repo = signedInRepo(overrides);
    await expect(unlinkMyLoginMethod(ID_B, repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.listIdentities).not.toHaveBeenCalled();
    expect(repo.unlinkIdentity).not.toHaveBeenCalled();
  });

  it("Auth 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = signedInRepo({
      unlinkIdentity: vi.fn(async () => Promise.reject(new Error("auth down"))),
    });
    await expect(unlinkMyLoginMethod(ID_B, repo)).rejects.toThrow("auth down");
  });
});

describe("signOutEverywhere", () => {
  it("그 사람의 토큰으로 모든 기기의 세션을 끊는다", async () => {
    const repo = signedInRepo();
    await expect(signOutEverywhere(repo)).resolves.toEqual({ status: "done" });
    expect(repo.signOutEverywhere).toHaveBeenCalledWith("user-token");
  });

  it("정지된 회원도 자기 세션은 끊을 수 있다", async () => {
    const repo = signedInRepo({
      accountOf: vi.fn(async () => ({ is_admin: false, status: "suspended" })),
    });
    await expect(signOutEverywhere(repo)).resolves.toEqual({ status: "done" });
    expect(repo.signOutEverywhere).toHaveBeenCalledWith("user-token");
  });

  it("로그인 전이면 signed-out 이고 끊지 않는다", async () => {
    const repo = signedInRepo({ currentSession: vi.fn(async () => null) });
    await expect(signOutEverywhere(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.signOutEverywhere).not.toHaveBeenCalled();
  });

  it("DB 설정이 없으면 토큰을 읽지 않는다", async () => {
    const repo = signedInRepo({ isConfigured: () => false });
    await expect(signOutEverywhere(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.currentSession).not.toHaveBeenCalled();
  });

  it("Auth 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = signedInRepo({
      signOutEverywhere: vi.fn(async () => Promise.reject(new Error("auth down"))),
    });
    await expect(signOutEverywhere(repo)).rejects.toThrow("auth down");
  });
});
