import "server-only";
import {
  CONNECTOR_TIMEOUT_MS,
  type BidSourceConnector,
  type FetchPageInput,
} from "./connector.model";
import {
  COVERAGE_UNVERIFIED_SOURCES,
  EXTERNAL_SERVICES,
  NO_DATA_RESULT_CODES,
  authResultCodesOf,
  treatsHttpUnauthorizedAsAuth,
  type ExternalConnector,
  type ExternalConnectorOptions,
  type ExternalFetchOutcome,
} from "./external-connector.model";
import { buildExternalRequest } from "./external-request";
import { EXTERNAL_RESPONSE_MAX_BYTES, parseExternalPayload } from "./external-payload";

async function boundedText(response: Response): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > EXTERNAL_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
export function createExternalApiConnector(options: ExternalConnectorOptions): ExternalConnector {
  const timeoutMs = options.timeoutMs ?? CONNECTOR_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("ExternalApiConnector: timeout invalid");
  async function fetchPage(input: FetchPageInput): Promise<ExternalFetchOutcome> {
    const request = buildExternalRequest(options, input);
    if (!request.ok) return request;
    const capturePartition = `${request.partition}:${request.window.from}:${request.window.to}:page:${request.pageNo}`;
    try {
      const denied = await input.beforeRequest?.();
      if (denied) return { ok: false, failure: denied };
      const response = await options.fetch(request.url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      const failed = (
        kind: "HTTP_ERROR" | "RATE_LIMITED" | "SERVICE_KEY_INVALID",
        detail: string,
      ): ExternalFetchOutcome => ({
        ok: false,
        failure: { kind, status: response.status, detail },
      });
      // 결과 코드 없이 401·403 만 오면 키·승인·접속 허용 문제다. 정한 서비스(LH)만 인증 실패로 막는다.
      const unauthorized =
        treatsHttpUnauthorizedAsAuth(options.sourceKey) &&
        (response.status === 401 || response.status === 403);
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        return failed("RATE_LIMITED", "HTTP_RATE_LIMITED");
      }
      const length = response.headers.get("content-length");
      if (length !== null && /^\d+$/.test(length) && Number(length) > EXTERNAL_RESPONSE_MAX_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return failed("HTTP_ERROR", "RESPONSE_TOO_LARGE");
      }
      const text = await boundedText(response);
      if (text === null) return failed("HTTP_ERROR", "RESPONSE_TOO_LARGE");
      const parsed = parseExternalPayload(text, [options.serviceKey], {
        noDataCodes: NO_DATA_RESULT_CODES[options.sourceKey] ?? [],
      });
      if (!parsed.ok) {
        if (parsed.kind === "RESULT_CODE") {
          const kind =
            parsed.resultCode === "22"
              ? "QUOTA_EXCEEDED"
              : authResultCodesOf(options.sourceKey).includes(parsed.resultCode ?? "")
                ? "SERVICE_KEY_INVALID"
                : "RESULT_CODE";
          return {
            ok: false,
            failure: {
              kind,
              resultCode: parsed.resultCode,
              detail: parsed.detail,
              ...(parsed.evidence === undefined
                ? {}
                : {
                    capture: {
                      ...parsed.evidence,
                      serviceKey: options.sourceKey,
                      operation: request.operation,
                      partitionKey: capturePartition,
                    },
                  }),
            },
          };
        }
        return unauthorized
          ? failed("SERVICE_KEY_INVALID", "HTTP_UNAUTHORIZED")
          : failed("HTTP_ERROR", parsed.detail);
      }
      if (unauthorized) return failed("SERVICE_KEY_INVALID", "HTTP_UNAUTHORIZED");
      if (!response.ok) return failed("HTTP_ERROR", "HTTP_REQUEST_FAILED");
      const coverageUnverified = COVERAGE_UNVERIFIED_SOURCES.has(options.sourceKey);
      const offset = (request.pageNo - 1) * request.numOfRows;
      const knownTotal = parsed.totalCount;
      const pageValid =
        knownTotal !== null &&
        parsed.successCodeVerified &&
        offset <= knownTotal &&
        parsed.items.length === Math.min(request.numOfRows, knownTotal - offset);
      const morePages = pageValid && offset + parsed.items.length < knownTotal;
      // KEPCO's response cap and omitted-company coverage have not been verified, even if a count happens to be returned.
      const complete = !coverageUnverified && pageValid;
      const nextSlice =
        request.sliceIndex + 1 < request.sliceCount ? `${request.sliceIndex + 1}:1` : null;
      // 확인할 수 없는 서비스(KEPCO)는 PARTIAL 이어도 다음 날짜 조각으로 넘어간다. 조각은 서로 겹치지 않아
      // 넘어가도 다시 받으면 채울 수 있는 구간을 버리지 않는다. 잘린 쪽(그 밖의 PARTIAL)은 cursor 를 주지 않는다.
      const nextCursor = complete
        ? morePages
          ? `${request.sliceIndex}:${request.pageNo + 1}`
          : nextSlice
        : coverageUnverified
          ? nextSlice
          : null;
      return {
        ok: true,
        page: {
          items: parsed.items,
          nextCursor,
          completeness: complete ? "COMPLETE" : "PARTIAL",
          contentType: parsed.contentType,
          sanitizedPayload: parsed.sanitizedPayload,
          operation: request.operation,
          partition: request.partition,
          capturePartition,
          rateLimitInfo: null,
        },
      };
    } catch (error) {
      const isTimeout =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return {
        ok: false,
        failure: {
          kind: isTimeout ? "TIMEOUT" : "HTTP_ERROR",
          detail: isTimeout ? "REQUEST_TIMEOUT" : "REQUEST_OR_RESPONSE_FAILED",
        },
      };
    }
  }
  return { sourceKey: options.sourceKey, fetchPage };
}

export function createExternalSourceConnector(
  options: ExternalConnectorOptions,
): BidSourceConnector {
  const connector = createExternalApiConnector(options);
  const source = EXTERNAL_SERVICES[options.sourceKey].family.toLowerCase();
  if (source !== "g2b" && source !== "kwater" && source !== "lh" && source !== "kepco")
    throw new Error("external source family invalid");
  return {
    source,
    async fetchPage(input) {
      const outcome = await connector.fetchPage(input);
      if (!outcome.ok) return outcome;
      const page = outcome.page;
      return {
        ok: true,
        page: {
          records: page.items.map((item) => ({
            kind: "external" as const,
            sourceKey: options.sourceKey,
            item,
            companyId: options.companyId,
            operation: page.operation,
          })),
          nextCursor: page.nextCursor,
          rateLimitInfo: page.rateLimitInfo,
          completeness: page.completeness,
          capture: {
            serviceKey: options.sourceKey,
            operation: page.operation,
            partitionKey: page.capturePartition,
            contentType: page.contentType,
            sanitizedPayload: page.sanitizedPayload,
          },
        },
      };
    },
  };
}
