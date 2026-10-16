import type { Metadata } from "next";
import { connection } from "next/server";
import { AccountCard, AccountHeader, AccountLink, NoDatabase } from "@/app/auth/account-card";
import { getMyProfile } from "@/server/profile";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "비밀번호 재설정" };

// 메일의 링크는 /auth/confirm 을 거쳐 /auth/password 로 온다.
export default async function ResetPage() {
  await connection();
  const me = await getMyProfile();

  return (
    <AccountCard>
      {me.status === "no-database" ? (
        <NoDatabase />
      ) : (
        <>
          <AccountHeader title="비밀번호 재설정">
            가입한 이메일로 재설정 링크를 보냅니다.
          </AccountHeader>
          <div className="flex flex-col gap-4">
            <ResetForm />
            <p className="text-center type-label">
              <AccountLink href="/auth/login">로그인으로 돌아가기</AccountLink>
            </p>
          </div>
        </>
      )}
    </AccountCard>
  );
}
