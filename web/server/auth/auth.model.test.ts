import { describe, expect, it } from "vitest";
import {
  canUnlink,
  type IdentityRow,
  type LoginMethod,
  oauthFailurePath,
  oauthSuccessPath,
  parseConfirmLink,
  parseIdentityId,
  parseOAuthCallback,
  safeNextPath,
  toAuthentication,
  toLoginMethods,
} from "./auth.model";

describe("safeNextPath", () => {
  it("이 사이트 안의 경로는 검색어까지 그대로 둔다", () => {
    expect(safeNextPath("/auth/password")).toBe("/auth/password");
    expect(safeNextPath("/posts?page=2")).toBe("/posts?page=2");
  });

  it("없으면 계정 화면으로 보낸다", () => {
    expect(safeNextPath(null)).toBe("/auth/login");
    expect(safeNextPath("")).toBe("/auth/login");
  });

  it("바깥 주소로 읽히는 값은 받지 않는다", () => {
    [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/.//evil.example",
      "/..//evil.example",
      "javascript:alert(1)",
      "account",
    ].forEach((next) => expect(safeNextPath(next), JSON.stringify(next)).toBe("/auth/login"));
  });
});

describe("parseConfirmLink", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("가입 확인과 비밀번호 재설정 링크를 읽는다", () => {
    expect(parseConfirmLink(params("token_hash=abc&type=email"))).toEqual({
      tokenHash: "abc",
      type: "email",
      next: "/auth/login",
    });
    expect(parseConfirmLink(params("token_hash=abc&type=recovery&next=/auth/password"))).toEqual({
      tokenHash: "abc",
      type: "recovery",
      next: "/auth/password",
    });
  });

  it("토큰이 없거나 모르는 종류면 링크로 보지 않는다", () => {
    expect(parseConfirmLink(params("type=email"))).toBeNull();
    expect(parseConfirmLink(params("token_hash=abc"))).toBeNull();
    expect(parseConfirmLink(params("token_hash=abc&type=magiclink"))).toBeNull();
  });

  it("next 가 바깥 주소여도 링크는 읽고, 갈 곳만 계정 화면으로 바꾼다", () => {
    expect(parseConfirmLink(params("token_hash=abc&type=email&next=//evil.example"))?.next).toBe(
      "/auth/login",
    );
  });
});

describe("parseOAuthCallback", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("코드와 갈 곳을 읽고, 갈 곳이 없으면 계정 화면이다", () => {
    expect(parseOAuthCallback(params("code=abc&next=/acme/tasks"))).toEqual({
      status: "code",
      code: "abc",
      next: "/acme/tasks",
      isLinking: false,
    });
    expect(parseOAuthCallback(params("code=abc"))).toMatchObject({
      code: "abc",
      next: "/auth/login",
    });
  });

  it("코드가 없거나 제공자가 오류를 돌려줬으면 오류이고, Supabase 의 오류 코드를 함께 읽는다", () => {
    expect(parseOAuthCallback(params("next=/auth/login")).status).toBe("error");
    expect(parseOAuthCallback(params("code=")).status).toBe("error");
    expect(
      parseOAuthCallback(params("error=access_denied&error_code=user_banned&code=abc")),
    ).toEqual({ status: "error", errorCode: "user_banned", next: "/auth/login", isLinking: false });
  });

  it("next 가 바깥 주소면 갈 곳만 계정 화면으로 바꾼다", () => {
    expect(parseOAuthCallback(params("code=abc&next=https://evil.example")).next).toBe(
      "/auth/login",
    );
    expect(parseOAuthCallback(params("code=abc&next=//evil.example")).next).toBe("/auth/login");
  });
});

describe("parseOAuthCallback 의 연결 흐름", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("flow=link 면 연결 흐름이다", () => {
    expect(parseOAuthCallback(params("code=abc&next=/acme/settings&flow=link"))).toEqual({
      status: "code",
      code: "abc",
      next: "/acme/settings",
      isLinking: true,
    });
  });

  it("flow 가 link 가 아니면 로그인 흐름이다", () => {
    expect(parseOAuthCallback(params("code=abc&flow=LINK")).isLinking).toBe(false);
    expect(parseOAuthCallback(params("code=abc&flow=login")).isLinking).toBe(false);
  });

  it("연결 흐름의 오류도 갈 곳과 오류 코드를 함께 읽는다", () => {
    expect(
      parseOAuthCallback(
        params(
          "error=server_error&error_code=identity_already_exists&next=/acme/settings&flow=link",
        ),
      ),
    ).toEqual({
      status: "error",
      errorCode: "identity_already_exists",
      next: "/acme/settings",
      isLinking: true,
    });
  });
});

