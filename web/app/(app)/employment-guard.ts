import "server-only";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/profile";
import { completionPath } from "@/app/auth/employment-routing";

export async function requireCompleteEmployment(next: string): Promise<void> {
  const me = await getMyProfile();
  // 로그인 전·DB 없음의 안내와 접근 거절은 기존 화면/도메인이 처리한다.
  if (me.status === "signed-out" || me.status === "no-database") return;
  if (me.status !== "ready") redirect("/auth/login");
  if (!me.profile.profileComplete) redirect(completionPath(next));
}
