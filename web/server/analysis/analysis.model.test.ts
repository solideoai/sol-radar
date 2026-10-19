import { describe, expect, expectTypeOf, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  analyze,
  structuredRequirementSchema,
  type AnalysisResult,
  type EvidenceRef,
  type RequirementExtraction,
  type StructuredRequirement,
} from "@/server/scoring";
import {
  chooseExplanation,
  collectEvidence,
  extraReviewFlags,
  readCachedExtraction,
  readExtractResult,
  toExplainRequest,
  toExtractRequest,
  toExtractionRecord,
  toKevRequest,
  toKevWire,
  toIdempotencyKey,
  toKstDate,
  toModelMeta,
  withStructuredSeq,
  type AnalysisContext,
  type CachedExtraction,
  type DocumentIssue,
  type ExtractionRecord,
  type ExtraReviewFlag,
} from "./analysis.model";
import type { KevOutcome } from "./fallback.model";
import {
  extractRequestSchema,
  type ExtractResponse,
  type GatewayFailure,
  type GatewayResult,
  type KevResponse,
} from "./gateway.model";
import {
  EXTRACT_MS,
  KEV_MS,
  buildAnalysisInput,
  buildContext,
  cachedExtractionId,
  cachedRow,
  evidence,
  extractBody,
  extractFailedBody,
  keysDeep,
  kevUsedBody,
  loadExtraction,
  loadKevFixture,
  loadKevResponses,
  loadProfile,
  sourceFor,
  withPatch,
} from "./test-support";

// 분석 오케스트레이션의 순수 규칙. 저장·네트워크·시각에 닿지 않는다.
// C4 결과(AnalysisResult)는 실제 analyze 로 만든다. 흉내 낸 결과로 C4 계약을 가정하지 않는다.

const RULE_RESULT_KEYS = [
  "score",
  "recommendation",
  "qualificationChecks",
  "qualificationStatus",
  "reviewFlags",
  "factors",
];

const EXTRACTED_FIELDS = [
  "summary",
  "projectType",
  "domain",
  "requiredSkills",
  "preferredSkills",
  "qualifications",
  "pastPerformance",
  "staffing",
  "budgetKrw",
  "deadlineAt",
  "contractMethod",
  "restrictions",
  "submission",
] as const;

const documentIssue: DocumentIssue = {
  documentId: "FX-01-rfp",
  downloadStatus: "DOWNLOADED",
  parseStatus: "FAILED",
  errorCode: "PARSE_UNSUPPORTED",
};

/** Kev 를 쓴 C4 결과(FX-01, fixture wire). */
const resultWithKev = (): AnalysisResult => analyze(buildAnalysisInput("FX-01"));
/** Kev 를 쓰지 않은 C4 결과(FX-01). */
const resultWithoutKev = (): AnalysisResult => analyze(buildAnalysisInput("FX-01", { kev: null }));

/** 3b mock 모양(model "mock")의 wire 로 계산한 C4 결과. */
const resultWithMockModel = (): AnalysisResult => {
  const kev = loadKevFixture("FX-01");
  if (kev === null) throw new Error("fixtures/kev/FX-01.json 이 없다");
  return analyze(buildAnalysisInput("FX-01", { kev: { ...kev, model: "mock" } }));
};

/** 근거만 바꾼 C4 결과. 자격 검사·요소마다 근거 목록을 하나씩 준다. */
function withEvidence(checks: EvidenceRef[][], factors: EvidenceRef[][]): AnalysisResult {
  const base = resultWithKev();
  return withPatch(base, (draft) => {
    draft.qualificationChecks = checks.map((list, index) => ({
      ...base.qualificationChecks[0],
      id: `qualifications[${index}]`,
      evidence: list,
    }));
    draft.factors = factors.map((list) => ({ ...base.factors[0], evidence: list }));
  });
}

/** warnings·필드 note 를 바꾼 FX-01 추출. */
function extractionWith(patch: (draft: RequirementExtraction) => void): RequirementExtraction {
  return withPatch(loadExtraction("FX-01"), patch);
}

const okResult = <T>(value: T): GatewayResult<T> => ({ ok: true, value, attempts: 1 });
const failedResult = <T>(failure: GatewayFailure): GatewayResult<T> => ({
  ok: false,
  failure,
  attempts: 1,
});

