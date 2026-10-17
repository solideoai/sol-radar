import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/server/csp";
import { refreshSession } from "@/server/supabase";

// 모든 화면 요청 앞에서 두 가지를 한다(Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다).
// 1. 로그인 토큰을 갱신한다. 권한 판단은 여기서 하지 않는다(DB의 RLS 정책이 정한다).
// 2. 요청마다 새 nonce 로 CSP 를 만들어 요청과 응답에 싣는다. Next 는 요청의 CSP 에서 nonce 를 꺼내 자기 스크립트에 붙인다.
//    그래서 모든 화면이 동적 렌더링이어야 한다(루트 app/layout.tsx 가 connection() 을 부른다).
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const path = request.nextUrl.pathname;
  const isBusinessPath =
    /^\/[^/]+\/(?:dashboard|tasks|settings(?:\/(?:members|team))?)\/?$/.test(path) &&
    !/^\/(?:auth|api|account|admin|teams|invitations)\//.test(path);
  const response = await refreshSession(request, {
    // 서버 컴포넌트가 next/script 등에 nonce 를 넘길 때 headers().get("x-nonce") 로 읽는다.
    "x-nonce": nonce,
    // 레이아웃은 주소를 직접 받지 않으므로 보완 뒤 복귀할 실제 경로만 전달한다. 인증 판단은 각 경계에서 한다.
    "x-sol-radar-path": isBusinessPath ? path + request.nextUrl.search : "",
    "content-security-policy": policy,
  });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // /api/* 는 각 Route Handler가 인증한다(기존 API는 Bearer 전용, v1은 쿠키/Bearer). JSON 응답에는 HTML CSP가 필요 없다.
  // API는 이 페이지용 프록시를 거치지 않는다. 정적 파일·이미지도 제외한다.
  // api 뒤에 / 나 끝을 붙인다 — 조직 주소는 apiary 처럼 api 로 시작할 수 있다(api 자체는 예약어).
  // 문서가 권하는 prefetch 제외(missing: next-router-prefetch)는 두지 않는다. prefetch 도 서버 렌더라 여기서 토큰을
  // 갱신하지 않으면 서버 컴포넌트가 갱신한 토큰을 쿠키에 쓰지 못해 다음 요청에서 로그아웃될 수 있다.
  matcher: [
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
