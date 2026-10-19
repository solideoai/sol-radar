import "server-only";
import type { ExplainResponse, ExtractResponse, GatewayResult, KevResponse } from "./gateway.model";

// ── PARTIAL 대체 판단: gateway 결과를 규칙 엔진에 넘길 값으로 바꾸는 순수 규칙 (03 §2.1·§8, 02 장애 원칙) ──
// AI 가 죽어도 분석은 규칙만으로 끝난다. 여기서는 "무엇을 쓸 수 있고, PARTIAL 사유가 무엇인가"만 정한다.
// 문자열 값은 03 §8 의 오류 코드다. 규칙 엔진의 analyze 입력(aiUnavailableReason·kev)과의 타입 연결은 2단계에서 한다.

export type AiUnavailableReason = "AI_UNAVAILABLE" | "EXTRACTION_FAILED" | "QWEN_UNAVAILABLE";

export type ExtractionOutcome =
  | { kind: "EXTRACTED"; response: ExtractResponse }
  | { kind: "UNAVAILABLE"; reason: AiUnavailableReason };

/** /extract 결과 → 추출을 쓸 수 있는가. 호출 실패는 종류와 상관없이 gateway 불가로 본다(503 AI_UNAVAILABLE 주입 포함). */
export function toExtractionOutcome(result: GatewayResult<ExtractResponse>): ExtractionOutcome {
  if (!result.ok) return { kind: "UNAVAILABLE", reason: "AI_UNAVAILABLE" };
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
  // gateway 불가 → AI_UNAVAILABLE, PARTIAL.
  | { kind: "GATEWAY_DOWN" };

/**
 * /kev 결과 → Kev 사용 여부. 호출 실패(4xx·INVALID_RESPONSE 포함)는 쓸 수 있는 Kev 응답이 없으므로 GATEWAY_DOWN 이다.
 * KEV_UNAVAILABLE 은 200 + errorCode 일 때만이다. enabled=true 면 errorCode 가 있어도(분할 일부 실패) 응답을 쓴다.
 */
export function toKevOutcome(result: GatewayResult<KevResponse>): KevOutcome {
  if (!result.ok) return { kind: "GATEWAY_DOWN" };
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
 * Kev DISABLED 는 사유가 아니다. /explain 실패도 PARTIAL 사유가 아니라 입력에 없다.
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
