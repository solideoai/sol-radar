import { NextResponse, type NextRequest } from "next/server";
import { completeOAuthSignIn } from "@/server/auth";

// 간편 로그인(구글·카카오·네이버)이 돌아오는 주소: /auth/callback?code=…&next=… 실패하면 계정 화면이 안내를 보인다.
// 어디로 보낼지는 도메인이 정하고, 늘 이 사이트 안의 경로다.
export async function GET(request: NextRequest) {
  const path = await completeOAuthSignIn(request.nextUrl.searchParams);
  return NextResponse.redirect(new URL(path, request.url));
}
