import "server-only";
import { z } from "zod";
import {
  CONNECTOR_TIMEOUT_MS,
  type BidSourceConnector,
  type ConnectorFailure,
  type ConnectorFailureKind,
  type FetchPageInput,
  type FetchPageOutcome,
  type G2bItem,
  type RateLimitInfo,
  type SourceRecord,
} from "./connector.model";
import { DEFAULT_INFO_BIZ_FILTER } from "./g2b-filter";
import { buildG2bListUrl, splitG2bWindow, type G2bWindowSlice } from "./g2b-request";
import {
  G2B_API_HOST,
  G2B_BID_NOTICE_LIST_OPERATION,
  G2B_DEFAULT_ROWS,
  G2B_GATEWAY_KEY_ERROR_CODES,
  G2B_MAX_ROWS,
  G2B_RESPONSE_MAX_BYTES,
  looksLikeXml,
  parseG2bEnvelope,
  parseG2bGatewayError,
  stripContactFields,
  type G2bEnvelope,
} from "./g2b.model";
import { isDailyLimitExceeded } from "./quota";
import { redactSecrets, redactUrl } from "./redaction";

// ── OfficialApiConnector: 나라장터 입찰공고 목록(15129394 getBidPblancListInfoServc) ──
// fetch·서비스키는 주입받는다(env 를 읽지 않는다). 서비스키가 쿼리로 나가므로 요청 URL 은 어디에도 남기지 않는다.
// redirect "error": 공공 API 는 리다이렉트하지 않는다. 따라가면 서비스키가 실린 요청이 다른 곳으로 간다(7-3).
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; redirect?: "error" },
) => Promise<Response>;

export type OfficialApiConnectorOptions = {
  endpoint: string;
  serviceKey: string;
  fetch: FetchLike;
  numOfRows?: number;
  timeoutMs?: number;
  isInfoBizNotice?: (item: G2bItem) => boolean;
};

const OPERATION = G2B_BID_NOTICE_LIST_OPERATION;
const GATEWAY_KEY_ERROR_CODES: ReadonlySet<string> = new Set(G2B_GATEWAY_KEY_ERROR_CODES);
const CURSOR_PATTERN = /^(\d+):(\d+)$/;
const NON_NEGATIVE_INTEGER = /^\d+$/;
const isoInstantSchema = z.iso.datetime({ offset: true });
const emptyPage = (): FetchPageOutcome => ({
  ok: true,
  page: { records: [], nextCursor: null, rateLimitInfo: null },
});

type PageCursor = { sliceIndex: number; pageNo: number };
type Failed = { ok: false; failure: ConnectorFailure };
type RequestResult = { ok: true; response: Response } | Failed;
type TextResult = { ok: true; text: string } | Failed;

// 생성 오류 메시지에 받은 값을 넣지 않는다. endpoint·키가 로그로 새지 않게 한다.
function validateEndpoint(endpoint: string): string {
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  const isAllowed =
    url !== null &&
    url.protocol === "https:" &&
    url.hostname === G2B_API_HOST &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "";
  if (!isAllowed) {
    throw new Error(`OfficialApiConnector: endpoint 는 https://${G2B_API_HOST} 아래 경로여야 한다`);
  }
  return endpoint;
}

function validateNumOfRows(numOfRows: number): number {
  if (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > G2B_MAX_ROWS) {
    throw new Error(`OfficialApiConnector: numOfRows 는 1~${G2B_MAX_ROWS} 정수여야 한다`);
  }
  return numOfRows;
}

function validateTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("OfficialApiConnector: timeoutMs 는 1 이상 정수여야 한다");
  }
  return timeoutMs;
}

// 수집 창은 서비스가 run.params 에서 넘긴다. ISO 가 아니면 호출자의 프로그램 오류라 던진다.
function instantOf(value: string | null, name: "from" | "to"): Date {
  if (value === null || !isoInstantSchema.safeParse(value).success) {
    throw new Error(`OfficialApiConnector: ${name} 는 ISO 8601 시각이어야 한다`);
  }
  return new Date(Date.parse(value));
}

