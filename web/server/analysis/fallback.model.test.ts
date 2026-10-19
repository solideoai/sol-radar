import { describe, expect, it } from "vitest";
import {
  pickAiUnavailableReason,
  toExplainOutcome,
  toExtractionOutcome,
  toKevOutcome,
  type AiUnavailableReason,
  type ExtractionOutcome,
  type KevOutcome,
} from "./fallback.model";
import type {
  ExplainResponse,
  ExtractResponse,
  GatewayFailure,
  GatewayResult,
  KevResponse,
} from "./gateway.model";

// ── 결과 만들기 ──

const ok = <T>(value: T): GatewayResult<T> => ({ ok: true, value, attempts: 1 });
const failed = <T>(failure: GatewayFailure, attempts = 1): GatewayResult<T> => ({
  ok: false,
  failure,
  attempts,
});

/** gateway 호출 실패의 모든 종류(03 §8 "worker → gateway 오류" 행). */
const failures: [string, GatewayFailure][] = [
  ["연결 거부", { kind: "UNREACHABLE", code: "ECONNREFUSED" }],
  ["timeout", { kind: "TIMEOUT" }],
  ["5xx 재시도 소진", { kind: "HTTP_ERROR", httpStatus: 500, errorCode: null }],
  ["503 AI_UNAVAILABLE", { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" }],
  ["4xx", { kind: "HTTP_ERROR", httpStatus: 422, errorCode: "KO_STATE_NOT_ALLOWED" }],
  ["INVALID_RESPONSE", { kind: "INVALID_RESPONSE", issues: ["status: invalid_value"] }],
  ["CIRCUIT_OPEN", { kind: "CIRCUIT_OPEN" }],
];

// ── 정상 본문 ──

const completedExtract: ExtractResponse = {
  status: "COMPLETED",
  payload: { schemaVersion: "req-extraction/v0.1", fields: [] },
  translations: null,
  errorCode: null,
  injectionSuspected: false,
  warnings: [],
  timings: { extractMs: 12 },
};

const failedExtract = (errorCode: ExtractResponse["errorCode"]): ExtractResponse => ({
  ...completedExtract,
  status: "FAILED",
  payload: null,
  errorCode,
});

const enabledKev: KevResponse = {
  kev: { enabled: true, provider: "mock", model: "mock" },
  stateHash: "b".repeat(64),
  requirements: null,
  wire: null,
  timings: { kevMs: 3 },
  errorCode: null,
};

/** 3b 통보: KEV_ENABLED=false 인 mock /kev 본문. */
const disabledKev = (errorCode: KevResponse["errorCode"]): KevResponse => ({
  kev: {
    enabled: false,
    provider: null,
    model: null,
    suggestedOption: null,
    disclaimer: "Kev 는 참고 지표이며 판정을 바꾸지 않습니다.",
  },
  stateHash: null,
  requirements: null,
  wire: null,
  timings: { kevMs: 0 },
  errorCode,
});

const explainBody = (fallback: boolean): ExplainResponse => ({
  text: "필수 자격을 모두 충족해 입찰을 권고합니다(점수 94).",
  usedNumbers: ["94"],
  fallback,
});

describe("toExtractionOutcome", () => {
  it("COMPLETED 는 추출을 쓴다", () => {
    expect(toExtractionOutcome(ok(completedExtract))).toEqual({
      kind: "EXTRACTED",
      response: completedExtract,
    });
  });

  it("PENDING_REVIEW 도 추출을 쓴다", () => {
    const response: ExtractResponse = { ...completedExtract, status: "PENDING_REVIEW" };
    expect(toExtractionOutcome(ok(response))).toEqual({ kind: "EXTRACTED", response });
  });

  it("FAILED 이고 errorCode 가 null 이면 EXTRACTION_FAILED", () => {
    expect(toExtractionOutcome(ok(failedExtract(null)))).toEqual({
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
    });
  });

  it("FAILED 이고 errorCode 가 QWEN_UNAVAILABLE 이면 QWEN_UNAVAILABLE", () => {
    expect(toExtractionOutcome(ok(failedExtract("QWEN_UNAVAILABLE")))).toEqual({
      kind: "UNAVAILABLE",
      reason: "QWEN_UNAVAILABLE",
    });
  });

  it("FAILED 이고 errorCode 가 EXTRACTION_FAILED 이면 EXTRACTION_FAILED", () => {
    expect(toExtractionOutcome(ok(failedExtract("EXTRACTION_FAILED")))).toEqual({
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
    });
  });

  it.each(failures)("호출 실패(%s)는 AI_UNAVAILABLE", (_label, failure) => {
    expect(toExtractionOutcome(failed(failure))).toEqual({
      kind: "UNAVAILABLE",
      reason: "AI_UNAVAILABLE",
    });
  });

  it("gateway_down 주입(HTTP 503 AI_UNAVAILABLE, 재시도 뒤)도 AI_UNAVAILABLE", () => {
    const result = failed<ExtractResponse>(
      { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" },
      2,
    );
    expect(toExtractionOutcome(result)).toEqual({ kind: "UNAVAILABLE", reason: "AI_UNAVAILABLE" });
  });
});

describe("toKevOutcome", () => {
  it.each(failures)("호출 실패(%s)는 GATEWAY_DOWN", (_label, failure) => {
    expect(toKevOutcome(failed(failure))).toEqual({ kind: "GATEWAY_DOWN" });
  });

  it("200 이고 kev.enabled=true 면 Kev 응답을 쓴다", () => {
    expect(toKevOutcome(ok(enabledKev))).toEqual({ kind: "USED", response: enabledKev });
  });

  it("200 이고 kev.enabled=true 면 errorCode 가 KEV_UNAVAILABLE 이어도 Kev 응답을 쓴다(설계 §6 결정 2)", () => {
    const partial: KevResponse = { ...enabledKev, errorCode: "KEV_UNAVAILABLE" };
    expect(toKevOutcome(ok(partial))).toEqual({ kind: "USED", response: partial });
  });

  it("200 이고 kev.enabled=false·errorCode KEV_UNAVAILABLE 이면 DISABLED 이고 kevUnavailable=true", () => {
    expect(toKevOutcome(ok(disabledKev("KEV_UNAVAILABLE")))).toEqual({
      kind: "DISABLED",
      kevUnavailable: true,
    });
  });

  it("200 이고 kev.enabled=false·errorCode null 이면 DISABLED 이고 kevUnavailable=false", () => {
    expect(toKevOutcome(ok(disabledKev(null)))).toEqual({
      kind: "DISABLED",
      kevUnavailable: false,
    });
  });
});

describe("toExplainOutcome", () => {
  it.each(failures)(
    "호출 실패(%s)는 규칙 엔진 템플릿(text null)으로 대체한다",
    (_label, failure) => {
      expect(toExplainOutcome(failed(failure))).toEqual({ kind: "TEMPLATE", text: null });
    },
  );

  it("200 이고 fallback=true(mock 기본)면 gateway 가 낸 템플릿 문장을 쓴다", () => {
    expect(toExplainOutcome(ok(explainBody(true)))).toEqual({
      kind: "TEMPLATE",
      text: "필수 자격을 모두 충족해 입찰을 권고합니다(점수 94).",
    });
  });

  it("200 이고 fallback=false 면 모델 문장과 쓴 숫자를 쓴다", () => {
    expect(toExplainOutcome(ok(explainBody(false)))).toEqual({
      kind: "MODEL_TEXT",
      text: "필수 자격을 모두 충족해 입찰을 권고합니다(점수 94).",
      usedNumbers: ["94"],
    });
  });
});

describe("pickAiUnavailableReason", () => {
  const extracted: ExtractionOutcome = { kind: "EXTRACTED", response: completedExtract };
  const extractionFailed = (reason: AiUnavailableReason): ExtractionOutcome => ({
    kind: "UNAVAILABLE",
    reason,
  });
  const kevUsed: KevOutcome = { kind: "USED", response: enabledKev };
  const kevDisabled = (kevUnavailable: boolean): KevOutcome => ({
    kind: "DISABLED",
    kevUnavailable,
  });
  const gatewayDown: KevOutcome = { kind: "GATEWAY_DOWN" };

  type Case = {
    name: string;
    extraction: ExtractionOutcome | null;
    cachedExtractionFailed: AiUnavailableReason | null;
    kev: KevOutcome | null;
    expected: AiUnavailableReason | null;
  };

  const cases: Case[] = [
    // 사유 없음
    {
      name: "아무 실패도 없으면 null",
      extraction: null,
      cachedExtractionFailed: null,
      kev: null,
      expected: null,
    },
    {
      name: "이번 run 추출과 Kev 를 모두 썼으면 null",
      extraction: extracted,
      cachedExtractionFailed: null,
      kev: kevUsed,
      expected: null,
    },
    {
      name: "Kev 가 KEV_UNAVAILABLE 로 DISABLED 여도 사유가 아니다",
      extraction: extracted,
      cachedExtractionFailed: null,
      kev: kevDisabled(true),
      expected: null,
    },
    {
      name: "Kev 가 사용 안 함으로 DISABLED 여도 사유가 아니다",
      extraction: null,
      cachedExtractionFailed: null,
      kev: kevDisabled(false),
      expected: null,
    },
    // 이번 run 의 gateway 불가
    {
      name: "이번 run /extract 가 gateway 불가면 AI_UNAVAILABLE",
      extraction: extractionFailed("AI_UNAVAILABLE"),
      cachedExtractionFailed: null,
      kev: null,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "캐시 추출을 쓰고 /kev 가 GATEWAY_DOWN 이면 AI_UNAVAILABLE",
      extraction: null,
      cachedExtractionFailed: null,
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "추출을 썼어도 /kev 가 GATEWAY_DOWN 이면 AI_UNAVAILABLE",
      extraction: extracted,
      cachedExtractionFailed: null,
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "gateway 불가가 이번 run 의 QWEN_UNAVAILABLE 보다 먼저다",
      extraction: extractionFailed("QWEN_UNAVAILABLE"),
      cachedExtractionFailed: null,
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "gateway 불가가 이번 run 의 EXTRACTION_FAILED 보다 먼저다",
      extraction: extractionFailed("EXTRACTION_FAILED"),
      cachedExtractionFailed: null,
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "gateway 불가가 캐시 행 실패 코드보다 먼저다(/kev GATEWAY_DOWN)",
      extraction: null,
      cachedExtractionFailed: "EXTRACTION_FAILED",
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
    {
      name: "gateway 불가가 캐시 행 실패 코드보다 먼저다(/extract AI_UNAVAILABLE)",
      extraction: extractionFailed("AI_UNAVAILABLE"),
      cachedExtractionFailed: "QWEN_UNAVAILABLE",
      kev: null,
      expected: "AI_UNAVAILABLE",
    },
    // 이번 run 추출 실패 코드
    {
      name: "이번 run 추출이 QWEN_UNAVAILABLE 이면 그 코드",
      extraction: extractionFailed("QWEN_UNAVAILABLE"),
      cachedExtractionFailed: null,
      kev: kevUsed,
      expected: "QWEN_UNAVAILABLE",
    },
    {
      name: "이번 run 추출이 EXTRACTION_FAILED 면 그 코드",
      extraction: extractionFailed("EXTRACTION_FAILED"),
      cachedExtractionFailed: null,
      kev: null,
      expected: "EXTRACTION_FAILED",
    },
    {
      name: "이번 run 추출 실패 코드가 캐시 행 실패 코드보다 먼저다",
      extraction: extractionFailed("QWEN_UNAVAILABLE"),
      cachedExtractionFailed: "EXTRACTION_FAILED",
      kev: null,
      expected: "QWEN_UNAVAILABLE",
    },
    {
      name: "이번 run 추출 실패에 Kev DISABLED 가 겹쳐도 추출 실패 코드",
      extraction: extractionFailed("EXTRACTION_FAILED"),
      cachedExtractionFailed: null,
      kev: kevDisabled(true),
      expected: "EXTRACTION_FAILED",
    },
    // 캐시 행 실패 코드
    {
      name: "캐시 행이 QWEN_UNAVAILABLE 로 실패였으면 그 코드",
      extraction: null,
      cachedExtractionFailed: "QWEN_UNAVAILABLE",
      kev: null,
      expected: "QWEN_UNAVAILABLE",
    },
    {
      name: "캐시 행이 EXTRACTION_FAILED 로 실패였으면 그 코드",
      extraction: null,
      cachedExtractionFailed: "EXTRACTION_FAILED",
      kev: kevUsed,
      expected: "EXTRACTION_FAILED",
    },
    {
      name: "캐시 행 실패에 Kev DISABLED 가 겹쳐도 캐시 행 코드",
      extraction: null,
      cachedExtractionFailed: "QWEN_UNAVAILABLE",
      kev: kevDisabled(true),
      expected: "QWEN_UNAVAILABLE",
    },
    // 설계 §6 결정 1: 캐시 행 코드는 이번 run 에 /extract 를 부르지 않았을 때만 본다
    {
      name: "캐시 행이 QWEN_UNAVAILABLE 이어도 이번 run 이 EXTRACTED 면 null",
      extraction: extracted,
      cachedExtractionFailed: "QWEN_UNAVAILABLE",
      kev: null,
      expected: null,
    },
    {
      name: "캐시 행이 EXTRACTION_FAILED 여도 이번 run 이 EXTRACTED 이고 Kev 를 썼으면 null",
      extraction: extracted,
      cachedExtractionFailed: "EXTRACTION_FAILED",
      kev: kevUsed,
      expected: null,
    },
    {
      name: "캐시 행이 실패여도 이번 run 이 EXTRACTED 이고 Kev 가 DISABLED 면 null",
      extraction: extracted,
      cachedExtractionFailed: "QWEN_UNAVAILABLE",
      kev: kevDisabled(true),
      expected: null,
    },
    {
      name: "이번 run 이 EXTRACTED 이고 캐시 행이 실패여도 /kev GATEWAY_DOWN 이면 AI_UNAVAILABLE",
      extraction: extracted,
      cachedExtractionFailed: "EXTRACTION_FAILED",
      kev: gatewayDown,
      expected: "AI_UNAVAILABLE",
    },
  ];

  for (const { name, extraction, cachedExtractionFailed, kev, expected } of cases) {
    it(name, () => {
      expect(pickAiUnavailableReason({ extraction, cachedExtractionFailed, kev })).toBe(expected);
    });
  }
});