/** gateway 호출 실패의 모든 종류(1단계 GatewayFailure). */
const transportFailures: [string, GatewayFailure][] = [
  ["연결 거부", { kind: "UNREACHABLE", code: "ECONNREFUSED" }],
  ["timeout", { kind: "TIMEOUT" }],
  ["503 AI_UNAVAILABLE", { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" }],
  ["422", { kind: "HTTP_ERROR", httpStatus: 422, errorCode: null }],
  ["INVALID_RESPONSE", { kind: "INVALID_RESPONSE", issues: ["status: invalid_value"] }],
  ["CIRCUIT_OPEN", { kind: "CIRCUIT_OPEN" }],
];

// ── K12 ──

describe("withStructuredSeq · 구조화 자격 행에 배열 index 로 seq 를 채운다(K12)", () => {
  const rows: Omit<StructuredRequirement, "seq">[] = [
    {
      kind: "PERMITTED_INDUSTRY",
      code: "1468",
      name: "소프트웨어사업자",
      value: { a: 1 },
      sourceOperation: "getBidPblancListInfoServcPPSSrch",
    },
    {
      kind: "LICENSE_LIMIT",
      code: null,
      name: "정보통신공사업",
      value: {},
      sourceOperation: "getBidPblancListInfoLicenseLimit",
    },
    {
      kind: "PARTICIPATION_REGION",
      code: "36",
      name: "세종",
      value: { region: "세종" },
      sourceOperation: "getBidPblancListPrtcptPsblRgn",
    },
  ];

  it("seq 는 0부터 배열 index 다", () => {
    expect(withStructuredSeq(rows).map((row) => row.seq)).toEqual([0, 1, 2]);
  });

  it("입력 순서와 나머지 필드를 바꾸지 않는다", () => {
    expect(withStructuredSeq(rows)).toEqual(rows.map((row, seq) => ({ ...row, seq })));
  });

  it("빈 목록은 빈 목록이다", () => {
    expect(withStructuredSeq([])).toEqual([]);
  });

  it("입력 행 객체를 변형하지 않는다", () => {
    const before = structuredClone(rows);
    withStructuredSeq(rows);
    expect(rows).toEqual(before);
  });

  it("결과 행은 C4 structuredRequirementSchema 를 통과한다", () => {
    for (const row of withStructuredSeq(rows)) {
      expect(structuredRequirementSchema.safeParse(row).success).toBe(true);
    }
  });
});

// ── score_runs.idempotency_key ──

describe("toIdempotencyKey · score_runs.idempotency_key(전역 UNIQUE)", () => {
  it('"<orgId>:<requestId>" 문자열을 돌려준다', () => {
    expect(toIdempotencyKey("4d1f0c2e-org", "req-1")).toBe("4d1f0c2e-org:req-1");
  });

  it("같은 requestId 라도 조직이 다르면 키가 다르다", () => {
    expect(toIdempotencyKey("org-a", "req-1")).not.toBe(toIdempotencyKey("org-b", "req-1"));
  });

  it("같은 조직이라도 requestId 가 다르면 키가 다르다", () => {
    expect(toIdempotencyKey("org-a", "req-1")).not.toBe(toIdempotencyKey("org-a", "req-2"));
  });
});

// ── config.today ──

describe("toKstDate · 시각 → KST 날짜(config.today)", () => {
  it("UTC 14:59:59 는 아직 같은 KST 날짜다", () => {
    expect(toKstDate(new Date("2026-10-16T14:59:59Z"))).toBe("2026-10-16");
  });

  it("UTC 15:00:00 은 KST 다음 날 0시다", () => {
    expect(toKstDate(new Date("2026-10-16T15:00:00Z"))).toBe("2026-10-17");
  });

  it("KST 0시 직전(UTC 전날 14:59:59.999)은 전날이다", () => {
    expect(toKstDate(new Date("2026-10-15T14:59:59.999Z"))).toBe("2026-10-15");
  });

  it("월말 KST 0시를 넘기면 다음 달 1일이다", () => {
    expect(toKstDate(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
  });

  it("연말 KST 0시를 넘기면 다음 해 1월 1일이다", () => {
    expect(toKstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });

  it("프로세스 시간대가 KST 가 아니어도 KST 날짜를 낸다", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(toKstDate(new Date("2026-10-16T15:00:00Z"))).toBe("2026-10-17");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

// ── 캐시 추출 ──

describe("readCachedExtraction · 캐시 행 → 쓸 수 있는 추출(못 쓰면 null = 다시 추출)", () => {
  const row = (overrides: Partial<CachedExtraction>): CachedExtraction => ({
    id: cachedExtractionId("FX-01"),
    status: "COMPLETED",
    payload: loadExtraction("FX-01"),
    translations: null,
    ...overrides,
  });

  it("캐시 행 타입은 id·status·payload·translations 이고 errorCode 가 없다(타입 시험)", () => {
    expectTypeOf<keyof CachedExtraction>().toEqualTypeOf<
      "id" | "status" | "payload" | "translations"
    >();
    expectTypeOf<CachedExtraction["id"]>().toEqualTypeOf<string>();
  });

  it("캐시 행이 없으면 null 이다", () => {
    expect(readCachedExtraction(null)).toBeNull();
  });

  it("FAILED 행(payload null)은 없는 것으로 보고 null 이다", () => {
    expect(readCachedExtraction(row({ status: "FAILED", payload: null }))).toBeNull();
  });

  it("FAILED 행은 payload 가 유효해도 쓰지 않는다", () => {
    expect(readCachedExtraction(row({ status: "FAILED" }))).toBeNull();
  });

  it("COMPLETED 이고 payload 가 스키마를 통과하면 그 추출을 돌려준다", () => {
    expect(readCachedExtraction(row({}))).toEqual(loadExtraction("FX-01"));
  });

  it("PENDING_REVIEW 이고 payload 가 스키마를 통과하면 그 추출을 돌려준다", () => {
    expect(readCachedExtraction(row({ status: "PENDING_REVIEW" }))).toEqual(
      loadExtraction("FX-01"),
    );
  });

  it("예산이 KRW 정수 문자열이 아니면('12억원') 고쳐 살리지 않고 null 이다", () => {
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.budgetKrw.value = "12억원";
    });
    expect(readCachedExtraction(row({ payload }))).toBeNull();
  });

  it("KNOWN 인데 근거가 없는 필드가 있으면 null 이다", () => {
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.summary.evidence = [];
    });
    expect(readCachedExtraction(row({ payload }))).toBeNull();
  });

  it("schemaVersion 이 다르면 null 이다", () => {
    const payload = { ...loadExtraction("FX-01"), schemaVersion: "requirement-extraction/v9" };
    expect(readCachedExtraction(row({ payload }))).toBeNull();
  });

  it("payload 가 null 이면 null 이다", () => {
    expect(readCachedExtraction(row({ payload: null }))).toBeNull();
  });

  it("payload 가 객체가 아니면 null 이다", () => {
    expect(readCachedExtraction(row({ payload: "{}" }))).toBeNull();
  });
});

// ── /extract 결과 ──

describe("readExtractResult · /extract 결과 → 쓸 수 있는 추출 또는 PARTIAL 사유", () => {
  it("200 COMPLETED·유효 payload → EXTRACTED 이고 추출과 응답 본문을 돌려준다", () => {
    const body = extractBody(loadExtraction("FX-01"));
    expect(readExtractResult(okResult(body))).toEqual({
      kind: "EXTRACTED",
      extraction: loadExtraction("FX-01"),
      response: body,
    });
  });

  it("200 PENDING_REVIEW·유효 payload → EXTRACTED 다", () => {
    const body = extractBody(loadExtraction("FX-01"), { status: "PENDING_REVIEW" });
    expect(readExtractResult(okResult(body))).toMatchObject({ kind: "EXTRACTED" });
  });

  it("200 COMPLETED 인데 payload 가 스키마 위반이면 EXTRACTION_FAILED 이고 response 는 null(저장하지 않는다)", () => {
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.budgetKrw.value = "12억원";
    });
    expect(readExtractResult(okResult(extractBody(payload)))).toEqual({
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
      response: null,
    });
  });

  it("200 FAILED·QWEN_UNAVAILABLE → QWEN_UNAVAILABLE 이고 response 는 그 본문(FAILED 행 저장용)", () => {
    const body = extractFailedBody("QWEN_UNAVAILABLE");
    expect(readExtractResult(okResult(body))).toEqual({
      kind: "UNAVAILABLE",
      reason: "QWEN_UNAVAILABLE",
      response: body,
    });
  });

  it("200 FAILED·errorCode null → EXTRACTION_FAILED 이고 response 는 그 본문", () => {
    const body = extractFailedBody(null);
    expect(readExtractResult(okResult(body))).toEqual({
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
      response: body,
    });
  });

  it("200 FAILED·EXTRACTION_FAILED → EXTRACTION_FAILED 다", () => {
    expect(readExtractResult(okResult(extractFailedBody("EXTRACTION_FAILED")))).toMatchObject({
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
    });
  });

  it.each(transportFailures)(
    "호출 실패(%s) → AI_UNAVAILABLE 이고 response 는 null 이다",
    (_name, failure) => {
      expect(readExtractResult(failedResult<ExtractResponse>(failure))).toEqual({
        kind: "UNAVAILABLE",
        reason: "AI_UNAVAILABLE",
        response: null,
      });
    },
  );
});

// ── 추출 저장 레코드 ──

describe("toExtractionRecord · /extract 성공 응답 → requirement_extractions 저장 레코드(성공 행만)", () => {
  /** 출처를 가르려고 세 번째 인자(검증한 추출)만 바꾼다. 응답 payload 는 fixture 원본 그대로다. */
  const record = (
    patchExtraction: (draft: RequirementExtraction) => void,
    responseOverrides: Partial<Omit<ExtractResponse, "payload">> = {},
    context: AnalysisContext = buildContext("FX-01"),
  ): ExtractionRecord =>
    toExtractionRecord(
      context,
      extractBody(loadExtraction("FX-01"), responseOverrides),
      extractionWith(patchExtraction),
    );

  it("FX-01 COMPLETED 응답이면 설계의 13필드를 채운다", () => {
    const extraction = loadExtraction("FX-01");
    const expected: ExtractionRecord = {
      bidId: "bid-FX-01",
      revisionId: "FX-01#01",
      provider: extraction.model.provider,
      modelName: extraction.model.name,
      promptVersion: extraction.model.promptVersion,
      promptHash: extraction.model.promptHash,
      schemaVersion: "requirement-extraction/v0.1",
      status: "COMPLETED",
      payload: extraction,
      translations: null,
      warnings: [],
      latencyMs: EXTRACT_MS,
      retries: extraction.model.retries,
    };
    expect(toExtractionRecord(buildContext("FX-01"), extractBody(extraction), extraction)).toEqual(
      expected,
    );
  });

  it("레코드 키는 설계의 13개뿐이다(requestId·errorCode·injectionSuspected·extractMs 는 없다)", () => {
    expect(Object.keys(record(() => {})).toSorted()).toEqual(
      [
        "bidId",
        "revisionId",
        "provider",
        "modelName",
        "promptVersion",
        "promptHash",
        "schemaVersion",
        "status",
        "payload",
        "translations",
        "warnings",
        "latencyMs",
        "retries",
      ].toSorted(),
    );
  });

  it.each(["COMPLETED", "PENDING_REVIEW"] as const)("status 는 응답의 status(%s)다", (status) => {
    expect(record(() => {}, { status }).status).toBe(status);
  });

  it("bidId 는 추출의 bidId 가 아니라 context.bidId 다", () => {
    expect(record(() => {}).bidId).toBe("bid-FX-01");
  });

  it("revisionId 는 추출의 revisionId 가 아니라 bid.revisionId 다", () => {
    const result = record((draft) => {
      draft.revisionId = "FX-01#99";
    });
    expect(result.revisionId).toBe("FX-01#01");
  });

  it("provider 는 context.aiProvider 가 아니라 추출의 model.provider 다", () => {
    const result = record(
      (draft) => {
        draft.model.provider = "hosted";
      },
      {},
      buildContext("FX-01", { aiProvider: "local" }),
    );
    expect(result.provider).toBe("hosted");
  });

  it("modelName·promptVersion·promptHash·retries 는 응답 payload 가 아니라 세 번째 인자(검증한 추출)의 model 이다", () => {
    const result = record((draft) => {
      draft.model.name = "qwen-test-model";
      draft.model.promptVersion = "req-extract/v9";
      draft.model.promptHash = "f".repeat(64);
      draft.model.retries = 1;
    });
    expect(result).toMatchObject({
      modelName: "qwen-test-model",
      promptVersion: "req-extract/v9",
      promptHash: "f".repeat(64),
      retries: 1,
    });
  });

  it("schemaVersion 은 추출의 schemaVersion 이다", () => {
    expect(record(() => {}).schemaVersion).toBe("requirement-extraction/v0.1");
  });

  it("payload 는 응답의 payload 가 아니라 세 번째 인자(검증한 추출)다", () => {
    const patch = (draft: RequirementExtraction) => {
      draft.summary.value = "검증한 추출의 요약";
    };
    expect(record(patch).payload).toEqual(extractionWith(patch));
  });

  it("latencyMs 는 추출의 model.latencyMs 가 아니라 응답의 timings.extractMs 다", () => {
    const result = record((draft) => {
      draft.model.latencyMs = 999;
    });
    expect(result.latencyMs).toBe(EXTRACT_MS);
  });

  it("warnings 는 추출의 warnings 가 아니라 응답의 warnings 다", () => {
    const result = record(
      (draft) => {
        draft.warnings = ["EXTRACTION_LOW_CONFIDENCE"];
      },
      { warnings: ["ATTACHMENT_PARSE_FAILED:FX-01-rfp"] },
    );
    expect(result.warnings).toEqual(["ATTACHMENT_PARSE_FAILED:FX-01-rfp"]);
  });

  it("translations 는 캐시 행의 값이 아니라 응답의 translations 다", () => {
    const context = buildContext("FX-01", {
      extraction: { ...cachedRow("FX-01"), translations: { summary: "stale cached summary" } },
    });
    const result = record(() => {}, { translations: { summary: "fresh summary" } }, context);
    expect(result.translations).toEqual({ summary: "fresh summary" });
  });

  it("응답의 translations 가 null 이면 캐시 행에 값이 있어도 null 이다", () => {
    const context = buildContext("FX-01", {
      extraction: { ...cachedRow("FX-01"), translations: { summary: "stale cached summary" } },
    });
    expect(record(() => {}, { translations: null }, context).translations).toBeNull();
  });

  it("세 번째 인자는 null 을 받지 않고 status 는 성공 두 값뿐이다(타입 시험)", () => {
    expectTypeOf(toExtractionRecord).parameter(2).toEqualTypeOf<RequirementExtraction>();
    expectTypeOf<ExtractionRecord["status"]>().toEqualTypeOf<"COMPLETED" | "PENDING_REVIEW">();
  });
});

describe("toExtractRequest · /extract 요청(03 §2.1 ExtractRequest)", () => {
  it("식별자·공고 요약 meta·원문을 옮긴다(revisionId 는 bid.revisionId)", () => {
    const context = buildContext("FX-01");
    const source = sourceFor("FX-01");
    expect(toExtractRequest(context, source)).toEqual({
      requestId: "req-FX-01",
      bidId: "bid-FX-01",
      revisionId: "FX-01#01",
      fixtureId: "FX-01",
      meta: {
        stage: context.bid.stage,
        agency: context.bid.agency,
        budgetKrw: context.bid.budgetKrw,
        deadlineAt: context.bid.deadlineAt,
      },
      body: source.body,
      attachments: source.attachments,
    });
  });

  it("fixtureId 가 null(live)이면 fixtureId 키를 넣지 않는다", () => {
    const request = toExtractRequest(
      buildContext("FX-01", { fixtureId: null }),
      sourceFor("FX-01"),
    );
    expect(Object.keys(request)).not.toContain("fixtureId");
  });

  it("revision 이 붙은 fixtureId('FX-07.r01')를 그대로 싣는다(K5)", () => {
    const request = toExtractRequest(
      buildContext("FX-07", { fixtureId: "FX-07.r01" }),
      sourceFor("FX-07"),
    );
    expect(request.fixtureId).toBe("FX-07.r01");
  });

  it("조립한 요청은 1단계 extractRequestSchema 를 통과한다", () => {
    const request = toExtractRequest(buildContext("FX-01"), sourceFor("FX-01"));
    expect(extractRequestSchema.safeParse(request).success).toBe(true);
  });
});

// ── /kev 요청 ──

describe("toKevRequest · /kev 요청(03 §5.7 KevAdapterInput + K6)", () => {
  const extraction = loadExtraction("FX-01");

  it("요청 키는 KevAdapterInput·K6 의 12개뿐이다", () => {
    expect(Object.keys(toKevRequest(buildContext("FX-01"), extraction, null)).toSorted()).toEqual(
      [
        "requestId",
        "fixtureId",
        "bidId",
        "orgId",
        "revisionId",
        "profileRevision",
        "extraction",
        "translations",
        "profileSummary",
        "attachmentsIncomplete",
        "questionSetVersion",
        "stateLanguage",
      ].toSorted(),
    );
  });

  it("식별자·revision·질문 세트·추출을 context 에서 옮긴다", () => {
    const context = buildContext("FX-01");
    expect(toKevRequest(context, extraction, null)).toMatchObject({
      requestId: "req-FX-01",
      fixtureId: "FX-01",
      bidId: "bid-FX-01",
      orgId: "org-solideo-demo",
      revisionId: "FX-01#01",
      profileRevision: context.profile.revision,
      extraction,
      questionSetVersion: "kev-qs/v0.1",
    });
  });

  it("revisionId 는 추출의 revisionId 가 아니라 bid.revisionId 다", () => {
    const context = buildContext("FX-01");
    const bid = { ...context.bid, revisionId: "FX-01#09" };
    expect(toKevRequest({ ...context, bid }, extraction, null).revisionId).toBe("FX-01#09");
  });

  it("질문 세트 v0.2 를 그대로 싣는다", () => {
    const context = buildContext("FX-01", {
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.2" },
    });
    expect(toKevRequest(context, extraction, null).questionSetVersion).toBe("kev-qs/v0.2");
  });

  it("profileSummary 는 회사 프로필 전체에 staffAvailability: null 을 더한 것이다(K6)", () => {
    expect(toKevRequest(buildContext("FX-01"), extraction, null).profileSummary).toEqual({
      ...loadProfile(),
      staffAvailability: null,
    });
  });

  it("stateLanguage 는 'en' 이다(03 §5.11)", () => {
    expect(toKevRequest(buildContext("FX-01"), extraction, null).stateLanguage).toBe("en");
  });

  it("어느 깊이에도 규칙 결과 키가 없다(03 §5.6)", () => {
    const keys = keysDeep(toKevRequest(buildContext("FX-01"), extraction, null));
    for (const key of RULE_RESULT_KEYS) expect(keys).not.toContain(key);
  });

  it("fixtureId 가 null(live)이면 fixtureId 키를 넣지 않는다", () => {
    const request = toKevRequest(buildContext("FX-01", { fixtureId: null }), extraction, null);
    expect(Object.keys(request)).not.toContain("fixtureId");
  });

  it("세 번째 인자 translations 를 캐시 행 값이 아니라 그대로 싣는다(§5-2)", () => {
    const context = buildContext("FX-01", {
      extraction: { ...cachedRow("FX-01"), translations: { summary: "cached summary" } },
    });
    const translations = { "requiredSkills[0]": "NestJS" };
    expect(toKevRequest(context, extraction, translations).translations).toEqual(translations);
  });

  it("세 번째 인자가 null 이면 캐시 행에 translations 가 있어도 null 이다", () => {
    const context = buildContext("FX-01", {
      extraction: { ...cachedRow("FX-01"), translations: { summary: "cached summary" } },
    });
    expect(toKevRequest(context, extraction, null).translations).toBeNull();
  });

  it("첨부 문제가 없으면 attachmentsIncomplete=false 다", () => {
    expect(toKevRequest(buildContext("FX-01"), extraction, null).attachmentsIncomplete).toBe(false);
  });

  it("bid.attachmentsIncomplete=true 면 attachmentsIncomplete=true 다", () => {
    const context = buildContext("FX-01");
    const bid = { ...context.bid, attachmentsIncomplete: true };
    expect(toKevRequest({ ...context, bid }, extraction, null).attachmentsIncomplete).toBe(true);
  });

  it("bid.attachmentsIncomplete=false 를 명시해도 다른 문제가 없으면 false 다", () => {
    const context = buildContext("FX-01");
    const bid = { ...context.bid, attachmentsIncomplete: false };
    expect(toKevRequest({ ...context, bid }, extraction, null).attachmentsIncomplete).toBe(false);
  });

  it("추출 경고에 ATTACHMENT_PARSE_FAILED: 로 시작하는 값이 있으면 true 다", () => {
    const parseFailed = extractionWith((draft) => {
      draft.warnings = ["ATTACHMENT_PARSE_FAILED:FX-01-rfp"];
    });
    expect(toKevRequest(buildContext("FX-01"), parseFailed, null).attachmentsIncomplete).toBe(true);
  });

  it("documentIssues 가 하나라도 있으면 true 다", () => {
    const context = buildContext("FX-01", { documentIssues: [documentIssue] });
    expect(toKevRequest(context, extraction, null).attachmentsIncomplete).toBe(true);
  });

  it("첨부와 무관한 경고(CITATION_FAILED:qualifications)만 있으면 false 다", () => {
    const citation = extractionWith((draft) => {
      draft.warnings = ["CITATION_FAILED:qualifications"];
    });
    expect(toKevRequest(buildContext("FX-01"), citation, null).attachmentsIncomplete).toBe(false);
  });
});

// ── /kev 응답 → C4 kev 입력 ──

describe("toKevWire · gateway /kev 응답 → C4 analyze 의 kev 입력(wire 형식)", () => {
  const responses = loadKevResponses("FX-01");
  const used = (): KevResponse => kevUsedBody(responses);

  it("3b mock 응답(wire 1개)을 provider·model·질문 세트·requestId·responses·latency_ms 로 조립한다", () => {
    expect(toKevWire(used())).toEqual({
      provider: "mock",
      model: "mock",
      questionSetVersion: "kev-qs/v0.1",
      requestId: null,
      responses,
      latency_ms: KEV_MS,
    });
  });

  it("latency_ms 는 wire 원소의 값이 아니라 timings.kevMs 다", () => {
    const body = withPatch(used(), (draft) => {
      draft.timings.kevMs = 412;
      draft.wire = [{ responses, latency_ms: 9 }];
    });
    expect(toKevWire(body)?.latency_ms).toBe(412);
  });

  it("kev.model 이 없으면 model=null 이다", () => {
    const body = withPatch(used(), (draft) => {
      delete draft.kev.model;
    });
    expect(toKevWire(body)?.model).toBeNull();
  });

  it("kev.requestId 가 있으면 그대로 싣는다", () => {
    const body = withPatch(used(), (draft) => {
      draft.kev.requestId = "kev-req-7";
    });
    expect(toKevWire(body)?.requestId).toBe("kev-req-7");
  });

  it("분할 wire(원소 2개)의 responses 를 순서대로 합친다(03 §5.10)", () => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [
        {
          responses: {
            recommendation: responses.recommendation,
            mandatoryRisk: responses.mandatoryRisk,
          },
        },
        { responses: { needsHumanReview: responses.needsHumanReview, fit: responses.fit } },
      ];
    });
    expect(toKevWire(body)?.responses).toEqual(responses);
  });

  it("분할 wire 에서 같은 질문이 겹치면 나중 원소가 이긴다(§5-6)", () => {
    const later = {
      choice: "WATCH" as const,
      confidence: 0.6,
      probabilities: { BID: 0.2, WATCH: 0.6, NO_BID: 0.2 },
    };
    const body = withPatch(used(), (draft) => {
      draft.wire = [{ responses }, { responses: { recommendation: later } }];
    });
    expect(toKevWire(body)?.responses).toEqual({ ...responses, recommendation: later });
  });

  it("wire 가 null 이면 null 이다", () => {
    expect(toKevWire(withPatch(used(), (draft) => void (draft.wire = null)))).toBeNull();
  });

  it("wire 가 비었으면 null 이다", () => {
    expect(toKevWire(withPatch(used(), (draft) => void (draft.wire = [])))).toBeNull();
  });

  it.each([
    ["null", null],
    ["문자열", "responses"],
    ["숫자", 3],
  ])("wire 원소가 객체가 아니면(%s) null 이다", (_name, element) => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [{ responses }, element];
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("wire 원소의 responses 가 객체가 아니면 null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [{ responses: "BID" }];
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("wire 원소에 responses 가 없으면 null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [{ responses }, { usage: { input_tokens: 0, output_tokens: 0 } }];
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("합친 responses 의 확률이 범위를 벗어나면(1.5) null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [
        {
          responses: {
            ...responses,
            mandatoryRisk: { noul: 1.5 },
          },
        },
      ];
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("합친 responses 에 질문이 빠졌으면(fit 없음) null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.wire = [
        {
          responses: {
            recommendation: responses.recommendation,
            mandatoryRisk: responses.mandatoryRisk,
            needsHumanReview: responses.needsHumanReview,
          },
        },
      ];
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("kev.provider 가 mock·local·hosted 가 아니면 null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.kev.provider = "openai";
    });
    expect(toKevWire(body)).toBeNull();
  });

  it("kev.questionSetVersion 이 알 수 없는 값이면 null 이다", () => {
    const body = withPatch(used(), (draft) => {
      draft.kev.questionSetVersion = "kev-qs/v9";
    });
    expect(toKevWire(body)).toBeNull();
  });
});