function cursorOf(cursor: string | null, sliceCount: number): PageCursor {
  if (cursor === null) return { sliceIndex: 0, pageNo: 1 };
  const match = CURSOR_PATTERN.exec(cursor);
  const sliceIndex = match ? Number(match[1]) : Number.NaN;
  const pageNo = match ? Number(match[2]) : Number.NaN;
  if (!(sliceIndex < sliceCount) || !(pageNo >= 1)) {
    throw new Error("OfficialApiConnector: cursor 는 '{조각}:{쪽}' 형식이고 범위 안이어야 한다");
  }
  return { sliceIndex, pageNo };
}

const nonNegativeIntegerHeader = (value: string | null): number | null =>
  value !== null && NON_NEGATIVE_INTEGER.test(value) ? Number(value) : null;

const isTimeoutError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

// detail 은 고정 문구 + 오퍼레이션 이름 + 결과 코드·상태만 담는다. 오류 객체의 message 는 URL 을 품을 수 있어 쓰지 않는다.
const failed = (fields: Omit<ConnectorFailure, "detail">, detail: string): Failed => ({
  ok: false,
  failure: { ...fields, detail: `나라장터 ${OPERATION} ${detail}` },
});

const timedOut = (): Failed => failed({ kind: "TIMEOUT" }, "응답 시간 초과");

const tooLarge = (status: number): Failed =>
  failed({ kind: "HTTP_ERROR", status }, `응답이 너무 크다(HTTP ${status})`);

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

function nextCursorOf(
  { sliceIndex, pageNo }: PageCursor,
  numOfRows: number,
  totalCount: number,
  sliceCount: number,
): string | null {
  if (pageNo * numOfRows < totalCount) return `${sliceIndex}:${pageNo + 1}`;
  return sliceIndex + 1 < sliceCount ? `${sliceIndex + 1}:1` : null;
}

