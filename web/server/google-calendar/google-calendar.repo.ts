import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type { EventMapping, GoogleCalendarRow, GoogleSyncResult } from "./google-calendar.model";
import { monthRange } from "./google-calendar.model";

// ── 구글 캘린더 연동의 저장(ADR-073). 로그인한 사람의 세션(anon 키 + RLS)으로만 부른다 ──
// 두 표(google_calendar_links·google_calendar_events)는 본인 행만 RLS 로 열려 있다(20261030002000). 요청마다 await getSupabase() 를 부른다.
// 구글 로그인 연결·코드 교환은 Supabase Auth 를 같은 세션으로 부른다. 서비스 시험은 이 객체와 같은 모양의 가짜를 넘긴다.
// 오류 message 에는 표·동작·PostgREST code 만 싣는다(값·토큰은 싣지 않는다).

/** 저장 실패. message 는 "google calendar 저장 오류: <대상> <code>" 이다. */
export class GoogleCalendarStoreError extends Error {
  readonly code: string;
  constructor(target: string, code: string) {
    super(`google calendar 저장 오류: ${target} ${code}`);
    this.name = "GoogleCalendarStoreError";
    this.code = code;
  }
}

const storeError = (target: string, error: { code?: string | null }): GoogleCalendarStoreError =>
  new GoogleCalendarStoreError(target, error.code ?? "UNKNOWN");

const LINK_STATUSES = ["CONNECTED", "EXPIRED"] as const;
const SYNC_RESULTS = ["SYNCED", "FAILED", "EXPIRED"] as const;
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const LINKS = "google_calendar_links";
const EVENTS = "google_calendar_events";
const LINK_COLUMNS =
  "status, google_email, refresh_token_enc, calendar_id, last_synced_at, last_result";

type SelectedLink = {
  status: string;
  google_email: string | null;
  refresh_token_enc: string;
  calendar_id: string | null;
  last_synced_at: string | null;
  last_result: string | null;
};

/** check 제약이 막는 값이지만, 들어오면 화면 상태를 지어내지 않고 던진다. */
function toRow(row: SelectedLink): GoogleCalendarRow {
  if (!isOneOf(LINK_STATUSES, row.status)) throw new GoogleCalendarStoreError(LINKS, "INVALID_ROW");
  if (row.last_result !== null && !isOneOf(SYNC_RESULTS, row.last_result)) {
    throw new GoogleCalendarStoreError(LINKS, "INVALID_ROW");
  }
  return {
    status: row.status,
    google_email: row.google_email,
    refresh_token_enc: row.refresh_token_enc,
    calendar_id: row.calendar_id,
    last_synced_at: row.last_synced_at,
    last_result: row.last_result,
  };
}

/** 구글 인가 주소를 만들 때의 입력. Supabase 가 PKCE 확인 값을 쿠키에 굽는다(Route Handler 에서만 부른다). */
export type AuthorizeInput = {
  /** 구글이 아직 로그인 수단이 아니면 link(연결), 이미면 signin(다시 동의) */
  mode: "link" | "signin";
  redirectTo: string;
  scopes: string;
  queryParams: Record<string, string>;
};

export type ExchangedSession = {
  userId: string;
  providerRefreshToken: string | null;
  googleEmail: string | null;
};

export const GOOGLE_PROVIDER = "google";

