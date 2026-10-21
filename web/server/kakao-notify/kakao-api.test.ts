import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KakaoTokenError, createKakaoApi, type KakaoApi } from "./kakao-api";
import type { KakaoFeedTemplate } from "./feed.model";

// 카카오 API 클라이언트(계획 Task 3, 설계 §4.2·§5.5). 실제 카카오 서버는 부르지 않는다.
// fetch 를 주입하고 정해 둔 답을 준다. 오류는 가짜 fetch 가 바로 던진다(기다리는 시험은 timeout 10ms 하나뿐이다).
// 키·토큰은 시험용 가짜 값이다. 오류·결과에 이 값들이 새지 않는지도 본다.

// ── 가짜 fetch ──

type Reply = (init: RequestInit | undefined) => Promise<Response>;
type Call = { url: string; init: RequestInit | undefined };

const jsonReply =
  (status: number, body: unknown): Reply =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json;charset=UTF-8" },
      }),
    );

const textReply =
  (status: number, text: string): Reply =>
  () =>
    Promise.resolve(new Response(text, { status, headers: { "content-type": "text/html" } }));

const rejectReply =
  (error: unknown): Reply =>
  () =>
    Promise.reject(error);

/** fetch 가 Promise 를 돌려주지 않고 그 자리에서 던진다. */
const throwSyncReply =
  (error: unknown): Reply =>
  () => {
    throw error;
  };

/** 헤더(상태)는 왔는데 본문을 읽는 중에 오류가 난다. */
const bodyErrorReply =
  (status: number, error: unknown): Reply =>
  () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        }),
        { status },
      ),
    );

/** 응답을 주지 않고 signal 이 끊을 때까지 기다린다. 끊기면 signal.reason 으로 reject 한다(fetch 와 같다). */
const hangUntilAbort: Reply = (init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

function fakeFetch(reply: Reply) {
  const calls: Call[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return reply(init);
  };
  return { fetch, calls };
}

// ── 오류 모양 ──

/** undici 의 연결 거부 모양. 메시지에 주소가 들어 있다. */
const refused = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:443"), {
      code: "ECONNREFUSED",
    }),
  });

/** AbortSignal.timeout 이 끊었을 때 fetch 가 던지는 모양. */
const timedOut = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const aborted = () => new DOMException("This operation was aborted", "AbortError");

// ── 값 ──

const REST_API_KEY = "fake-rest-api-key-0001";
const CLIENT_SECRET = "fake-client-secret-비밀-0002";
const ACCESS_TOKEN = "fake-access-token-0003";
const REFRESH_TOKEN = "fake-refresh-token-리프레시-0004";
const NEW_ACCESS_TOKEN = "fake-new-access-token-0005";
const NEW_REFRESH_TOKEN = "fake-new-refresh-token-0006";
const AUTH_CODE = "fake-authorization-code-0007";
const REDIRECT_URI = "http://localhost:3000/api/v1/me/kakao-notify/callback";
const STATE = "state-한글 &=?#값";
const NOW = new Date("2026-10-20T05:14:00.000Z");
const TIMEOUT_MS = 5000;
/** 응답 본문의 msg·error_description 자리. 결과·오류로 새면 안 된다. */
const LEAKY_TEXT = "LEAK-응답본문-비밀값";

const MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded;charset=utf-8";

const TEMPLATE: KakaoFeedTemplate = {
  object_type: "feed",
  content: {
    title: "2026년 가상시청 통합 민원 플랫폼 고도화 사업 & 유지보수 (가상)",
    description: "BID 권고 · 필수 자격 충족",
    link: {
      web_url: "https://sol-radar.example/bids/7c9e6679",
      mobile_web_url: "https://sol-radar.example/bids/7c9e6679",
    },
  },
  item_content: {
    items: [
      { item: "발주처", item_op: "가상시청" },
      { item: "마감", item_op: "10-30(금) 18:00 · D-10" },
    ],
  },
  buttons: [
    {
      title: "분석 보기",
      link: {
        web_url: "https://sol-radar.example/bids/7c9e6679",
        mobile_web_url: "https://sol-radar.example/bids/7c9e6679",
      },
    },
  ],
};

