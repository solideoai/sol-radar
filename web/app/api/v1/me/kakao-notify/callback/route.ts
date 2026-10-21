import type { NextRequest } from "next/server";
import { requireUser } from "@/app/api/v1/_lib/http";
import {
  settingsRedirect,
  withoutStateCookie,
} from "@/app/api/v1/me/kakao-notify/_lib/connect-redirect";
import {
  KAKAO_STATE_COOKIE,
  completeKakaoConnect,
  isKakaoStateCookieSecure,
  type KakaoConnectResult,
} from "@/server/kakao-notify";
import { toServerErrorRecord } from "@/server/shared";

const failed: KakaoConnectResult = { outcome: "failed", reason: null };

/**
 * GET /me/kakao-notify/callback — 카카오 동의 화면이 돌아오는 주소(KAKAO_REDIRECT_URI). 늘 설정 화면으로 보낸다(307).
 * 결과는 ?kakao=connected|consent_denied|state_mismatch|failed. state 쿠키는 결과와 상관없이 지운다.
 * 로그는 결과·이유 코드만 싣는다. code·state·토큰·사용자 ID 는 싣지 않는다.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname;
  const connected = await (async (): Promise<KakaoConnectResult> => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return failed;
    return completeKakaoConnect({
      userId: guarded.user.id,
      params: request.nextUrl.searchParams,
      stateCookie: request.cookies.get(KAKAO_STATE_COOKIE.name)?.value,
    });
  })().catch((error: unknown) => {
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
  if (connected.outcome !== "connected") {
    console.warn(
      JSON.stringify({
        level: "warn",
        source: "server",
        event: "kakao_notify.connect",
        outcome: connected.outcome,
        reason: connected.reason,
        time: new Date().toISOString(),
      }),
    );
  }
  return withoutStateCookie(
    settingsRedirect(request, connected.outcome),
    isKakaoStateCookieSecure(),
  );
}
