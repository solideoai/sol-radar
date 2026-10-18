import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { getMyProfile } from "@/server/profile";
import { getMyBusinessAccess, getMyWorkspace } from "@/server/organization";
import { nameOf } from "@/server/shared";
import { loadPeopleDirectory, peopleUiResult, PeopleForbidden } from "./people-data";
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const directory = peopleUiResult(await loadPeopleDirectory());
  if (directory.status === "error")
    return directory.code === "FORBIDDEN" ? <PeopleForbidden /> : <>{children}</>;
  const [business, me] = await Promise.all([getMyBusinessAccess(), getMyProfile()]);
  if (business.status !== "ready" || me.status !== "ready") redirect("/auth/login");
  const workspace = await getMyWorkspace(business.current.slug);
  if (workspace.status !== "ready") redirect("/auth/organization-state");
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
    >
      {children}
    </AppShell>
  );
}
