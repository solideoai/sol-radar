import { SignOutButton } from "@/app/account/sign-out-button";
import { AccountCard, AccountHeader, AccountLink } from "@/app/auth/account-card";
import { Skeleton } from "@/components/ui/skeleton";
export default function CompleteProfileLoading() {
  return (
    <AccountCard>
      <AccountHeader title="필수 정보 입력">
        서비스를 이용하려면 이름과 부서, 직급/직책을 확인해 주세요.
      </AccountHeader>
      <p role="status" className="type-body text-muted-foreground">
        정보를 불러오는 중입니다.
      </p>
      <div className="flex flex-col gap-4" aria-hidden>
        {[1, 2, 3].map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <p className="text-center type-body">
        <AccountLink href="/auth/account">계정 관리</AccountLink>
      </p>
      <SignOutButton />
    </AccountCard>
  );
}