// ── 근거 ──

describe("collectEvidence · 결과에 쓰인 공고 근거(match≠FAILED, 같은 근거는 한 번)", () => {
  it("자격 검사 근거를 검사 순서대로 먼저, 요소 근거를 요소 순서대로 뒤에 둔다", () => {
    const a = evidence({ quotedText: "A" });
    const b = evidence({ quotedText: "B" });
    const c = evidence({ quotedText: "C" });
    const d = evidence({ quotedText: "D" });
    expect(collectEvidence(withEvidence([[a], [b]], [[c], [d]]))).toEqual([a, b, c, d]);
  });

  it("match=FAILED 근거는 뺀다", () => {
    const failed = evidence({ quotedText: "실패 인용", match: "FAILED" });
    const exact = evidence({ quotedText: "정상 인용", match: "EXACT" });
    expect(collectEvidence(withEvidence([[failed, exact]], []))).toEqual([exact]);
  });

  it("match 가 없거나 EXACT·NORMALIZED·FUZZY 인 근거는 남긴다", () => {
    const list = [
      evidence({ quotedText: "없음" }),
      evidence({ quotedText: "EXACT", match: "EXACT" }),
      evidence({ quotedText: "NORMALIZED", match: "NORMALIZED" }),
      evidence({ quotedText: "FUZZY", match: "FUZZY" }),
    ];
    expect(collectEvidence(withEvidence([list], []))).toEqual(list);
  });

  it("판정 키가 같으면 판정 키 밖의 필드(fetchedAt·match·sourceUrl·apiSource)가 달라도 처음 것 하나만 남긴다", () => {
    const first = evidence({ fetchedAt: "2026-10-16T09:00:00Z", match: "EXACT" });
    const again = evidence({
      fetchedAt: "2026-10-17T09:00:00Z",
      match: "FUZZY",
      sourceUrl: "https://demo.sol-radar.invalid/x",
      apiSource: "g2b",
    });
    expect(collectEvidence(withEvidence([[first, again]], []))).toEqual([first]);
  });

  it("FAILED 를 먼저 거른 뒤 중복을 없앤다: 같은 키가 FAILED 로 먼저, 정상으로 나중에 오면 정상 것이 남는다(§5-6)", () => {
    const failed = evidence({ quotedText: "같은 인용", match: "FAILED" });
    const exact = evidence({ quotedText: "같은 인용", match: "EXACT" });
    expect(collectEvidence(withEvidence([[failed], [exact]], []))).toEqual([exact]);
  });

  it.each<[string, Partial<EvidenceRef>]>([
    ["page", { page: null }],
    ["charStart", { charStart: null }],
    ["charEnd", { charEnd: null }],
  ])("%s 가 없는 근거와 null 인 근거는 같은 근거다(§5-6)", (_key, nulled) => {
    const missing = evidence();
    const withNull = evidence(nulled);
    expect(collectEvidence(withEvidence([[missing, withNull]], []))).toEqual([missing]);
  });

  it("자격 검사와 요소에 같은 근거가 있으면 한 번만 남긴다", () => {
    const shared = evidence({ quotedText: "공유 인용" });
    expect(collectEvidence(withEvidence([[shared]], [[{ ...shared }]]))).toEqual([shared]);
  });

  it("kind 가 없는 근거와 kind=TEXT 근거는 같은 근거다", () => {
    const implicit = evidence();
    const explicit = evidence({ kind: "TEXT" });
    expect(collectEvidence(withEvidence([[implicit, explicit]], []))).toEqual([implicit]);
  });

  it("kind=API_FIELD 와 kind=TEXT 는 다른 근거다", () => {
    const text = evidence({ kind: "TEXT" });
    const api = evidence({ kind: "API_FIELD" });
    expect(collectEvidence(withEvidence([[text, api]], []))).toEqual([text, api]);
  });

  it.each<[string, Partial<EvidenceRef>]>([
    ["documentId", { documentId: "FX-01-rfp" }],
    ["revisionId", { revisionId: "FX-01#02" }],
    ["page", { page: 3 }],
    ["charStart", { charStart: 10 }],
    ["charEnd", { charEnd: 20 }],
    ["apiField", { apiField: "bidNtceNm" }],
    ["quotedText", { quotedText: "다른 인용" }],
  ])("판정 키 %s 하나만 달라도 다른 근거다", (_key, change) => {
    const base = evidence();
    const changed = evidence(change);
    expect(collectEvidence(withEvidence([[base, changed]], []))).toEqual([base, changed]);
  });

  it("근거가 하나도 없으면 빈 목록이다", () => {
    expect(collectEvidence(withEvidence([[]], [[], []]))).toEqual([]);
  });

  it("실제 FX-01 결과의 근거는 모두 결과 안의 근거이고 FAILED 가 없다", () => {
    const result = resultWithKev();
    const all = [
      ...result.qualificationChecks.flatMap((check) => check.evidence),
      ...result.factors.flatMap((factor) => factor.evidence),
    ];
    const collected = collectEvidence(result);
    expect(collected.length).toBeGreaterThan(0);
    for (const item of collected) {
      expect(all).toContainEqual(item);
      expect(item.match).not.toBe("FAILED");
    }
  });
});

