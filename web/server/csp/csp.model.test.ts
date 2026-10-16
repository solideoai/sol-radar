import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp.model";

// 스펙 3장 5번. 정책 문자열을 지시어 → 출처 목록으로 나눠 본다.
const directivesOf = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );

const NONCE = "MDFmYjY4ZjctN2RmZC00ZDM5LWI4YWMtZmI1ZDFkNmMzMWNj";
const SUPABASE = "https://abcd.supabase.co";
const production = (overrides: { nonce?: string; supabaseUrl?: string | null } = {}) =>
  buildContentSecurityPolicy({
    nonce: NONCE,
    isDevelopment: false,
    supabaseUrl: SUPABASE,
    ...overrides,
  });

describe("buildContentSecurityPolicy", () => {
  it("운영 정책은 이 문자열이다(지시어 순서까지 고정)", () => {
    expect(production()).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' https://t1.kakaocdn.net`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data: https://*.googleusercontent.com https://*.kakaocdn.net https://*.pstatic.net",
        "font-src 'self'",
        "connect-src 'self' https://abcd.supabase.co",
        "frame-src postcode.map.kakao.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("스펙의 필수 지시어를 지킨다 — script-src 'self' 'nonce-…' 'strict-dynamic', object-src·base-uri·form-action·frame-ancestors", () => {
    const directives = directivesOf(production());
    expect(directives.get("script-src")?.slice(0, 3)).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
    ]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("운영의 스크립트는 nonce 로만 연다 — 'unsafe-inline'·'unsafe-eval'·와일드카드·scheme 전체가 없다", () => {
    const scripts = directivesOf(production()).get("script-src") ?? [];
    for (const loose of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "*",
      "https:",
      "http:",
      "data:",
      "blob:",
    ])
      expect(scripts, loose).not.toContain(loose);
    expect(directivesOf(production()).get("default-src")).toEqual(["'self'"]);
  });

  it("지시어마다 한 번씩만 나온다", () => {
    const names = production()
      .split("; ")
      .map((directive) => directive.split(" ")[0]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("개발 모드는 script-src 끝에 'unsafe-eval' 만 더하고 나머지는 운영과 같다", () => {
    const development = buildContentSecurityPolicy({
      nonce: NONCE,
      isDevelopment: true,
      supabaseUrl: SUPABASE,
    });
    const dev = directivesOf(development);
    const prod = directivesOf(production());
    expect(dev.get("script-src")).toEqual([...(prod.get("script-src") ?? []), "'unsafe-eval'"]);
    expect([...dev.keys()]).toEqual([...prod.keys()]);
    for (const [name, sources] of prod)
      if (name !== "script-src") expect(dev.get(name), name).toEqual(sources);
  });

  it("넘긴 nonce 가 script-src 에 그대로 들어가고, 다른 nonce 면 그 자리만 다르다", () => {
    const other = "b3RoZXItbm9uY2U=";
    expect(production({ nonce: other })).toBe(production().replace(NONCE, other));
    expect(production({ nonce: other })).not.toContain(NONCE);
    expect(directivesOf(production({ nonce: other })).get("script-src")).toContain(
      `'nonce-${other}'`,
    );
  });

  it("connect-src 에는 Supabase 주소의 출처(scheme·호스트·포트)만 연다 — 끝의 / ·경로·검색어는 뗀다", () => {
    const connectOf = (supabaseUrl: string | null | undefined) =>
      directivesOf(production({ supabaseUrl })).get("connect-src");
    expect(connectOf("https://abcd.supabase.co/")).toEqual(["'self'", "https://abcd.supabase.co"]);
    expect(connectOf("https://abcd.supabase.co/rest/v1/?apikey=x#y")).toEqual([
      "'self'",
      "https://abcd.supabase.co",
    ]);
    expect(connectOf("http://127.0.0.1:54321")).toEqual(["'self'", "http://127.0.0.1:54321"]);
  });

  it("Supabase 주소가 없거나 http(s) 주소가 아니면 connect-src 는 'self' 뿐이다", () => {
    for (const supabaseUrl of [
      undefined,
      null,
      "",
      "abcd.supabase.co",
      "ftp://abcd.supabase.co",
      "javascript:alert(1)",
    ])
      expect(
        directivesOf(production({ supabaseUrl })).get("connect-src"),
        String(supabaseUrl),
      ).toEqual(["'self'"]);
  });

  it("Supabase 주소에 ; 와 지시어를 섞어도 정책에 새 지시어가 끼어들지 못한다", () => {
    const policy = production({ supabaseUrl: "https://abcd.supabase.co/; script-src *" });
    expect(policy).not.toContain("script-src *");
    expect(directivesOf(policy).get("connect-src")).toEqual(["'self'", "https://abcd.supabase.co"]);
    expect(policy.split("; ")).toHaveLength(11);
  });
});
