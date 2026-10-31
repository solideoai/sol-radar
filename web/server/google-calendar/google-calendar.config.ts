import "server-only";
import { createTokenSealer } from "@/server/token-seal";

// ── 웹 서버의 구글 캘린더 연동 설정(ADR-073, ADR-018 예외 확장) ──
// 순수 함수: env 객체 → 설정 또는 빠진·틀린 변수 이름. 값은 돌려주는 설정 밖으로 싣지 않는다(오류·로그에는 이름만).
// NEXT_PUBLIC_ 이름은 쓰지 않는다 — 화면 번들에 들어가면 안 되는 비밀이다.
// 클라이언트 ID·시크릿은 Supabase 대시보드의 Google 제공자에 넣은 것과 같은 값이다(refresh token 을 그 클라이언트가 발급했다).

type Env = Record<string, string | undefined>;

export const GOOGLE_TOKEN_KEY_NAME = "GOOGLE_TOKEN_ENC_KEY";

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  /** GOOGLE_TOKEN_ENC_KEY(base64 32바이트). refresh token 암호화와 연결 state 서명 키(HKDF)의 바탕이다. */
  tokenKey: string;
};

const valueOf = (env: Env, key: string): string => env[key]?.trim() ?? "";

/**
 * 구글 refresh token 봉인. AAD 에 "google:" 를 붙인다 — GOOGLE_TOKEN_ENC_KEY 를 카카오 키와 같은 값으로 넣어도
 * 카카오 암호문(접두 없음)이 구글 자리에서 풀리지 않는다. 연결 콜백·밀어넣기가 모두 이것을 쓴다.
 */
export const googleTokenSealer = createTokenSealer(GOOGLE_TOKEN_KEY_NAME, { aadPrefix: "google:" });

const isTokenKey = (value: string): boolean => {
  try {
    googleTokenSealer.assertKey(value);
    return true;
  } catch {
    return false;
  }
};

/** 빠졌거나 형식이 틀린 변수 이름. 비어 있으면 설정이 갖춰진 것이다. */
export function missingGoogleCalendarSettings(env: Env): string[] {
  const problems = [
    valueOf(env, "GOOGLE_OAUTH_CLIENT_ID") === "" ? "GOOGLE_OAUTH_CLIENT_ID" : null,
    valueOf(env, "GOOGLE_OAUTH_CLIENT_SECRET") === "" ? "GOOGLE_OAUTH_CLIENT_SECRET" : null,
    isTokenKey(valueOf(env, GOOGLE_TOKEN_KEY_NAME)) ? null : GOOGLE_TOKEN_KEY_NAME,
  ];
  return problems.filter((name): name is string => name !== null);
}

/** env → 설정. 하나라도 빠졌거나 틀리면 null(연결·밀어넣기를 시작하지 않는다). */
export function readGoogleCalendarConfig(env: Env): GoogleCalendarConfig | null {
  if (missingGoogleCalendarSettings(env).length > 0) return null;
  return {
    clientId: valueOf(env, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: valueOf(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    tokenKey: valueOf(env, GOOGLE_TOKEN_KEY_NAME),
  };
}
