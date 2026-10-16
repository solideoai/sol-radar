import { describe, expect, it } from "vitest";
import { bearerTokenOf, toAuthClaims } from "./claims";

const SUPABASE_URL = "https://test.supabase.co";
const ISSUER = "https://test.supabase.co/auth/v1";
const USER = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";

// 로그인한 사람에게 이 프로젝트의 Auth 가 준 access token 의 클레임.
const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: ISSUER,
  aud: "authenticated",
  role: "authenticated",
  sub: USER,
  email: "a@example.com",
  ...overrides,
});

describe("bearerTokenOf", () => {
  it("Authorization: Bearer 의 토큰을 꺼낸다", () => {
    expect(bearerTokenOf("Bearer eyJhbGci.eyJzdWIi.c2lnbmF0dXJl")).toBe(
      "eyJhbGci.eyJzdWIi.c2lnbmF0dXJl",
    );
  });

  it("방식 이름은 대소문자를 가리지 않는다", () => {
    expect(bearerTokenOf("bearer abc")).toBe("abc");
    expect(bearerTokenOf("BEARER abc")).toBe("abc");
  });

  it("헤더 값 앞뒤의 공백은 걷어 낸다", () => {
    expect(bearerTokenOf("  Bearer abc  ")).toBe("abc");
  });

  it("토큰 끝의 = 채움은 토큰의 일부다", () => {
    expect(bearerTokenOf("Bearer abc==")).toBe("abc==");
  });

  it("헤더가 없거나 비었거나 토큰이 없으면 null", () => {
    expect(bearerTokenOf(null)).toBeNull();
    expect(bearerTokenOf("")).toBeNull();
    expect(bearerTokenOf("Bearer")).toBeNull();
    expect(bearerTokenOf("Bearer ")).toBeNull();
  });

  it("Bearer 가 아닌 방식(Basic 등)은 토큰으로 보지 않는다", () => {
    expect(bearerTokenOf("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerTokenOf("Token abc")).toBeNull();
    expect(bearerTokenOf("abc")).toBeNull();
  });

  it("공백·쉼표가 섞였거나 = 가 가운데 있는 값은 토큰으로 보지 않는다", () => {
    [
      "Bearer  abc",
      "Bearer\tabc",
      "Bearer abc def",
      "Bearer abc,def",
      "Bearer abc, Bearer def",
      "Bearer a=b",
    ].forEach((header) => expect(bearerTokenOf(header), JSON.stringify(header)).toBeNull());
  });
});

describe("toAuthClaims", () => {
  it("이 프로젝트가 로그인한 사람에게 준 토큰이면 id 와 이메일을 돌려준다", () => {
    expect(toAuthClaims(payload(), SUPABASE_URL)).toEqual({ userId: USER, email: "a@example.com" });
  });

  it("Supabase 주소 끝의 / 는 발급자를 맞출 때 무시한다", () => {
    expect(toAuthClaims(payload(), `${SUPABASE_URL}/`)).toEqual({
      userId: USER,
      email: "a@example.com",
    });
    expect(toAuthClaims(payload(), `${SUPABASE_URL}//`)?.userId).toBe(USER);
  });

  it("발급자(iss)는 정확히 같아야 한다 — 다른 프로젝트·끝의 /·더 긴 경로·없음은 거절한다", () => {
    [
      "https://other.supabase.co/auth/v1",
      `${ISSUER}/`,
      `${ISSUER}/extra`,
      "https://test.supabase.co",
      "supabase",
      undefined,
    ].forEach((iss) =>
      expect(toAuthClaims(payload({ iss }), SUPABASE_URL), String(iss)).toBeNull(),
    );
  });

  it("대상(aud)은 문자열이든 배열이든 authenticated 가 들어 있어야 한다", () => {
    expect(toAuthClaims(payload({ aud: ["authenticated", "other"] }), SUPABASE_URL)?.userId).toBe(
      USER,
    );
    expect(toAuthClaims(payload({ aud: ["other"] }), SUPABASE_URL)).toBeNull();
    expect(toAuthClaims(payload({ aud: [] }), SUPABASE_URL)).toBeNull();
    expect(toAuthClaims(payload({ aud: "anon" }), SUPABASE_URL)).toBeNull();
    expect(toAuthClaims(payload({ aud: undefined }), SUPABASE_URL)).toBeNull();
  });

  it("역할이 authenticated 가 아니면(anon·service_role 키도 JWT 다) 거절한다", () => {
    ["anon", "service_role", "Authenticated", undefined].forEach((role) =>
      expect(toAuthClaims(payload({ role }), SUPABASE_URL), String(role)).toBeNull(),
    );
  });

  it("anon 키의 모양(iss supabase, role anon, sub 없음)은 거절한다", () => {
    expect(toAuthClaims({ iss: "supabase", ref: "test", role: "anon" }, SUPABASE_URL)).toBeNull();
  });

  it("sub 가 사람 id(uuid)가 아니면 거절한다", () => {
    ["not-a-uuid", "", `${USER}x`, ` ${USER}`, 42, null, undefined].forEach((sub) =>
      expect(toAuthClaims(payload({ sub }), SUPABASE_URL), String(sub)).toBeNull(),
    );
  });

  it("이메일이 없거나 빈 문자열이거나 글자가 아니면 null 이다 — 이메일을 주지 않는 제공자", () => {
    expect(toAuthClaims(payload({ email: "" }), SUPABASE_URL)).toEqual({
      userId: USER,
      email: null,
    });
    expect(toAuthClaims(payload({ email: undefined }), SUPABASE_URL)?.email).toBeNull();
    expect(toAuthClaims(payload({ email: 1 }), SUPABASE_URL)?.email).toBeNull();
  });
});
