import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { AUTH_COOKIE_OPTIONS } from "@/server/shared";

// ── Supabase 클라이언트 (브라우저 쪽) ──
// 세션을 쿠키에 적어 서버(getSupabase)·proxy.ts 와 같은 로그인을 본다. 무엇을 읽고 쓸지는 키가 아니라 RLS 정책이 정한다.
// 브라우저에서는 @supabase/ssr 이 같은 클라이언트를 돌려준다.
// NEXT_PUBLIC_ 값은 빌드 때 코드에 박힌다. process.env[이름] 처럼 동적으로 읽으면 박히지 않으므로 직접 적어 넘긴다.
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} 가 없습니다. web/.env.local 을 설정하세요 (database 스킬 참고).`);
  }
  return value;
}

export function getSupabaseBrowser(): SupabaseClient<Database> {
  return createBrowserClient<Database>(
    required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { cookieOptions: AUTH_COOKIE_OPTIONS },
  );
}
