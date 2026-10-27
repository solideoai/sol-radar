import "server-only";
import type { z } from "zod";
import { admit, INITIAL_BREAKER, record, type BreakerState } from "./circuit-breaker.model";
import {
  classifyFetchError,
  explainResponseSchema,
  extractResponseSchema,
  healthResponseSchema,
  isAvailabilityFailure,
  isRetryable,
  kevResponseSchema,
  readErrorCode,
  toIssueList,
  type ExplainResponse,
  type ExtractRequest,
  type ExtractResponse,
  type GatewayConfig,
  type GatewayFailure,
  type GatewayHealth,
  type GatewayRequestBody,
  type GatewayResult,
  type KevResponse,
  type ParseClientConfig,
  type ParseResponse,
  parseResponseSchema,
} from "./gateway.model";

// ── AI gateway HTTP 클라이언트: timeout·1회 재시도·circuit breaker·응답 검증 (02 장애 원칙, 03 §2.1·§8) ──
// 예상한 실패는 던지지 않고 결과 값으로 돌려준다. 로그는 남기지 않는다(호출자 몫).
// 오류 메시지·URL·본문은 결과에 싣지 않는다. 주소나 공고 원문이 로그로 새지 않게 한다.

export type GatewayClientDeps = {
  fetch: typeof fetch;
  /** breaker 시각. 시험이 고정할 수 있게 주입받는다. */
  now: () => number;
};

export type GatewayClient = {
  health(): Promise<GatewayResult<GatewayHealth>>;
  extract(request: ExtractRequest): Promise<GatewayResult<ExtractResponse>>;
  kev(request: GatewayRequestBody): Promise<GatewayResult<KevResponse>>;
  explain(request: GatewayRequestBody): Promise<GatewayResult<ExplainResponse>>;
  /** 관측·시험용. */
  breakerState(): BreakerState;
};

type Endpoint<T> = {
  path: string;
  timeoutMs: number;
  schema: z.ZodType<T>;
  /** 없으면 GET, 있으면 JSON 본문의 POST. */
  body?: GatewayRequestBody;
};

/** 보낼 요청. init 은 시도마다 부른다(시도마다 새 timeout signal). */
type Call<T> = { url: string; init: () => RequestInit; schema: z.ZodType<T> };

type Attempt<T> = { ok: true; value: T } | { ok: false; failure: GatewayFailure };

/** 시도마다 새 signal 을 건다. 재시도가 첫 시도의 남은 시간을 물려받지 않게 한다. */
function toRequestInit(timeoutMs: number, body: GatewayRequestBody | undefined): RequestInit {
  const signal = AbortSignal.timeout(timeoutMs);
  // 내부 gateway 는 리다이렉트하지 않는다. 따라가면 엉뚱한 곳으로 공고 본문을 보낼 수 있다.
  const redirect = "error";
  if (!body) return { method: "GET", signal, redirect };
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": body.requestId },
    body: JSON.stringify(body),
    signal,
    redirect,
  };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * gateway 하나의 호출기: 1회 재시도·circuit breaker·응답 검증. 클라이언트 인스턴스마다 breaker 를 따로 든다.
 * 분석 클라이언트(createGatewayClient)와 문서 파싱 클라이언트(createParseClient)가 같은 규칙으로 부른다.
 */
