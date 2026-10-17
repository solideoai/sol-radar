import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AccountSettings, loadAccountSettings } from "@/app/account/account-settings";
import { SignOutButton } from "@/app/account/sign-out-button";
import { AccountCard, AccountHeader, AccountLink } from "@/app/auth/account-card";
import { AccountRetry } from "./account-retry";
export const metadata: Metadata = { title: "계정 관리" };
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  await connection();
  const account = await loadAccountSettings().catch(() => null);
  if (account && (account.me.status !== "ready" || account.login.status !== "ready"))
    redirect("/auth/login");
  const { link } = await searchParams;
  return (
    <AccountCard>
      <AccountHeader title="계정 관리">프로필과 로그인 정보를 관리합니다.</AccountHeader>
      <p className="text-center type-body">
        <AccountLink href="/auth/organization-state">서비스로 돌아가기</AccountLink>
      </p>
      {account?.me.status === "ready" && account.login.status === "ready" ? (
        <AccountSettings
          profile={account.me.profile}
          login={account.login}
          link={link}
          settingsPath="/auth/account"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p role="alert" className="type-body text-destructive">
            계정 정보를 불러오지 못했습니다. 다시 시도해 주세요.
          </p>
          <AccountRetry />
          <SignOutButton />
        </div>
      )}
    </AccountCard>
  );
}
