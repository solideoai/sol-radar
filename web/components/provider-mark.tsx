import { cn } from "cn";
import { KeyRoundIcon, MailIcon } from "lucide-react";
import Image from "next/image";
import { socialProviderOf, type SocialProvider } from "@/lib/auth-providers";

// 로그인 수단 목록(마이페이지)에서 줄 앞에 두는 회사 표시. 장식이라 aria-hidden 이다 — 옆에 같은 뜻의 글자가 있다.
// 회사 로고는 바꾸지 않고 각 회사가 정한 바탕 위에 둔다. 네이버의 흰 N 은 초록 바탕이 있어야 보인다.
// 크기는 로그인 버튼(web/app/auth/social-sign-in.tsx)과 같은 비율이고, 네이버는 가이드의 최소 16px 이다.
const BRANDS: Record<SocialProvider, { logo: string; size: number; className: string }> = {
  google: { logo: "/google.svg", size: 18, className: "border border-border bg-background" },
  kakao: { logo: "/kakao.svg", size: 18, className: "bg-kakao" },
  naver: { logo: "/naver.svg", size: 16, className: "bg-naver" },
};

const FRAME = "flex size-8 shrink-0 items-center justify-center rounded-lg";

/** provider 는 Supabase 의 이름(email·google·kakao·custom:naver). 모르는 이름은 열쇠 모양이다. */
export function ProviderMark({ provider }: { provider: string }) {
  const social = socialProviderOf(provider);
  if (!social) {
    const Icon = provider === "email" ? MailIcon : KeyRoundIcon;
    return (
      <span aria-hidden className={cn(FRAME, "bg-muted text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
    );
  }
  const brand = BRANDS[social];
  return (
    <span aria-hidden className={cn(FRAME, brand.className)}>
      <Image
        src={brand.logo}
        alt=""
        width={brand.size}
        height={brand.size}
        style={{ width: brand.size, height: brand.size }}
      />
    </span>
  );
}
