import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { KakaoTokenError, createKakaoApi, type KakaoApi } from "./kakao-api";
import { readKakaoConnectConfig, type KakaoConnectConfig } from "./kakao-connect.config";
import { toKakaoNotifyView, type KakaoNotifyView } from "./kakao-notify.model";
import { kakaoNotifyRepo, type KakaoNotifyRepo } from "./kakao-notify.repo";
import { encryptKakaoToken } from "./kakao-token.crypto";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

// ── 개인 설정 "카카오톡 알림" 의 흐름(계획 Task 6, 설계 §6 연결 흐름) ──
// 누구의 연결인지는 Route Handler 가 로그인(requireUser)에서 읽어 userId 로 넘긴다. 저장은 같은 요청의 세션으로 RPC 가 auth.uid() 를 쓴다.
// 연결: /connect 가 state 를 쿠키와 인가 주소에 싣는다 → 카카오 동의 → /callback 이 state 를 확인하고 토큰을 받아 암호화해 저장한다.
// 거부·state 불일치·쿠키 없음이면 카카오 토큰 요청도 저장도 하지 않는다(Review Focus 5).

/** 콜백 결과. 설정 화면이 /settings?kakao=<값> 으로 받는다(계획 Task 7). 화면은 이 목록에 있는 값만 믿는다. */
export const KAKAO_CONNECT_OUTCOMES = [
  "connected",
  "consent_denied",
  "state_mismatch",
  "failed",
] as const;
export type KakaoConnectOutcome = (typeof KAKAO_CONNECT_OUTCOMES)[number];

/** 주소의 ?kakao= 값 → 결과. 목록에 없거나 여러 개면 null(안내하지 않는다). */
export const toKakaoConnectOutcome = (value: unknown): KakaoConnectOutcome | null =>
  KAKAO_CONNECT_OUTCOMES.find((outcome) => outcome === value) ?? null;

/** 콜백 로그용 이유 코드. 값(토큰·코드·state)은 싣지 않는다. */
export type KakaoConnectReason =
  | "NOT_CONFIGURED"
  | "STATE_MISSING"
  | "STATE_INVALID"
  | "ACCESS_DENIED"
  | "KAKAO_ERROR"
  | "CODE_MISSING"
  | "SCOPE_MISSING"
  | "REFRESH_MISSING"
  | `TOKEN_${string}`;

export type KakaoConnectResult = {
  outcome: KakaoConnectOutcome;
  reason: KakaoConnectReason | null;
};

export type KakaoConnectStart =
  | { kind: "REDIRECT"; redirectTo: string; state: string; isSecureCookie: boolean }
  | { kind: "NOT_CONFIGURED" };

/** 연결 시작이 굽는 state 쿠키. 콜백 경로에만 실리고 10분 뒤 사라진다. */
export const KAKAO_STATE_COOKIE = {
  name: "kakao_notify_state",
  path: "/api/v1/me/kakao-notify",
  maxAgeSeconds: 600,
} as const;

const TALK_MESSAGE_SCOPE = "talk_message";
/** 웹 서버의 카카오 요청 하나의 시간 초과. 사람이 기다리는 콜백이라 worker 보다 짧게 둔다. */
const WEB_KAKAO_TIMEOUT_MS = 10_000;

export type KakaoNotifyDeps = {
  repo: KakaoNotifyRepo;
  config: () => KakaoConnectConfig | null;
  api: (config: KakaoConnectConfig) => KakaoApi;
  now: () => Date;
};

const defaultDeps = (): KakaoNotifyDeps => ({
  repo: kakaoNotifyRepo,
  config: () => readKakaoConnectConfig(process.env),
  api: (config) =>
    createKakaoApi({
      fetch,
      restApiKey: config.restApiKey,
      clientSecret: config.clientSecret,
      timeoutMs: WEB_KAKAO_TIMEOUT_MS,
      now: () => new Date(),
    }),
  now: () => new Date(),
});

const result = (
  outcome: KakaoConnectOutcome,
  reason: KakaoConnectReason | null,
): KakaoConnectResult => ({ outcome, reason });

const sameText = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

// 콜백 주소가 https 면 쿠키도 https 에서만 보낸다(로컬 http 데모는 Secure 없이).
// 요청 주소(프록시 뒤에서는 내부 주소일 수 있다)가 아니라 브라우저가 실제로 돌아오는 콜백 주소로 정한다.
const isSecureRedirect = (config: KakaoConnectConfig): boolean =>
  new URL(config.redirectUri).protocol === "https:";

