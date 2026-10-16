import "server-only";
import { notFound, redirect } from "next/navigation";
import { getMyProfile } from "@/server/profile";
import { getCurrentOrganization } from "@/server/organization";
import { organizationStatePath } from "@/app/auth/employment-routing";
import { completionPath } from "@/app/auth/employment-routing";

export async function requireCompleteEmployment(next: string): Promise<void> {
  const me = await getMyProfile();
  // 로그인 전·DB 없음의 안내와 접근 거절은 기존 화면/도메인이 처리한다.
  if (me.status === "signed-out" || me.status === "no-database") return;
  if (me.status !== "ready") redirect("/auth/login");
  if (!me.profile.profileComplete) redirect(completionPath(next));
}

// Public actions must bind even a valid member's input to the sole business organization.
export async function requireCurrentOrganization(next: string, orgId?: unknown) {
  await requireCompleteEmployment(next);
  const result = await getCurrentOrganization();
  if (result.status === "no-org" || result.status === "multiple-orgs")
    redirect(organizationStatePath(next));
  if (result.status !== "ready") return null;
  if (orgId !== undefined && orgId !== result.current.id) notFound();
  return result;
}