export function createOfficialApiConnector(
  options: OfficialApiConnectorOptions,
): BidSourceConnector {
  const endpoint = validateEndpoint(options.endpoint);
  if (options.serviceKey.trim() === "") {
    throw new Error("OfficialApiConnector: serviceKey 가 비어 있다");
  }
  const serviceKey = options.serviceKey;
  const numOfRows = validateNumOfRows(options.numOfRows ?? G2B_DEFAULT_ROWS);
  const timeoutMs = validateTimeout(options.timeoutMs ?? CONNECTOR_TIMEOUT_MS);
  const isInfoBizNotice = options.isInfoBizNotice ?? DEFAULT_INFO_BIZ_FILTER;
  // 서버가 요청 값을 resultMsg 에 되돌려 주는 경우에도 키가 detail 로 나가지 않게 connector 에서 먼저 가린다.
  const redact = (text: string): string => redactSecrets(redactUrl(text), [serviceKey]);

  async function request(slice: G2bWindowSlice, pageNo: number): Promise<RequestResult> {
    const url = buildG2bListUrl({ endpoint, serviceKey, pageNo, numOfRows, slice });
    try {
      const response = await options.fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      return { ok: true, response };
    } catch (error) {
      return isTimeoutError(error)
        ? timedOut()
        : failed({ kind: "HTTP_ERROR" }, "요청 실패(네트워크)");
    }
  }

  // 게이트웨이 키 오류는 2xx 가 아닌 상태로도 오므로 상태와 상관없이 본문을 읽는다. 받는 중에도 timeout 이 날 수 있다.
  // 7-3: 상한을 넘는 본문은 끝까지 받지 않는다. 받은 바이트가 넘는 순간 읽기를 멈춘다.
  async function readText(response: Response): Promise<TextResult> {
    const status = response.status;
    try {
      const text = await readBoundedText(response, G2B_RESPONSE_MAX_BYTES);
      return text === null ? tooLarge(status) : { ok: true, text };
    } catch (error) {
      return isTimeoutError(error)
        ? timedOut()
        : failed({ kind: "HTTP_ERROR", status }, `응답 본문을 읽지 못했다(HTTP ${status})`);
    }
  }

  // 5-A 분류: 코드 22 → 일일 한도, 30·31 → 키 오류, 그 밖 → 결과 코드. 코드를 못 읽으면 HTTP 오류다.
  function gatewayFailure(text: string, status: number): Failed {
    const gateway = parseG2bGatewayError(text);
    if (gateway === null) {
      return failed(
        { kind: "HTTP_ERROR", status },
        `게이트웨이 응답을 해석하지 못했다(HTTP ${status})`,
      );
    }
    const code = gateway.returnReasonCode;
    const kind = gatewayFailureKind(code);
    // authMsg 형식에 맞는 키가 되돌아올 수도 있어 키를 한 번 더 가린다.
    const authMsg = gateway.returnAuthMsg === null ? "" : ` ${redact(gateway.returnAuthMsg)}`;
    return failed({ kind, resultCode: code }, `게이트웨이 resultCode ${code}${authMsg}`);
  }

  function envelopeOutcome(text: string, status: number): G2bEnvelope | Failed {
    try {
      return parseG2bEnvelope(JSON.parse(text));
    } catch {
      return failed({ kind: "HTTP_ERROR", status }, `응답 본문이 JSON 이 아니다(HTTP ${status})`);
    }
  }

  async function fetchPage(input: FetchPageInput): Promise<FetchPageOutcome> {
    const slices = splitG2bWindow(instantOf(input.from, "from"), instantOf(input.to, "to"));
    if (slices.length === 0) return emptyPage();
    const cursor = cursorOf(input.cursor, slices.length);

    const requested = await request(slices[cursor.sliceIndex], cursor.pageNo);
    if (!requested.ok) return requested;
    const { response } = requested;
    const status = response.status;

    if (status === 429) {
      await discardBody(response);
      const retryAfterSec = nonNegativeIntegerHeader(response.headers.get("retry-after"));
      return failed(
        { kind: "RATE_LIMITED", status, ...(retryAfterSec === null ? {} : { retryAfterSec }) },
        "호출 한도 초과(HTTP 429)",
      );
    }

    // 선언한 크기가 상한을 넘으면 본문을 읽지 않는다.
    if (exceedsDeclaredLength(response.headers.get("content-length"))) {
      await discardBody(response);
      return tooLarge(status);
    }
    const read = await readText(response);
    if (!read.ok) return read;
    // Content-Type 은 믿지 않는다. 키 오류 XML 이 application/json 으로 올 수도 있다.
    if (looksLikeXml(read.text)) return gatewayFailure(read.text, status);
    if (!response.ok) return failed({ kind: "HTTP_ERROR", status }, `HTTP ${status}`);

    const envelope = envelopeOutcome(read.text, status);
    if ("failure" in envelope) return envelope;
    if (!envelope.ok && envelope.kind === "MALFORMED") {
      return failed({ kind: "HTTP_ERROR", status }, `응답 형식이 봉투가 아니다(HTTP ${status})`);
    }
    if (!envelope.ok) {
      const kind = isDailyLimitExceeded(envelope.resultCode) ? "QUOTA_EXCEEDED" : "RESULT_CODE";
      return failed(
        { kind, resultCode: envelope.resultCode },
        `resultCode ${envelope.resultCode}: ${redact(envelope.resultMsg)}`,
      );
    }

    // 필터는 담당자 필드가 있는 원본 행으로 판정하고, 담는 것은 담당자 필드를 뺀 행이다.
    const records = envelope.items
      .filter((item) => isInfoBizNotice(item))
      .map((item): SourceRecord => ({ kind: "g2b-bid-notice", item: stripContactFields(item) }));
    const rateLimitInfo: RateLimitInfo = {
      limit: null,
      remaining: nonNegativeIntegerHeader(response.headers.get("x-ratelimit-remaining")),
      retryAfterSec: null,
    };
    return {
      ok: true,
      page: {
        records,
        nextCursor: nextCursorOf(cursor, numOfRows, envelope.totalCount, slices.length),
        rateLimitInfo,
      },
    };
  }

  return { source: "g2b", fetchPage };
}
