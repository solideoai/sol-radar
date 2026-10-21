import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, isAuthError, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/database.types";
import { AUTH_COOKIE_OPTIONS } from "@/server/shared";
import { type AuthClaims, bearerTokenOf, toAuthClaims } from "./claims";

// ── Supabase 클라이언트 (서버 쪽) ──
// 기본 통로는 anon 키 + 요청한 사람의 로그인이다. RLS 가 그 사람 기준으로 걸려 코드가 실수해도 남의 데이터가 새지 않는다.
// 로그인은 화면이면 쿠키, API(/api/*)를 부르는 앱·다른 서비스면 `Authorization: Bearer <access token>` 헤더에서 온다.
// 기본 통로는 **요청마다 새로 만든다.** 여러 요청이 하나를 같이 쓰면 한 사람의 로그인이 다른 사람의 요청에 섞인다.
// service_role 키는 RLS를 통째로 무시하므로 기본 통로로 쓰지 않는다(관리자 연결은 로그인이 없어 한 번 만들어 다시 쓴다).
let adminClient: SupabaseClient<Database> | null = null;

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 가 없습니다. web/.env.local 을 설정하세요 (database 스킬 참고).`);
  }
  return value;
}

/** DB 를 아직 붙이지 않은 프로젝트인지. 화면이 getSupabase() 의 예외 대신 "연결 없음"을 그리게 한다. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function requestBearerToken(): Promise<string | null> {
  return bearerTokenOf((await headers()).get("authorization"));
}

/** 기본 통로. 서버 컴포넌트·서버 함수·라우트 핸들러에서 요청마다 부른다. */
export async function getSupabase(): Promise<SupabaseClient<Database>> {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const key = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const bearer = await requestBearerToken();
  // 토큰을 헤더에 싣기만 한다. 맞는 토큰인지는 PostgREST·Auth 가 서명으로 보고, 틀리면 거절한다(RLS 도 그 사람 기준).
  // 세션을 저장하거나 갱신하지 않는다 — 갱신은 토큰을 가진 쪽(앱)이 한다.
  if (bearer) {
    return createClient<Database>(url, key, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // 서버 컴포넌트는 쿠키를 쓸 수 없어 예외가 난다. 토큰 갱신은 proxy.ts 가 화면을 그리기 전에 끝내 두므로 버려도 된다.
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서만 여기로 온다.
        }
      },
    },
  });
}

// 서명이 틀렸거나 만료됐거나 Auth 가 거절한(4xx) 토큰은 로그인하지 않은 것과 같다. 네트워크·서버 오류(5xx 등)는 올린다.
const isRejectedToken = (error: unknown): boolean =>
  isAuthError(error) &&
  typeof error.status === "number" &&
  error.status >= 400 &&
  error.status < 500;

/** 검증을 마친 로그인. accessToken 은 그 사람으로 Auth 를 부를 때(연결 해제·모든 기기 로그아웃) 쓴다. */
export type AuthContext = { claims: AuthClaims; accessToken: string };

// SDK decodeJWT의 JSON/UTF-8 오류는 AuthError가 아닌 예외로 나온다.
// 세 부분이 있는 토큰의 인코딩만 먼저 확인한다. 구조·서명·만료 검증은 SDK가 맡는다.
function hasUnreadableJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    for (const part of parts.slice(0, 2)) {
      const raw: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(part, "base64url")),
      );
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * 지금 요청의 로그인. 서명·만료(getClaims)와 발급자·대상·역할(toAuthClaims)을 확인한 토큰만 믿고, 아니면 null 이다.
 * 쿠키의 세션(getSession)은 쿠키를 그대로 믿으므로 토큰을 꺼내는 데만 쓰고, 그 토큰도 같은 검증을 거친다.
 * source "bearer" 는 Authorization 헤더만 본다(API — 쿠키 로그인을 받지 않아 CSRF 대상이 되지 않는다).
 */
export async function getAuthContext(
  source: "bearer" | "request" = "request",
): Promise<AuthContext | null> {
  const bearer = await requestBearerToken();
  if (source === "bearer" && !bearer) return null;
  const supabase = await getSupabase();
  const session = bearer ? null : await supabase.auth.getSession();
  if (session?.error && !isRejectedToken(session.error)) throw session.error;
  const accessToken = bearer ?? session?.data.session?.access_token ?? null;
  if (!accessToken) return null;
  if (hasUnreadableJwt(accessToken)) return null;
  const { data, error } = await supabase.auth.getClaims(accessToken);
  if (error) {
    if (isRejectedToken(error)) return null;
    throw error;
  }
  const claims = data ? toAuthClaims(data.claims, need("NEXT_PUBLIC_SUPABASE_URL")) : null;
  return claims ? { claims, accessToken } : null;
}

/** 지금 요청의 로그인한 사람. 로그인 전이거나 믿을 수 없는 토큰이면 null. */
export async function getAuthClaims(): Promise<AuthClaims | null> {
  return (await getAuthContext())?.claims ?? null;
}

/**
 * 로그인 수단 하나를 그 사람의 토큰으로 해제한다(Supabase Auth `DELETE /user/identities/{id}`).
 * SDK 의 unlinkIdentity 는 저장된 세션이 있어야 해서 Bearer 로 온 요청(세션 없음)에서는 쓰지 못한다.
 * 마지막 로그인 수단이면 Auth 가 single_identity_not_deletable 로 거절한다.
 */
export async function unlinkAuthIdentity(
  accessToken: string,
  identityId: string,
): Promise<"unlinked" | "not-found" | "last-method"> {
  const url = need("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${url}/auth/v1/user/identities/${encodeURIComponent(identityId)}`, {
    method: "DELETE",
    headers: {
      apikey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (response.ok) return "unlinked";
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === "object" && body !== null && "error_code" in body ? body.error_code : null;
  if (code === "single_identity_not_deletable") return "last-method";
  if (response.status === 404 || code === "identity_not_found") return "not-found";
  throw new Error(`로그인 수단을 해제하지 못했습니다 (Auth ${response.status} ${String(code)})`);
}

/**
 * 쿠키·헤더를 읽지 않는 anon 클라이언트. 로그인 없이 도는 곳(상태 검사 등)에서만 쓴다.
 * 세션을 저장하거나 갱신하지 않으므로 요청 사이에 로그인이 섞이지 않는다.
 */
export function getSupabaseAnon(): SupabaseClient<Database> {
  return createClient<Database>(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

/**
 * ⚠️ RLS를 우회한다. 받은 주소·키로 관리자 연결을 새로 만든다(모듈 변수에 담지 않는다).
 * process.env 가 아니라 파일에서 읽은 값을 쓰는 곳(demo:reset)이 부른다. 오류에는 받은 값을 싣지 않는다.
 */
export function createSupabaseAdminClient(input: {
  url: string;
  serviceRoleKey: string;
}): SupabaseClient<Database> {
  if (input.url.trim() === "") throw new Error("관리자 연결의 Supabase 주소가 비어 있습니다.");
  if (input.serviceRoleKey.trim() === "") {
    throw new Error("관리자 연결의 service role 키가 비어 있습니다.");
  }
  return createClient<Database>(input.url, input.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * ⚠️ RLS를 우회한다. 관리 작업(배치·마이그레이션 보조)에만, 꼭 필요할 때만 쓴다.
 * 어드민 화면도 쓰지 않는다. 운영자 판단은 profiles.is_admin 과 관리자 정책으로 DB가 한다 —
 * 우회하면 "누가 운영자인가"를 코드가 판단하고, 그 판단이 틀리면 막을 방법이 없다.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  adminClient ??= createClient<Database>(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return adminClient;
}