export async function getMyKakaoNotify(
  userId: string,
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<KakaoNotifyView> {
  return toKakaoNotifyView(await deps.repo.readMine(userId));
}

/** 서버 화면(개인 설정)용: 로그인한 사람의 화면 상태. 로그인 전이거나 DB 설정이 없으면 null. */
export async function loadMyKakaoNotify(
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<KakaoNotifyView | null> {
  if (!deps.repo.isConfigured()) return null;
  const userId = await deps.repo.currentUserId();
  return userId === null ? null : getMyKakaoNotify(userId, deps);
}

/** 카카오 인가 주소와 state. 설정이 빠졌으면 NOT_CONFIGURED(이동하지 않는다). */
export async function startKakaoConnect(
  userId: string,
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<KakaoConnectStart> {
  const config = deps.config();
  if (config === null) return { kind: "NOT_CONFIGURED" };
  const state = createOAuthState({ userId, now: deps.now(), secret: config.tokenKey });
  return {
    kind: "REDIRECT",
    redirectTo: deps.api(config).authorizeUrl({ redirectUri: config.redirectUri, state }),
    state,
    isSecureCookie: isSecureRedirect(config),
  };
}

/** 콜백이 state 쿠키를 지울 때 구울 때와 같은 Secure 를 쓰게 한다. 설정이 없으면 false. */
export function isKakaoStateCookieSecure(deps: KakaoNotifyDeps = defaultDeps()): boolean {
  const config = deps.config();
  return config !== null && isSecureRedirect(config);
}

/**
 * 카카오 콜백. state 를 먼저 본다 — state 가 맞지 않으면 error 값도 믿지 않는다(남이 만든 주소일 수 있다).
 * 카카오 토큰 요청 실패는 failed 로 돌려준다. 저장(RPC)이 던지면 그대로 던진다(Route Handler 가 failed 로 보내고 기록한다).
 */
export async function completeKakaoConnect(
  input: { userId: string; params: URLSearchParams; stateCookie: string | undefined },
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<KakaoConnectResult> {
  const config = deps.config();
  if (config === null) return result("failed", "NOT_CONFIGURED");

  const state = input.params.get("state");
  if (state === null || state === "" || input.stateCookie === undefined) {
    return result("state_mismatch", "STATE_MISSING");
  }
  const isValidState =
    sameText(state, input.stateCookie) &&
    verifyOAuthState({ state, userId: input.userId, now: deps.now(), secret: config.tokenKey });
  if (!isValidState) return result("state_mismatch", "STATE_INVALID");

  const kakaoError = input.params.get("error");
  if (kakaoError === "access_denied") return result("consent_denied", "ACCESS_DENIED");
  if (kakaoError !== null) return result("failed", "KAKAO_ERROR");
  const code = input.params.get("code");
  if (code === null || code === "") return result("failed", "CODE_MISSING");

  const tokens = await deps
    .api(config)
    .exchangeCode({ code, redirectUri: config.redirectUri })
    .catch((error: unknown) => {
      if (error instanceof KakaoTokenError) return error;
      throw error;
    });
  if (tokens instanceof KakaoTokenError) return result("failed", `TOKEN_${tokens.code}`);
  // 로그인은 했지만 "카카오톡 메시지 전송" 선택 동의를 끄고 넘어온 경우다.
  if (!tokens.scopes.includes(TALK_MESSAGE_SCOPE)) return result("consent_denied", "SCOPE_MISSING");
  if (tokens.refreshToken === null || tokens.refreshExpiresAt === null) {
    return result("failed", "REFRESH_MISSING");
  }

  await deps.repo.saveLink({
    accessTokenEnc: encryptKakaoToken(tokens.accessToken, config.tokenKey, {
      userId: input.userId,
      kind: "access",
    }),
    refreshTokenEnc: encryptKakaoToken(tokens.refreshToken, config.tokenKey, {
      userId: input.userId,
      kind: "refresh",
    }),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  });
  return result("connected", null);
}

const enabledInputSchema = z.object({ enabled: z.boolean() }).strict();

/** PATCH 본문 { enabled: boolean } 만 받는다. 다른 키·모양이면 INVALID(저장하지 않는다). */
export async function setMyKakaoNotifyEnabled(
  input: unknown,
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<"OK" | "NOT_CONNECTED" | "INVALID"> {
  const parsed = enabledInputSchema.safeParse(input);
  if (!parsed.success) return "INVALID";
  return deps.repo.setEnabled(parsed.data.enabled);
}

export async function disconnectMyKakaoNotify(
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<void> {
  await deps.repo.disconnect();
}

export async function requestMyKakaoNotifyTest(
  deps: KakaoNotifyDeps = defaultDeps(),
): Promise<"QUEUED" | "THROTTLED" | "NOT_READY"> {
  return deps.repo.requestTest();
}
