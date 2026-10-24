import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountCard, AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { completionPath, safeBusinessNext } from "@/app/auth/employment-routing";
import { getMyProfile } from "@/server/profile";
import { getCurrentOrganization } from "@/server/organization";
import { getMyJoinRequest, type MyJoinRequest } from "@/server/join-request";
import { buttonVariants } from "@/components/ui/button";
import { StateRetry } from "./state-retry";
import { StateLinks } from "./state-links";
import { JoinRequestPanel } from "./join-request-panel";
export const metadata: Metadata = {
  title: "계정 상태 확인",
  robots: { index: false, follow: false },
};
// 조직이 없는 계정은 가입 신청 상태에 따라 제목이 바뀐다(설계 5.1). 승인된 신청은 멤버십이 생겨 이 화면에 오지 않는다.
const JOIN_HEADER: Record<Exclude<MyJoinRequest["status"], "signed-out">, [string, string]> = {
  none: ["가입 신청", "관리자가 승인하면 조직도와 업무 화면이 열립니다."],
  approved: ["가입 신청", "관리자가 승인하면 조직도와 업무 화면이 열립니다."],
  pending: [
    "관리자 승인 대기 중",
    "승인되면 이 화면이 업무 화면으로 바뀝니다. 기다리는 동안 사진을 바꿀 수 있습니다.",
  ],
  rejected: ["가입 신청이 반려되었습니다", "내용을 확인하고 다시 신청할 수 있습니다."],
};

export default async function OrganizationStatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const next = safeBusinessNext((await searchParams).next);
  const me = await getMyProfile().catch(() => null);
  if (me?.status === "no-database")
    return (
      <AccountCard>
        <NoDatabase />
      </AccountCard>
    );
  if (me && me.status !== "ready") redirect("/auth/login");
  if (me?.status === "ready" && !me.profile.profileComplete) redirect(completionPath(next));
  const organization = me ? await getCurrentOrganization().catch(() => null) : null;
  if (organization?.status === "ready") redirect(next);
  if (organization?.status === "signed-out" || organization?.status === "no-database")
    redirect("/auth/login");
  const noOrg = organization?.status === "no-org";
  const join = noOrg ? await getMyJoinRequest().catch(() => null) : null;
  if (join?.status === "signed-out") redirect("/auth/login");
  const profile = me?.status === "ready" ? me.profile : null;
  const failed = organization === null || (noOrg && join === null);
  const [joinTitle, joinText] = join ? JOIN_HEADER[join.status] : ["가입 신청", null];
  return (
    <AccountCard>
      <AccountHeader title={noOrg ? joinTitle : "계정 상태 확인"}>
        {noOrg ? joinText : failed ? null : "지원되지 않는 계정 상태입니다. 관리자에게 문의하세요"}
      </AccountHeader>
      {failed ? (
        <p role="alert" className="type-body text-destructive">
          계정 상태를 불러오지 못했습니다. 다시 시도해 주세요.
        </p>
      ) : null}
      {join && profile ? (
        <JoinRequestPanel
          userId={profile.userId}
          name={profile.displayName ?? profile.email ?? "이름 없음"}
          employment={
            profile.employment
              ? `${profile.employment.departmentName} · ${profile.employment.jobTitleLabel}`
              : null
          }
          avatarUrl={profile.avatarUrl}
          hasOwnPhoto={profile.hasOwnPhoto}
          request={join}
        />
      ) : null}
      <div className="flex flex-col gap-3">
        {noOrg ? (
          <Link className={cn(buttonVariants({ variant: "outline" }))} href="/invitations">
            받은 초대 보기
          </Link>
        ) : null}
        <StateRetry failed={failed} />
      </div>
      <StateLinks />
    </AccountCard>
  );
}
