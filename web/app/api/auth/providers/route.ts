import { json } from "@/app/api/_lib/http";
import { enabledSocialProviders, SUPABASE_PROVIDER_ID } from "@/lib/auth-providers";

// 공개: 이 배포에서 켜 둔 간편 로그인 제공자. 로그인 화면을 따로 그리는 앱이 어떤 버튼을 보일지 정할 때 쓴다.
// supabaseProvider 는 supabase-js 의 signInWithOAuth({ provider }) 에 그대로 넘기는 이름이다.
// 다른 API 와 같이 캐시하지 않는다 — 제공자를 켜고 끄는 배포가 바로 보이게 한다.
export function GET() {
  return json({
    providers: enabledSocialProviders.map((id) => ({
      id,
      supabaseProvider: SUPABASE_PROVIDER_ID[id],
    })),
  });
}