// ── 파이프라인 플래그 ──

describe("extraReviewFlags · C4 reviewFlags 에 없는 파이프라인 플래그", () => {
  const clean = loadExtraction("FX-01");
  const kevUsed: KevOutcome = { kind: "USED", response: kevUsedBody(loadKevResponses("FX-01")) };

  it("문제없는 추출·Kev 사용이면 빈 목록이다(FX-01 의 매핑 note 는 플래그가 아니다)", () => {
    expect(extraReviewFlags({ extraction: clean, kev: kevUsed, resultFlags: [] })).toEqual([]);
  });

  it("추출이 없고 Kev 를 부르지 않았으면 빈 목록이다", () => {
    expect(extraReviewFlags({ extraction: null, kev: null, resultFlags: [] })).toEqual([]);
  });

  it("경고 CITATION_FAILED:<field> 가 있으면 CITATION_FAILED(K1)", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["CITATION_FAILED:qualifications"];
    });
    expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([
      "CITATION_FAILED",
    ]);
  });

  it("경고 CITATION_FAILED(필드 없음)가 있으면 CITATION_FAILED", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["CITATION_FAILED"];
    });
    expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([
      "CITATION_FAILED",
    ]);
  });

  it.each(EXTRACTED_FIELDS)(
    "필드 %s 의 note 가 CITATION_FAILED 면 CITATION_FAILED(K1)",
    (field) => {
      const extraction = extractionWith((draft) => {
        draft[field] = { value: null, state: "UNKNOWN", evidence: [], note: "CITATION_FAILED" };
      });
      expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([
        "CITATION_FAILED",
      ]);
    },
  );

  it("첨부 파싱 실패 경고(ATTACHMENT_PARSE_FAILED:…)는 플래그를 내지 않는다", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["ATTACHMENT_PARSE_FAILED:FX-01-rfp"];
    });
    expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([]);
  });

  it("경고 EXTRACTION_LOW_CONFIDENCE 가 있으면 EXTRACTION_LOW_CONFIDENCE", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["EXTRACTION_LOW_CONFIDENCE"];
    });
    expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([
      "EXTRACTION_LOW_CONFIDENCE",
    ]);
  });

  it("Kev 만 불가(DISABLED·kevUnavailable=true)면 KEV_UNAVAILABLE", () => {
    const kev: KevOutcome = { kind: "DISABLED", kevUnavailable: true };
    expect(extraReviewFlags({ extraction: clean, kev, resultFlags: [] })).toEqual([
      "KEV_UNAVAILABLE",
    ]);
  });

  it("Kev 사용 안 함(DISABLED·kevUnavailable=false)은 플래그가 아니다", () => {
    const kev: KevOutcome = { kind: "DISABLED", kevUnavailable: false };
    expect(extraReviewFlags({ extraction: clean, kev, resultFlags: [] })).toEqual([]);
  });

  it("gateway 불가(GATEWAY_DOWN)는 KEV_UNAVAILABLE 이 아니다(C4 AI_UNAVAILABLE 몫)", () => {
    const kev: KevOutcome = { kind: "GATEWAY_DOWN" };
    expect(extraReviewFlags({ extraction: clean, kev, resultFlags: [] })).toEqual([]);
  });

  it("셋 다 있으면 CITATION_FAILED → EXTRACTION_LOW_CONFIDENCE → KEV_UNAVAILABLE 순서다", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["EXTRACTION_LOW_CONFIDENCE", "CITATION_FAILED:summary"];
    });
    const kev: KevOutcome = { kind: "DISABLED", kevUnavailable: true };
    expect(extraReviewFlags({ extraction, kev, resultFlags: [] })).toEqual([
      "CITATION_FAILED",
      "EXTRACTION_LOW_CONFIDENCE",
      "KEV_UNAVAILABLE",
    ]);
  });

  it("경고와 note 가 함께 CITATION_FAILED 여도 한 번만 낸다", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["CITATION_FAILED:qualifications", "CITATION_FAILED:domain"];
      draft.qualifications = {
        value: null,
        state: "UNKNOWN",
        evidence: [],
        note: "CITATION_FAILED",
      };
    });
    expect(extraReviewFlags({ extraction, kev: null, resultFlags: [] })).toEqual([
      "CITATION_FAILED",
    ]);
  });

  it("resultFlags 에 이미 있는 값은 뺀다", () => {
    const extraction = extractionWith((draft) => {
      draft.warnings = ["CITATION_FAILED:qualifications", "EXTRACTION_LOW_CONFIDENCE"];
    });
    const kev: KevOutcome = { kind: "DISABLED", kevUnavailable: true };
    expect(
      extraReviewFlags({
        extraction,
        kev,
        resultFlags: ["AI_UNAVAILABLE", "CITATION_FAILED", "KEV_UNAVAILABLE"],
      }),
    ).toEqual(["EXTRACTION_LOW_CONFIDENCE"]);
  });
});

