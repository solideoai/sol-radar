import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountSettings, loadAccountSettings } from "@/app/account/account-settings";
import { AppPage } from "@/components/app-page";
import { requireWorkspace } from "@/app/(app)/[slug]/workspace";
import { canSeeOrganizationTab } from "./show-organization";
import { SettingsNav } from "./settings-nav";
export const metadata: Metadata = { title: "설정" };
export default async function SettingsPage({
  params,
  searchParams,
}: PageProps<"/[slug]/settings">) {
  await connection();
  const { slug } = await params;
  const workspace = await requireWorkspace(slug, `/${slug}/settings`);
  const [{ me, login }, showOrganization] = await Promise.all([
    loadAccountSettings(),
    canSeeOrganizationTab(workspace.current.id),
  ]);
  if (me.status !== "ready" || login.status !== "ready") redirect("/auth/login");
  const { link } = await searchParams;
  return (
    <AppPage title="설정" description="프로필과 로그인 정보를 관리합니다.">
      <div>
        <SettingsNav
          slug={workspace.current.slug}
          isTeam={!workspace.current.isPersonal}
          showOrganization={showOrganization}
        />
        <AccountSettings
          profile={me.profile}
          login={login}
          link={typeof link === "string" ? link : undefined}
          settingsPath={`/${workspace.current.slug}/settings`}
        />
      </div>
    </AppPage>
  );
}
