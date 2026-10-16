"use client";

import { cn } from "cn";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SUPABASE_PROVIDER_ID, type SocialProvider } from "@/lib/auth-providers";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// 간편 로그인 버튼들. 처음 온 사람은 같은 버튼으로 가입된다(가입 트리거가 프로필·개인 조직을 만든다).
// 누르면 Supabase → 그 회사를 거쳐 /auth/callback 으로 돌아온다. 그 사이 확인 값(PKCE)은 이 브라우저의 쿠키에 있다.
// next 는 로그인 뒤 갈 사이트 안 경로다. 콜백이 한 번 더 걸러 바깥 주소로는 보내지 않는다.
//
// 모양은 회사마다의 로그인 버튼 가이드를 따른다. 높이·모서리는 이메일 폼의 버튼과 맞추고 색·로고·문구만 회사 것을 쓴다
// (여러 회사 버튼을 함께 쌓는 국내 서비스들이 이렇게 한다).
//   구글  — 흰 바탕 테두리 버튼, 네 색 G 로고 24px.
//   카카오 — 바탕 토큰 kakao(가이드 지정 노랑), 검은 말풍선 심볼, 글자 검정 85%. 레이블은 가이드의 완성형 "카카오 로그인" 그대로.
//   네이버 — 바탕 토큰 naver(가이드 지정 초록), 흰 N 로고 16px(가이드 최소), 로고와 글자 간격 8px, 글자 흰색.
// 로고는 브랜드 색 그대로인 정적 파일(public/*.svg)이다. 화면 코드에 색을 적지 않는 규칙(check:colors)을 지킨다.
const PROVIDERS: Record<
  SocialProvider,
  {
    name: string;
    logo: string;
    logoSize: number;
    className: string;
  }
> = {
  google: {
    name: "구글",
    logo: "/google.svg",
    logoSize: 24,
    className: "border-border bg-background text-foreground hover:bg-muted",
  },
  kakao: {
    name: "카카오",
    logo: "/kakao.svg",
    logoSize: 18,
    className: "bg-kakao text-kakao-foreground/85 hover:bg-kakao/90",
  },
  // 네이버는 Supabase 의 기본 제공자가 아니라 사용자 정의 OIDC 제공자(custom:naver)로 등록한다(SUPABASE_PROVIDER_ID).
  naver: {
    name: "네이버",
    logo: "/naver.svg",
    logoSize: 16,
    className: "bg-naver text-naver-foreground hover:bg-naver/90",
  },
};

// 이메일 폼과 링크 아래, 가는 선 뒤에 켜 둔 제공자의 버튼을 쌓는다. 켠 것이 없으면 아무것도 그리지 않는다.
export function SocialSignIn({
  providers,
  labels,
  next = null,
}: {
  providers: SocialProvider[];
  labels: Record<SocialProvider, string>;
  next?: string | null;
}) {
  if (providers.length === 0) return null;
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-3">
        {providers.map((provider) => (
          <SocialSignInButton
            key={provider}
            provider={provider}
            label={labels[provider]}
            next={next}
          />
        ))}
      </div>
    </>
  );
}

function SocialSignInButton({
  provider,
  label,
  next,
}: {
  provider: SocialProvider;
  label: string;
  next: string | null;
}) {
  const config = PROVIDERS[provider];
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setIsPending(true);
    setError(null);
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
      provider: SUPABASE_PROVIDER_ID[provider],
      options: { redirectTo: callback.toString() },
    });
    // 성공하면 브라우저가 그 회사로 넘어가 이 화면에 돌아오지 않는다. 버튼은 꺼진 채로 둔다.
    if (error) {
      setError(`${config.name} 로그인을 시작하지 못했습니다: ${error.message}`);
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className={cn("h-9 w-full gap-2 px-3.5 font-normal", config.className)}
        onClick={onClick}
        disabled={isPending}
      >
        <Image
          src={config.logo}
          alt=""
          width={config.logoSize}
          height={config.logoSize}
          style={{ width: config.logoSize, height: config.logoSize }}
        />
        {label}
      </Button>
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