describe("oauthSuccessPath", () => {
  it("로그인 흐름은 next 그대로다", () => {
    expect(oauthSuccessPath({ next: "/acme/tasks", isLinking: false })).toBe("/acme/tasks");
    expect(oauthSuccessPath({ next: "/acme/tasks?page=2", isLinking: false })).toBe(
      "/acme/tasks?page=2",
    );
  });

  it("연결 흐름은 next 에 ?link=linked 를 붙인다", () => {
    expect(oauthSuccessPath({ next: "/acme/settings", isLinking: true })).toBe(
      "/acme/settings?link=linked",
    );
  });

  it("next 에 이미 검색어가 있으면 거기에 더하고, 있던 link 는 덮어쓴다", () => {
    expect(oauthSuccessPath({ next: "/acme/settings?tab=account", isLinking: true })).toBe(
      "/acme/settings?tab=account&link=linked",
    );
    expect(oauthSuccessPath({ next: "/acme/settings?link=failed", isLinking: true })).toBe(
      "/acme/settings?link=linked",
    );
  });
});

describe("oauthFailurePath", () => {
  const login = (errorCode: string | null) => ({
    errorCode,
    next: "/acme/tasks",
    isLinking: false,
  });
  const link = (errorCode: string | null, next = "/acme/settings") => ({
    errorCode,
    next,
    isLinking: true,
  });

  it("정지된 계정(user_banned)은 어느 흐름이든 로그인 화면의 정지 안내다", () => {
    expect(oauthFailurePath(login("user_banned"))).toBe("/auth/login?link=suspended");
    expect(oauthFailurePath(link("user_banned"))).toBe("/auth/login?link=suspended");
  });

  it("로그인 흐름의 실패는 next 와 상관없이 oauth-failed 안내다", () => {
    [null, "access_denied", "identity_already_exists", "bad_code_verifier"].forEach((code) =>
      expect(oauthFailurePath(login(code)), String(code)).toBe("/auth/login?link=oauth-failed"),
    );
  });

  it("연결 흐름의 실패는 next(마이페이지)로 돌아가 아는 이유를 붙인다", () => {
    expect(oauthFailurePath(link("identity_already_exists"))).toBe(
      "/acme/settings?link=identity_already_exists",
    );
    expect(oauthFailurePath(link("manual_linking_disabled"))).toBe(
      "/acme/settings?link=manual_linking_disabled",
    );
  });

  it("연결 흐름에서 모르는 오류·교환 실패(오류 코드 없음)는 failed 다", () => {
    expect(oauthFailurePath(link("access_denied"))).toBe("/acme/settings?link=failed");
    expect(oauthFailurePath(link(null))).toBe("/acme/settings?link=failed");
  });

  it("next 에 이미 검색어가 있으면 거기에 더하고, 있던 link 는 덮어쓴다", () => {
    expect(oauthFailurePath(link("manual_linking_disabled", "/acme/settings?tab=account"))).toBe(
      "/acme/settings?tab=account&link=manual_linking_disabled",
    );
    expect(oauthFailurePath(link(null, "/acme/settings?link=linked"))).toBe(
      "/acme/settings?link=failed",
    );
  });
});

describe("toAuthentication", () => {
  const claims = { userId: "user-1", email: "a@example.com" };

  it("활동 중인 회원은 ready 이고, 역할은 DB 의 is_admin 에서 온다", () => {
    expect(toAuthentication(claims, { is_admin: false, status: "active" })).toEqual({
      status: "ready",
      user: { id: "user-1", email: "a@example.com", role: "user" },
    });
    expect(toAuthentication(claims, { is_admin: true, status: "active" })).toEqual({
      status: "ready",
      user: { id: "user-1", email: "a@example.com", role: "admin" },
    });
  });

  it("이메일이 없는 토큰은 이메일 없이 ready 다", () => {
    expect(
      toAuthentication({ userId: "user-1", email: null }, { is_admin: false, status: "active" }),
    ).toMatchObject({ status: "ready", user: { email: null } });
  });

  it("프로필 행이 없으면(탈퇴 직후의 토큰) unauthenticated 다", () => {
    expect(toAuthentication(claims, null)).toEqual({ status: "unauthenticated" });
  });

  it("정지된 회원은 운영자여도 suspended 다", () => {
    expect(toAuthentication(claims, { is_admin: false, status: "suspended" })).toEqual({
      status: "suspended",
    });
    expect(toAuthentication(claims, { is_admin: true, status: "suspended" })).toEqual({
      status: "suspended",
    });
  });

  it("active 가 아닌 모르는 상태도 열지 않는다", () => {
    expect(toAuthentication(claims, { is_admin: false, status: "deleted" })).toEqual({
      status: "suspended",
    });
  });
});

