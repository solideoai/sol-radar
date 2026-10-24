import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { listPendingJoinRequests } from "@/server/join-request";
import { getOrgSettingsPage } from "@/server/organization";
import { SettingsNav } from "@/app/(app)/[slug]/settings/settings-nav";
import { requireWork } from "@/app/(app)/(work)/work";
import { OrgAuditTable } from "./org-audit-table";
import { OrgInvitationTable } from "./org-invitation-table";
import { OrgInviteForm } from "./org-invite-form";
import { OrgJoinRequestTable } from "./org-join-request-table";
import { OrgMemberTable } from "./org-member-table";
import {
  ORG_SETTINGS_DESCRIPTION,
  ORG_SETTINGS_META_TITLE,
  ORG_SETTINGS_PATH,
  ORG_SETTINGS_TITLE,
} from "./org-settings-copy";
import { OrgSettingsForbidden } from "./org-settings-forbidden";

export const metadata: Metadata = { title: ORG_SETTINGS_META_TITLE };

// N2 설정 조직 탭(디자인 스펙 docs/plans/2026-10-21-n2-org-settings-design.md). 업무 역할 ADMIN 전용이다.
// 역할을 먼저 보고 ADMIN 이 아니면 데이터를 읽지 않고 안내만 그린다. 읽기·쓰기 권한 자체는 RLS 와 트리거가 정한다.
export default async function OrgSettingsPage() {
  await connection();
  const work = await requireWork(ORG_SETTINGS_PATH);
  if (work.role !== "ADMIN") return <OrgSettingsForbidden role={work.role} />;
  const [page, joinRequests] = await Promise.all([
    getOrgSettingsPage({ orgId: work.orgId, userId: work.userId }),
    listPendingJoinRequests(work.orgId),
  ]);
  return (
    <AppPage title={ORG_SETTINGS_TITLE} description={ORG_SETTINGS_DESCRIPTION}>
      {/* AppPage 의 간격이 사이에 끼지 않게 하위 메뉴와 카드를 한 묶음으로 둔다(템플릿 멤버 화면과 같다). */}
      <div>
        <SettingsNav slug={work.org.slug} isTeam={!work.org.isPersonal} showOrganization />
        <div className="flex flex-col gap-6 pt-6">
          <OrgJoinRequestTable requests={joinRequests} />
          <OrgMemberTable members={page.members} adminCount={page.adminCount} />
          <OrgInviteForm />
          <OrgInvitationTable invitations={page.invitations} />
          <OrgAuditTable entries={page.audit} />
        </div>
      </div>
    </AppPage>
  );
}
