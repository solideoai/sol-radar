import "server-only";
import type { KakaoFeedTemplate } from "./feed.model";

// ── 카카오 REST API 클라이언트: 인가 주소·토큰 받기·토큰 갱신·나에게 보내기(설계 §4.2·§5.5, 계획 Task 3) ──
// 작은 fetch 클라이언트다. 로그는 남기지 않는다(호출자 몫). 시간 초과는 부르는 쪽이 정한 deps.timeoutMs 하나다.
// 발송 실패는 던지지 않고 결과 값으로 돌려준다. 토큰 실패는 KakaoTokenError 로 던진다(갱신의 invalid_grant 만 값이다).
// 결과·오류에는 HTTP 상태·카카오 오류 코드만 싣는다. 토큰·키·시크릿·응답 본문(msg·error_description)은 싣지 않고 cause 도 달지 않는다.
//
// 나에게 보내기 결과 분류(2026-10-21 카카오 문서 확인):
//   https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api   (발송 요청·성공 {"result_code":0})
//   https://developers.kakao.com/docs/ko/rest-api/reference           (오류 본문 {msg, code}, 예시 401/-401·403/-402)
//   https://developers.kakao.com/docs/ko/rest-api/error-code          (공통·카카오 로그인·카카오톡 메시지 코드표)
//
//   | 응답                                        | 결과              | 근거                                                    |
//   |---------------------------------------------|-------------------|---------------------------------------------------------|
//   | 200, result_code 0                          | SENT              | 성공 응답                                               |
//   | 200, result_code 0 을 확인 못 함            | UNKNOWN_OUTCOME   | 카카오가 받았으니 갔을 수 있다. 다시 보내지 않는다      |
//   | 401(본문 무관), 또는 code -401              | TOKEN_INVALID     | -401 토큰 무효·만료(앱 키 불일치도 같은 코드다)         |
//   | 403, code -402                              | TOKEN_INVALID     | -402 동의 없음 — 사용자가 talk_message 동의를 철회했다  |
//   | 504(본문 무관)                              | UNKNOWN_OUTCOME   | 앞단이 기다리다 끊었다. 뒤쪽이 이미 처리했을 수 있다    |
//   | 429, 그 밖의 5xx(500·502·503 -9798 점검 등) | RETRYABLE HTTP_n  | 시스템 오류·점검·쿼터                                   |
//   | 400, code -1                                | RETRYABLE KAKAO_-1| 서버 내부 처리 오류. 문서의 해결이 "재시도"다           |
//   | 400, code -7                                | RETRYABLE KAKAO_-7| 서비스 점검·내부 문제(503 점검과 같게 본다)             |
//   | 400, code -603                              | UNKNOWN_OUTCOME   | 카카오 내부 처리 timeout — 갔는지 모른다                |
//   | 응답 헤더 전 timeout(TimeoutError·AbortError)| UNKNOWN_OUTCOME   | 요청은 나갔을 수 있다(설계 §5.5 최대 한 번)             |
//   | 연결 실패(TypeError 등, abort 아님)         | RETRYABLE NETWORK | 보내기 전 실패가 분명하다                               |
//   | 그 밖의 4xx(-2 인자·어뷰징, -3 앱 설정,     | REJECTED          | code 가 정수면 KAKAO_<code>, 아니면 HTTP_<상태>         |
//   |  -10 횟수 초과, -532·-533·-536 하루 쿼터 등) |                   | 같은 요청을 다시 보내도 같다                            |
//   본문을 읽다 끊기면 상태만으로 나눈다(200·504 는 UNKNOWN_OUTCOME, 401 은 TOKEN_INVALID, 그 밖의 5xx 는 RETRYABLE,
//   나머지 REJECTED HTTP_n).
//   연결 전 timeout 과 요청 뒤 timeout 은 fetch 가 구분해 주지 않는다. 두 번 가는 쪽보다 한 통 빠지는 쪽을 고른다.
//
// 토큰(https://developers.kakao.com/docs/ko/kakaologin/rest-api, .../kakaologin/trouble-shooting):
//   expires_in·refresh_token_expires_in 은 초다. scope 는 공백으로 나눈 목록이고, 갱신 응답에는 범위가 바뀐 때만 온다.
//   갱신 응답의 refresh_token 은 남은 기간이 1개월 미만일 때만 온다. 없으면 null 로 돌려주고 부르는 쪽이 기존 값을 둔다.
//   갱신의 invalid_grant(KOE322 리프레시 토큰 없음·만료)는 다시 해도 같으므로 "INVALID_GRANT" 값으로 돌려준다.
//   문서가 그 HTTP 상태를 적지 않아 4xx 전부에서 본다. invalid_client(KOE010 시크릿 오류 등)는 앱 설정 문제라 던진다.

