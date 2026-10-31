import { NextResponse } from "next/server";
import { handleApiRequest, requireUser } from "@/app/api/v1/_lib/http";
import {
  connectOutcomeRedirect,
  isOwnNavigation,
  isSecureRequest,
  withStateCookie,
} from "@/app/api/v1/me/google-calendar/_lib/connect-redirect";
import { safeNextPath } from "@/server/auth";
import { startGoogleCalendarConnect } from "@/server/google-calendar";

/**
 * GET /me/google-calendar/connect?next=<사이트 안 경로> — 캘린더 툴바의 [구글 캘린더 연동] 링크(ADR-073).
 * state 쿠키를 굽고 Supabase 구글 OAuth(캘린더 범위·offline·consent)의 동의 화면으로 보낸다(307).
 * 구글이 아직 로그인 수단이 아니면 로그인 연결(linkIdentity)까지 한 화면에서 끝난다. 돌아오는 곳은 /auth/callback?flow=google-calendar 다.
 * 로그인이 아니거나, 다른 사이트에서 온 이동이거나(Sec-Fetch-Site), 서버에 구글 설정이 빠졌으면 next 로 돌려보낸다(?google=failed).
 */
export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const next = safeNextPath(new URL(request.url).searchParams.get("next"));
    const guarded = await requireUser(request);
    if (!guarded.ok || !isOwnNavigation(request)) {
      return connectOutcomeRedirect(request, next, "failed");
    }
    const start = await startGoogleCalendarConnect({
      userId: guarded.user.id,
      callbackOrigin: new URL(request.url).origin,
      next,
    });
    if (start.kind !== "REDIRECT") {
      console.warn(
        JSON.stringify({
          level: "warn",
          source: "server",
          event: "google_calendar.connect_start",
          outcome: start.kind,
          reason: start.kind === "START_FAILED" ? start.reason : null,
          time: new Date().toISOString(),
        }),
      );
      return connectOutcomeRedirect(request, next, "failed");
    }
    const response = NextResponse.redirect(start.redirectTo);
    response.headers.set("Cache-Control", "no-store");
    return withStateCookie(response, start.state, isSecureRequest(request));
  });
}
