import "server-only";
import type { FixtureRecord } from "./fixture.model";

// ── 07 §2 Connector 계약: 출처마다 페이지 하나를 받아 오는 방법만 다르고, 결과 모양은 같다 ──
export const CONNECTOR_TIMEOUT_MS = 15_000;

export type FetchPageInput = { from: string | null; to: string | null; cursor: string | null };

export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  retryAfterSec: number | null;
};

/** 나라장터 응답 행. 담당자 필드를 뺀 뒤에만 SourceRecord 에 담는다. */
export type G2bItem = Record<string, unknown>;

export type SourceRecord =
  | { kind: "fixture"; fixtureId: string; record: FixtureRecord }
  | { kind: "g2b-bid-notice"; item: G2bItem };

export type FetchedPage = {
  records: SourceRecord[];
  nextCursor: string | null;
  rateLimitInfo: RateLimitInfo | null;
};

export const CONNECTOR_FAILURE_KINDS = [
  "RATE_LIMITED",
  "HTTP_ERROR",
  "RESULT_CODE",
  "QUOTA_EXCEEDED",
  "TIMEOUT",
  "FIXTURE_INVALID",
] as const;
export type ConnectorFailureKind = (typeof CONNECTOR_FAILURE_KINDS)[number];

// detail 은 ingest_errors 로 간다. 서비스키·요청 URL·담당자 정보를 넣지 않는다.
export type ConnectorFailure = {
  kind: ConnectorFailureKind;
  status?: number;
  resultCode?: string;
  retryAfterSec?: number;
  detail: string;
};

// 예상한 실패(429·5xx·결과 코드 등)는 던지지 않고 값으로 돌려준다. 던지는 것은 프로그램 오류뿐이다.
export type FetchPageOutcome =
  { ok: true; page: FetchedPage } | { ok: false; failure: ConnectorFailure };

export type BidSourceConnector = {
  readonly source: "fixture" | "g2b";
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
  TIMEOUT: "API_TIMEOUT",
  FIXTURE_INVALID: "SCHEMA_INVALID",
};

export function ingestErrorCodeOf(failure: ConnectorFailure): string {
  return INGEST_ERROR_CODE[failure.kind];
}
