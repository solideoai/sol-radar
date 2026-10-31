import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import {
  connectOutcomeRedirect,
  isSecureRequest,
  withoutStateCookie,
} from "@/app/api/v1/me/google-calendar/_lib/connect-redirect";
import { safeNextPath } from "@/server/auth";
import {
  GOOGLE_STATE_COOKIE,
  completeGoogleCalendarConnect,
  type GoogleConnectResult,
} from "@/server/google-calendar";
import { toServerErrorRecord } from "@/server/shared";

const failed: GoogleConnectResult = { outcome: "failed", reason: null, userId: null };

/** 로그인 화면이 ?link= 로 고르는 안내(app/auth/login/page.tsx 의 LINK_NOTICE_KEYS). */
const GOOGLE_MISMATCH_LINK = "google-mismatch";

/**
 * 다른 계정으로 돌아와 세션을 끊었으면 next(보통 /calendar)는 로그인을 요구해 검색어 없이 로그인 화면으로 보낸다.
 * 안내가 사라지지 않게 로그인 화면으로 바로 보내고, 다시 로그인하면 next 로 돌아간다(로그인 화면이 next 를 다시 검사한다).
 */
function mismatchLoginRedirect(request: Request, next: string): NextResponse {
  const destination = new URL("/auth/login", request.url);
  destination.searchParams.set("link", GOOGLE_MISMATCH_LINK);
  destination.searchParams.set("next", next);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * /auth/callback?flow=google-calendar — 구글 캘린더 연결이 돌아오는 갈래(ADR-073). 늘 307 이다.
 * 결과는 next(보통 /calendar)의 ?google=connected|consent_denied|no_refresh_token|state_mismatch|failed 이고,
 * 다른 계정으로 돌아왔으면(account_mismatch) 세션을 끊은 뒤 로그인 화면(?link=google-mismatch&next=…)이다.
 * state 쿠키는 결과와 상관없이 지운다.
 * 로그는 JSON 한 줄(결과·이유 코드·확인된 사람의 user id)이다. code·state·토큰·구글 이메일은 싣지 않는다.
 */
export async function completeGoogleCalendarCallback(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const connected = await completeGoogleCalendarConnect({
    params: request.nextUrl.searchParams,
    stateCookie: request.cookies.get(GOOGLE_STATE_COOKIE.name)?.value,
  }).catch((error: unknown) => {
    console.error(
      JSON.stringify(
        toServerErrorRecord(
          error,
          { path, method: request.method },
          { routePath: path, routeType: "route" },
          new Date(),
        ),
      ),
    );
    return failed;
  });
  const isConnected = connected.outcome === "connected";
  (isConnected ? console.info : console.warn)(
    JSON.stringify({
      level: isConnected ? "info" : "warn",
      source: "server",
      event: "google_calendar.connect",
      action: "connect",
      result: connected.outcome,
      reason: connected.reason,
      userId: connected.userId,
      time: new Date().toISOString(),
    }),
  );
  // 다른 계정 세션을 끊지 못했으면 따로 한 줄 남긴다(오류 코드만. 쿠키를 직접 지우지는 않는다).
  if (connected.signOutError !== undefined) {
    console.warn(
      JSON.stringify({
        level: "warn",
        source: "server",
        event: "google_calendar.sign_out_failed",
        action: "connect",
        result: "failed",
        code: connected.signOutError,
        time: new Date().toISOString(),
      }),
    );
  }
  const redirect =
    connected.outcome === "account_mismatch"
      ? mismatchLoginRedirect(request, next)
      : connectOutcomeRedirect(request, next, connected.outcome);
  return withoutStateCookie(redirect, isSecureRequest(request));
}
