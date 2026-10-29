import "server-only";
import type { ExternalSourceKey } from "./source-keys";
import type { FixtureRecord } from "./fixture.model";

// ── 07 §2 Connector 계약: 출처마다 페이지 하나를 받아 오는 방법만 다르고, 결과 모양은 같다 ──
export const CONNECTOR_TIMEOUT_MS = 15_000;

/**
 * 내부 HTTP 경계용. 실패는 송신 전에 반환하며 URL/키를 전달하지 않는다.
 * scope 는 같은 서비스 안의 기능(보조 조회 registryKey)이다. 일일 한도가 기능마다 따로라 따로 센다. 없으면 목록이다.
 */
export type BeforeApiRequest = (scope?: string) => Promise<ConnectorFailure | null>;
export type FetchPageInput = {
  from: string | null;
  to: string | null;
  cursor: string | null;
  beforeRequest?: BeforeApiRequest;
};

export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  retryAfterSec: number | null;
};

/** 나라장터 응답 행. 담당자 필드를 뺀 뒤에만 SourceRecord 에 담는다. */
export type G2bItem = Record<string, unknown>;

export type SourceRecord =
  | { kind: "fixture"; fixtureId: string; record: FixtureRecord }
  | { kind: "g2b-bid-notice"; item: G2bItem }
  | {
      kind: "external";
      sourceKey: ExternalSourceKey;
      item: Record<string, unknown>;
      companyId?: string;
      operation?: string;
    };

export type PageCapture = {
  serviceKey: string;
  operation: string;
  partitionKey: string;
  contentType: "application/json" | "application/xml";
  sanitizedPayload: string;
};
export type IngestCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";

export type FetchedPage = {
  completeness?: IngestCompleteness;
  capture?: PageCapture;
  records: SourceRecord[];
  nextCursor: string | null;
  rateLimitInfo: RateLimitInfo | null;
};

export const CONNECTOR_FAILURE_KINDS = [
  "RATE_LIMITED",
  "HTTP_ERROR",
  "RESULT_CODE",
  "QUOTA_EXCEEDED",
  "QUOTA_UNAVAILABLE",
  "TIMEOUT",
  "FIXTURE_INVALID",
  // data.go.kr 게이트웨이가 키를 거부했다(등록 안 됨·기한 만료). 다시 불러도 같아 재시도하지 않는다(5-A)
  "SERVICE_KEY_INVALID",
  "NOT_VERIFIED",
  "INVALID_INPUT",
] as const;
export type ConnectorFailureKind = (typeof CONNECTOR_FAILURE_KINDS)[number];

// detail 은 ingest_errors 로 간다. 서비스키·요청 URL·담당자 정보를 넣지 않는다.
export type ConnectorFailure = {
  kind: ConnectorFailureKind;
  status?: number;
  resultCode?: string;
  retryAfterSec?: number;
  detail: string;
  capture?: PageCapture;
};

// 예상한 실패(429·5xx·결과 코드 등)는 던지지 않고 값으로 돌려준다. 던지는 것은 프로그램 오류뿐이다.
export type FetchPageOutcome =
  { ok: true; page: FetchedPage } | { ok: false; failure: ConnectorFailure };

export type BidSourceConnector = {
  readonly source: "fixture" | "g2b" | "kwater" | "lh" | "kepco";
  fetchPage(input: FetchPageInput): Promise<FetchPageOutcome>;
};

const SERVER_ERROR_MIN_STATUS = 500;

/** 기다리면 나아질 수 있는 실패만 재시도한다. 4xx·결과 코드·한도 초과는 다시 불러도 같다. */
export function isRetryableFailure(failure: ConnectorFailure): boolean {
  switch (failure.kind) {
    case "RATE_LIMITED":
    case "TIMEOUT":
      return true;
    case "HTTP_ERROR":
      return failure.status !== undefined && failure.status >= SERVER_ERROR_MIN_STATUS;
    default:
      return false;
  }
}

// 04 §3.6 ingest_errors.error_code
const INGEST_ERROR_CODE: Readonly<Record<ConnectorFailureKind, string>> = {
  RATE_LIMITED: "RATE_LIMITED",
  HTTP_ERROR: "API_HTTP_ERROR",
  RESULT_CODE: "API_RESULT_CODE",
  QUOTA_EXCEEDED: "API_QUOTA_EXCEEDED",
  QUOTA_UNAVAILABLE: "QUOTA_STORE_UNAVAILABLE",
  TIMEOUT: "API_TIMEOUT",
  FIXTURE_INVALID: "SCHEMA_INVALID",
  SERVICE_KEY_INVALID: "API_SERVICE_KEY_INVALID",
  NOT_VERIFIED: "SOURCE_NOT_VERIFIED",
  INVALID_INPUT: "SOURCE_INPUT_INVALID",
};

export function ingestErrorCodeOf(failure: ConnectorFailure): string {
  return INGEST_ERROR_CODE[failure.kind];
}
