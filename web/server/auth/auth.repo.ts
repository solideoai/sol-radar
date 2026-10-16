import "server-only";
import {
  getAuthContext,
  getSupabase,
  isSupabaseConfigured,
  unlinkAuthIdentity,
} from "@/server/supabase";
import type { AccountRow, IdentityRow, LinkType } from "./auth.model";

// ── 저장: Supabase Auth 를 부르는 자리. 규칙은 두지 않는다 ──
export const authRepo = {
  isConfigured: isSupabaseConfigured,
  // 맞으면 라우트 핸들러의 응답에 로그인 쿠키가 실린다. 틀렸거나 만료됐거나 이미 쓴(한 번만 쓴다) 토큰이면 false.
  async verifyLink(tokenHash: string, type: LinkType): Promise<boolean> {
    const { error } = await (await getSupabase()).auth.verifyOtp({ token_hash: tokenHash, type });
    return !error;
  },
  // PKCE: 코드와 짝인 확인 값은 버튼을 누른 브라우저의 쿠키에 있다. 다른 브라우저·만료·이미 쓴 코드면 false.
  async exchangeCode(code: string): Promise<boolean> {
    const { error } = await (await getSupabase()).auth.exchangeCodeForSession(code);
    return !error;
  },

  // 서명·만료·발급자를 확인한 지금 요청의 로그인. "bearer" 면 Authorization 헤더만, 기본은 쿠키도 본다. 아니면 null.
  currentSession: getAuthContext,

  // 역할·상태는 요청마다 DB 에서 읽는다 — 정지·운영자 해제가 다음 요청부터 걸린다. 탈퇴했으면 행이 없다.
  async accountOf(userId: string): Promise<AccountRow | null> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("profiles")
      .select("is_admin, status")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // 연결된 로그인 수단은 Auth 서버에 묻는다(토큰의 클레임은 발급 때의 것이라 그 뒤의 연결·해제를 모른다).
  async listIdentities(accessToken: string): Promise<IdentityRow[]> {
    const { data, error } = await (await getSupabase()).auth.getUser(accessToken);
    if (error) throw error;
    return data.user.identities ?? [];
  },

  unlinkIdentity: unlinkAuthIdentity,

  // 그 사람의 모든 세션(다른 기기 포함)의 refresh token 을 끊는다. 이미 받은 access token 은 만료까지 남는다.
  async signOutEverywhere(accessToken: string): Promise<void> {
    const { error } = await (await getSupabase()).auth.admin.signOut(accessToken, "global");
    if (error) throw error;
  },
};

export type AuthRepo = typeof authRepo;
