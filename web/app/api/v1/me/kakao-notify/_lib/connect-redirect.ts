import "server-only";
import { NextResponse } from "next/server";
import { KAKAO_STATE_COOKIE, type KakaoConnectOutcome } from "@/server/kakao-notify";

// 카카오 연결의 브라우저 이동(/connect·/callback)이 함께 쓰는 응답. 둘 다 링크·카카오 리다이렉트로 오는 GET 이라
// JSON 오류 대신 설정 화면으로 돌려보내고, 설정 화면이 ?kakao=<결과> 로 안내 문구를 고른다(계획 Task 7).

/** 설정 화면으로 이동. /settings 는 내 개인 조직의 설정으로 다시 보낸다. 캐시하지 않는다. */
export function settingsRedirect(request: Request, outcome: KakaoConnectOutcome): NextResponse {
  const destination = new URL("/settings", request.url);
  destination.searchParams.set("kakao", outcome);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

const stateCookieOptions = (isSecure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isSecure,
  path: KAKAO_STATE_COOKIE.path,
});

/** /connect: state 를 굽는다. 카카오에서 돌아오는 최상위 GET 에 실리도록 SameSite=Lax 다. */
export function withStateCookie(
  response: NextResponse,
  state: string,
  isSecure: boolean,
): NextResponse {
  response.cookies.set(KAKAO_STATE_COOKIE.name, state, {
    ...stateCookieOptions(isSecure),
    maxAge: KAKAO_STATE_COOKIE.maxAgeSeconds,
  });
  return response;
}

/** /callback: 결과와 상관없이 state 를 지운다(한 번만 쓴다). 구울 때와 같은 경로여야 지워진다. */
export function withoutStateCookie(response: NextResponse, isSecure: boolean): NextResponse {
  response.cookies.set(KAKAO_STATE_COOKIE.name, "", { ...stateCookieOptions(isSecure), maxAge: 0 });
  return response;
}
