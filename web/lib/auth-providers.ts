// 간편 로그인 버튼을 보일지. Supabase 에 그 제공자를 설정한 프로젝트에서만 web/.env.local 에 켠다
// (설정법은 docs/boilerplate/OAUTH-PROVIDERS.md). 설정 없이 버튼만 보이면 누를 때 실패한다. 꺼 둔 제공자는 버튼만 없고 나머지는 그대로 동작한다.
// NEXT_PUBLIC_ 값은 빌드 때 코드에 박힌다 — 이름을 글자 그대로 적어야 박히고, 바꿨으면 다시 빌드한다.
export type SocialProvider = "google" | "kakao" | "naver";

const ENABLED: Record<SocialProvider, boolean> = {
  google: process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true",
  kakao: process.env.NEXT_PUBLIC_AUTH_KAKAO === "true",
  naver: process.env.NEXT_PUBLIC_AUTH_NAVER === "true",
};

// Supabase Auth 의 제공자 이름. 네이버는 기본 제공자가 아니라 사용자 정의 OIDC 제공자(custom:naver)로 등록한다.
export const SUPABASE_PROVIDER_ID = {
  google: "google",
  kakao: "kakao",
  naver: "custom:naver",
} as const satisfies Record<SocialProvider, string>;

// 화면에 놓는 순서: 구글 → 카카오 → 네이버.
const SOCIAL_PROVIDERS = ["google", "kakao", "naver"] as const satisfies readonly SocialProvider[];

export const enabledSocialProviders: SocialProvider[] = SOCIAL_PROVIDERS.filter(
  (provider) => ENABLED[provider],
);

// Supabase 의 제공자 이름(identities.provider)을 이 앱의 이름으로 되돌린다. 이메일 등 간편 로그인이 아니면 null.
export const socialProviderOf = (supabaseProvider: string): SocialProvider | null =>
  SOCIAL_PROVIDERS.find((provider) => SUPABASE_PROVIDER_ID[provider] === supabaseProvider) ?? null;
