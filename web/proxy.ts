import { NextResponse, type NextRequest } from "next/server";
import { guardRedisApiRequest } from "@/app/_lib/redis-api-auth";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { buildContentSecurityPolicy } from "@/server/csp";
import { refreshSession } from "@/server/supabase";

// 모든 화면 요청 앞에서 두 가지를 한다(Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다).
// 1. 로그인 토큰을 갱신한다. 권한 판단은 여기서 하지 않는다(DB의 RLS 정책이 정한다).
// 2. 요청마다 새 nonce 로 CSP 를 만들어 요청과 응답에 싣는다. Next 는 요청의 CSP 에서 nonce 를 꺼내 자기 스크립트에 붙인다.
//    그래서 모든 화면이 동적 렌더링이어야 한다(루트 app/layout.tsx 가 connection() 을 부른다).
export async function proxy(request: NextRequest) {
  const rejected = guardRedisApiRequest(request);
  if (rejected)
    return new NextResponse(rejected.body, { status: rejected.status, headers: rejected.headers });
  if (deploymentRole() === "redis-api") return NextResponse.next();
  const path = request.nextUrl.pathname;
  // Gateway는 모든 경로를 검사한다. 화면 런타임은 기존 API/health/정적 자산의 세션 검사 생략을 유지한다.
  if (
    /^\/(?:api|health)(?:\/|$)|^\/_next\/(?:static|image)(?:\/|$)|^\/favicon\.ico$|\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/.test(
      path,
    )
  ) {
    return NextResponse.next();
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
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
  // redis-api의 비허용 경로(구형 API·Server Action·정적 파일 포함)를 렌더 전에 차단한다.
  // frontend/standalone의 API·health·자산은 함수 안에서 세션 갱신/CSP만 생략한다.
  matcher: ["/:path*"],
};
