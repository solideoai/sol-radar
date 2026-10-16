import { signOutEverywhere } from "@/server/auth";
import { noContent, requireUser, unauthenticated } from "@/app/api/_lib/http";

// 모든 기기의 세션을 끊는다(Supabase Auth 의 global 로그아웃). refresh token 이 모두 무효가 되고,
// 이미 받은 access token 은 만료(기본 1시간)까지 남는다 — 앱은 응답을 받으면 들고 있는 토큰을 버린다.
export async function POST() {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  const result = await signOutEverywhere();
  return result.status === "done" ? noContent() : unauthenticated();
}
