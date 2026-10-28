import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loadMyBusinessAccess, loadMyProfile } from "@/app/_lib/my-account";
import { loadStatusSummary } from "@/app/_lib/work-data";
import { AppShell } from "@/components/app-shell";
import { getMyWorkspace } from "@/server/organization";
import { nameOf } from "@/server/shared";
import { ingestStaleAfterMs } from "@/server/opportunities";
import {
  currentDefaultOrigin,
  currentIngestIntervalMinutes,
  currentRunMode,
} from "@/app/_lib/run-mode";

// layout 은 화면 실행을 막지 못한다. 각 화면이 requireWork 로 다시 확인한다(work.ts).
// 여기서는 셸(사이드바·상단바)에 쓸 값만 읽는다. 요약이 실패해도 셸은 남긴다.
// 화면마다(router.refresh() 마다) 돌므로 대시보드 전체 집계·AI 프로브는 기다리지 않는다(M3).
// 상단바에는 실행 모드·AI 상태를 싣지 않는다(10-26). 실행 모드는 기본 출처를 정하는 데만 쓴다.
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const [business, me] = await Promise.all([loadMyBusinessAccess(), loadMyProfile()]);
  if (business.status !== "ready" || me.status !== "ready") redirect("/auth/login");
  const workspace = await getMyWorkspace(business.current.slug);
  if (workspace.status !== "ready") redirect("/auth/organization-state");

  const runMode = currentRunMode();
  // 상단바의 DEMO 배지·수집 신선도는 실행 모드가 아니라 화면 기본 출처를 따른다(10-25 계획 B2).
  const defaultOrigin = currentDefaultOrigin(runMode);
  const summary = await loadStatusSummary(defaultOrigin).catch((error: unknown) => {
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
      solRole={business.current.solRole}
      defaultSidebarOpen={(await cookies()).get("sidebar_state")?.value !== "false"}
      status={{
        defaultOrigin,
        staleAfterMs: ingestStaleAfterMs(currentIngestIntervalMinutes()),
        initialSummary: summary,
      }}
    >
      {children}
    </AppShell>
  );
}
