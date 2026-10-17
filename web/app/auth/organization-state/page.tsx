import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountCard, AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { completionPath, safeBusinessNext } from "@/app/auth/employment-routing";
import { getMyProfile } from "@/server/profile";
import { getCurrentOrganization } from "@/server/organization";
import { buttonVariants } from "@/components/ui/button";
import { StateRetry } from "./state-retry";
import { StateLinks } from "./state-links";
export const metadata: Metadata = {
  title: "계정 상태 확인",
  robots: { index: false, follow: false },
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
  const failed = organization === null;
  return (
    <AccountCard>
      <AccountHeader title={noOrg ? "조직 초대가 필요합니다" : "계정 상태 확인"}>
        {noOrg
          ? "업무를 시작하려면 조직 관리자의 초대를 받아 수락해 주세요."
          : failed
            ? null
            : "지원되지 않는 계정 상태입니다. 관리자에게 문의하세요"}
      </AccountHeader>
      {failed ? (
        <p role="alert" className="type-body text-destructive">
          계정 상태를 불러오지 못했습니다. 다시 시도해 주세요.
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        {noOrg ? (
          <Link className={buttonVariants()} href="/invitations">
            받은 초대 보기
          </Link>
        ) : null}
        <StateRetry failed={failed} />
      </div>
      <StateLinks />
    </AccountCard>
  );
}
