import { SignOutButton } from "@/app/account/sign-out-button";
import { AccountLink } from "@/app/auth/account-card";
export function StateLinks() {
  return (
    <div className="flex flex-col items-center gap-4">
      <AccountLink href="/auth/account">계정 관리</AccountLink>
      <SignOutButton className="w-full" />
    </div>
  );
}
