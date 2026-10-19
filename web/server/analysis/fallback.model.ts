import "server-only";
import {
  isAvailabilityFailure,
  type ExplainResponse,
  type ExtractResponse,
  type GatewayFailure,
  type GatewayResult,
  type KevResponse,
} from "./gateway.model";

// ── PARTIAL 대체 판단: gateway 결과를 규칙 엔진에 넘길 값으로 바꾸는 순수 규칙 (03 §2.1·§8, 02 장애 원칙) ──
// AI 가 죽어도 분석은 규칙만으로 끝난다. 여기서는 "무엇을 쓸 수 있고, PARTIAL 사유가 무엇인가"만 정한다.
// 문자열 값은 03 §8 의 오류 코드다. 규칙 엔진의 analyze 입력(aiUnavailableReason·kev)과의 타입 연결은 2단계에서 한다.
// 실패는 "gateway 가 응답했는가"로 나눈다(C5-B, ADR-030 B1, 03 §8). 응답하지 않았으면(전송 실패) AI_UNAVAILABLE 이고,
// 응답했지만 쓸 수 없으면 /extract 는 EXTRACTION_FAILED, /kev 는 Kev 만 불가(RULES_ONLY, 분석은 COMPLETED)다.
// 한 유형의 실패를 다른 유형으로 뭉뚱그리지 않는다(03 §8).

// ── 진단: 실패 종류와 issue 목록. worker 로그에만 싣고 DB 에 넣지 않는다 ──

/** gateway 가 응답하지 않았다. CIRCUIT_OPEN 은 요청을 보내지 않았다(앞서 gateway 가 죽었다고 판단했다). */
export type TransportFailureName = "UNREACHABLE" | "TIMEOUT" | "HTTP_5XX" | "CIRCUIT_OPEN";

/** gateway 가 응답했지만 쓸 수 없다. 200 이 아닌 4xx 밖의 상태(3xx 등)도 계약 밖 응답이라 INVALID_RESPONSE 로 본다. */
export type AnsweredFailureName = "HTTP_4XX" | "INVALID_RESPONSE";

/** Kev 만 못 쓰는 이유. WIRE_INVALID 는 200 응답의 wire 가 규칙 엔진의 kev 입력 스키마를 어긴 경우다. */
export type KevUnusableFailure = AnsweredFailureName | "WIRE_INVALID";

/** PAYLOAD_INVALID 는 /extract 200 응답의 payload 가 추출 스키마를 어긴 경우다. */
export type DiagnosticFailure = TransportFailureName | KevUnusableFailure | "PAYLOAD_INVALID";

/** issues 는 "경로: 코드"(zod toIssueList, 최대 10)뿐이다. 받은 값·오류 message·주소는 싣지 않는다. */
export type FailureDiagnostic = { failure: DiagnosticFailure; issues: string[] };

/** 전송 실패면 그 이름, 아니면 null. 1단계 isAvailabilityFailure(UNREACHABLE·TIMEOUT·5xx) + CIRCUIT_OPEN 이다. */
function transportFailureName(failure: GatewayFailure): TransportFailureName | null {
  if (failure.kind === "UNREACHABLE" || failure.kind === "TIMEOUT") return failure.kind;
  if (failure.kind === "CIRCUIT_OPEN") return failure.kind;
  return isAvailabilityFailure(failure) ? "HTTP_5XX" : null;
}

/** 응답했지만 쓸 수 없는 실패의 이름. 전송 실패가 아닌 것만 받는다. */
function answeredFailureName(failure: GatewayFailure): AnsweredFailureName {
  const isClientError =
    failure.kind === "HTTP_ERROR" && failure.httpStatus >= 400 && failure.httpStatus <= 499;
  return isClientError ? "HTTP_4XX" : "INVALID_RESPONSE";
}

/** 호출 실패 → 진단. issue 목록은 1단계 봉투 검증(INVALID_RESPONSE)에만 있다. 오류 코드 문자열은 싣지 않는다. */
export function toFailureDiagnostic(failure: GatewayFailure): FailureDiagnostic {
  return {
    failure: transportFailureName(failure) ?? answeredFailureName(failure),
    issues: failure.kind === "INVALID_RESPONSE" ? [...failure.issues] : [],
  };
}

export type AiUnavailableReason = "AI_UNAVAILABLE" | "EXTRACTION_FAILED" | "QWEN_UNAVAILABLE";

export type ExtractionOutcome =
  | { kind: "EXTRACTED"; response: ExtractResponse }
  | { kind: "UNAVAILABLE"; reason: AiUnavailableReason };

/**
 * /extract 결과 → 추출을 쓸 수 있는가. 전송 실패(503 AI_UNAVAILABLE 주입 포함)는 gateway 불가(AI_UNAVAILABLE)이고,
 * gateway 가 응답했지만 쓸 수 없으면(4xx·INVALID_RESPONSE) 추출 실패(EXTRACTION_FAILED)다(03 §8 :737).
 */
