import "server-only";
import type { ConnectorFailure, ConnectorFailureKind } from "./connector.model";
import {
  G2B_GATEWAY_KEY_ERROR_CODES,
  G2B_RESPONSE_MAX_BYTES,
  looksLikeXml,
  parseG2bGatewayError,
  type G2bEnvelope,
} from "./g2b.model";
import { isDailyLimitExceeded } from "./quota";
import { redactSecrets, redactUrl } from "./redaction";

// ── 나라장터 요청 한 번의 공통 처리. 목록(OfficialApiConnector)과 보조 조회(G2bAuxFetcher)가 같이 쓴다 ──
// fetch·서비스키는 주입받는다(env 를 읽지 않는다). 서비스키가 쿼리로 나가므로 요청 URL 은 어디에도 남기지 않는다.
// redirect "error": 공공 API 는 리다이렉트하지 않는다. 따라가면 서비스키가 실린 요청이 다른 곳으로 간다(7-3).
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; redirect?: "error" },
) => Promise<Response>;

export type G2bFailed = { ok: false; failure: ConnectorFailure };
export type G2bEnvelopeResult =
  | {
      ok: true;
      items: Record<string, unknown>[];
      totalCount: number;
      rateLimitRemaining: number | null;
    }
  | G2bFailed;

export type G2bHttp = {
  /** URL 을 부르고 봉투까지 해석한다. 예상한 실패(429·5xx·결과 코드·키 오류)는 값으로 돌려준다 */
  fetchEnvelope(
    url: string,
    operation: string,
    parseEnvelope: (body: unknown) => G2bEnvelope,
  ): Promise<G2bEnvelopeResult>;
};

const GATEWAY_KEY_ERROR_CODES: ReadonlySet<string> = new Set(G2B_GATEWAY_KEY_ERROR_CODES);
const NON_NEGATIVE_INTEGER = /^\d+$/;

export function validateG2bTimeout(timeoutMs: number, who: string): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`${who}: timeoutMs 는 1 이상 정수여야 한다`);
  }
  return timeoutMs;
}

export const nonNegativeIntegerHeader = (value: string | null): number | null =>
  value !== null && NON_NEGATIVE_INTEGER.test(value) ? Number(value) : null;

const isTimeoutError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

const exceedsDeclaredLength = (contentLength: string | null): boolean =>
  contentLength !== null &&
  NON_NEGATIVE_INTEGER.test(contentLength.trim()) &&
  Number(contentLength.trim()) > G2B_RESPONSE_MAX_BYTES;

// 본문을 조각으로 받아 UTF-8 바이트를 센다. 상한을 넘으면 읽기를 끊고 null 을 돌려준다.
async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function gatewayFailureKind(code: string): ConnectorFailureKind {
  if (isDailyLimitExceeded(code)) return "QUOTA_EXCEEDED";
  if (GATEWAY_KEY_ERROR_CODES.has(code)) return "SERVICE_KEY_INVALID";
  return "RESULT_CODE";
}

