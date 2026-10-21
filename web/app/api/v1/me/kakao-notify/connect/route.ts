import { NextResponse } from "next/server";
import { handleApiRequest, requireUser } from "@/app/api/v1/_lib/http";
import {
  isOwnNavigation,
  settingsRedirect,
  withStateCookie,
} from "@/app/api/v1/me/kakao-notify/_lib/connect-redirect";
import { startKakaoConnect } from "@/server/kakao-notify";

/**
 * GET /me/kakao-notify/connect — 설정 화면의 "카카오톡 알림 연결" 링크. state 쿠키를 굽고 카카오 동의 화면으로 보낸다(307, NextResponse.redirect 기본값).
 * 로그인이 아니거나, 다른 사이트에서 온 이동이거나(Sec-Fetch-Site), 서버에 카카오 설정이 빠졌으면 설정 화면으로 돌려보낸다(?kakao=failed).
 */
export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok || !isOwnNavigation(request)) return settingsRedirect(request, "failed");
    const start = await startKakaoConnect(guarded.user.id);
    if (start.kind === "NOT_CONFIGURED") return settingsRedirect(request, "failed");
    const response = NextResponse.redirect(start.redirectTo);
    response.headers.set("Cache-Control", "no-store");
    return withStateCookie(response, start.state, start.isSecureCookie);
  });
}
