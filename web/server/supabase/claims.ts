import "server-only";

// ── 로그인 토큰의 순수 규칙. 서명·만료는 Supabase(getClaims)가 보고, 여기서는 누가 누구에게 준 토큰인지 본다 ──

// 서버가 믿는 로그인 정보. 화면·API 가 보낸 userId·role 은 믿지 않고 이것만 쓴다.
export type AuthClaims = {
  userId: string;
  // 이메일을 주지 않는 제공자(카카오 비즈 앱이 아님·네이버)로 가입하면 없다.
  email: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RFC 6750 의 Bearer 토큰 글자. 공백·쉼표가 섞인 값은 토큰으로 보지 않는다.
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/** `Authorization: Bearer <토큰>` 의 토큰. 없거나 모양이 틀리면 null. */
export function bearerTokenOf(authorization: string | null): string | null {
  return BEARER.exec(authorization?.trim() ?? "")?.[1] ?? null;
}

/**
 * 서명이 맞는 토큰이어도 이 프로젝트의 Auth 가(iss) 로그인한 사람에게(aud·role) 준 것만 받는다.
 * 다른 Supabase 프로젝트의 토큰, anon·service_role 키(이것도 JWT 다), sub 가 사람 id 가 아닌 토큰은 null.
 * 사용자 지정 도메인을 쓰면 iss 가 그 도메인이므로 NEXT_PUBLIC_SUPABASE_URL 도 그 도메인으로 둔다(docs/AUTH-SECURITY.md).
 */
export function toAuthClaims(
  payload: Readonly<Record<string, unknown>>,
  supabaseUrl: string,
): AuthClaims | null {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const { sub, email } = payload;
  if (payload.iss !== issuer || !audiences.includes("authenticated")) return null;
  if (payload.role !== "authenticated" || typeof sub !== "string" || !UUID.test(sub)) return null;
  return { userId: sub, email: typeof email === "string" && email !== "" ? email : null };
}
