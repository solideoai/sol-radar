import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AccountCard, AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { buttonVariants } from "@/components/ui/button";
import { getMyProfile, type MyProfile } from "@/server/profile";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "새 비밀번호" };

// 재설정 메일의 링크(/auth/confirm)가 로그인시킨 뒤 여기로 보낸다. 로그인한 사람이 직접 들어와 바꾸는 데도 쓴다.
export default async function PasswordPage() {
  await connection();
  const me = await getMyProfile();

  return (
    <AccountCard>
      <PasswordBody status={me.status} />
    </AccountCard>
  );
}

function PasswordBody({ status }: { status: MyProfile["status"] }) {
  if (status === "no-database") return <NoDatabase />;
  if (status === "suspended") {
    return (
      <AccountHeader title="이용이 정지된 계정입니다">
        운영자가 이 계정의 이용을 정지했습니다. 다시 이용하려면 운영자에게 문의해 주세요.
      </AccountHeader>
    );
  }
  if (status === "signed-out") {
    return (
      <>
        <AccountHeader title="로그인이 필요합니다">
          재설정 링크가 만료됐거나 이미 사용됐습니다. 메일을 다시 받아 주세요.
        </AccountHeader>
        {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
        <Link href="/auth/reset" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
          재설정 메일 다시 받기
        </Link>
      </>
    );
  }
  return (
    <>
      <AccountHeader title="새 비밀번호">앞으로 쓸 비밀번호를 정합니다.</AccountHeader>
      <NewPasswordForm />
    </>
  );
}
