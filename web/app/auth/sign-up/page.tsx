import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountCard, AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { SocialSignIn } from "@/app/auth/social-sign-in";
import { enabledSocialProviders } from "@/lib/auth-providers";
import { getMyProfile, getSignupOptions } from "@/server/profile";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "회원가입" };

// 카카오는 가이드의 완성형 레이블을 그대로 쓰고, 네이버는 가이드 예시 문구("네이버로 간편가입")를 쓴다.
const SIGN_UP_LABELS = {
  google: "구글 계정으로 시작하기",
  kakao: "카카오 로그인",
  naver: "네이버로 간편가입",
};

// 가입하면 DB 트리거(handle_new_user)가 profiles 행과 개인 조직을 만든다. 화면은 행을 만들지 않는다.
export default async function SignUpPage() {
  await connection();
  const me = await getMyProfile();
  // 로그인돼 있으면(정지된 계정 포함) 계정 화면이 알맞은 곳으로 보낸다.
  if (me.status !== "no-database" && me.status !== "signed-out") redirect("/auth/login");

  const options = (() => {
    try {
      return getSignupOptions();
    } catch {
      return null;
    }
  })();

  return (
    <AccountCard>
      {me.status === "no-database" ? (
        <NoDatabase />
      ) : (
        <>
          <AccountHeader title="회원가입">
            솔리데오에서 사용할 계정 정보를 입력해 주세요.
          </AccountHeader>
          <SignUpForm options={options}>
            <SocialSignIn providers={enabledSocialProviders} labels={SIGN_UP_LABELS} />
          </SignUpForm>
        </>
      )}
    </AccountCard>
  );
}
