import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loadStatusSummary } from "@/app/_lib/work-data";
import { AppShell } from "@/components/app-shell";
import { defaultOrigin } from "@/server/bids";
import { getMyBusinessAccess, getMyWorkspace } from "@/server/organization";
import { getMyProfile } from "@/server/profile";
import { nameOf } from "@/server/shared";
import { currentRunMode } from "@/app/_lib/run-mode";

// layout 은 화면 실행을 막지 못한다. 각 화면이 requireWork 로 다시 확인한다(work.ts).
// 여기서는 셸(사이드바·상단바)에 쓸 값만 읽는다. 요약이 실패해도 셸은 남긴다.
// 화면마다(router.refresh() 마다) 돌므로 대시보드 전체 집계·AI 프로브는 기다리지 않는다(M3).
// AI 상태는 TopbarStatus 가 마운트 때 /health/ready 로 읽는다.
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const [business, me] = await Promise.all([getMyBusinessAccess(), getMyProfile()]);
  if (business.status !== "ready" || me.status !== "ready") redirect("/auth/login");
  const workspace = await getMyWorkspace(business.current.slug);
  if (workspace.status !== "ready") redirect("/auth/organization-state");

  const runMode = currentRunMode();
  const summary = await loadStatusSummary(defaultOrigin(runMode)).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "work_status_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  });
  return (
    <AppShell
      user={{
        name: nameOf(me.profile.displayName, me.profile.email),
        email: me.profile.email,
        avatarUrl: me.profile.avatarUrl,
        isAdmin: me.profile.isAdmin,
      }}
      workspace={{
        current: workspace.current,
        orgs: workspace.orgs,
        pendingInvitationCount: workspace.pendingInvitationCount,
      }}
      defaultSidebarOpen={(await cookies()).get("sidebar_state")?.value !== "false"}
      status={{
        runMode,
        initialSummary: summary,
        initialAi: null,
      }}
    >
      {children}
    </AppShell>
  );
}