export type KakaoTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
  scopes: string[];
};

export type KakaoSendResult =
  | { kind: "SENT" }
  | { kind: "TOKEN_INVALID" }
  | { kind: "RETRYABLE"; code: string }
  | { kind: "UNKNOWN_OUTCOME" }
  | { kind: "REJECTED"; code: string };

export type KakaoApiDeps = {
  fetch: typeof fetch;
  restApiKey: string;
  clientSecret: string;
  /** 요청 하나(응답 본문 읽기까지)의 시간 초과. 기본값을 두지 않는다 — worker·웹 설정이 정한다. */
  timeoutMs: number;
  /** 토큰 만료 시각의 기준. */
  now: () => Date;
};

export type KakaoApi = {
  authorizeUrl(input: { redirectUri: string; state: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<KakaoTokenSet>;
  refresh(refreshToken: string): Promise<KakaoTokenSet | "INVALID_GRANT">;
  sendMemo(accessToken: string, template: KakaoFeedTemplate): Promise<KakaoSendResult>;
};

/** 토큰 받기·갱신 오류. message 는 "kakao token 오류: <코드>[ <OAuth error>][ <KOE 코드>]" 이고 값은 싣지 않는다. */
export class KakaoTokenError extends Error {
  readonly code: string;
  constructor(code: string, details: readonly string[] = []) {
    super(["kakao token 오류:", code, ...details].join(" "));
    this.name = "KakaoTokenError";
    this.code = code;
  }
}

const AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const MEMO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded;charset=utf-8";
const MESSAGE_SCOPE = "talk_message";

const RETRYABLE_KAKAO_CODES: ReadonlySet<number> = new Set([-1, -7]);
const UNKNOWN_OUTCOME_KAKAO_CODES: ReadonlySet<number> = new Set([-603]);
/** 게이트웨이 시간 초과. 요청이 카카오 뒤쪽에 닿아 처리됐을 수 있어 다시 보내지 않는다(설계 §5.5 최대 한 번). */
const GATEWAY_TIMEOUT = 504;

/** 응답이 왔는가. 본문을 읽다 끊겼으면 body 는 undefined 이고 bodyFailure 에 까닭이 있다. */
type Exchange =
  | { kind: "NO_RESPONSE"; isTimeout: boolean }
  | {
      kind: "RESPONSE";
      status: number;
      body: unknown;
      bodyFailure: "TIMEOUT" | "NETWORK" | null;
    };

/** 객체의 필드 하나. 객체가 아니거나 필드가 없으면 undefined. DOMException 의 name 처럼 상속한 getter 도 읽는다. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

const isTimeout = (error: unknown): boolean => {
  const name = readField(error, "name");
  return name === "TimeoutError" || name === "AbortError";
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 카카오 API 오류 본문의 code. 정수가 아니면 null — 글자가 코드 자리로 결과에 새지 않게 한다. */
function readKakaoCode(body: unknown): number | null {
  const code = readField(body, "code");
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

function classifySend(exchange: Exchange): KakaoSendResult {
  if (exchange.kind === "NO_RESPONSE") {
    return exchange.isTimeout
      ? { kind: "UNKNOWN_OUTCOME" }
      : { kind: "RETRYABLE", code: "NETWORK" };
  }
  const { status, body } = exchange;
  const kakaoCode = readKakaoCode(body);
  if (status === 200) {
    return readField(body, "result_code") === 0 ? { kind: "SENT" } : { kind: "UNKNOWN_OUTCOME" };
  }
  if (status === 401 || kakaoCode === -401) return { kind: "TOKEN_INVALID" };
  if (status === 403 && kakaoCode === -402) return { kind: "TOKEN_INVALID" };
  if (status === GATEWAY_TIMEOUT) return { kind: "UNKNOWN_OUTCOME" };
  if (status === 429 || status >= 500) return { kind: "RETRYABLE", code: `HTTP_${status}` };
  if (kakaoCode !== null && RETRYABLE_KAKAO_CODES.has(kakaoCode)) {
    return { kind: "RETRYABLE", code: `KAKAO_${kakaoCode}` };
  }
  if (kakaoCode !== null && UNKNOWN_OUTCOME_KAKAO_CODES.has(kakaoCode)) {
    return { kind: "UNKNOWN_OUTCOME" };
  }
  return { kind: "REJECTED", code: kakaoCode === null ? `HTTP_${status}` : `KAKAO_${kakaoCode}` };
}

const OAUTH_ERROR_PATTERN = /^[a-z_]{1,40}$/;
const KOE_PATTERN = /^KOE\d{3}$/;

/** OAuth error·KOE 코드는 정해진 모양일 때만 싣는다(설정 문제를 가리는 데 필요하고 값이 아니다). */
function httpTokenError(status: number, body: unknown): KakaoTokenError {
  const oauthError = readField(body, "error");
  const koeCode = readField(body, "error_code");
  const details = [
    typeof oauthError === "string" && OAUTH_ERROR_PATTERN.test(oauthError) ? oauthError : null,
    typeof koeCode === "string" && KOE_PATTERN.test(koeCode) ? koeCode : null,
  ].filter((detail): detail is string => detail !== null);
  return new KakaoTokenError(`HTTP_${status}`, details);
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const isPositiveSeconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isAbsent = (value: unknown): boolean => value === undefined || value === null;

const secondsAfter = (base: Date, seconds: number): Date =>
  new Date(base.getTime() + seconds * 1000);

/**
 * 토큰 응답을 KakaoTokenSet 으로. 모양이 틀리면 null.
 * 토큰 받기 응답에는 refresh_token 이 늘 있다(isRefreshRequired). 갱신 응답에는 있을 때만 있고, 있으면 만료도 함께 와야 한다.
 */
function toTokenSet(
  body: unknown,
  issuedAt: Date,
  isRefreshRequired: boolean,
): KakaoTokenSet | null {
  const accessToken = readField(body, "access_token");
  const expiresIn = readField(body, "expires_in");
  const refreshToken = readField(body, "refresh_token");
  const refreshExpiresIn = readField(body, "refresh_token_expires_in");
  const scope = readField(body, "scope");

  if (!isNonEmptyString(accessToken) || !isPositiveSeconds(expiresIn)) return null;
  if (!isAbsent(scope) && typeof scope !== "string") return null;
  const scopes = typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
  const base = { accessToken, accessExpiresAt: secondsAfter(issuedAt, expiresIn), scopes };

  if (isAbsent(refreshToken)) {
    return isRefreshRequired ? null : { ...base, refreshToken: null, refreshExpiresAt: null };
  }
  if (!isNonEmptyString(refreshToken) || !isPositiveSeconds(refreshExpiresIn)) return null;
  return { ...base, refreshToken, refreshExpiresAt: secondsAfter(issuedAt, refreshExpiresIn) };
}

export function createKakaoApi(deps: KakaoApiDeps): KakaoApi {
  /** 응답 헤더까지. 던지지 않는다. fetch 주입 함수가 Promise 없이 그 자리에서 던져도 여기서 받는다. */
  async function fetchHeaders(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: true; response: Response } | { ok: false; isTimeout: boolean }> {
    try {
      return { ok: true, response: await deps.fetch(url, init) };
    } catch (error) {
      return { ok: false, isTimeout: isTimeout(error) };
    }
  }

  /** 요청 하나. 던지지 않는다. 시간 초과는 응답 본문 읽기까지 같은 signal 이다. */
  async function postForm(
    url: string,
    form: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<Exchange> {
    const sent = await fetchHeaders(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": FORM_CONTENT_TYPE },
      body: form.toString(),
      signal: AbortSignal.timeout(deps.timeoutMs),
      // 따라가면 토큰·본문이 다른 곳으로 갈 수 있다. 카카오 API 는 리다이렉트하지 않는다.
      redirect: "error",
    });
    if (!sent.ok) return { kind: "NO_RESPONSE", isTimeout: sent.isTimeout };
    const { status } = sent.response;
    try {
      const text = await sent.response.text();
      return { kind: "RESPONSE", status, body: parseJson(text), bodyFailure: null };
    } catch (error) {
      const bodyFailure = isTimeout(error) ? "TIMEOUT" : "NETWORK";
      return { kind: "RESPONSE", status, body: undefined, bodyFailure };
    }
  }

  /** 토큰 요청. 응답을 못 받았거나 본문을 못 읽었으면 던진다. */
  async function postToken(form: URLSearchParams): Promise<{ status: number; body: unknown }> {
    const exchange = await postForm(TOKEN_URL, form, {});
    if (exchange.kind === "NO_RESPONSE") {
      throw new KakaoTokenError(exchange.isTimeout ? "TIMEOUT" : "NETWORK");
    }
    if (exchange.bodyFailure !== null) throw new KakaoTokenError(exchange.bodyFailure);
    return { status: exchange.status, body: exchange.body };
  }

  const tokenSetOrThrow = (
    body: unknown,
    issuedAt: Date,
    isRefreshRequired: boolean,
  ): KakaoTokenSet => {
    const tokens = toTokenSet(body, issuedAt, isRefreshRequired);
    if (tokens === null) throw new KakaoTokenError("INVALID_RESPONSE");
    return tokens;
  };

  return {
    authorizeUrl: ({ redirectUri, state }) => {
      const query = new URLSearchParams({
        client_id: deps.restApiKey,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: MESSAGE_SCOPE,
        state,
      });
      return `${AUTHORIZE_URL}?${query.toString()}`;
    },

    async exchangeCode({ code, redirectUri }) {
      // 요청 전 시각을 기준으로 삼는다. 만료를 실제보다 조금 이르게 잡는 쪽이 안전하다.
      const issuedAt = deps.now();
      const reply = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: deps.restApiKey,
          client_secret: deps.clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      );
      if (reply.status !== 200) throw httpTokenError(reply.status, reply.body);
      return tokenSetOrThrow(reply.body, issuedAt, true);
    },

    async refresh(refreshToken) {
      const issuedAt = deps.now();
      const reply = await postToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: deps.restApiKey,
          client_secret: deps.clientSecret,
          refresh_token: refreshToken,
        }),
      );
      const isClientError = reply.status >= 400 && reply.status < 500;
      if (isClientError && readField(reply.body, "error") === "invalid_grant") {
        return "INVALID_GRANT";
      }
      if (reply.status !== 200) throw httpTokenError(reply.status, reply.body);
      return tokenSetOrThrow(reply.body, issuedAt, false);
    },

    async sendMemo(accessToken, template) {
      const exchange = await postForm(
        MEMO_SEND_URL,
        new URLSearchParams({ template_object: JSON.stringify(template) }),
        { Authorization: `Bearer ${accessToken}` },
      );
      return classifySend(exchange);
    },
  };
}