function createCaller(deps: Partial<GatewayClientDeps>) {
  // 부를 때 globalThis.fetch 를 찾는다. 만든 뒤 바뀐 fetch(시험의 stub 등)도 따르고 this 를 잃지 않는다.
  const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  let breaker: BreakerState = INITIAL_BREAKER;

  async function attemptOnce<T>(request: Call<T>): Promise<Attempt<T>> {
    try {
      const response = await fetchImpl(request.url, request.init());
      // 본문 읽기도 같은 signal 아래라 여기서 나는 timeout 은 catch 에서 TIMEOUT 으로 분류된다.
      const text = await response.text();
      const json = parseJson(text);
      if (response.status !== 200) {
        const errorCode = json.ok ? readErrorCode(json.value) : null;
        return {
          ok: false,
          failure: { kind: "HTTP_ERROR", httpStatus: response.status, errorCode },
        };
      }
      if (!json.ok) {
        return {
          ok: false,
          failure: { kind: "INVALID_RESPONSE", issues: ["(root): invalid_json"] },
        };
      }
      const parsed = request.schema.safeParse(json.value);
      if (!parsed.success) {
        return {
          ok: false,
          failure: { kind: "INVALID_RESPONSE", issues: toIssueList(parsed.error) },
        };
      }
      return { ok: true, value: parsed.data };
    } catch (error) {
      // fetch 주입 함수가 동기로 던져도 여기로 온다.
      return { ok: false, failure: classifyFetchError(error) };
    }
  }

  async function call<T>(request: Call<T>): Promise<GatewayResult<T>> {
    // 허용 판단과 상태 전이를 await 전에 끝낸다. 시험 요청이 나가 있는 동안 들어온 호출이 HALF_OPEN 을 보고 거부되게 한다.
    const admission = admit(breaker, now());
    breaker = admission.state;
    if (!admission.allowed) return { ok: false, failure: { kind: "CIRCUIT_OPEN" }, attempts: 0 };

    const first = await attemptOnce(request);
    const retried = !first.ok && isRetryable(first.failure);
    // 재시도는 한 번뿐이고 기다리지 않는다. 두 번째 결과가 최종이다.
    const final = retried ? await attemptOnce(request) : first;
    const attempts = retried ? 2 : 1;

    const isDown = !final.ok && isAvailabilityFailure(final.failure);
    breaker = record(breaker, isDown ? "failure" : "success", now());

    return final.ok
      ? { ok: true, value: final.value, attempts }
      : { ok: false, failure: final.failure, attempts };
  }

  return { call, breakerState: () => breaker };
}

export function createGatewayClient(
  config: GatewayConfig,
  deps: Partial<GatewayClientDeps> = {},
): GatewayClient {
  // breaker 는 gateway 하나의 생사를 보므로 네 엔드포인트가 함께 쓴다. 인스턴스마다 따로다.
  const caller = createCaller(deps);
  const call = <T>(endpoint: Endpoint<T>): Promise<GatewayResult<T>> =>
    caller.call({
      url: `${config.baseUrl}${endpoint.path}`,
      init: () => toRequestInit(endpoint.timeoutMs, endpoint.body),
      schema: endpoint.schema,
    });

  return {
    health: () =>
      call({ path: "/health", timeoutMs: config.healthTimeoutMs, schema: healthResponseSchema }),
    extract: (request) =>
      call({
        path: "/extract",
        timeoutMs: config.extractTimeoutMs,
        schema: extractResponseSchema,
        body: request,
      }),
    kev: (request) =>
      call({
        path: "/kev",
        timeoutMs: config.kevTimeoutMs,
        schema: kevResponseSchema,
        body: request,
      }),
    explain: (request) =>
      call({
        path: "/explain",
        timeoutMs: config.explainTimeoutMs,
        schema: explainResponseSchema,
        body: request,
      }),
    breakerState: caller.breakerState,
  };
}

export type ParseClient = {
  /** 원본 바이트를 그대로 보낸다(03 §10.1). gateway 는 형식을 매직 바이트로 판정하고 50 MB 를 넘으면 TOO_LARGE 다. */
  parse(input: { requestId: string; bytes: Uint8Array }): Promise<GatewayResult<ParseResponse>>;
  /** 관측·시험용. */
  breakerState(): BreakerState;
};

/**
 * 문서 파싱 클라이언트(documents worker). 분석 클라이언트와 같은 timeout·1회 재시도·circuit breaker 규칙이고,
 * breaker 는 이 인스턴스만의 것이다(documents worker 는 분석 엔드포인트를 부르지 않는다).
 */
export function createParseClient(
  config: ParseClientConfig,
  deps: Partial<GatewayClientDeps> = {},
): ParseClient {
  const caller = createCaller(deps);
  return {
    parse: ({ requestId, bytes }) =>
      caller.call({
        url: `${config.baseUrl}/parse`,
        init: () => ({
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-Request-Id": requestId },
          // 복사본을 보낸다. 재시도가 같은 바이트를 다시 읽을 수 있게 원본 버퍼를 넘기지 않는다.
          body: new Blob([new Uint8Array(bytes)]),
          signal: AbortSignal.timeout(config.parseTimeoutMs),
          // 내부 gateway 는 리다이렉트하지 않는다. 따라가면 엉뚱한 곳으로 첨부를 보낼 수 있다.
          redirect: "error",
        }),
        schema: parseResponseSchema,
      }),
    breakerState: caller.breakerState,
  };
}
