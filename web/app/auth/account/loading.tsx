import { SignOutButton } from "@/app/account/sign-out-button";
import { AccountCard, AccountHeader, AccountLink } from "@/app/auth/account-card";
import { Skeleton } from "@/components/ui/skeleton";
export default function AccountLoading() {
  return (
    <AccountCard>
      <AccountHeader title="계정 관리">프로필과 로그인 정보를 관리합니다.</AccountHeader>
      <p className="text-center type-body">
        <AccountLink href="/auth/organization-state">서비스로 돌아가기</AccountLink>
      </p>
      <p role="status" className="type-body text-muted-foreground">
        계정 정보를 불러오는 중입니다.
      </p>
      <div className="flex flex-col gap-8" aria-hidden>
        {[1, 2, 3, 4, 5].map((section) => (
          <Skeleton key={section} className="h-24 w-full" />
        ))}
      </div>
      <SignOutButton />
    </AccountCard>
  );
}
