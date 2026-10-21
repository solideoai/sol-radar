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

// 이 사이트 안의 링크(same-origin)나 주소창·북마크(none)로 연 이동만 연결을 시작한다. 다른 사이트(same-site 하위 도메인 포함)가
// 최상위 이동으로 /connect 를 열면, 카카오가 동의 화면 없이 돌려보낼 때 꺼 둔 알림이 몰래 다시 켜진다(보안 검토 중 1).
// 이 머리는 브라우저가 붙이고 페이지 스크립트가 바꿀 수 없다. 머리가 없으면(오래된 브라우저·직접 호출) 막는다.
const OWN_NAVIGATION_SITES: readonly string[] = ["same-origin", "none"];

/** /connect 를 연 이동이 이 사이트 안에서 시작했는지. */
export const isOwnNavigation = (request: Request): boolean =>
  OWN_NAVIGATION_SITES.includes(request.headers.get("Sec-Fetch-Site") ?? "");

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
