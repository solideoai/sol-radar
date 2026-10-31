import "server-only";
import { NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE, type GoogleConnectOutcome } from "@/server/google-calendar";

// 구글 캘린더 연결의 브라우저 이동(/connect 와 /auth/callback?flow=google-calendar)이 함께 쓰는 응답(ADR-073).
// 둘 다 링크·구글 리다이렉트로 오는 GET 이라 JSON 오류 대신 돌아갈 화면(next, 보통 /calendar)으로 보내고,
// 그 화면이 ?google=<결과> 로 안내 문구를 고른다. next 는 부르는 쪽이 safeNextPath 를 거친 사이트 안 경로다.

/** next 로 이동하며 결과를 붙인다. 캐시하지 않는다. */
export function connectOutcomeRedirect(
  request: Request,
  next: string,
  outcome: GoogleConnectOutcome,
): NextResponse {
  const destination = new URL(next, request.url);
  destination.searchParams.set("google", outcome);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// 이 사이트 안의 링크(same-origin)나 주소창·북마크(none)로 연 이동만 연결을 시작한다. 다른 사이트가 최상위 이동으로
// /connect 를 열면 사용자가 모르는 사이 구글 동의 화면으로 끌려간다. 이 머리는 브라우저가 붙이고 페이지 스크립트가 바꿀 수 없다.
const OWN_NAVIGATION_SITES: readonly string[] = ["same-origin", "none"];

/** /connect 를 연 이동이 이 사이트 안에서 시작했는지. */
export const isOwnNavigation = (request: Request): boolean =>
  OWN_NAVIGATION_SITES.includes(request.headers.get("Sec-Fetch-Site") ?? "");

/** 쿠키의 Secure. https 로 온 요청(운영·Vercel)에서만 켠다. 로컬 http 에서는 끈다. */
export const isSecureRequest = (request: Request): boolean =>
  new URL(request.url).protocol === "https:";

const stateCookieOptions = (isSecure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isSecure,
  path: GOOGLE_STATE_COOKIE.path,
});

/** /connect: state 를 굽는다. 구글에서 돌아오는 최상위 GET 에 실리도록 SameSite=Lax 다. */
export function withStateCookie(
  response: NextResponse,
  state: string,
  isSecure: boolean,
): NextResponse {
  response.cookies.set(GOOGLE_STATE_COOKIE.name, state, {
    ...stateCookieOptions(isSecure),
    maxAge: GOOGLE_STATE_COOKIE.maxAgeSeconds,
  });
  return response;
}

/** 콜백: 결과와 상관없이 state 를 지운다(한 번만 쓴다). 구울 때와 같은 경로여야 지워진다. */
export function withoutStateCookie(response: NextResponse, isSecure: boolean): NextResponse {
  response.cookies.set(GOOGLE_STATE_COOKIE.name, "", {
    ...stateCookieOptions(isSecure),
    maxAge: 0,
  });
  return response;
}
