import "server-only";
import { authenticate, type AuthUser } from "@/server/auth";

// ── /api/* 의 공통 응답과 문지기 ──
// 요청서의 NestJS 장치와 같은 일을 한다: requireUser = SupabaseAuthGuard + CurrentUser, requireAdmin = RolesGuard + Roles("admin").
// 감싸지 않은 핸들러가 Public 이다. 누가 무엇을 읽고 쓰는지는 이 문지기 뒤에서도 RLS·DB 함수가 다시 본다.
//
// 로그인은 `Authorization: Bearer <Supabase access token>` 으로만 받는다(서버 연결 @/server/supabase 가 헤더를 읽는다).
// 쿠키로는 로그인되지 않아 다른 사이트가 사용자의 브라우저로 이 주소를 부르게 해도(CSRF) 로그인한 요청이 되지 않는다.
// 웹 화면은 이 주소 대신 서버 함수(actions.ts)를 쓴다. 다른 출처의 브라우저 호출을 허용하는 CORS 헤더는 두지 않는다.

// 로그인한 사람의 응답은 공유 캐시에 남기지 않는다.
const NO_STORE = { "Cache-Control": "no-store" };

export type ApiErrorCode =
  | "unauthenticated"
  | "suspended"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "conflict"
  | "sole_owner"
  | "sole_admin"
  | "last_identity"
  | "self"
  | "admin_target"
  | "not_configured";

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: NO_STORE });

export const noContent = (): Response => new Response(null, { status: 204, headers: NO_STORE });

export const apiError = (status: number, code: ApiErrorCode, message: string): Response =>
  Response.json(
    { error: { code, message } },
    {
      status,
      // 401 은 어떤 방식으로 로그인해야 하는지 알린다(RFC 6750).
      headers: status === 401 ? { ...NO_STORE, "WWW-Authenticate": "Bearer" } : NO_STORE,
    },
  );

export const unauthenticated = () =>
  apiError(
    401,
    "unauthenticated",
    "로그인이 필요합니다. Authorization: Bearer <access token> 을 보내세요.",
  );

type Guarded = { ok: true; user: AuthUser } | { ok: false; response: Response };

/** 로그인한 활동 중인 회원만 통과시킨다. 정지된 회원은 토큰이 아직 유효해도 403 이다. */
export async function requireUser(): Promise<Guarded> {
  const auth = await authenticate("bearer");
  switch (auth.status) {
    case "no-database":
      return { ok: false, response: apiError(503, "not_configured", "DB 가 연결되지 않았습니다.") };
    case "unauthenticated":
      return { ok: false, response: unauthenticated() };
    case "suspended":
      return { ok: false, response: apiError(403, "suspended", "정지된 계정입니다.") };
    case "ready":
      return { ok: true, user: auth.user };
  }
}

/** 운영자(profiles.is_admin)만 통과시킨다. 역할은 토큰이 아니라 DB 에서 읽은 값이다. */
export async function requireAdmin(): Promise<Guarded> {
  const guarded = await requireUser();
  if (!guarded.ok || guarded.user.role === "admin") return guarded;
  return { ok: false, response: apiError(403, "forbidden", "운영자만 할 수 있습니다.") };
}

// 본문이 JSON 객체가 아니면 null. 값의 검증은 도메인이 한다.
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body))
    : null;
}
