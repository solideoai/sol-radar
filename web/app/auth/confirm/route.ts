import { afterEmploymentAuthentication } from "@/app/auth/employment-routing";
import { NextResponse, type NextRequest } from "next/server";
import { confirmEmailLink } from "@/server/auth";

// 링크 모양은 메일 템플릿(supabase/templates/)이 정한다. 어디로 보낼지는 도메인이 정하고, 늘 이 사이트 안의 경로다.
// shortcut: 링크를 열기만 해도(GET) 토큰이 쓰인다. 메일 보안 검사가 링크를 미리 열면 사용자가 누르기 전에 만료될 수 있다.
// 그런 사용자가 생기면 확인 버튼을 누르는 화면(POST)이나 6자리 코드 입력으로 바꾼다.
export async function GET(request: NextRequest) {
  const path = await confirmEmailLink(request.nextUrl.searchParams);
  const isExempt =
    request.nextUrl.searchParams.get("type") === "recovery" || path === "/auth/login?link=invalid";
  const destination = isExempt ? path : await afterEmploymentAuthentication(path);
  return NextResponse.redirect(new URL(destination, request.url));
}