const SECRET_VALUES = [
  REST_API_KEY,
  CLIENT_SECRET,
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  NEW_ACCESS_TOKEN,
  NEW_REFRESH_TOKEN,
  AUTH_CODE,
  LEAKY_TEXT,
  "10.0.0.5",
];

function apiWith(reply: Reply, timeoutMs = TIMEOUT_MS): { api: KakaoApi; calls: Call[] } {
  const fake = fakeFetch(reply);
  const api = createKakaoApi({
    fetch: fake.fetch,
    restApiKey: REST_API_KEY,
    clientSecret: CLIENT_SECRET,
    timeoutMs,
    now: () => NOW,
  });
  return { api, calls: fake.calls };
}

function only(calls: Call[]): Call {
  expect(calls).toHaveLength(1);
  return calls[0];
}

const headersOf = (call: Call): Headers => new Headers(call.init?.headers);

const formOf = (call: Call): Record<string, string> => {
  expect(typeof call.init?.body).toBe("string");
  return Object.fromEntries(new URLSearchParams(String(call.init?.body)));
};

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

/** 오류를 어떻게 문자열로 만들어도(로그·inspect·JSON) 키·토큰·응답 본문이 나오지 않는다. */
function expectNoSecrets(value: unknown): void {
  const renderings = [String(value), inspect(value, { depth: 5 }), JSON.stringify(value) ?? ""];
  if (value instanceof Error) renderings.push(value.stack ?? "", value.message);
  for (const text of renderings) {
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
  }
}

const kakaoError = (status: number, code: unknown) =>
  jsonReply(status, { msg: `${LEAKY_TEXT} msg`, code });

const tokenBody = (overrides: Record<string, unknown> = {}) => ({
  token_type: "bearer",
  access_token: NEW_ACCESS_TOKEN,
  expires_in: 43199,
  refresh_token: NEW_REFRESH_TOKEN,
  refresh_token_expires_in: 5183999,
  scope: "talk_message profile_nickname",
  ...overrides,
});

const oauthError = (status: number, error: string, errorCode = "KOE322") =>
  jsonReply(status, { error, error_description: `${LEAKY_TEXT} desc`, error_code: errorCode });

const after = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

// ── sendMemo: 요청 ──

describe("sendMemo · 요청", () => {
  it("나에게 보내기 기본 템플릿 주소로 POST 한 번 보낸다", async () => {
    const { api, calls } = apiWith(jsonReply(200, { result_code: 0 }));
    await api.sendMemo(ACCESS_TOKEN, TEMPLATE);
    const call = only(calls);
    expect(call.url).toBe(MEMO_URL);
    expect(call.init?.method).toBe("POST");
  });

  it("Authorization 은 Bearer <액세스 토큰>, Content-Type 은 form utf-8 이다", async () => {
    const { api, calls } = apiWith(jsonReply(200, { result_code: 0 }));
    await api.sendMemo(ACCESS_TOKEN, TEMPLATE);
    const headers = headersOf(only(calls));
    expect(headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers.get("content-type")).toBe(FORM_CONTENT_TYPE);
  });

  it("본문은 template_object=<JSON> 하나이고 URL 인코딩되어 있다", async () => {
    const { api, calls } = apiWith(jsonReply(200, { result_code: 0 }));
    await api.sendMemo(ACCESS_TOKEN, TEMPLATE);
    const call = only(calls);
    const form = formOf(call);
    expect(Object.keys(form)).toEqual(["template_object"]);
    expect(JSON.parse(form.template_object)).toEqual(TEMPLATE);
    // 원문 그대로가 아니라 인코딩된 글자다(& 가 본문을 쪼개지 않는다).
    expect(String(call.init?.body)).toMatch(/^template_object=/);
    expect(String(call.init?.body)).not.toContain("{");
    expect(String(call.init?.body)).not.toContain("가상시청");
  });

  it("deps.timeoutMs 로 AbortSignal.timeout 을 걸어 fetch 에 넘긴다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { api, calls } = apiWith(jsonReply(200, { result_code: 0 }), 4321);
    await api.sendMemo(ACCESS_TOKEN, TEMPLATE);
    expect(timeout).toHaveBeenCalledWith(4321);
    expect(only(calls).init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("리다이렉트를 따라가지 않는다(토큰·본문을 다른 곳으로 보내지 않는다)", async () => {
    const { api, calls } = apiWith(jsonReply(200, { result_code: 0 }));
    await api.sendMemo(ACCESS_TOKEN, TEMPLATE);
    expect(only(calls).init?.redirect).toBe("error");
  });
});

// ── sendMemo: 결과 분류 ──

describe("sendMemo · 성공", () => {
  it("200 이고 result_code 0 이면 SENT", async () => {
    const { api } = apiWith(jsonReply(200, { result_code: 0 }));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "SENT" });
  });

  it.each([
    ["result_code 가 0 이 아님", jsonReply(200, { result_code: 1 })],
    ["result_code 없음", jsonReply(200, {})],
    ["JSON 아님", textReply(200, "<html>ok</html>")],
    ["본문 읽기 중 timeout", bodyErrorReply(200, timedOut())],
  ])("200 인데 result_code 0 을 확인하지 못하면(%s) UNKNOWN_OUTCOME", async (_label, reply) => {
    const { api } = apiWith(reply);
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "UNKNOWN_OUTCOME" });
  });
});

