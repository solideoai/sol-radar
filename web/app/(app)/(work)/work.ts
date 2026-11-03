import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadMyBusinessAccess, loadMyProfile } from "@/app/_lib/my-account";
import { currentDefaultOrigin, currentRunMode } from "@/app/_lib/run-mode";
import { completionPath, organizationStatePath, signInPath } from "@/app/auth/employment-routing";
import type { BidListOrigin, RunMode } from "@/server/bids";
import type { CurrentOrg, SolRole } from "@/server/organization";

export type WorkContext = {
  orgId: string;
  userId: string;
  role: SolRole;
  runMode: RunMode;
  // 화면의 기본 데이터 출처(SOL_DEFAULT_ORIGIN, 없으면 실행 모드로 정한다). 실행 모드 라벨과 따로다.
  defaultOrigin: BidListOrigin;
  org: CurrentOrg;
};

// 업무 화면(대시보드·공고·알림)의 접근 가드. layout 은 화면 실행을 막지 못하므로 화면마다 다시 부른다.
// 권한 자체는 RLS 가 정한다. 여기서는 로그인·가입 완료·업무 조직 하나를 확인해 맥락을 만든다.
export async function requireWork(next: string): Promise<WorkContext> {
  // 프로필과 업무 조직은 서로의 결과가 필요 없어 같이 읽는다(layout 도 같이 읽는다). 판정 순서는 로그인 → 가입 보완 → 업무 조직 그대로다.
  const [me, business] = await Promise.all([loadMyProfile(), loadMyBusinessAccess()]);
  if (me.status === "no-database") throw new Error("no-database");
  // 카톡 안 창이면 로그인 대신 기본 브라우저로 넘긴다(signInPath).
  if (me.status !== "ready") redirect(signInPath(next, (await headers()).get("user-agent")));
  if (!me.profile.profileComplete) redirect(completionPath(next));

  switch (business.status) {
    case "no-database":
      throw new Error("no-database");
    case "signed-out":
      redirect(signInPath(next, (await headers()).get("user-agent")));
    case "no-org":
    case "multiple-orgs":
    case "forbidden":
      redirect(organizationStatePath(next));
    case "ready": {
      const runMode = currentRunMode();
      return {
        orgId: business.current.id,
        userId: business.userId,
        role: business.current.solRole,
        runMode,
        defaultOrigin: currentDefaultOrigin(runMode),
        org: business.current,
      };
    }
  }
}