// ── /explain 요청 ──

describe("toExplainRequest · /explain 요청(K8)", () => {
  const build = (result: AnalysisResult, extraFlags: ExtraReviewFlag[] = []) =>
    toExplainRequest({
      requestId: "req-FX-01",
      result,
      extraFlags,
      evidence: collectEvidence(result),
      documentIssues: [documentIssue],
    });

  it("요청 키는 K8 의 6개다", () => {
    expect(Object.keys(build(resultWithKev())).toSorted()).toEqual(
      [
        "requestId",
        "qualificationChecks",
        "scoreBreakdown",
        "evidence",
        "kevSummary",
        "documentIssues",
      ].toSorted(),
    );
  });

  it("scoreBreakdown 키는 K8 의 6개다", () => {
    expect(Object.keys(build(resultWithKev()).scoreBreakdown).toSorted()).toEqual(
      [
        "score",
        "factors",
        "recommendation",
        "recommendationBasis",
        "reviewFlags",
        "missingFactors",
      ].toSorted(),
    );
  });

  it("자격 판정·점수·요소·권고·근거 종류·missing 을 C4 값 그대로 싣는다", () => {
    const result = resultWithKev();
    const request = build(result);
    expect(request.requestId).toBe("req-FX-01");
    expect(request.qualificationChecks).toEqual(result.qualificationChecks);
    expect(request.scoreBreakdown).toEqual({
      score: result.score,
      factors: result.factors,
      recommendation: result.recommendation,
      recommendationBasis: result.recommendationBasis,
      reviewFlags: result.reviewFlags,
      missingFactors: result.missingFactors,
    });
  });

  it("scoreBreakdown.reviewFlags 는 C4 reviewFlags 뒤에 파이프라인 플래그를 붙인다", () => {
    const result = analyze(buildAnalysisInput("FX-02"));
    expect(
      build(result, ["CITATION_FAILED", "KEV_UNAVAILABLE"]).scoreBreakdown.reviewFlags,
    ).toEqual([...result.reviewFlags, "CITATION_FAILED", "KEV_UNAVAILABLE"]);
  });

  it("같은 파이프라인 플래그가 두 번 와도 한 번만 싣는다", () => {
    const result = resultWithKev();
    expect(
      build(result, ["KEV_UNAVAILABLE", "KEV_UNAVAILABLE"]).scoreBreakdown.reviewFlags,
    ).toEqual([...result.reviewFlags, "KEV_UNAVAILABLE"]);
  });

  it("evidence·documentIssues 는 받은 값을 그대로 싣는다", () => {
    const result = resultWithKev();
    const request = build(result);
    expect(request.evidence).toEqual(collectEvidence(result));
    expect(request.documentIssues).toEqual([documentIssue]);
  });

  it("Kev 를 쓴 run 이면 kevSummary 는 result.kev 다", () => {
    const result = resultWithKev();
    expect(build(result).kevSummary).toEqual(result.kev);
  });

  it("Kev 를 쓰지 않은 run(result.kev.enabled=false)이면 kevSummary 는 null 이다", () => {
    expect(build(resultWithoutKev()).kevSummary).toBeNull();
  });

  it("result.reviewFlags 를 바꾸지 않는다", () => {
    const result = resultWithKev();
    const before = [...result.reviewFlags];
    build(result, ["CITATION_FAILED"]);
    expect(result.reviewFlags).toEqual(before);
  });
});

