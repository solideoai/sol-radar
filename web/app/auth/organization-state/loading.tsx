import { AccountCard, AccountHeader } from "@/app/auth/account-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateLinks } from "./state-links";
export default function OrganizationStateLoading() {
  return (
    <AccountCard>
      <AccountHeader title="계정 상태 확인" />
      <p role="status" className="type-body text-muted-foreground">
        계정 상태를 확인하는 중입니다.
      </p>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full motion-reduce:animate-none" />
        <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      </div>
      <StateLinks />
    </AccountCard>
  );
}
