import "server-only";
import type { ConnectorFailure, FetchPageInput, RateLimitInfo } from "./connector.model";
import type { FetchLike } from "./g2b-http";

import type { ExternalSourceKey } from "./source-keys";
export { EXTERNAL_SOURCE_KEYS } from "./source-keys";
export type { ExternalSourceKey } from "./source-keys";
export type ExternalItem = Record<string, unknown>;
export type ExternalFailure = Omit<ConnectorFailure, "kind"> & {
  kind: ConnectorFailure["kind"] | "NOT_VERIFIED" | "INVALID_INPUT";
};
export type ExternalPage = {
  items: ExternalItem[];
  nextCursor: string | null;
  completeness: "COMPLETE" | "PARTIAL";
  contentType: "application/json" | "application/xml";
  /** Re-serialized parsed structure after credential/contact removal; never transport bytes. */
  sanitizedPayload: string;
  operation: string;
  partition: string;
  capturePartition: string;
  rateLimitInfo: RateLimitInfo | null;
};
export type ExternalFetchOutcome =
  { ok: true; page: ExternalPage } | { ok: false; failure: ExternalFailure };
export type ExternalConnector = {
  readonly sourceKey: ExternalSourceKey;
  fetchPage(input: FetchPageInput): Promise<ExternalFetchOutcome>;
};
export type ExternalConnectorOptions = {
  sourceKey: ExternalSourceKey;
  serviceKey: string;
  fetch: FetchLike;
  operation?: string;
  endpoint?: string;
  companyId?: string;
  requestId?: string;
  numOfRows?: number;
  timeoutMs?: number;
};

export const EXTERNAL_SERVICES = {
  "kwater-bid-notice": {
    family: "KWATER",
    serviceId: "15101635",
    endpoint: "https://apis.data.go.kr/B500001/ebid/tndr3",
    operation: "servcList",
    verifiedOperations: ["dmscptList"],
  },
  "lh-bid-notice": {
    family: "LH",
    serviceId: "15159012",
    endpoint: "https://apis.data.go.kr/B552555/OpenBidInfoList",
    operation: "getOpenBidInfo",
    verifiedOperations: ["getOpenBidInfo"],
  },
  "kwater-procurement-plan": {
    family: "KWATER",
    serviceId: "15102588",
    endpoint: "https://apis.data.go.kr/B500001/ebid/ordg2",
    operation: "servc",
    verifiedOperations: ["gds"],
  },
  "lh-pre-specification": {
    family: "LH",
    serviceId: "15159011",
    endpoint: "https://apis.data.go.kr/B552555/OpenAdvcinfoReqList",
    operation: "getOpenAdvcinfoReqList",
    verifiedOperations: ["getOpenAdvcinfoReqList"],
  },
  "g2b-procurement-request": {
    family: "G2B",
    serviceId: "15129468",
    endpoint: "https://apis.data.go.kr/1230000/ao/PrcrmntReqInfoService",
    operation: "getPrcrmntReqInfoListGnrlServc",
    verifiedOperations: ["getPrcrmntReqInfoListThngDetail"],
  },
  "kepco-ebid-contract": {
    family: "KEPCO",
    serviceId: "15148223",
    endpoint: "https://bigdata.kepco.co.kr/openapi/v1/electContract.do",
    operation: "electContract",
    verifiedOperations: ["electContract"],
  },
} as const;

/**
 * 응답이 빠짐없는지 확인할 방법이 없는 서비스. KEPCO 는 쪽 번호가 없고(90일 조각마다 한 번 부른다) 건수 상한·
 * 빠진 회사 범위가 검증되지 않아 모든 쪽이 PARTIAL 이다. 같은 창을 다시 받아도 COMPLETE 가 될 수 없으므로
 * 조각은 다음 조각으로 넘어가고(external-api-connector.ts), 정기 창도 다시 쓰지 않는다(worker/ingest-queue.ts).
 */
export const COVERAGE_UNVERIFIED_SOURCES: ReadonlySet<ExternalSourceKey> = new Set([
  "kepco-ebid-contract",
]);

export const KEPCO_COMPANIES: Readonly<Record<string, string>> = {
  COM01: "한국전력공사",
  COM02: "한국서부발전",
  COM03: "한국전력국제원자력대학원대학교",
  COM04: "한국남부발전",
  COM05: "한국중부발전",
  COM06: "한국남동발전",
  COM08: "한국동서발전",
  COM09: "한국전력기술",
  COM10: "한전KPS",
  COM11: "한국전력거래소",
  COM12: "한국원자력연료",
  COM14: "한국발전교육원",
  COM16: "한국해상풍력",
  COM19: "KAPES",
};
