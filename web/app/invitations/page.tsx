import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { AuthFrame } from "@/components/auth-frame";
import { buttonVariants } from "@/components/ui/button";
import { getReceivedInvitations } from "@/server/organization";
import { getMyProfile } from "@/server/profile";
import { redirect } from "next/navigation";
import { StateRetry } from "@/app/auth/organization-state/state-retry";
import { InvitationLinks } from "./invitation-links";
import { InvitationList } from "./invitation-list";

export const metadata: Metadata = { title: "받은 초대" };

// 지금 조직이 필요 없어 인증 틀에 둔다. 초대 메일의 링크가 이 화면이다(메일 설정이 없으면 초대한 사람이 직접 알린다).
// 초대받은 이메일로 로그인해 수락한다.
export default async function InvitationsPage() {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const me = await getMyProfile().catch(() => null);
  if (me?.status === "missing" || me?.status === "suspended") redirect("/auth/login");
  const received = me ? await getReceivedInvitations().catch(() => null) : null;
  if (!received)
    return (
      <AuthFrame>
        <AccountHeader title="받은 초대" />
        <p role="alert" className="type-body text-destructive">
          받은 초대를 불러오지 못했습니다. 다시 시도해 주세요.
        </p>
        <StateRetry failed />
        <InvitationLinks />
      </AuthFrame>
    );

  switch (received.status) {
    case "no-database":
      return (
        <AuthFrame>
          <NoDatabase />
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          <Link href="/auth/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            계정 화면으로 가기
          </Link>
        </AuthFrame>
      );
    case "signed-out":
      return (
        <AuthFrame>
          <AccountHeader title="로그인이 필요합니다">
            로그인한 사람만 볼 수 있는 화면입니다.
          </AccountHeader>
          <Link href="/auth/login" className={cn(buttonVariants(), "w-full")}>
            로그인하러 가기
          </Link>
        </AuthFrame>
      );
    case "ready": {
      const email = me?.status === "ready" ? (me.profile.email ?? "") : "";
      return (
        <AuthFrame>
          <AccountHeader title="받은 초대">
            {/* 초대는 이메일로 온다. 이메일을 주지 않는 제공자로 가입한 계정은 받을 수 없다. */}
            {email ? (
              <>
                <span className="wrap-anywhere">{email}</span> 으로 받은 초대입니다.
              </>
            ) : (
              "이메일이 없는 계정이라 초대를 받을 수 없습니다."
            )}
          </AccountHeader>
          <InvitationList invitations={received.invitations} email={email} />
          <InvitationLinks />
        </AuthFrame>
      );
    }
  }
}
