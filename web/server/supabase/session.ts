import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { AUTH_COOKIE_OPTIONS } from "@/server/shared";

/**
 * 만료된 로그인 토큰을 갱신해 쿠키로 돌려준다(`proxy.ts` 가 부른다).
 * 서버 컴포넌트는 쿠키를 쓸 수 없어서 화면을 그리기 전에 여기서 끝낸다. Supabase 설정이 없으면 그냥 통과시킨다.
 * forwardHeaders 는 뒤따르는 서버 렌더에 함께 넘길 요청 헤더다(CSP 와 nonce). 같은 이름의 헤더가 요청에 있으면 덮는다.
 */
export async function refreshSession(
  request: NextRequest,
  forwardHeaders: Record<string, string> = {},
): Promise<NextResponse> {
  // 갱신한 쿠키는 request.cookies 에 들어가므로 응답을 만들 때마다 그 시점의 요청 헤더에서 다시 복사한다.
  const next = () => {
    const headers = new Headers(request.headers);
    Object.entries(forwardHeaders).forEach(([name, value]) => headers.set(name, value));
    return NextResponse.next({ request: { headers } });
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return next();

  // 갱신된 쿠키는 요청(뒤따르는 서버 렌더가 읽는다)과 응답(브라우저가 저장한다) 양쪽에 싣는다. let 금지라 객체에 담는다.
  const state = { response: next() };
  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        state.response = next();
        cookiesToSet.forEach(({ name, value, options }) =>
          state.response.cookies.set(name, value, options),
        );
        // 새 토큰이 실린 응답이 공유 캐시에 남지 않게 하는 헤더다.
        Object.entries(headers).forEach(([name, value]) => state.response.headers.set(name, value));
      },
    },
  });

  // 세션을 읽는 이 호출이 만료 토큰을 갱신하고 setAll 을 부른다. 지우면 사용자가 무작위로 로그아웃된다.
  await supabase.auth.getClaims();
  return state.response;
}