// ── 설명 문장 ──

describe("chooseExplanation · 모델 문장은 fallback=false 일 때만, 그 밖에는 C4 템플릿(K3)", () => {
  const result = resultWithKev();

  it("MODEL_TEXT 면 모델 문장이고 source=MODEL", () => {
    expect(
      chooseExplanation({ kind: "MODEL_TEXT", text: "모델 문장", usedNumbers: ["94"] }, result),
    ).toEqual({ text: "모델 문장", source: "MODEL" });
  });

  it("TEMPLATE 이면 gateway 문장이 있어도 C4 result.explanation 이고 source=TEMPLATE", () => {
    expect(chooseExplanation({ kind: "TEMPLATE", text: "gateway 템플릿" }, result)).toEqual({
      text: result.explanation,
      source: "TEMPLATE",
    });
  });

  it("TEMPLATE·text=null(호출 실패)이면 C4 result.explanation 이다", () => {
    expect(chooseExplanation({ kind: "TEMPLATE", text: null }, result)).toEqual({
      text: result.explanation,
      source: "TEMPLATE",
    });
  });

  it("/explain 을 부르지 않았으면(null) C4 result.explanation 이다", () => {
    expect(chooseExplanation(null, result)).toEqual({
      text: result.explanation,
      source: "TEMPLATE",
    });
  });
});