describe("toLoginMethods", () => {
  const identity = (overrides: Partial<IdentityRow> = {}): IdentityRow => ({
    identity_id: "11111111-1111-4111-8111-111111111111",
    provider: "email",
    identity_data: { email: "a@example.com" },
    created_at: "2026-10-01T00:00:00.000Z",
    last_sign_in_at: "2026-10-14T00:00:00.000Z",
    ...overrides,
  });

  it("Supabase 의 identities 를 화면 모양으로 바꾼다", () => {
    expect(toLoginMethods([identity()])).toEqual([
      {
        identityId: "11111111-1111-4111-8111-111111111111",
        provider: "email",
        label: "이메일",
        email: "a@example.com",
        linkedAt: "2026-10-01T00:00:00.000Z",
        lastSignInAt: "2026-10-14T00:00:00.000Z",
      },
    ]);
  });

  it("제공자 이름을 한국어 이름으로 바꾸고, 모르는 제공자는 이름 그대로 둔다", () => {
    const labels = ["email", "google", "kakao", "custom:naver", "custom:line"].map(
      (provider, index) =>
        toLoginMethods([identity({ provider, created_at: `2026-10-0${index + 1}` })])[0].label,
    );
    expect(labels).toEqual(["이메일", "구글", "카카오", "네이버", "custom:line"]);
  });

  it("연결한 순서대로 놓고, 같은 시각이면 id 순이다", () => {
    const methods = toLoginMethods([
      identity({ identity_id: "c", created_at: "2026-10-03T00:00:00.000Z" }),
      identity({ identity_id: "b", created_at: "2026-10-01T00:00:00.000Z" }),
      identity({ identity_id: "a", created_at: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(methods.map((method) => method.identityId)).toEqual(["a", "b", "c"]);
  });

  it("연결 시각이 없는 줄은 맨 앞이고 시각은 null 이다", () => {
    const methods = toLoginMethods([
      identity({ identity_id: "b" }),
      identity({ identity_id: "a", created_at: undefined, last_sign_in_at: undefined }),
    ]);
    expect(
      methods.map((method) => [method.identityId, method.linkedAt, method.lastSignInAt]),
    ).toEqual([
      ["a", null, null],
      ["b", "2026-10-01T00:00:00.000Z", "2026-10-14T00:00:00.000Z"],
    ]);
  });

  it("제공자가 이메일을 주지 않았으면(없음·빈 값·글자 아님) email 은 null 이다", () => {
    [undefined, {}, { email: "" }, { email: 1 }].forEach((identity_data) =>
      expect(
        toLoginMethods([identity({ identity_data })])[0].email,
        JSON.stringify(identity_data),
      ).toBeNull(),
    );
  });

  it("빈 목록은 빈 목록이고, 받은 배열을 바꾸지 않는다", () => {
    expect(toLoginMethods([])).toEqual([]);
    const input = [identity({ identity_id: "b" }), identity({ identity_id: "a" })];
    toLoginMethods(input);
    expect(input.map((row) => row.identity_id)).toEqual(["b", "a"]);
  });
});

describe("canUnlink", () => {
  const method = (identityId: string): LoginMethod => ({
    identityId,
    provider: "google",
    label: "구글",
    email: null,
    linkedAt: null,
    lastSignInAt: null,
  });

  it("로그인 수단이 둘 이상일 때만 해제할 수 있다", () => {
    expect(canUnlink([])).toBe(false);
    expect(canUnlink([method("a")])).toBe(false);
    expect(canUnlink([method("a"), method("b")])).toBe(true);
  });
});

describe("parseIdentityId", () => {
  const ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  it("uuid 를 받고 소문자로 맞춘다", () => {
    expect(parseIdentityId(ID)).toBe(ID);
    expect(parseIdentityId(ID.toUpperCase())).toBe(ID);
  });

  it("uuid 가 아닌 값은 받지 않는다", () => {
    [
      "",
      "abc",
      ` ${ID}`,
      `${ID}x`,
      ID.replaceAll("-", ""),
      "../admin",
      undefined,
      null,
      1,
      [ID],
    ].forEach((input) => expect(parseIdentityId(input), JSON.stringify(input)).toBeNull());
  });
});
