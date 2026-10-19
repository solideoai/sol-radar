import "server-only";
import { redirect } from "next/navigation";
import { currentRunMode } from "@/app/_lib/run-mode";
import { completionPath, organizationStatePath } from "@/app/auth/employment-routing";
import type { RunMode } from "@/server/bids";
import { getMyBusinessAccess, type CurrentOrg, type SolRole } from "@/server/organization";
import { getMyProfile } from "@/server/profile";

export type WorkContext = {
  orgId: string;
  userId: string;
  role: SolRole;
  runMode: RunMode;
  org: CurrentOrg;
};

// 업무 화면(대시보드·공고·알림)의 접근 가드. layout 은 화면 실행을 막지 못하므로 화면마다 다시 부른다.
// 권한 자체는 RLS 가 정한다. 여기서는 로그인·가입 완료·업무 조직 하나를 확인해 맥락을 만든다.
export async function requireWork(next: string): Promise<WorkContext> {
  const me = await getMyProfile();
  if (me.status === "no-database") throw new Error("no-database");
  if (me.status !== "ready") redirect("/auth/login");
  if (!me.profile.profileComplete) redirect(completionPath(next));

  const business = await getMyBusinessAccess();
  switch (business.status) {
    case "no-database":
      throw new Error("no-database");
    case "signed-out":
      redirect("/auth/login");
    case "no-org":
    case "multiple-orgs":
    case "forbidden":
      redirect(organizationStatePath(next));
    case "ready":
      return {
        orgId: business.current.id,
        userId: business.userId,
        role: business.current.solRole,
        runMode: currentRunMode(),
        org: business.current,
      };
  }
}