describe("sendMemo · 토큰 무효", () => {
  it.each([
    ["401 / -401", kakaoError(401, -401)],
    ["401 본문 없음", textReply(401, "")],
    ["401 본문 읽기 실패", bodyErrorReply(401, timedOut())],
    ["400 / -401", kakaoError(400, -401)],
    ["403 / -402(동의 철회)", kakaoError(403, -402)],
  ])("%s → TOKEN_INVALID", async (_label, reply) => {
    const { api } = apiWith(reply);
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "TOKEN_INVALID" });
  });
});

describe("sendMemo · 다시 보낼 수 있는 실패", () => {
  it.each([500, 502, 503, 504])("%i → RETRYABLE HTTP_<상태>", async (status) => {
    const { api } = apiWith(kakaoError(status, -9798));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: `HTTP_${status}`,
    });
  });

  it("429 → RETRYABLE HTTP_429", async () => {
    const { api } = apiWith(textReply(429, ""));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "HTTP_429",
    });
  });

  it("5xx 는 본문을 읽다 끊겨도 RETRYABLE HTTP_<상태>", async () => {
    const { api } = apiWith(bodyErrorReply(503, timedOut()));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "HTTP_503",
    });
  });

  it.each([
    [-1, "KAKAO_-1"],
    [-7, "KAKAO_-7"],
  ])("400 / %i(서버 내부 오류·점검) → RETRYABLE %s", async (code, expected) => {
    const { api } = apiWith(kakaoError(400, code));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: expected,
    });
  });

  it("연결 실패(TypeError)는 RETRYABLE NETWORK", async () => {
    const { api } = apiWith(rejectReply(refused()));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "NETWORK",
    });
  });

  it("fetch 가 그 자리에서 던져도 RETRYABLE NETWORK 이고 sendMemo 는 던지지 않는다", async () => {
    const { api } = apiWith(throwSyncReply(new TypeError("Invalid URL")));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "NETWORK",
    });
  });
});

describe("sendMemo · 결과를 모르는 실패", () => {
  it("응답 헤더 전에 timeout 으로 끊기면 UNKNOWN_OUTCOME", async () => {
    const { api } = apiWith(rejectReply(timedOut()));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "UNKNOWN_OUTCOME" });
  });

  it("AbortError 로 끊겨도 UNKNOWN_OUTCOME", async () => {
    const { api } = apiWith(rejectReply(aborted()));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "UNKNOWN_OUTCOME" });
  });

  it("실제로 timeoutMs 가 지나면 끊고 UNKNOWN_OUTCOME", async () => {
    const { api } = apiWith(hangUntilAbort, 10);
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "UNKNOWN_OUTCOME" });
  });

  it("400 / -603(카카오 내부 처리 timeout) → UNKNOWN_OUTCOME", async () => {
    const { api } = apiWith(kakaoError(400, -603));
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "UNKNOWN_OUTCOME" });
  });
});

