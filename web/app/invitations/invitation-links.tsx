import { AccountLink } from "@/app/auth/account-card";
import { StateLinks } from "@/app/auth/organization-state/state-links";
export function InvitationLinks() {
  return (
    <div className="flex flex-col items-center gap-4">
      <AccountLink href="/auth/organization-state">서비스로 돌아가기</AccountLink>
      <StateLinks />
    </div>
  );
}
