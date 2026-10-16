import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import type { Database } from "@/lib/database.types";

// 웹과 같은 anon 키를 쓴다. 무엇을 읽고 쓸 수 있는지는 키가 아니라 DB의 RLS 정책이 정한다.
// ⚠️ EXPO_PUBLIC_ 값은 앱 번들에 그대로 박혀 누구나 꺼내 볼 수 있다. service_role 키 같은 비밀은
// 절대 여기 두지 않는다.
// 클라이언트는 처음 쓰는 순간 만든다. 불러오는 순간 만들면 설정이 없는 곳(CI·테스트)에서
// "supabaseUrl is required" 로 죽는다. let 금지 규칙 때문에 객체에 캐시한다.
const cache: { client: SupabaseClient<Database> | null } = { client: null };

// EXPO_PUBLIC_ 값은 process.env[이름] 처럼 동적으로 읽으면 번들에 박히지 않는다.
// 부르는 쪽에서 process.env.EXPO_PUBLIC_... 로 직접 적어 넘긴다.
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} 가 없습니다. mobile/.env 를 설정하세요 (database 스킬 참고).`);
  }
  return value;
}

export function getSupabaseApp(): SupabaseClient<Database> {
  if (!cache.client) {
    const client = createClient<Database>(
      required(process.env.EXPO_PUBLIC_SUPABASE_URL, "EXPO_PUBLIC_SUPABASE_URL"),
      required(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, "EXPO_PUBLIC_SUPABASE_ANON_KEY"),
      {
        auth: {
          // 저장소가 없으면 세션이 메모리에만 남아 앱을 다시 켜면 로그아웃된다.
          storage: AsyncStorage,
          persistSession: true,
          autoRefreshToken: true,
          // 앱에는 브라우저 주소창이 없다.
          detectSessionInUrl: false,
          // 앱에는 브라우저의 잠금 API 가 없다. 토큰 갱신이 겹치지 않게 프로세스 안에서 잠근다.
          lock: processLock,
        },
      },
    );
    // 백그라운드에서는 타이머가 멈추므로 돌아올 때 갱신을 다시 켜야 만료된 토큰으로 요청하지 않는다.
    AppState.addEventListener("change", (state) => {
      if (state === "active") client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
    cache.client = client;
  }
  return cache.client;
}

// 속성에 처음 손대는 순간 getSupabaseApp() 이 불려 클라이언트가 만들어진다.
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseApp();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