describe("sendMemo · 거절", () => {
  it.each([
    ["400 / -2(인자 오류·어뷰징 제한)", kakaoError(400, -2), "KAKAO_-2"],
    ["400 / -10(요청 횟수 초과)", kakaoError(400, -10), "KAKAO_-10"],
    ["400 / -532(하루 쿼터 초과)", kakaoError(400, -532), "KAKAO_-532"],
    ["403 / -3(앱에 talk_message 미설정)", kakaoError(403, -3), "KAKAO_-3"],
    ["403 본문 없음", textReply(403, ""), "HTTP_403"],
    ["400 JSON 아님", textReply(400, `<html>${LEAKY_TEXT}</html>`), "HTTP_400"],
    ["400 code 가 수가 아님", kakaoError(400, `${LEAKY_TEXT}`), "HTTP_400"],
    ["400 본문 읽기 실패", bodyErrorReply(400, timedOut()), "HTTP_400"],
    ["404", textReply(404, ""), "HTTP_404"],
  ])("%s → REJECTED %s", async (_label, reply, code) => {
    const { api } = apiWith(reply);
    expect(await api.sendMemo(ACCESS_TOKEN, TEMPLATE)).toEqual({ kind: "REJECTED", code });
  });
});

describe("sendMemo · 값이 새지 않는다", () => {
  it.each([
    ["거절", kakaoError(400, -2)],
    ["code 자리에 글자", kakaoError(400, LEAKY_TEXT)],
    ["토큰 무효", kakaoError(401, -401)],
    ["연결 실패", rejectReply(refused())],
  ])("%s 결과에 토큰·응답 본문·주소가 없다", async (_label, reply) => {
    const { api } = apiWith(reply);
    expectNoSecrets(await api.sendMemo(ACCESS_TOKEN, TEMPLATE));
  });
});

// ── 인가 주소 ──

describe("authorizeUrl", () => {
  it("kauth 인가 주소에 client_id·redirect_uri·response_type=code·scope=talk_message·state 를 싣는다", () => {
    const { api, calls } = apiWith(jsonReply(200, {}));
    const url = new URL(api.authorizeUrl({ redirectUri: REDIRECT_URI, state: STATE }));
    expect(`${url.origin}${url.pathname}`).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: REST_API_KEY,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "talk_message",
      state: STATE,
    });
    expect(calls).toEqual([]);
  });

  it("주소에 client_secret 이 없다", () => {
    const { api } = apiWith(jsonReply(200, {}));
    expect(api.authorizeUrl({ redirectUri: REDIRECT_URI, state: STATE })).not.toContain(
      CLIENT_SECRET,
    );
  });
});

// ── 토큰 받기 ──

describe("exchangeCode · 요청", () => {
  it("kauth 토큰 주소로 form POST 하고 Authorization 은 싣지 않는다", async () => {
    const { api, calls } = apiWith(jsonReply(200, tokenBody()));
    await api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI });
    const call = only(calls);
    expect(call.url).toBe(TOKEN_URL);
    expect(call.init?.method).toBe("POST");
    expect(headersOf(call).get("content-type")).toBe(FORM_CONTENT_TYPE);
    expect(headersOf(call).has("authorization")).toBe(false);
    expect(call.init?.redirect).toBe("error");
  });

  it("본문은 grant_type=authorization_code·client_id·client_secret·redirect_uri·code 다", async () => {
    const { api, calls } = apiWith(jsonReply(200, tokenBody()));
    await api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI });
    expect(formOf(only(calls))).toEqual({
      grant_type: "authorization_code",
      client_id: REST_API_KEY,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code: AUTH_CODE,
    });
  });

  it("deps.timeoutMs 로 AbortSignal.timeout 을 건다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { api } = apiWith(jsonReply(200, tokenBody()), 2468);
    await api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI });
    expect(timeout).toHaveBeenCalledWith(2468);
  });
});

