import "server-only";
import { assertKakaoTokenKey } from "./kakao-token.crypto";

// ── 웹 서버의 카카오 연결 설정(계획 Global Constraints env 이름) ──
// 순수 함수: env 객체 → 설정 또는 빠진·틀린 변수 이름. 값은 돌려주는 설정 밖으로 싣지 않는다(오류·로그에는 이름만).
// NEXT_PUBLIC_ 이름은 쓰지 않는다 — 화면 번들에 들어가면 안 되는 비밀이다.

type Env = Record<string, string | undefined>;

export type KakaoConnectConfig = {
  restApiKey: string;
  clientSecret: string;
  /** KAKAO_TOKEN_ENC_KEY(base64 32바이트). 토큰 암호화와 OAuth state 키(HKDF)의 바탕이다. */
  tokenKey: string;
  /** 카카오 콘솔에 등록한 콜백 주소. 인가·토큰 요청 모두 이 값으로 고정한다(요청 주소에서 만들지 않는다). */
  redirectUri: string;
};

const valueOf = (env: Env, key: string): string => env[key]?.trim() ?? "";

const isWebUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const isTokenKey = (value: string): boolean => {
  try {
    assertKakaoTokenKey(value);
    return true;
  } catch {
    return false;
  }
};

/** 빠졌거나 형식이 틀린 변수 이름. 비어 있으면 설정이 갖춰진 것이다. */
export function missingKakaoConnectSettings(env: Env): string[] {
  const problems = [
    valueOf(env, "KAKAO_REST_API_KEY") === "" ? "KAKAO_REST_API_KEY" : null,
    valueOf(env, "KAKAO_CLIENT_SECRET") === "" ? "KAKAO_CLIENT_SECRET" : null,
    isTokenKey(valueOf(env, "KAKAO_TOKEN_ENC_KEY")) ? null : "KAKAO_TOKEN_ENC_KEY",
    isWebUrl(valueOf(env, "KAKAO_REDIRECT_URI")) ? null : "KAKAO_REDIRECT_URI",
  ];
  return problems.filter((name): name is string => name !== null);
}

/** env → 설정. 하나라도 빠졌거나 틀리면 null(연결을 시작하지 않는다). */
export function readKakaoConnectConfig(env: Env): KakaoConnectConfig | null {
  if (missingKakaoConnectSettings(env).length > 0) return null;
  return {
    restApiKey: valueOf(env, "KAKAO_REST_API_KEY"),
    clientSecret: valueOf(env, "KAKAO_CLIENT_SECRET"),
    tokenKey: valueOf(env, "KAKAO_TOKEN_ENC_KEY"),
    redirectUri: valueOf(env, "KAKAO_REDIRECT_URI"),
  };
}
