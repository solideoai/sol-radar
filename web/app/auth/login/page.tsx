import {
  completionPath,
  safeEmploymentNext,
  organizationStatePath,
} from "@/app/auth/employment-routing";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SignOutButton } from "@/app/account/sign-out-button";
import { AccountCard, AccountHeader, AccountLink, NoDatabase } from "@/app/auth/account-card";
import { SocialSignIn } from "@/app/auth/social-sign-in";
import { enabledSocialProviders } from "@/lib/auth-providers";
import { getCurrentOrganization } from "@/server/organization";
import { getMyProfile, type MyProfile } from "@/server/profile";
import { SUSPENDED_NOTICE } from "@/app/auth/notices";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "로그인" };

// 로그인한 사람은 이 화면에 머물지 않는다. 무엇을 보여 줄지는 도메인(@/server/profile)이, 누가 무엇을 읽는지는 RLS 가 정한다.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; next?: string }>;
}) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const [me, { link, next: rawNext }] = await Promise.all([getMyProfile(), searchParams]);
  // 로그인 뒤 갈 곳(?next=). 사이트 안 경로만 받고, 계정 화면(/auth/…)으로는 되돌리지 않는다(돌고 돈다).
  const nextPath = rawNext === undefined ? null : safeEmploymentNext(rawNext);
  const next = nextPath && !nextPath.startsWith("/auth/") ? nextPath : null;
  // 로그인 직후와 메일 확인 뒤에도 프로필 완성을 확인하고 현재 업무 조직 또는 조직 상태 화면으로 보낸다.
  if (me.status === "ready") {
    if (!me.profile.profileComplete) redirect(completionPath(next ?? undefined));
    const organization = await getCurrentOrganization().catch(() => null);
    if (organization?.status === "ready") redirect(next ?? "/dashboard");
    if (organization?.status === "no-org" || organization?.status === "multiple-orgs")
      redirect(organizationStatePath(next));
    redirect("/auth/organization-state");
  }
  const status = me.status;
  // 메일 링크(/auth/confirm)나 간편 로그인(/auth/callback)이 실패해 돌아온 경우, 정지된 계정이 로그인하려 한 경우.
  const notice = LINK_NOTICES[LINK_NOTICE_KEYS.find((key) => key === link) ?? "none"];

  return (
    <AccountCard>
      <AccountBody status={status} notice={notice} next={next} />
    </AccountCard>
  );
}

// 구글은 참고 화면의 문구, 카카오는 가이드의 완성형 레이블, 네이버는 가이드가 허용한 문구다.
const LOGIN_LABELS = {
  google: "구글 계정으로 로그인",
  kakao: "카카오 로그인",
  naver: "네이버 로그인",
};

const LINK_NOTICE_KEYS = ["invalid", "oauth-failed", "suspended"] as const;
const LINK_NOTICES: Record<(typeof LINK_NOTICE_KEYS)[number] | "none", string | null> = {
  invalid: "메일의 링크가 만료됐거나 이미 사용됐습니다. 로그인하거나 메일을 다시 받아 주세요.",
  "oauth-failed": "간편 로그인을 마치지 못했습니다. 다시 시도하거나 이메일로 로그인해 주세요.",
  suspended: SUSPENDED_NOTICE,
  none: null,
};

function AccountBody({
  status,
  notice,
  next,
}: {
  status: Exclude<MyProfile["status"], "ready">;
  notice: string | null;
  next: string | null;
}) {
  switch (status) {
    case "no-database":
      return <NoDatabase />;
    case "signed-out":
      return (
        <>
          <AccountHeader title="로그인" />
          <div className="flex flex-col gap-4">
            {notice ? (
              <p role="alert" className="type-label text-destructive">
                {notice}
              </p>
            ) : null}
            <SignInForm />
            <div className="flex flex-col items-center gap-2 type-label">
              <p className="text-muted-foreground">
                계정이 없나요? <AccountLink href="/auth/sign-up">회원가입</AccountLink>
              </p>
              <AccountLink href="/auth/reset">비밀번호를 잊었나요?</AccountLink>
            </div>
            <SocialSignIn providers={enabledSocialProviders} labels={LOGIN_LABELS} next={next} />
          </div>
        </>
      );
    // 운영자가 정지한 계정이 아직 로그인돼 있다(앱 틀이 여기로 보낸다). 다른 화면·데이터는 서버와 DB 가 닫는다.
    case "suspended":
      return (
        <>
          <AccountHeader title="이용이 정지된 계정입니다">
            운영자가 이 계정의 이용을 정지했습니다. 다시 이용하려면 운영자에게 문의해 주세요.
          </AccountHeader>
          <SignOutButton className="w-full" />
        </>
      );
    case "missing":
      return (
        <>
          <AccountHeader title="프로필이 없습니다">
            로그인은 됐지만 프로필이 없습니다. 가입 트리거보다 먼저 만든 계정일 수 있습니다.
          </AccountHeader>
          <SignOutButton className="w-full" />
        </>
      );
  }
}
