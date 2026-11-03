import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountCard, AccountLink } from "@/app/auth/account-card";
import { loginPath, safeEmploymentNext } from "@/app/auth/employment-routing";
import { isKakaoInAppBrowser } from "@/app/auth/in-app-browser";
import { AuthHeader } from "@/components/auth-frame";
import { OpenInBrowserButton } from "./open-in-browser-button";

export const metadata: Metadata = {
  title: "브라우저로 열기",
  robots: { index: false, follow: false },
};

// 카카오톡 안 창에서 로그인 없이 업무 화면을 열면 여기로 온다(signInPath).
// 휴대폰 기본 브라우저로 같은 화면을 넘겨, 브라우저에 남은 로그인으로 바로 보이게 한다.
// 넘어가지 않을 때를 위해 다시 누를 버튼과 이 창에서 로그인할 길을 함께 둔다.
export default async function OpenInBrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const [requestHeaders, { next: rawNext }] = await Promise.all([headers(), searchParams]);
  // 사이트 안 업무 경로만 넘긴다. 계정 화면(/auth/…)이나 바깥 주소면 업무 첫 화면이다.
  const path = safeEmploymentNext(rawNext);
  const next = path === "/auth/login" ? "/dashboard" : path;
  // 카카오톡 밖에서 이 주소를 열면 넘길 일이 없다. 바로 로그인으로 보낸다.
  if (!isKakaoInAppBrowser(requestHeaders.get("user-agent"))) redirect(loginPath(next));

  return (
    <AccountCard>
      <AuthHeader
        title="브라우저에서 엽니다"
        note="열리지 않으면 아래 버튼을 다시 누르거나 이 창에서 로그인하세요."
      >
        카카오톡 안 창은 휴대폰 브라우저의 로그인을 이어받지 못합니다. 아이폰은 Safari, 안드로이드는
        기본 브라우저에서 이 화면을 엽니다.
      </AuthHeader>
      <div className="flex flex-col items-center gap-4">
        <OpenInBrowserButton next={next} />
        <AccountLink href={loginPath(next)}>이 창에서 로그인</AccountLink>
      </div>
    </AccountCard>
  );
}
