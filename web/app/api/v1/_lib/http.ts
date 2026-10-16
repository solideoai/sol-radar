import "server-only";
import { toServerErrorRecord } from "@/server/shared";
import { authenticate, type AuthUser } from "@/server/auth";
import { getMyEmployment, type EmploymentResult } from "@/server/profile";

type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_DISABLED"
  | "CSRF_REJECTED"
  | "PROFILE_INCOMPLETE"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";
const responseHeaders = (requestId: string) => ({
  "Cache-Control": "no-store",
  "X-Request-Id": requestId,
});
export const json = (body: unknown): Response =>
  Response.json(body, { headers: responseHeaders(crypto.randomUUID()) });
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): Response {
  const requestId = crypto.randomUUID();
  return Response.json(
    { error: { code, message, details, requestId } },
    { status, headers: responseHeaders(requestId) },
  );
}

// Routes normalize unexpected failures to the v1 envelope. Services still propagate DB failures.
export async function handleApiRequest(
  request: Request,
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const response = apiError(500, "INTERNAL_ERROR", "요청을 처리하지 못했습니다.");
    const path = new URL(request.url).pathname;
    console.error(
      JSON.stringify({
        ...toServerErrorRecord(
          error,
          { path, method: request.method },
          { routePath: path, routeType: "route" },
          new Date(),
        ),
        requestId: response.headers.get("X-Request-Id"),
      }),
    );
    return response;
  }
}

type Guarded = { ok: true; user: AuthUser } | { ok: false; response: Response };
export async function requireUser(request: Request): Promise<Guarded> {
  // Presence, not successful parsing: a malformed Authorization must never fall back to a cookie.
  const hasAuthorization = request.headers.has("Authorization");
  const auth = await authenticate(hasAuthorization ? "bearer" : "request");
  if (auth.status === "no-database")
    return {
      ok: false,
      response: apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다.", {
        component: "db",
      }),
    };
  if (auth.status === "unauthenticated")
    return { ok: false, response: apiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.") };
  if (auth.status === "suspended")
    return { ok: false, response: apiError(403, "ACCOUNT_DISABLED", "정지된 계정입니다.") };
  if (
    !hasAuthorization &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.headers.get("X-Requested-With") !== "sol-radar"
  ) {
    return { ok: false, response: apiError(403, "CSRF_REJECTED", "요청 확인 헤더가 필요합니다.") };
  }
  return { ok: true, user: auth.user };
}

export function employmentResponse(result: EmploymentResult): Response {
  switch (result.status) {
    case "ready":
      return json(result.state);
    case "signed-out":
      return apiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
    case "suspended":
      return apiError(403, "ACCOUNT_DISABLED", "정지된 계정입니다.");
    case "missing":
      return apiError(404, "NOT_FOUND", "프로필이 없습니다.", { resource: "profile" });
    case "no-database":
      return apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다.", { component: "db" });
    case "invalid":
      return apiError(400, "VALIDATION_ERROR", "가입 정보를 확인하세요.", {
        issues: Object.entries(result.fields).map(([path, message]) => ({ path, message })),
      });
  }
}

// Only authentication and the current user's completion; business routes must check membership separately.
export async function requireCompleteUser(request: Request): Promise<Guarded> {
  const guarded = await requireUser(request);
  if (!guarded.ok) return guarded;
  const employment = await getMyEmployment();
  if (employment.status !== "ready") return { ok: false, response: employmentResponse(employment) };
  return employment.state.profileComplete
    ? guarded
    : {
        ok: false,
        response: apiError(403, "PROFILE_INCOMPLETE", "가입 정보를 보완하세요.", {
          completionPath: "/auth/complete-profile",
        }),
      };
}
