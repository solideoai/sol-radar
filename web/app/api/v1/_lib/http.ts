import "server-only";
import type { PeopleResult } from "@/server/people";
import { toServerErrorRecord } from "@/server/shared";
import { authenticate, type AuthUser } from "@/server/auth";
import type { AnalysisContext } from "@/server/bids";
import { getMyBusinessAccess } from "@/server/organization";
import { getMyEmployment, type EmploymentResult } from "@/server/profile";

type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_DISABLED"
  | "CSRF_REJECTED"
  | "PROFILE_INCOMPLETE"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "UNSUPPORTED_ACCOUNT_STATE"
  | "INVALID_CURSOR"
  | "ANALYSIS_IN_PROGRESS"
  | "INGESTION_IN_PROGRESS"
  | "RUN_MODE_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "HOSTED_NOT_APPROVED"
  | "RATE_LIMITED"
  | "KAKAO_NOT_CONNECTED"
  | "KAKAO_NOT_READY"
  | "KAKAO_TEST_THROTTLED"
  | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";
const responseHeaders = (requestId: string) => ({
  "Cache-Control": "no-store",
  "X-Request-Id": requestId,
});
const dbUnavailable = (): Response =>
  apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다.", { component: "db" });
export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: responseHeaders(crypto.randomUUID()) });
/** 본문 없는 성공(204 바꿈 완료). 머리는 json 과 같다. */
export const noContent = (): Response =>
  new Response(null, { status: 204, headers: responseHeaders(crypto.randomUUID()) });
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const requestId = crypto.randomUUID();
  return Response.json(
    { error: { code, message, details, requestId } },
    { status, headers: { ...headers, ...responseHeaders(requestId) } },
  );
}

// 서비스 결과의 공통 모양(공고 ServiceResult·수집 관리 IngestionAdminResult). 도메인끼리는 서로를 import 하지 않아
// 여기서 모양으로 받는다. result.code 가 ApiErrorCode 안에 있는지는 tsc 가 본다.
type ServiceOutcome<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      code: ApiErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

// 서비스 결과를 v1 응답으로 옮긴다.
export function serviceResponse<T>(result: ServiceOutcome<T>): Response {
  if (result.ok) return json(result.data, result.status);
  const retryAfter = result.details?.retryAfterSeconds;
  return apiError(
    result.status,
    result.code,
    result.message,
    result.details ?? {},
    result.status === 429 && typeof retryAfter === "number"
      ? { "Retry-After": String(retryAfter) }
      : {},
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
  if (auth.status === "no-database") return { ok: false, response: dbUnavailable() };
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
      return dbUnavailable();
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

export function peopleResponse<T>(result: PeopleResult<T>): Response {
  return result.status === "ready"
    ? json(result.data)
    : apiError(
        result.error.httpStatus,
        result.error.code,
        result.error.message,
        result.error.details,
      );
}

// 업무 경로의 입구: 로그인·가입 정보 완료 뒤 업무 조직 멤버십(sol_role)까지 확인한다.
export async function requireBusinessUser(
  request: Request,
): Promise<{ ok: true; ctx: AnalysisContext } | { ok: false; response: Response }> {
  const guarded = await requireCompleteUser(request);
  if (!guarded.ok) return guarded;
  const access = await getMyBusinessAccess();
  const reject = (response: Response) => ({ ok: false as const, response });
  switch (access.status) {
    case "no-database":
      return reject(dbUnavailable());
    case "signed-out":
      return reject(apiError(401, "UNAUTHENTICATED", "로그인이 필요합니다."));
    case "no-org":
      return reject(
        apiError(403, "FORBIDDEN", "업무 조직에 가입해야 합니다.", {
          reason: "ORGANIZATION_REQUIRED",
          organizationStatePath: "/auth/organization-state",
        }),
      );
    case "multiple-orgs":
      return reject(apiError(403, "UNSUPPORTED_ACCOUNT_STATE", "업무 조직 하나만 지원합니다."));
    case "forbidden":
      return reject(apiError(403, "FORBIDDEN", "조회 권한이 없습니다."));
    case "ready":
      if (access.userId !== guarded.user.id || access.current.isPersonal)
        return reject(apiError(403, "FORBIDDEN", "조회 권한이 없습니다."));
      return {
        ok: true,
        ctx: { orgId: access.current.id, userId: access.userId, role: access.current.solRole },
      };
  }
}