describe("exchangeCode · 응답", () => {
  it("expires_in·refresh_token_expires_in(초)을 now 기준 시각으로, scope 를 공백으로 나눈 배열로 바꾼다", async () => {
    const { api } = apiWith(jsonReply(200, tokenBody()));
    expect(await api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI })).toEqual({
      accessToken: NEW_ACCESS_TOKEN,
      refreshToken: NEW_REFRESH_TOKEN,
      accessExpiresAt: after(43199),
      refreshExpiresAt: after(5183999),
      scopes: ["talk_message", "profile_nickname"],
    });
  });

  it("scope 가 없으면 빈 배열이다", async () => {
    const { api } = apiWith(jsonReply(200, tokenBody({ scope: undefined })));
    const tokens = await api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI });
    expect(tokens.scopes).toEqual([]);
  });

  it.each([
    ["access_token 없음", tokenBody({ access_token: undefined })],
    ["access_token 빈 글자", tokenBody({ access_token: "" })],
    ["expires_in 이 글자", tokenBody({ expires_in: "43199" })],
    ["expires_in 이 0", tokenBody({ expires_in: 0 })],
    ["refresh_token 없음", tokenBody({ refresh_token: undefined })],
    ["refresh_token_expires_in 없음", tokenBody({ refresh_token_expires_in: undefined })],
    ["scope 가 글자가 아님", tokenBody({ scope: ["talk_message"] })],
  ])("200 이어도 모양이 틀리면(%s) INVALID_RESPONSE 로 던진다", async (_label, body) => {
    const { api } = apiWith(jsonReply(200, body));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error).toBeInstanceOf(KakaoTokenError);
    expect(error.message).toBe("kakao token 오류: INVALID_RESPONSE");
  });

  it("200 인데 JSON 이 아니면 INVALID_RESPONSE 로 던진다", async () => {
    const { api } = apiWith(textReply(200, `<html>${NEW_ACCESS_TOKEN}</html>`));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: INVALID_RESPONSE");
    expectNoSecrets(error);
  });
});

describe("exchangeCode · 실패", () => {
  it("400 invalid_grant(인가 코드 재사용·만료)는 HTTP 상태·error·KOE 코드만 싣고 던진다", async () => {
    const { api } = apiWith(oauthError(400, "invalid_grant", "KOE320"));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error).toBeInstanceOf(KakaoTokenError);
    expect(error.name).toBe("KakaoTokenError");
    expect(error.message).toBe("kakao token 오류: HTTP_400 invalid_grant KOE320");
  });

  it("401 invalid_client(시크릿 오류)도 던진다", async () => {
    const { api } = apiWith(oauthError(401, "invalid_client", "KOE010"));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: HTTP_401 invalid_client KOE010");
  });

  it("error·error_code 가 코드 모양이 아니면 싣지 않는다", async () => {
    const { api } = apiWith(
      jsonReply(400, { error: `${LEAKY_TEXT} error`, error_code: `${LEAKY_TEXT}` }),
    );
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: HTTP_400");
  });

  it("500 은 HTTP_500 으로 던진다", async () => {
    const { api } = apiWith(textReply(500, LEAKY_TEXT));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: HTTP_500");
  });

  it.each([
    ["응답 전 timeout", rejectReply(timedOut())],
    ["본문 읽기 중 timeout", bodyErrorReply(200, timedOut())],
  ])("%s 는 TIMEOUT 으로 던진다", async (_label, reply) => {
    const { api } = apiWith(reply);
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: TIMEOUT");
  });

  it("연결 실패는 NETWORK 로 던진다", async () => {
    const { api } = apiWith(rejectReply(refused()));
    const error = await rejectionOf(
      api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("kakao token 오류: NETWORK");
  });

  it.each([
    ["400 invalid_grant", oauthError(400, "invalid_grant", "KOE320")],
    ["500", textReply(500, LEAKY_TEXT)],
    ["연결 실패", rejectReply(refused())],
    ["timeout", rejectReply(timedOut())],
  ])(
    "%s 오류를 어떻게 문자열로 만들어도 코드·키·시크릿·응답 본문이 없다",
    async (_label, reply) => {
      const { api } = apiWith(reply);
      const error = await rejectionOf(
        api.exchangeCode({ code: AUTH_CODE, redirectUri: REDIRECT_URI }),
      );
      expect(error.cause).toBeUndefined();
      expectNoSecrets(error);
    },
  );
});

// ── 토큰 갱신 ──

describe("refresh · 요청", () => {
  it("kauth 토큰 주소로 grant_type=refresh_token·client_id·client_secret·refresh_token 을 보낸다", async () => {
    const { api, calls } = apiWith(jsonReply(200, tokenBody()));
    await api.refresh(REFRESH_TOKEN);
    const call = only(calls);
    expect(call.url).toBe(TOKEN_URL);
    expect(call.init?.method).toBe("POST");
    expect(headersOf(call).get("content-type")).toBe(FORM_CONTENT_TYPE);
    expect(formOf(call)).toEqual({
      grant_type: "refresh_token",
      client_id: REST_API_KEY,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
    });
  });

  it("deps.timeoutMs 로 AbortSignal.timeout 을 건다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { api } = apiWith(jsonReply(200, tokenBody()), 1357);
    await api.refresh(REFRESH_TOKEN);
    expect(timeout).toHaveBeenCalledWith(1357);
  });
});

