import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type { KakaoNotifyRow } from "./kakao-notify.model";

// ── 개인 설정 "카카오톡 알림" 의 저장(계획 Task 6). 로그인한 사람의 세션(anon 키 + RLS)으로만 부른다 ──
// 읽기는 화면 역할에 열린 열 넷만 고른다(토큰 열은 authenticated 에 select 권한이 없다, 20261021000601).
// 쓰기는 RPC 넷이고 누구의 행인지는 RPC 가 auth.uid() 로 정한다. 요청마다 await getSupabase() 를 부른다.
// 서비스 시험은 이 객체와 같은 모양의 가짜를 넘긴다.

/** RPC 가 raise exception 으로 올린 오류. PostgREST 는 code P0001 · message 에 그 문자열을 싣는다. */
const RAISED = "P0001";
const isRaised = (error: { code?: string | null; message?: string | null }, message: string) =>
  error.code === RAISED && error.message === message;

const LINK_STATUSES = ["CONNECTED", "EXPIRED"] as const;
const SEND_RECORDS = ["SENT", "FAILED", "EXPIRED"] as const;

/** 저장 실패. message 는 표·RPC 이름과 PostgREST code 만 싣는다(값·토큰은 싣지 않는다). */
export class KakaoNotifyStoreError extends Error {
  readonly code: string;
  constructor(target: string, code: string) {
    super(`kakao notify 저장 오류: ${target} ${code}`);
    this.name = "KakaoNotifyStoreError";
    this.code = code;
  }
}

const storeError = (target: string, error: { code?: string | null }): KakaoNotifyStoreError =>
  new KakaoNotifyStoreError(target, error.code ?? "UNKNOWN");

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

type SelectedRow = {
  enabled: boolean;
  status: string;
  last_sent_at: string | null;
  last_result: string | null;
};

/** check 제약이 막는 값이지만, 들어오면 화면 상태를 지어내지 않고 던진다. */
function toKakaoNotifyRow(row: SelectedRow): KakaoNotifyRow {
  const { last_result: lastResult } = row;
  if (!isOneOf(LINK_STATUSES, row.status)) {
    throw new KakaoNotifyStoreError("kakao_notify_links", "INVALID_ROW");
  }
  if (lastResult !== null && !isOneOf(SEND_RECORDS, lastResult)) {
    throw new KakaoNotifyStoreError("kakao_notify_links", "INVALID_ROW");
  }
  return {
    enabled: row.enabled,
    status: row.status,
    last_sent_at: row.last_sent_at,
    last_result: lastResult,
  };
}

/** 저장 RPC 에 넘기는 값. 토큰은 kakao-token.crypto 의 암호문이다. */
export type SealedKakaoLink = {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export const kakaoNotifyRepo = {
  isConfigured: isSupabaseConfigured,

  /** 서명·발급자를 확인한 토큰의 사람. 로그인 전이면 null. 서버 화면이 쓴다(Route Handler 는 requireUser 의 사람을 넘긴다). */
  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },

  /** 본인 행. 없으면(연결 전·해제 뒤) null. */
  async readMine(userId: string): Promise<KakaoNotifyRow | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("kakao_notify_links")
      .select("enabled, status, last_sent_at, last_result")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw storeError("kakao_notify_links", error);
    return data === null ? null : toKakaoNotifyRow(data);
  },

  /** 연결 저장(재연결이면 덮어쓴다). RPC 가 켬·CONNECTED 로 둔다. */
  async saveLink(sealed: SealedKakaoLink): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("save_kakao_notify_link", {
      p_access_token_enc: sealed.accessTokenEnc,
      p_refresh_token_enc: sealed.refreshTokenEnc,
      p_access_expires_at: sealed.accessExpiresAt.toISOString(),
      p_refresh_expires_at: sealed.refreshExpiresAt.toISOString(),
    });
    if (error) throw storeError("save_kakao_notify_link", error);
  },

  /** 켬·끔. 연결 전이면 NOT_CONNECTED. */
  async setEnabled(enabled: boolean): Promise<"OK" | "NOT_CONNECTED"> {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("set_kakao_notify_enabled", { p_enabled: enabled });
    if (error && isRaised(error, "KAKAO_NOT_CONNECTED")) return "NOT_CONNECTED";
    if (error) throw storeError("set_kakao_notify_enabled", error);
    return "OK";
  },

  /** 연결 해제(행 삭제). 행이 없어도 성공이다. 카카오 unlink 는 부르지 않는다(계획 Global Constraints). */
  async disconnect(): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("disconnect_kakao_notify");
    if (error) throw storeError("disconnect_kakao_notify", error);
  },

  /** 시험 메시지 요청. 같은 분 중복·24시간 10건 상한이면 THROTTLED, 연결·켬이 아니면 NOT_READY. */
  async requestTest(): Promise<"QUEUED" | "THROTTLED" | "NOT_READY"> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("request_kakao_notify_test");
    if (error && isRaised(error, "KAKAO_NOT_READY")) return "NOT_READY";
    if (error) throw storeError("request_kakao_notify_test", error);
    return data === true ? "QUEUED" : "THROTTLED";
  },
};

export type KakaoNotifyRepo = typeof kakaoNotifyRepo;
