import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { KakaoLinkStore, StoredKakaoLink } from "./kakao-notify.model";

// ── 저장: 카카오 연결 port(KakaoLinkStore)의 Supabase 구현. supabase-js 호출만 두고 규칙은 sender 에 둔다 ──
// worker 만 쓴다. worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다 — 화면 역할은 토큰 열을 읽지도 쓰지도 못한다
// (20261021000001 열 권한). 클라이언트는 모듈에 담아 두지 않는다.
// updated_at 은 표의 touch_updated_at 트리거가 채우므로 적지 않는다.
// saveTokens·markExpired 는 조건부 갱신이다. 읽은 액세스 암호문(expected)이 그대로인 행만 바꾸고, 바뀐 행 수로 true·false 를 정한다.
// 읽은 뒤 사용자가 다시 연결하면 새 암호문이 들어와 0행이다 — 옛 토큰으로 새 연결을 덮어쓰거나 새 연결을 만료로 바꾸지 않는다.
// 오류 message 에는 표·동작·code 만 싣는다(PostgREST message·details 에 값이 섞일 수 있다). 던지는 오류는 모두 KakaoLinkStoreError 다.

type Client = SupabaseClient<Database>;
type LinkRow = Pick<
  Tables<"kakao_notify_links">,
  | "user_id"
  | "access_token_enc"
  | "refresh_token_enc"
  | "access_expires_at"
  | "refresh_expires_at"
  | "status"
>;

const TABLE = "kakao_notify_links";
const LINK_COLUMNS =
  "user_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, status";

/** 카카오 연결 저장 오류. message 는 "kakao link store 오류: kakao_notify_links.<동작> <code>" 이고 값은 싣지 않는다. */
export class KakaoLinkStoreError extends Error {
  constructor(action: string, code: string) {
    super(`kakao link store 오류: ${TABLE}.${action} ${code}`);
    this.name = "KakaoLinkStoreError";
  }
}

/** PostgREST 오류를 KakaoLinkStoreError 로 바꾼다. code 가 없으면 UNKNOWN 이다. */
function storeError(action: string, error: { code?: string | null }): KakaoLinkStoreError {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  return new KakaoLinkStoreError(action, code);
}

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new KakaoLinkStoreError("select", "INVALID_ROW");
  return date;
}

function toStoredLink(row: LinkRow): StoredKakaoLink {
  const { status } = row;
  // 표의 check 가 둘만 받으므로 다른 값은 질의나 표가 틀렸다는 뜻이다.
  if (status !== "CONNECTED" && status !== "EXPIRED") {
    throw new KakaoLinkStoreError("select", "UNEXPECTED_STATUS");
  }
  return {
    userId: row.user_id,
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    accessExpiresAt: toDate(row.access_expires_at),
    refreshExpiresAt: toDate(row.refresh_expires_at),
    status,
  };
}

export function createKakaoLinkStore(client: Client): KakaoLinkStore {
  return {
    async read(userId) {
      const result = await client
        .from(TABLE)
        .select(LINK_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      if (result.error) throw storeError("select", result.error);
      return result.data === null ? null : toStoredLink(result.data);
    },

    async saveTokens(userId, sealed, expected) {
      const update = client
        .from(TABLE)
        .update({
          access_token_enc: sealed.accessTokenEnc,
          refresh_token_enc: sealed.refreshTokenEnc,
          access_expires_at: sealed.accessExpiresAt.toISOString(),
          refresh_expires_at: sealed.refreshExpiresAt?.toISOString() ?? null,
        })
        .eq("user_id", userId);
      const result = await (
        expected.accessTokenEnc === null
          ? update.is("access_token_enc", null)
          : update.eq("access_token_enc", expected.accessTokenEnc)
      ).select("user_id");
      if (result.error) throw storeError("update", result.error);
      return result.data.length > 0;
    },

    // CONNECTED 이고 읽은 액세스 암호문일 때만 바꾸고 바뀐 행으로 true·false 를 정한다. 만료 인앱 알림을 바뀐 순간 한 번만 내기 위해서다.
    async markExpired(userId, expected) {
      const update = client
        .from(TABLE)
        .update({ status: "EXPIRED" })
        .eq("user_id", userId)
        .eq("status", "CONNECTED");
      const result = await (
        expected.accessTokenEnc === null
          ? update.is("access_token_enc", null)
          : update.eq("access_token_enc", expected.accessTokenEnc)
      ).select("user_id");
      if (result.error) throw storeError("update", result.error);
      return result.data.length > 0;
    },

    async markResult(userId, sendRecord, at) {
      const result = await client
        .from(TABLE)
        .update({ last_sent_at: at.toISOString(), last_result: sendRecord })
        .eq("user_id", userId);
      if (result.error) throw storeError("update", result.error);
    },
  };
}
