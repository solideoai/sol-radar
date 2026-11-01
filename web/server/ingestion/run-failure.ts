import "server-only";
import { ingestErrorCodeOf, type ConnectorFailure } from "./connector.model";

// ── run 실패 사유(11-01 정기 수집 실패 조사). ingest_runs.summary.failure 와 worker 결과 로그에 싣는다 ──
// 상세 문구는 ingest_errors 에 있다. 여기에는 고정 오류 코드·HTTP 상태·공급자 결과 코드만 둔다(키·URL·응답 본문 없음).

/** FAILED 로 닫은 run 의 첫 실패 사유 */
export type IngestRunFailure = {
  errorCode: string;
  httpStatus: number | null;
  resultCode: string | null;
};

const SAFE_RESULT_CODE = /^[A-Za-z0-9_-]{1,20}$/;

const isHttpStatus = (status: number | undefined): status is number =>
  status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599;

/**
 * errorCode 는 이 저장소가 정한 코드다. 공급자 결과 코드는 모양이 맞을 때만 싣는다
 * (summary 는 화면 RPC 로도 읽혀 공급자가 되돌린 값을 그대로 두지 않는다).
 */
export function ingestRunFailureOf(
  errorCode: string,
  failure?: Pick<ConnectorFailure, "status" | "resultCode">,
): IngestRunFailure {
  const resultCode = failure?.resultCode;
  return {
    errorCode,
    httpStatus: isHttpStatus(failure?.status) ? failure.status : null,
    resultCode: resultCode !== undefined && SAFE_RESULT_CODE.test(resultCode) ? resultCode : null,
  };
}

/** connector 실패를 ingest_errors 와 같은 오류 코드로 옮긴다 */
export const connectorRunFailure = (failure: ConnectorFailure): IngestRunFailure =>
  ingestRunFailureOf(ingestErrorCodeOf(failure), failure);