// ── 메타의 model 칸 ──

describe("toModelMeta · meta.model(05 AnalysisResult.model)", () => {
  const extraction = loadExtraction("FX-01");

  it("추출·Kev 가 있으면 provider·qwen 3필드·kev 2필드·algorithmVersion 만 싣는다", () => {
    expect(toModelMeta({ aiProvider: "mock", extraction, result: resultWithMockModel() })).toEqual({
      provider: "mock",
      qwen: {
        name: extraction.model.name,
        promptVersion: extraction.model.promptVersion,
        promptHash: extraction.model.promptHash,
      },
      kev: { model: "mock", questionSetVersion: "kev-qs/v0.1" },
      algorithmVersion: "sol-v0.1.0",
    });
  });

  it("provider 는 context.aiProvider 다", () => {
    const meta = toModelMeta({ aiProvider: "local", extraction, result: resultWithMockModel() });
    expect(meta.provider).toBe("local");
  });

  it("추출이 없으면 qwen=null 이다", () => {
    expect(
      toModelMeta({ aiProvider: "mock", extraction: null, result: resultWithMockModel() }).qwen,
    ).toBeNull();
  });

  it("Kev 를 쓰지 않은 run 이면 kev=null 이다", () => {
    expect(
      toModelMeta({ aiProvider: "mock", extraction, result: resultWithoutKev() }).kev,
    ).toBeNull();
  });

  it("Kev 는 썼지만 result.kev.model 이 null 이면(fixture wire 에 model 없음) kev=null 이다", () => {
    const result = resultWithKev();
    expect(result.kev.enabled).toBe(true);
    expect(toModelMeta({ aiProvider: "mock", extraction, result }).kev).toBeNull();
  });

  it("algorithmVersion 은 result.algorithmVersion 이다", () => {
    const result = resultWithoutKev();
    expect(toModelMeta({ aiProvider: "mock", extraction, result }).algorithmVersion).toBe(
      result.algorithmVersion,
    );
  });
});

describe("readCachedExtraction · gateway /kev 계약", () => {
  // gateway 는 /kev 요청의 extraction 을 services/ai/schemas/requirement-extraction.v0.1.json(additionalProperties:false)로
  // 검증한다. worker 는 scoring 스키마로 파싱한 값을 보내므로, 파싱이 값을 바꾸거나 더하면 422 → GATEWAY_DOWN → PARTIAL 이 된다.
  const dir = new URL("../../../fixtures/extractions/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

  it("fixture 추출 파일이 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s 는 파싱 뒤에도 원본과 깊게 같다(필드를 지우거나 바꾸지 않는다)", (name) => {
    const raw: unknown = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    const parsed = readCachedExtraction({
      id: `extraction-${name}`,
      status: "COMPLETED",
      payload: raw,
      translations: null,
    });
    expect(parsed).toStrictEqual(raw);
  });
});