// 429 응답의 본문은 쓰지 않는다. 연결을 돌려주려고 버리며, 버리다 난 오류는 결과에 영향이 없다.
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export function createG2bHttp(options: {
  serviceKey: string;
  fetch: FetchLike;
  timeoutMs: number;
}): G2bHttp {
  const { serviceKey, timeoutMs } = options;
  // 서버가 요청 값을 resultMsg 에 되돌려 주는 경우에도 키가 detail 로 나가지 않게 여기서 먼저 가린다.
  const redact = (text: string): string => redactSecrets(redactUrl(text), [serviceKey]);

  // detail 은 고정 문구 + 오퍼레이션 이름 + 결과 코드·상태만 담는다. 오류 객체의 message 는 URL 을 품을 수 있어 쓰지 않는다.
  const failed = (
    operation: string,
    fields: Omit<ConnectorFailure, "detail">,
    detail: string,
  ): G2bFailed => ({
    ok: false,
    failure: { ...fields, detail: `나라장터 ${operation} ${detail}` },
  });
  const timedOut = (operation: string): G2bFailed =>
    failed(operation, { kind: "TIMEOUT" }, "응답 시간 초과");
  const tooLarge = (operation: string, status: number): G2bFailed =>
    failed(operation, { kind: "HTTP_ERROR", status }, `응답이 너무 크다(HTTP ${status})`);

  async function request(
    url: string,
    operation: string,
  ): Promise<{ ok: true; response: Response } | G2bFailed> {
    try {
      const response = await options.fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      return { ok: true, response };
    } catch (error) {
      return isTimeoutError(error)
        ? timedOut(operation)
        : failed(operation, { kind: "HTTP_ERROR" }, "요청 실패(네트워크)");
    }
  }

  // 게이트웨이 키 오류는 2xx 가 아닌 상태로도 오므로 상태와 상관없이 본문을 읽는다. 받는 중에도 timeout 이 날 수 있다.
  // 7-3: 상한을 넘는 본문은 끝까지 받지 않는다. 받은 바이트가 넘는 순간 읽기를 멈춘다.
  async function readText(
    response: Response,
    operation: string,
  ): Promise<{ ok: true; text: string } | G2bFailed> {
    const status = response.status;
    try {
      const text = await readBoundedText(response, G2B_RESPONSE_MAX_BYTES);
      return text === null ? tooLarge(operation, status) : { ok: true, text };
    } catch (error) {
      return isTimeoutError(error)
        ? timedOut(operation)
        : failed(
            operation,
            { kind: "HTTP_ERROR", status },
            `응답 본문을 읽지 못했다(HTTP ${status})`,
          );
    }
  }

  // 5-A 분류: 코드 22 → 일일 한도, 30·31 → 키 오류, 그 밖 → 결과 코드. 코드를 못 읽으면 HTTP 오류다.
  function gatewayFailure(text: string, status: number, operation: string): G2bFailed {
    const gateway = parseG2bGatewayError(text);
    if (gateway === null) {
      return failed(
        operation,
        { kind: "HTTP_ERROR", status },
        `게이트웨이 응답을 해석하지 못했다(HTTP ${status})`,
      );
    }
    const code = gateway.returnReasonCode;
    const kind = gatewayFailureKind(code);
    // authMsg 형식에 맞는 키가 되돌아올 수도 있어 키를 한 번 더 가린다.
    const authMsg = gateway.returnAuthMsg === null ? "" : ` ${redact(gateway.returnAuthMsg)}`;
    return failed(operation, { kind, resultCode: code }, `게이트웨이 resultCode ${code}${authMsg}`);
  }

  function envelopeOutcome(
    text: string,
    status: number,
    operation: string,
    parseEnvelope: (body: unknown) => G2bEnvelope,
  ): G2bEnvelope | G2bFailed {
    try {
      return parseEnvelope(JSON.parse(text));
    } catch {
      return failed(
        operation,
        { kind: "HTTP_ERROR", status },
        `응답 본문이 JSON 이 아니다(HTTP ${status})`,
      );
    }
  }

  async function fetchEnvelope(
    url: string,
    operation: string,
    parseEnvelope: (body: unknown) => G2bEnvelope,
  ): Promise<G2bEnvelopeResult> {
    const requested = await request(url, operation);
    if (!requested.ok) return requested;
    const { response } = requested;
    const status = response.status;

    if (status === 429) {
      await discardBody(response);
      const retryAfterSec = nonNegativeIntegerHeader(response.headers.get("retry-after"));
      return failed(
        operation,
        { kind: "RATE_LIMITED", status, ...(retryAfterSec === null ? {} : { retryAfterSec }) },
        "호출 한도 초과(HTTP 429)",
      );
    }

    // 선언한 크기가 상한을 넘으면 본문을 읽지 않는다.
    if (exceedsDeclaredLength(response.headers.get("content-length"))) {
      await discardBody(response);
      return tooLarge(operation, status);
    }
    const read = await readText(response, operation);
    if (!read.ok) return read;
    // Content-Type 은 믿지 않는다. 키 오류 XML 이 application/json 으로 올 수도 있다.
    if (looksLikeXml(read.text)) return gatewayFailure(read.text, status, operation);
    if (!response.ok) return failed(operation, { kind: "HTTP_ERROR", status }, `HTTP ${status}`);

    const envelope = envelopeOutcome(read.text, status, operation, parseEnvelope);
    if ("failure" in envelope) return envelope;
    if (!envelope.ok && envelope.kind === "MALFORMED") {
      return failed(
        operation,
        { kind: "HTTP_ERROR", status },
        `응답 형식이 봉투가 아니다(HTTP ${status})`,
      );
    }
    if (!envelope.ok) {
      const kind = isDailyLimitExceeded(envelope.resultCode) ? "QUOTA_EXCEEDED" : "RESULT_CODE";
      return failed(
        operation,
        { kind, resultCode: envelope.resultCode },
        `resultCode ${envelope.resultCode}: ${redact(envelope.resultMsg)}`,
      );
    }
    return {
      ok: true,
      items: envelope.items,
      totalCount: envelope.totalCount,
      rateLimitRemaining: nonNegativeIntegerHeader(response.headers.get("x-ratelimit-remaining")),
    };
  }

  return { fetchEnvelope };
}
