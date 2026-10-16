import { cn } from "cn";
import { UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMembersPage } from "@/server/organization";
import { requireWorkspace } from "@/app/(app)/[slug]/workspace";
import { SettingsNav } from "@/app/(app)/[slug]/settings/settings-nav";
import { InvitationTable } from "./invitation-table";
import { InviteForm } from "./invite-form";
import { LeaveTeam } from "./leave-team";
import { MemberTable } from "./member-table";

export const metadata: Metadata = { title: "멤버" };

// owner 에게만 보이는 버튼은 화면 요구일 뿐이고, 누가 초대하고 바꾸고 내보낼 수 있는지는
// DB 정책과 트리거가 강제한다(마지막 owner 보호 포함).
export default async function MembersPage({ params }: PageProps<"/[slug]/settings/members">) {
  await connection();
  const workspace = await requireWorkspace(
    (await params).slug,
    `/${(await params).slug}/settings/members`,
  );
  const { current, userId } = workspace;
  const page = await getMembersPage({ org: current, userId });

  const description =
    page.status === "personal"
      ? "멤버 초대는 팀에서 합니다."
      : page.canManage
        ? `${current.name}의 멤버를 초대하고 역할을 관리합니다.`
        : `${current.name}의 멤버입니다. 초대와 역할 변경은 소유자만 합니다.`;

  return (
    <AppPage title="설정" description={description}>
      {/* AppPage 의 간격이 사이에 끼지 않게 하위 메뉴와 카드를 한 묶음으로 둔다. */}
      <div>
        <SettingsNav slug={current.slug} isTeam={!current.isPersonal} />
        <div className="flex flex-col gap-6 pt-6">
          {page.status === "personal" ? (
            <PersonalNotice />
          ) : (
            <>
              {page.canManage ? <InviteForm orgId={current.id} /> : null}
              <MemberTable
                orgId={current.id}
                members={page.members}
                canManage={page.canManage}
                ownerCount={page.ownerCount}
              />
              {page.canManage ? (
                <InvitationTable orgId={current.id} invitations={page.invitations} />
              ) : null}
              <LeaveTeam
                orgId={current.id}
                orgName={current.name}
                // Membership changes are re-evaluated at the canonical entry.
                homeHref="/dashboard"
                isLastOwner={current.myRole === "owner" && page.ownerCount === 1}
                isAlone={page.members.length === 1}
                teamSettingsHref={`/${current.slug}/settings/team`}
              />
            </>
          )}
        </div>
      </div>
    </AppPage>
  );
}

function PersonalNotice() {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <UsersIcon className="size-5" />
          </span>
          <div>
            <p className="type-body font-semibold text-foreground">
              개인 공간에는 멤버를 초대할 수 없습니다
            </p>
            <p className="mt-1 type-label text-muted-foreground">
              팀을 만들어 초대하세요. 팀의 작업은 멤버 모두가 함께 봅니다.
            </p>
          </div>
          <Link href="/teams/new" className={cn(buttonVariants())}>
            새 팀 만들기
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