describe("refresh · 응답", () => {
  it("새 refresh_token 이 오면 그 값과 만료를 돌려준다", async () => {
    const { api } = apiWith(jsonReply(200, tokenBody()));
    expect(await api.refresh(REFRESH_TOKEN)).toEqual({
      accessToken: NEW_ACCESS_TOKEN,
      refreshToken: NEW_REFRESH_TOKEN,
      accessExpiresAt: after(43199),
      refreshExpiresAt: after(5183999),
      scopes: ["talk_message", "profile_nickname"],
    });
  });

  it("refresh_token 이 없으면 refreshToken·refreshExpiresAt 은 null 이고 scope 가 없으면 빈 배열이다", async () => {
    const { api } = apiWith(
      jsonReply(200, {
        token_type: "bearer",
        access_token: NEW_ACCESS_TOKEN,
        expires_in: 21599,
      }),
    );
    expect(await api.refresh(REFRESH_TOKEN)).toEqual({
      accessToken: NEW_ACCESS_TOKEN,
      refreshToken: null,
      accessExpiresAt: after(21599),
      refreshExpiresAt: null,
      scopes: [],
    });
  });

  it.each([
    ["access_token 없음", tokenBody({ access_token: undefined })],
    ["expires_in 없음", tokenBody({ expires_in: undefined })],
    ["refresh_token 만 있고 만료 없음", tokenBody({ refresh_token_expires_in: undefined })],
  ])("모양이 틀리면(%s) INVALID_RESPONSE 로 던진다", async (_label, body) => {
    const { api } = apiWith(jsonReply(200, body));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: INVALID_RESPONSE");
  });
});

describe("refresh · 실패", () => {
  it.each([400, 401])(
    "%i 이고 error=invalid_grant(리프레시 만료·연결 끊김)면 INVALID_GRANT",
    async (status) => {
      const { api } = apiWith(oauthError(status, "invalid_grant", "KOE322"));
      expect(await api.refresh(REFRESH_TOKEN)).toBe("INVALID_GRANT");
    },
  );

  it("400 이어도 invalid_grant 가 아니면(invalid_request) 던진다", async () => {
    const { api } = apiWith(oauthError(400, "invalid_request", "KOE319"));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: HTTP_400 invalid_request KOE319");
  });

  it("401 invalid_client 는 던진다(앱 설정 문제라 연결 만료가 아니다)", async () => {
    const { api } = apiWith(oauthError(401, "invalid_client", "KOE010"));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: HTTP_401 invalid_client KOE010");
  });

  it("5xx 는 본문이 invalid_grant 여도 INVALID_GRANT 가 아니라 HTTP_<상태> 로 던진다", async () => {
    const { api } = apiWith(oauthError(503, "invalid_grant"));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: HTTP_503 invalid_grant KOE322");
  });

  it("timeout 은 TIMEOUT 으로 던진다", async () => {
    const { api } = apiWith(rejectReply(timedOut()));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: TIMEOUT");
  });

  it("실제로 timeoutMs 가 지나면 끊고 TIMEOUT 으로 던진다", async () => {
    const { api } = apiWith(hangUntilAbort, 10);
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: TIMEOUT");
  });

  it("연결 실패는 NETWORK 로 던진다", async () => {
    const { api } = apiWith(rejectReply(refused()));
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("kakao token 오류: NETWORK");
  });

  it.each([
    ["invalid_request", oauthError(400, "invalid_request")],
    ["500", textReply(500, `${LEAKY_TEXT} ${NEW_REFRESH_TOKEN}`)],
    ["INVALID_RESPONSE", jsonReply(200, tokenBody({ expires_in: undefined }))],
  ])("%s 오류를 어떻게 문자열로 만들어도 토큰·시크릿·응답 본문이 없다", async (_label, reply) => {
    const { api } = apiWith(reply);
    const error = await rejectionOf(api.refresh(REFRESH_TOKEN));
    expect(error.cause).toBeUndefined();
    expectNoSecrets(error);
  });
});
