import type { IngestionRunView } from "@/server/ingestion";

// 수집 오류(errors[].errorCode)를 서랍의 무리로 나누는 표(N8 구현 계획 §4 D5). DTO 는 05 그대로라 종류 필드가 없다.
// 격리·경고 코드는 서버 web/server/ingestion/validation.ts 의 QUARANTINE_CODES·WARNING_CODES 와 같아야 한다
// (서버 모듈은 server-only 라 화면에서 가져올 수 없다. 같은지는 단위 시험이 고정한다).
// 중단 코드는 run 을 멈춘 원인이다. API_ 로 시작하는 코드(connector.model.ts 의 공공 API 실패)도 중단이다.
// 표에 없는 코드는 "기타"로 따로 보인다. 감추지 않는다.

export type IngestRunError = IngestionRunView["errors"][number];
export type IngestErrorKind = "FAILURE" | "QUARANTINE" | "WARNING" | "OTHER";

export const QUARANTINE_ERROR_CODES = ["MISSING_REQUIRED_FIELD", "SCHEMA_INVALID"] as const;
export const WARNING_ERROR_CODES = [
  "BUDGET_UNPARSED",
  "DATE_UNPARSED",
  "DATE_ORDER",
  "ENCODING_DEGRADED",
] as const;
export const FAILURE_ERROR_CODES = [
  "RUN_MODE_MISMATCH",
  "WINDOW_INVALID",
  "SEED_ANCHOR_MISSING",
  // 재시도를 다 쓴 뒤 run 을 멈추는 코드다(connector.model.ts).
  "RATE_LIMITED",
] as const;
export const FAILURE_ERROR_PREFIX = "API_";

const KIND_BY_CODE: ReadonlyMap<string, IngestErrorKind> = new Map([
  ...QUARANTINE_ERROR_CODES.map((code) => [code, "QUARANTINE"] as const),
  ...WARNING_ERROR_CODES.map((code) => [code, "WARNING"] as const),
  ...FAILURE_ERROR_CODES.map((code) => [code, "FAILURE"] as const),
]);

export function errorKindOf(code: string): IngestErrorKind {
  const kind = KIND_BY_CODE.get(code);
  if (kind !== undefined) return kind;
  return code.startsWith(FAILURE_ERROR_PREFIX) ? "FAILURE" : "OTHER";
}

// 스펙 §4.7 오류 코드 라벨(초안). 코드 글자는 화면에서 늘 라벨 옆에 함께 보인다.
const API_ERROR_LABEL = "공공 API 오류:";
const OTHER_ERROR_LABEL = "수집 오류";
const CODE_LABEL: ReadonlyMap<string, string> = new Map([
  ["MISSING_REQUIRED_FIELD", "필수 필드 누락"],
  ["SCHEMA_INVALID", "형식 오류"],
  ["BUDGET_UNPARSED", "예산을 읽지 못함"],
  ["DATE_UNPARSED", "날짜를 읽지 못함"],
  ["DATE_ORDER", "날짜 순서 이상"],
  ["ENCODING_DEGRADED", "글자 깨짐"],
  ["API_SERVICE_KEY_INVALID", "공공 API 서비스키 거부 (키 값은 보이지 않습니다)"],
  ["RATE_LIMITED", "요청 제한(429)이 계속되어 중단"],
  ["SEED_ANCHOR_MISSING", "SEED 수집 기록이 없어 LIVE 배치를 시작할 수 없음"],
  ["RUN_MODE_MISMATCH", "실행 모드와 소스가 맞지 않음"],
  ["WINDOW_INVALID", "수집 구간이 올바르지 않음"],
]);

/** 코드의 화면 라벨. 공공 API 오류는 19 §5 문구("공공 API 오류: {코드}")의 앞부분이다. */
export function errorCodeLabel(code: string): string {
  return (
    CODE_LABEL.get(code) ??
    (code.startsWith(FAILURE_ERROR_PREFIX) ? API_ERROR_LABEL : OTHER_ERROR_LABEL)
  );
}

export type GroupedErrors = Record<IngestErrorKind, IngestRunError[]>;

// 페이지 단위 실패는 run 을 멈춘 원인이다. 서버(ingestion.service.ts failRun)가 `<소스>:page:<커서>` 로 남긴다.
// fixture 파일 오류는 코드가 SCHEMA_INVALID(connector.model.ts)라 코드만 보면 격리로 잘못 보인다.
const PAGE_FAILURE_KEY = /^[a-z0-9]+:page:/;

/** 오류 한 줄의 종류. 페이지 단위 실패는 코드와 상관없이 중단이다 */
export function errorKindOfError(error: IngestRunError): IngestErrorKind {
  return PAGE_FAILURE_KEY.test(error.sourceKey) ? "FAILURE" : errorKindOf(error.errorCode);
}

/** errors 를 종류별로 나눈다. 무리 안의 순서는 서버가 준 순서 그대로다. */
export function groupErrorsByKind(errors: readonly IngestRunError[]): GroupedErrors {
  const groups: GroupedErrors = { FAILURE: [], QUARANTINE: [], WARNING: [], OTHER: [] };
  for (const error of errors) groups[errorKindOfError(error)].push(error);
  return groups;
}

/**
 * 실패한 run 의 대표 원인(상태 줄 "수집이 실패했습니다 · {라벨} {코드}"). 중단 코드가 먼저이고,
 * 없으면 분류하지 않은 오류의 첫 줄이다. 격리·경고는 run 을 멈추지 않으므로 고르지 않는다.
 */
export function primaryFailureOf(errors: readonly IngestRunError[]): IngestRunError | null {
  const groups = groupErrorsByKind(errors);
  return groups.FAILURE[0] ?? groups.OTHER[0] ?? null;
}