export function toExtractionOutcome(result: GatewayResult<ExtractResponse>): ExtractionOutcome {
  if (!result.ok) {
    const isTransport = transportFailureName(result.failure) !== null;
    return { kind: "UNAVAILABLE", reason: isTransport ? "AI_UNAVAILABLE" : "EXTRACTION_FAILED" };
  }
  const response = result.value;
  // gateway 가 코드 없이 FAILED 를 내면 추출 실패로 본다.
  if (response.status === "FAILED") {
    return { kind: "UNAVAILABLE", reason: response.errorCode ?? "EXTRACTION_FAILED" };
  }
  return { kind: "EXTRACTED", response };
}

export type KevOutcome =
  | { kind: "USED"; response: KevResponse }
  // gateway 는 정상이고 Kev 만 없다 → RULES_ONLY 지만 분석은 COMPLETED.
  | { kind: "DISABLED"; kevUnavailable: boolean }
  // gateway 는 응답했지만 그 응답을 쓸 수 없다 → Kev 만 불가(KEV_UNAVAILABLE)와 같다. RULES_ONLY, COMPLETED(03 §8 :595).
  | { kind: "UNUSABLE"; failure: KevUnusableFailure }
  // gateway 불가(전송 실패) → AI_UNAVAILABLE, PARTIAL.
  | { kind: "GATEWAY_DOWN" };

/**
 * /kev 결과 → Kev 사용 여부. 전송 실패는 GATEWAY_DOWN, 응답했지만 쓸 수 없으면(4xx·INVALID_RESPONSE) UNUSABLE 이다.
 * 200 응답의 wire 가 규칙 엔진 스키마를 어기는 경우(WIRE_INVALID)는 wire 를 읽는 호출자(analysis.service)가 UNUSABLE 로 바꾼다.
 * 200 이고 enabled=false 면 DISABLED 이고, KEV_UNAVAILABLE 은 errorCode 일 때만이다. enabled=true 면 errorCode 가 있어도(분할 일부 실패) 응답을 쓴다.
 */
export function toKevOutcome(result: GatewayResult<KevResponse>): KevOutcome {
  if (!result.ok) {
    return transportFailureName(result.failure) === null
      ? { kind: "UNUSABLE", failure: answeredFailureName(result.failure) }
      : { kind: "GATEWAY_DOWN" };
  }
  const response = result.value;
  if (response.kev.enabled) return { kind: "USED", response };
  return { kind: "DISABLED", kevUnavailable: response.errorCode === "KEV_UNAVAILABLE" };
}

export type ExplainOutcome =
  | { kind: "MODEL_TEXT"; text: string; usedNumbers: string[] }
  // text=null 이면 호출자가 규칙 엔진의 템플릿 설명을 쓴다.
  | { kind: "TEMPLATE"; text: string | null };

/** /explain 결과 → 설명 문장. 실패·시간 초과는 템플릿으로 대체하고 분석을 실패시키지 않는다(03 §2.1). */
export function toExplainOutcome(result: GatewayResult<ExplainResponse>): ExplainOutcome {
  if (!result.ok) return { kind: "TEMPLATE", text: null };
  const { text, usedNumbers, fallback } = result.value;
  // fallback=true 면 gateway 가 이미 템플릿 문장을 냈다.
  return fallback ? { kind: "TEMPLATE", text } : { kind: "MODEL_TEXT", text, usedNumbers };
}

/**
 * 분석 한 번의 AI 불가 사유 하나를 고른다. 없으면 null(COMPLETED 가능).
 * 우선순위: 이번 run 의 gateway 불가 → 이번 run 추출 실패 코드 → 캐시 행 실패 코드.
 * 캐시 행 코드는 이번 run 에 /extract 를 부르지 않았을 때(extraction=null)만 본다.
 * Kev DISABLED·UNUSABLE 은 사유가 아니다(gateway 가 응답했다). gateway 불가는 이번 run 의 전송 실패뿐이다.
 * /explain 실패도 PARTIAL 사유가 아니라 입력에 없다.
 */
export function pickAiUnavailableReason(input: {
  extraction: ExtractionOutcome | null;
  cachedExtractionFailed: AiUnavailableReason | null;
  kev: KevOutcome | null;
}): AiUnavailableReason | null {
  const { extraction, cachedExtractionFailed, kev } = input;
  const extractionReason = extraction?.kind === "UNAVAILABLE" ? extraction.reason : null;
  if (extractionReason === "AI_UNAVAILABLE" || kev?.kind === "GATEWAY_DOWN") {
    return "AI_UNAVAILABLE";
  }
  if (extractionReason !== null) return extractionReason;
  return extraction === null ? cachedExtractionFailed : null;
}
