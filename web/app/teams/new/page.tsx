import { requireCompleteEmployment } from "@/app/(app)/employment-guard";
import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountHeader, AccountLink, NoDatabase } from "@/app/auth/account-card";
import { AuthFrame } from "@/components/auth-frame";
import { buttonVariants } from "@/components/ui/button";
import { getMyHome } from "@/server/organization";
import { NewTeamForm } from "./new-team-form";

export const metadata: Metadata = { title: "새 팀 만들기" };

// 지금 조직이 필요 없는 한 가지 일이라 인증 틀에 둔다.
// 만든 사람이 owner 가 되는 것은 DB 트리거가 하고, 주소 규칙은 도메인과 DB 제약이 다시 본다.
export default async function NewTeamPage() {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  await requireCompleteEmployment("/teams/new");
  const home = await getMyHome();

  switch (home.status) {
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
    case "missing":
      // 개인 조직이 없는 계정은 계정 화면이 안내한다.
      redirect("/auth/login");
    case "ready":
      return (
        <AuthFrame>
          <AccountHeader title="새 팀 만들기">
            팀을 만들어 멤버를 초대하고 작업을 함께 관리합니다. 개인 공간은 그대로 남습니다.
          </AccountHeader>
          <div className="flex flex-col gap-4">
            <NewTeamForm />
            <p className="text-center type-label">
              <AccountLink href={`/${home.personalSlug}/dashboard`}>취소</AccountLink>
            </p>
          </div>
        </AuthFrame>
      );
  }
}
