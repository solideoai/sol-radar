import "server-only";
import {
  CONNECTOR_TIMEOUT_MS,
  type BidSourceConnector,
  type FetchPageInput,
} from "./connector.model";
import {
  EXTERNAL_SERVICES,
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
        kind: "HTTP_ERROR" | "RATE_LIMITED",
        detail: string,
      ): ExternalFetchOutcome => ({
        ok: false,
        failure: { kind, status: response.status, detail },
      });
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
      const parsed = parseExternalPayload(text, [options.serviceKey]);
      if (!parsed.ok) {
        if (parsed.kind === "RESULT_CODE") {
          const kind =
            parsed.resultCode === "22"
              ? "QUOTA_EXCEEDED"
              : ["30", "31"].includes(parsed.resultCode ?? "")
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
        return failed("HTTP_ERROR", parsed.detail);
      }
      if (!response.ok) return failed("HTTP_ERROR", "HTTP_REQUEST_FAILED");
      const isKepco = options.sourceKey === "kepco-ebid-contract";
      const offset = (request.pageNo - 1) * request.numOfRows;
      const knownTotal = parsed.totalCount;
      const pageValid =
        knownTotal !== null &&
        parsed.successCodeVerified &&
        offset <= knownTotal &&
        parsed.items.length === Math.min(request.numOfRows, knownTotal - offset);
      const morePages = pageValid && offset + parsed.items.length < knownTotal;
      // KEPCO's response cap and omitted-company coverage have not been verified, even if a count happens to be returned.
      const complete = !isKepco && pageValid;
      const nextCursor = complete
        ? morePages
          ? `${request.sliceIndex}:${request.pageNo + 1}`
          : request.sliceIndex + 1 < request.sliceCount
            ? `${request.sliceIndex + 1}:1`
            : null
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