export const googleCalendarRepo = {
  isConfigured: isSupabaseConfigured,

  /** 서명·발급자를 확인한 토큰의 사람. 로그인 전이면 null. 서버 화면이 쓴다. */
  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },

  /** 본인 행. 없으면(연결 전·해제 뒤) null. */
  async readMine(userId: string): Promise<GoogleCalendarRow | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from(LINKS)
      .select(LINK_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw storeError(`${LINKS}.select`, error);
    return data === null ? null : toRow(data);
  },

  /** 연결 저장(재연결이면 덮어쓴다). resetCalendar 면 전용 캘린더 id 와 매핑을 비운다(다른 구글 계정으로 바꿨을 때). */
  async saveLink(
    userId: string,
    input: { refreshTokenEnc: string; googleEmail: string | null; resetCalendar: boolean },
  ): Promise<void> {
    const supabase = await getSupabase();
    if (input.resetCalendar) {
      const cleared = await supabase.from(EVENTS).delete().eq("user_id", userId);
      if (cleared.error) throw storeError(`${EVENTS}.delete`, cleared.error);
    }
    const { error } = await supabase.from(LINKS).upsert(
      {
        user_id: userId,
        status: "CONNECTED",
        refresh_token_enc: input.refreshTokenEnc,
        google_email: input.googleEmail,
        ...(input.resetCalendar ? { calendar_id: null } : {}),
      },
      { onConflict: "user_id" },
    );
    if (error) throw storeError(`${LINKS}.upsert`, error);
  },

  async setCalendarId(userId: string, calendarId: string): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from(LINKS)
      .update({ calendar_id: calendarId })
      .eq("user_id", userId);
    if (error) throw storeError(`${LINKS}.update`, error);
  },

  async markSync(userId: string, result: GoogleSyncResult, at: Date): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from(LINKS)
      .update({ last_result: result, last_synced_at: at.toISOString() })
      .eq("user_id", userId);
    if (error) throw storeError(`${LINKS}.update`, error);
  },

  /** refresh token 이 거부됐다. 사용자가 다시 연결해야 한다. */
  async markExpired(userId: string): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from(LINKS)
      .update({ status: "EXPIRED", last_result: "EXPIRED" })
      .eq("user_id", userId);
    if (error) throw storeError(`${LINKS}.update`, error);
  },

  /** 연결 해제. 매핑은 FK cascade 로 함께 지워진다. 행이 없어도 오류가 아니다. */
  async disconnect(userId: string): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase.from(LINKS).delete().eq("user_id", userId);
    if (error) throw storeError(`${LINKS}.delete`, error);
  },

  /** 그 달의 매핑과, 지금 일정 key 의 매핑(다른 달로 옮겨 온 일정)을 합쳐 돌려준다. key 로 하나씩이다. */
  async listMappings(
    userId: string,
    input: { monthPrefix: string; keys: readonly string[] },
  ): Promise<EventMapping[]> {
    const range = monthRange(input.monthPrefix);
    if (range === null) throw new GoogleCalendarStoreError(EVENTS, "INVALID_MONTH");
    const supabase = await getSupabase();
    const columns = "event_key, google_event_id, event_date";
    const [inMonth, byKey] = await Promise.all([
      supabase
        .from(EVENTS)
        .select(columns)
        .eq("user_id", userId)
        .gte("event_date", range.from)
        .lt("event_date", range.to),
      input.keys.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from(EVENTS)
            .select(columns)
            .eq("user_id", userId)
            .in("event_key", [...input.keys]),
    ]);
    if (inMonth.error) throw storeError(`${EVENTS}.select`, inMonth.error);
    if (byKey.error) throw storeError(`${EVENTS}.select`, byKey.error);
    const merged = new Map<string, EventMapping>();
    for (const row of [...inMonth.data, ...byKey.data]) {
      merged.set(row.event_key, {
        eventKey: row.event_key,
        googleEventId: row.google_event_id,
        eventDate: row.event_date,
      });
    }
    return [...merged.values()];
  },

  async upsertMappings(userId: string, rows: readonly EventMapping[]): Promise<void> {
    if (rows.length === 0) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from(EVENTS).upsert(
      rows.map((row) => ({
        user_id: userId,
        event_key: row.eventKey,
        google_event_id: row.googleEventId,
        event_date: row.eventDate,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,event_key" },
    );
    if (error) throw storeError(`${EVENTS}.upsert`, error);
  },

  async deleteMappings(userId: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const supabase = await getSupabase();
    const { error } = await supabase
      .from(EVENTS)
      .delete()
      .eq("user_id", userId)
      .in("event_key", [...keys]);
    if (error) throw storeError(`${EVENTS}.delete`, error);
  },

  /** 전용 캘린더가 구글에서 사라졌을 때 매핑을 모두 비운다. */
  async clearMappings(userId: string): Promise<void> {
    const supabase = await getSupabase();
    const { error } = await supabase.from(EVENTS).delete().eq("user_id", userId);
    if (error) throw storeError(`${EVENTS}.delete`, error);
  },

  // ── Supabase Auth ──

  /** 지금 사람의 구글 로그인 수단. 연결돼 있으면 그 구글 계정 이메일(없을 수 있다). */
  async googleIdentity(): Promise<{ linked: boolean; email: string | null }> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const identity = data.user.identities?.find((entry) => entry.provider === GOOGLE_PROVIDER);
    if (identity === undefined) return { linked: false, email: null };
    const email = identity.identity_data?.email;
    return { linked: true, email: typeof email === "string" && email !== "" ? email : null };
  },

  /**
   * 구글 인가 주소. Supabase 가 PKCE 확인 값을 이 응답의 쿠키에 굽는다.
   * 구글이 아직 로그인 수단이 아니면 linkIdentity(연결), 이미면 signInWithOAuth(같은 계정으로 다시 동의).
   * 실패는 Supabase 오류 코드 문자열로 돌려준다(값 없음).
   */
  async authorizeUrl(input: AuthorizeInput): Promise<{ url: string } | { failed: string }> {
    const supabase = await getSupabase();
    const credentials = {
      provider: GOOGLE_PROVIDER,
      options: {
        redirectTo: input.redirectTo,
        scopes: input.scopes,
        queryParams: input.queryParams,
        skipBrowserRedirect: true,
      },
    } as const;
    const { data, error } =
      input.mode === "link"
        ? await supabase.auth.linkIdentity(credentials)
        : await supabase.auth.signInWithOAuth(credentials);
    if (error) return { failed: error.code ?? "AUTH_ERROR" };
    return data.url === null ? { failed: "NO_URL" } : { url: data.url };
  },

  /**
   * 콜백의 코드를 세션으로 바꾼다(이 응답에 로그인 쿠키가 실린다). 돌아온 세션의 사람·구글 refresh token·구글 이메일.
   * 다른 브라우저·만료·이미 쓴 코드면 null.
   */
  async exchangeCode(code: string): Promise<ExchangedSession | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || data.session === null) return null;
    const identity = data.user.identities?.find((entry) => entry.provider === GOOGLE_PROVIDER);
    const email = identity?.identity_data?.email;
    return {
      userId: data.user.id,
      providerRefreshToken: data.session.provider_refresh_token ?? null,
      googleEmail: typeof email === "string" && email !== "" ? email : null,
    };
  },

  /**
   * 시작한 사람과 다른 계정으로 돌아왔을 때 그 세션을 끊는다(로그인 쿠키를 지운다).
   * 실패하면 오류 코드(Supabase AuthError 의 code·name, 던졌으면 "THROWN")를 돌려준다. 오류 문구·토큰은 싣지 않는다.
   */
  async signOut(): Promise<{ errorCode: string | null }> {
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      return { errorCode: error === null ? null : (error.code ?? error.name) };
    } catch {
      return { errorCode: "THROWN" };
    }
  },
};

export type GoogleCalendarRepo = typeof googleCalendarRepo;
