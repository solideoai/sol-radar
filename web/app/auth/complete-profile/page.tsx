import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountCard, AccountHeader } from "@/app/auth/account-card";
import { safeBusinessNext } from "@/app/auth/employment-routing";
import { getMyEmployment, getSignupOptions } from "@/server/profile";
import { CompleteProfileForm } from "./complete-profile-form";
export const metadata: Metadata = { title: "필수 정보 입력" };
export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const next = safeBusinessNext((await searchParams).next);
  // Only data loading is caught; Next navigation errors must propagate.
  const result = await getMyEmployment().catch(() => null);
  if (result && result.status !== "ready") redirect("/auth/login");
  if (result?.status === "ready" && result.state.profileComplete) redirect(next);
  const options = (() => {
    try {
      return getSignupOptions();
    } catch {
      return null;
    }
  })();
  return (
    <AccountCard>
      <AccountHeader title="필수 정보 입력">
        서비스를 이용하려면 이름과 부서, 직급/직책을 확인해 주세요.
      </AccountHeader>
      <CompleteProfileForm
        options={options}
        state={result?.status === "ready" ? result.state : null}
        next={next}
      />
    </AccountCard>
  );
}
