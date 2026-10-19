import { describe, expect, it } from "vitest";
import * as analysisBarrel from "@/server/analysis";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  analyze,
  type AnalysisInput,
  type KevMockResponse,
} from "@/server/scoring";
import {
  collectEvidence,
  toIdempotencyKey,
  type AnalysisContext,
  type AnalysisRunRecord,
  type ExtractionRecord,
} from "./analysis.model";
import {
  AnalysisInputError,
  analyzeAndSave,
  runAnalysis,
  type AnalysisRunSink,
} from "./analysis.service";
import {
  CALCULATION_DATE,
  EXTRACT_MS,
  FINISHED_AT,
  KEV_MS,
  LEAKY_ADDRESS,
  MOCK_EXPLAIN_TEXT,
  QUEUED_AT,
  STARTED_AT,
  STATE_HASH,
  buildContext,
  buildDeps,
  clock,
  explainBody,
  extractBody,
  extractFailedBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  jsonReply,
  keysDeep,
  kevDisabledBody,
  kevUsedBody,
  loadBid,
  loadExtraction,
  loadGolden,
  loadKevResponses,
  loadProfile,
  loadTeam,
  refusedReply,
  sourceFor,
  timeoutReply,
  withPatch,
  type GatewayRoutes,
} from "./test-support";

// 03 §2.1 analysis job ①~⑤ 의 흐름(c5b 2단계 설계 §2·§4). 저장은 port 호출까지만 본다.
// gateway 는 실제 createGatewayClient 에 가짜 fetch 를 넣은 것이다. 1단계 timeout·재시도·breaker 를 그대로 거친다.
// 골든 숫자는 fixtures/goldens 에서 읽는다. 시계는 CALCULATION_DATE 의 KST 18:00 으로 고정한다.

const GOLDEN_IDS = ["FX-01", "FX-02", "FX-03"] as const;

type RunOptions = {
  routes?: GatewayRoutes;
  store?: Parameters<typeof fakeExtractionStore>[0];
  now?: () => Date;
};

/** runAnalysis 한 번. 시험마다 새 gateway(새 breaker)·새 추출 저장을 쓴다. */
async function run(context: AnalysisContext, options: RunOptions = {}) {
  const id = context.fixtureId ?? "FX-01";
  const fake = fakeGateway(options.routes ?? healthyRoutes(id));
  const store = fakeExtractionStore(options.store);
  const record = await runAnalysis(context, buildDeps(fake.gateway, store.store, options.now));
  return { record, fake, store };
}

/** /kev 만 바꾸고 /explain 은 mock 템플릿으로 둔다. */
function withKev(reply: GatewayRoutes["/kev"]): GatewayRoutes {
  return { "/kev": reply, "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)) };
}

/** 캐시를 쓸 수 없는 FX-01 에서 /extract 답을 준다. /kev·/explain 은 정상. */
function withExtract(reply: GatewayRoutes["/extract"]): GatewayRoutes {
  return { ...healthyRoutes("FX-01"), "/extract": reply };
}

/** 3b mock /kev 로 조립된 C4 kev 입력(독립적으로 적은 기대값). */
function mockKevWire(responses: KevMockResponse["responses"]): KevMockResponse {
  return {
    provider: "mock",
    model: "mock",
    questionSetVersion: "kev-qs/v0.1",
    requestId: null,
    responses,
    latency_ms: KEV_MS,
  };
}

/** 캐시가 유효하고 /kev 가 3b mock 일 때 analyze 에 들어가야 할 입력. */
function expectedInput(id: string): AnalysisInput {
  return {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: loadBid(id),
    extraction: loadExtraction(id),
    profile: loadProfile(),
    team: loadTeam(),
    kev: mockKevWire(loadKevResponses(id)),
    config: { ...SCORING_CONFIG_V0_1, today: CALCULATION_DATE },
  };
}

/**
 * FX-13 추출을 인용 검증 실패(K1) 모양으로 고친 캐시 행. FX-13 fixture 에는 그런 필드가 없다.
 * FX-13 공고의 budgetKrw 는 금액 텍스트("1,500백만원")라 C4 입력 계약이 거절한다. 정규화는 수집 도메인 몫이므로
 * scoring 시험(review.independent)처럼 정규화 값을 넣는다. 그 값은 FX-13 추출의 budgetKrw(07 §6.2 환산값)에서 읽는다.
 */
function citationFailedContext(kind: "warning" | "note"): AnalysisContext {
  const normalizedBudget = loadExtraction("FX-13").budgetKrw.value;
  const payload = withPatch(loadExtraction("FX-13"), (draft) => {
    if (kind === "warning") draft.warnings = ["CITATION_FAILED:qualifications"];
    else
      draft.qualifications = {
        value: null,
        state: "UNKNOWN",
        evidence: [],
        note: "CITATION_FAILED",
      };
  });
  return buildContext("FX-13", {
    bid: { ...loadBid("FX-13"), budgetKrw: normalizedBudget },
    extraction: { status: "COMPLETED", payload, errorCode: null, translations: null },
    kev: { enabled: false, questionSetVersion: "kev-qs/v0.1" },
  });
}

const invalidPayload = () =>
  withPatch(loadExtraction("FX-01"), (draft) => {
    draft.budgetKrw.value = "12억원";
  });

// ── 골든 ──

describe("runAnalysis · 골든(FX-01·02·03, 캐시 추출 + 3b mock /kev)", () => {
  for (const id of GOLDEN_IDS) {
    it(`${id}: score·recommendation 이 fixtures/goldens/${id}.json 과 같다`, async () => {
      const golden = loadGolden(id);
      const { record } = await run(buildContext(id));
      expect(record.result.score).toBe(golden.score);
      expect(record.result.recommendation).toBe(golden.recommendation);
    });

    it(`${id}: 요소별 normalized·points·maxPoints 가 골든과 같다`, async () => {
      const { record } = await run(buildContext(id));
      expect(
        record.result.factors.map(({ factor, normalized, points, maxPoints }) => ({
          factor,
          normalized,
          points,
          maxPoints,
        })),
      ).toEqual(loadGolden(id).factors);
    });

    it(`${id}: reviewFlags 가 골든과 같다`, async () => {
      const { record } = await run(buildContext(id));
      expect(record.result.reviewFlags).toEqual(loadGolden(id).reviewFlags);
    });

    it(`${id}: COMPLETED·RULES_WITH_KEV_ASSIST·errorCode null·extraReviewFlags [] 다`, async () => {
      const { record } = await run(buildContext(id));
      expect(record.result.status).toBe("COMPLETED");
      expect(record.result.recommendationBasis).toBe("RULES_WITH_KEV_ASSIST");
      expect(record.result.errorCode).toBeNull();
      expect(record.meta.extraReviewFlags).toEqual([]);
    });

    it(`${id}: /kev·/explain 을 한 번씩 부르고 /extract·loadSource·save 는 부르지 않는다`, async () => {
      const { fake, store } = await run(buildContext(id));
      expect(fake.count("/kev")).toBe(1);
      expect(fake.count("/explain")).toBe(1);
      expect(fake.count("/extract")).toBe(0);
      expect(store.loads).toHaveLength(0);
      expect(store.saves).toHaveLength(0);
    });
  }
});

// ── 레코드 모양 ──

describe("runAnalysis · 저장 직전 레코드(e8 C6)", () => {
  it("레코드 키는 orgId·bidId·revisionId·requestId·idempotencyKey·input·result·meta·kevOutput 이다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(Object.keys(record).toSorted()).toEqual(
      [
        "orgId",
        "bidId",
        "revisionId",
        "requestId",
        "idempotencyKey",
        "input",
        "result",
        "meta",
        "kevOutput",
      ].toSorted(),
    );
  });

  it("식별자는 context 에서, revisionId 는 bid.revisionId 에서 온다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record).toMatchObject({
      orgId: "org-solideo-demo",
      bidId: "bid-FX-01",
      revisionId: "FX-01#01",
      requestId: "req-FX-01",
    });
  });

  it("idempotencyKey 는 toIdempotencyKey(context.orgId, context.requestId) 다", async () => {
    const context = buildContext("FX-01");
    const { record } = await run(context);
    expect(record.idempotencyKey).toBe(toIdempotencyKey(context.orgId, context.requestId));
  });

  it('idempotencyKey 는 조직 접두어가 붙은 "org-solideo-demo:req-FX-01" 이다', async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.idempotencyKey).toBe("org-solideo-demo:req-FX-01");
  });

  it("input 은 캐시 추출·3b mock wire·고정 임계값·KST 기준일로 조립한 analyze 입력이다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.input).toEqual(expectedInput("FX-01"));
  });

  it("AI 불가 사유가 없으면 input 에 aiUnavailableReason 키를 넣지 않는다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(Object.keys(record.input)).not.toContain("aiUnavailableReason");
  });

  it("inputSnapshotHash 는 독립적으로 조립한 입력의 해시와 같다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.result.inputSnapshotHash).toBe(analyze(expectedInput("FX-01")).inputSnapshotHash);
  });

  it("result 는 같은 input 으로 analyze 를 직접 부른 결과와 깊게 같다(파이프라인이 고치지 않는다)", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.result).toEqual(analyze(record.input));
  });

  it("meta 키는 e8 C6 의 10개다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(Object.keys(record.meta).toSorted()).toEqual(
      [
        "runMode",
        "model",
        "fallbackReason",
        "evidence",
        "errorCode",
        "queuedAt",
        "startedAt",
        "finishedAt",
        "extraReviewFlags",
        "explanation",
      ].toSorted(),
    );
  });

  it("meta.model 은 provider·캐시 추출의 qwen·3b mock 의 kev·algorithmVersion 이다", async () => {
    const extraction = loadExtraction("FX-01");
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.model).toEqual({
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

  it("meta.model.provider 는 context.aiProvider 다", async () => {
    const { record } = await run(buildContext("FX-01", { aiProvider: "local" }));
    expect(record.meta.model.provider).toBe("local");
  });

  it("meta.runMode 는 context.runMode 다", async () => {
    const { record } = await run(buildContext("FX-01", { runMode: "fixture" }));
    expect(record.meta.runMode).toBe("fixture");
  });

  it("meta.fallbackReason 은 null 이다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.fallbackReason).toBeNull();
  });

  it("meta.errorCode 는 result.errorCode 다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.errorCode).toBe(record.result.errorCode);
  });

  it("meta.evidence 는 결과에서 모은 근거(collectEvidence)다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.evidence).toEqual(collectEvidence(record.result));
  });

  it("queuedAt 은 context 값, startedAt 은 첫 now(), finishedAt 은 두 번째 now() 다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.queuedAt).toBe(QUEUED_AT);
    expect(record.meta.startedAt).toBe(STARTED_AT);
    expect(record.meta.finishedAt).toBe(FINISHED_AT);
  });

  it("config.today 는 startedAt 의 KST 날짜다: UTC 14:59:59 → 같은 날", async () => {
    const now = clock("2026-10-16T14:59:59.000Z", "2026-10-16T15:00:05.000Z");
    const { record } = await run(buildContext("FX-01"), { now });
    expect(record.input.config.today).toBe("2026-10-16");
  });

  it("config.today 는 startedAt 의 KST 날짜다: UTC 15:00:00 → 다음 날", async () => {
    const now = clock("2026-10-16T15:00:00.000Z", "2026-10-16T15:00:05.000Z");
    const { record } = await run(buildContext("FX-01"), { now });
    expect(record.input.config.today).toBe("2026-10-17");
  });

  it("Kev 를 쓴 run 의 kevOutput 은 질문 세트·gateway wire·stateHash·stateTrace·requirements 다", async () => {
    const body = kevUsedBody(loadKevResponses("FX-01"));
    const { record } = await run(buildContext("FX-01"), { routes: withKev(jsonReply(body)) });
    expect(record.kevOutput).toEqual({
      questionSetVersion: "kev-qs/v0.1",
      wire: body.wire,
      stateHash: STATE_HASH,
      stateTrace: null,
      requirements: null,
    });
  });

  it("kevOutput 은 gateway 의 kev.stateTrace·requirements 를 그대로 싣는다", async () => {
    const stateTrace = { steps: ["q-recommendation", "q-fit"] };
    const requirements = [
      {
        itemId: "requiredSkills[0]",
        qid: "q-skill",
        distribution: { SATISFIED: 0.8, NOT_SATISFIED: 0.1, NEEDS_REVIEW: 0.1 },
        label: "SATISFIED" as const,
      },
    ];
    const body = withPatch(kevUsedBody(loadKevResponses("FX-01")), (draft) => {
      draft.kev.stateTrace = stateTrace;
      draft.requirements = requirements;
    });
    const { record } = await run(buildContext("FX-01"), { routes: withKev(jsonReply(body)) });
    expect(record.kevOutput).toMatchObject({ stateTrace, requirements });
  });

  it("gateway 가 kev.stateTrace 를 주지 않으면 kevOutput.stateTrace 는 null 이다", async () => {
    const body = withPatch(kevUsedBody(loadKevResponses("FX-01")), (draft) => {
      delete draft.kev.stateTrace;
    });
    const { record } = await run(buildContext("FX-01"), { routes: withKev(jsonReply(body)) });
    expect(record.kevOutput?.stateTrace).toBeNull();
  });
});

// ── /kev 요청 본문 ──

describe("runAnalysis · /kev 요청 translations(§5-2)", () => {
  it("캐시를 쓰면 /kev translations 는 context.extraction.translations 다", async () => {
    const translations = { summary: "Sejong City is recruiting bidders." };
    const context = buildContext("FX-01", {
      extraction: {
        status: "COMPLETED",
        payload: loadExtraction("FX-01"),
        errorCode: null,
        translations,
      },
    });
    const { fake } = await run(context);
    expect(fake.bodyOf("/kev").translations).toEqual(translations);
  });

  it("캐시 행이 없어 다시 추출하면 /kev translations 는 /extract 응답의 translations 다", async () => {
    const translations = { "requiredSkills[0]": "NestJS" };
    const reply = jsonReply(extractBody(loadExtraction("FX-01"), { translations }));
    const { fake } = await run(buildContext("FX-01", { extraction: null }), {
      routes: withExtract(reply),
    });
    expect(fake.bodyOf("/kev").translations).toEqual(translations);
  });

  it("쓸 수 없는 캐시를 다시 추출하면 캐시 행의 translations 가 아니라 /extract 응답 값(null)을 보낸다", async () => {
    const context = buildContext("FX-01", {
      extraction: {
        status: "COMPLETED",
        payload: invalidPayload(),
        errorCode: null,
        translations: { summary: "stale cached summary" },
      },
    });
    const reply = jsonReply(extractBody(loadExtraction("FX-01"), { translations: null }));
    const { fake } = await run(context, { routes: withExtract(reply) });
    expect(fake.bodyOf("/kev").translations).toBeNull();
  });
});

describe("runAnalysis · /kev 요청 본문", () => {
  it("어느 깊이에도 규칙 결과 키(score·recommendation·qualificationChecks·qualificationStatus·reviewFlags·factors)가 없다", async () => {
    const { fake } = await run(buildContext("FX-01"));
    const keys = keysDeep(fake.bodyOf("/kev"));
    for (const key of [
      "score",
      "recommendation",
      "qualificationChecks",
      "qualificationStatus",
      "reviewFlags",
      "factors",
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  it("stateLanguage='en', profileSummary.staffAvailability=null 이다", async () => {
    const { fake } = await run(buildContext("FX-01"));
    expect(fake.bodyOf("/kev")).toMatchObject({
      stateLanguage: "en",
      profileSummary: { staffAvailability: null },
    });
  });

  it("requestId·fixtureId·추출을 싣는다", async () => {
    const { fake } = await run(buildContext("FX-01"));
    expect(fake.bodyOf("/kev")).toMatchObject({
      requestId: "req-FX-01",
      fixtureId: "FX-01",
      extraction: loadExtraction("FX-01"),
    });
  });

  it("fixtureId 가 null(live)이면 fixtureId 키가 없다", async () => {
    const { fake } = await run(buildContext("FX-01", { fixtureId: null }), {
      routes: healthyRoutes("FX-01"),
    });
    expect(Object.keys(fake.bodyOf("/kev"))).not.toContain("fixtureId");
  });

  it("첨부 문제(documentIssues)가 있으면 attachmentsIncomplete=true 로 보낸다", async () => {
    const context = buildContext("FX-01", {
      documentIssues: [
        {
          documentId: "FX-01-rfp",
          downloadStatus: "DOWNLOADED",
          parseStatus: "FAILED",
          errorCode: null,
        },
      ],
    });
    const { fake } = await run(context);
    expect(fake.bodyOf("/kev").attachmentsIncomplete).toBe(true);
  });
});

// ── /explain 요청 본문 ──

describe("runAnalysis · /explain 요청 본문(K8)", () => {
  it("요청 키는 K8 의 6개다", async () => {
    const { fake } = await run(buildContext("FX-01"));
    expect(Object.keys(fake.bodyOf("/explain")).toSorted()).toEqual(
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

  it("규칙 결과(자격 판정·점수 분해·Kev 요약)를 C4 값 그대로 싣는다", async () => {
    const { record, fake } = await run(buildContext("FX-01"));
    const { result } = record;
    expect(fake.bodyOf("/explain")).toEqual({
      requestId: "req-FX-01",
      qualificationChecks: result.qualificationChecks,
      scoreBreakdown: {
        score: result.score,
        factors: result.factors,
        recommendation: result.recommendation,
        recommendationBasis: result.recommendationBasis,
        reviewFlags: result.reviewFlags,
        missingFactors: result.missingFactors,
      },
      evidence: record.meta.evidence,
      kevSummary: result.kev,
      documentIssues: [],
    });
  });

  it("documentIssues 를 그대로 싣는다", async () => {
    const issue = {
      documentId: "FX-01-rfp",
      downloadStatus: "DOWNLOADED",
      parseStatus: "PARTIAL",
      errorCode: "PARSE_UNSUPPORTED",
    };
    const { fake } = await run(buildContext("FX-01", { documentIssues: [issue] }));
    expect(fake.bodyOf("/explain").documentIssues).toEqual([issue]);
  });
});

// ── 골든 6(S6): /kev 연결 거부 ──

describe("골든 6(S6) · 같은 FX-01 에서 /kev 연결 거부", () => {
  const down = () => run(buildContext("FX-01"), { routes: withKev(refusedReply) });

  it("PARTIAL·AI_UNAVAILABLE·RULES_ONLY·Kev 비활성이다", async () => {
    const { record } = await down();
    expect(record.result).toMatchObject({
      status: "PARTIAL",
      errorCode: "AI_UNAVAILABLE",
      recommendationBasis: "RULES_ONLY",
      kev: { enabled: false },
    });
  });

  it("reviewFlags 에 AI_UNAVAILABLE 이 있다", async () => {
    const { record } = await down();
    expect(record.result.reviewFlags).toContain("AI_UNAVAILABLE");
  });

  it("score·qualificationStatus·qualificationChecks 가 정상 run 과 같다", async () => {
    const normal = await run(buildContext("FX-01"));
    const { record } = await down();
    expect(record.result.score).toBe(normal.record.result.score);
    expect(record.result.qualificationStatus).toBe(normal.record.result.qualificationStatus);
    expect(record.result.qualificationChecks).toEqual(normal.record.result.qualificationChecks);
  });

  it("연결 거부는 재시도하지 않아 /kev 요청은 1번이고 /explain 은 부르지 않는다", async () => {
    const { fake } = await down();
    expect(fake.count("/kev")).toBe(1);
    expect(fake.count("/explain")).toBe(0);
  });

  it("설명은 C4 템플릿이다(source=TEMPLATE)", async () => {
    const { record } = await down();
    expect(record.meta.explanation).toEqual({
      text: record.result.explanation,
      source: "TEMPLATE",
    });
  });

  it("kevOutput·meta.model.kev 는 null, meta.errorCode 는 AI_UNAVAILABLE 이다", async () => {
    const { record } = await down();
    expect(record.kevOutput).toBeNull();
    expect(record.meta.model.kev).toBeNull();
    expect(record.meta.errorCode).toBe("AI_UNAVAILABLE");
  });

  it("input.aiUnavailableReason 은 AI_UNAVAILABLE, input.kev 는 null 이다", async () => {
    const { record } = await down();
    expect(record.input.aiUnavailableReason).toBe("AI_UNAVAILABLE");
    expect(record.input.kev).toBeNull();
  });

  it("레코드에 실패 상세(오류 코드 문자열·내부 주소)를 싣지 않는다", async () => {
    const { record } = await down();
    const text = JSON.stringify(record);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain(LEAKY_ADDRESS);
    expect(text).not.toContain("gw.test");
  });
});

// ── /kev 의 다른 장애 ──

describe("runAnalysis · /kev 의 다른 장애도 gateway 불가(AI_UNAVAILABLE·PARTIAL)다", () => {
  it("timeout 은 한 번 재시도해 /kev 요청이 2번이고 PARTIAL·AI_UNAVAILABLE 이다", async () => {
    const { record, fake } = await run(buildContext("FX-01"), { routes: withKev(timeoutReply) });
    expect(fake.count("/kev")).toBe(2);
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
  });

  it("503 AI_UNAVAILABLE(장애 주입)은 재시도 뒤 PARTIAL·AI_UNAVAILABLE 이고 /explain 을 부르지 않는다", async () => {
    const reply = jsonReply({ errorCode: "AI_UNAVAILABLE", message: "x" }, 503);
    const { record, fake } = await run(buildContext("FX-01"), { routes: withKev(reply) });
    expect(fake.count("/kev")).toBe(2);
    expect(record.result.status).toBe("PARTIAL");
    expect(fake.count("/explain")).toBe(0);
  });

  it("4xx 응답도 쓸 수 있는 Kev 가 없어 PARTIAL·AI_UNAVAILABLE 이다", async () => {
    const reply = jsonReply({ errorCode: "KO_STATE_NOT_ALLOWED", message: "x" }, 422);
    const { record } = await run(buildContext("FX-01"), { routes: withKev(reply) });
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
  });

  it("200 이지만 봉투가 계약에 맞지 않으면 PARTIAL·AI_UNAVAILABLE 이다", async () => {
    const { record } = await run(buildContext("FX-01"), {
      routes: withKev(jsonReply({ kev: "x" })),
    });
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
  });

  it("breaker 가 열려 있으면 /kev 를 보내지 않고 PARTIAL·AI_UNAVAILABLE 이며 /explain 도 부르지 않는다", async () => {
    const fake = fakeGateway({ "/health": refusedReply, ...healthyRoutes("FX-01") });
    for (let attempt = 0; attempt < 3; attempt += 1) await fake.gateway.health();
    expect(fake.gateway.breakerState().kind).toBe("OPEN");
    const store = fakeExtractionStore();
    const record = await runAnalysis(buildContext("FX-01"), buildDeps(fake.gateway, store.store));
    expect(fake.count("/kev")).toBe(0);
    expect(fake.count("/explain")).toBe(0);
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
  });

  it("kev.enabled=true 인데 wire 가 null 이면 쓸 Kev 가 없어 PARTIAL·AI_UNAVAILABLE 이고 /explain 을 부르지 않는다", async () => {
    const body = withPatch(kevUsedBody(loadKevResponses("FX-01")), (draft) => {
      draft.wire = null;
    });
    const { record, fake } = await run(buildContext("FX-01"), { routes: withKev(jsonReply(body)) });
    expect(record.result).toMatchObject({ status: "PARTIAL", errorCode: "AI_UNAVAILABLE" });
    expect(fake.count("/explain")).toBe(0);
  });

  it("kev.enabled=true 인데 wire responses 가 kev-mock 스키마를 어기면 PARTIAL 이고 kevOutput 은 null 이다", async () => {
    const responses = loadKevResponses("FX-01");
    const body = withPatch(kevUsedBody(responses), (draft) => {
      draft.wire = [{ responses: { ...responses, mandatoryRisk: { noul: 1.5 } } }];
    });
    const { record } = await run(buildContext("FX-01"), { routes: withKev(jsonReply(body)) });
    expect(record.result.status).toBe("PARTIAL");
    expect(record.kevOutput).toBeNull();
  });
});

// ── Kev 만 불가·Kev 끔 ──

describe("runAnalysis · Kev 만 불가(200 + enabled=false + KEV_UNAVAILABLE)", () => {
  const kevOnlyDown = () =>
    run(buildContext("FX-01"), { routes: withKev(jsonReply(kevDisabledBody("KEV_UNAVAILABLE"))) });

  it("COMPLETED·RULES_ONLY·errorCode null 이다(PARTIAL 사유가 아니다)", async () => {
    const { record } = await kevOnlyDown();
    expect(record.result).toMatchObject({
      status: "COMPLETED",
      recommendationBasis: "RULES_ONLY",
      errorCode: null,
    });
  });

  it("meta.extraReviewFlags 가 KEV_UNAVAILABLE 이다", async () => {
    const { record } = await kevOnlyDown();
    expect(record.meta.extraReviewFlags).toEqual(["KEV_UNAVAILABLE"]);
  });

  it("/explain 을 부르고 요청 reviewFlags 에 KEV_UNAVAILABLE 을 싣는다", async () => {
    const { fake } = await kevOnlyDown();
    expect(fake.count("/explain")).toBe(1);
    expect(fake.bodyOf("/explain")).toMatchObject({
      scoreBreakdown: { reviewFlags: expect.arrayContaining(["KEV_UNAVAILABLE"]) },
      kevSummary: null,
    });
  });

  it("kevOutput 은 null 이다", async () => {
    const { record } = await kevOnlyDown();
    expect(record.kevOutput).toBeNull();
  });
});

describe("runAnalysis · gateway 가 Kev 를 쓰지 않는다고 답함(200 + enabled=false + errorCode null)", () => {
  it("COMPLETED·RULES_ONLY 이고 extraReviewFlags 는 비었다", async () => {
    const { record } = await run(buildContext("FX-01"), {
      routes: withKev(jsonReply(kevDisabledBody(null))),
    });
    expect(record.result.status).toBe("COMPLETED");
    expect(record.result.recommendationBasis).toBe("RULES_ONLY");
    expect(record.meta.extraReviewFlags).toEqual([]);
  });
});

describe("runAnalysis · KEV_ENABLED=false", () => {
  const kevOff = () =>
    run(buildContext("FX-01", { kev: { enabled: false, questionSetVersion: "kev-qs/v0.1" } }));

  it("/kev 를 부르지 않는다", async () => {
    const { fake } = await kevOff();
    expect(fake.count("/kev")).toBe(0);
  });

  it("/explain 은 부른다(K11)", async () => {
    const { fake } = await kevOff();
    expect(fake.count("/explain")).toBe(1);
  });

  it("COMPLETED·RULES_ONLY 이고 input.kev·kevOutput·meta.model.kev 는 null 이다", async () => {
    const { record } = await kevOff();
    expect(record.result.status).toBe("COMPLETED");
    expect(record.result.recommendationBasis).toBe("RULES_ONLY");
    expect(record.input.kev).toBeNull();
    expect(record.kevOutput).toBeNull();
    expect(record.meta.model.kev).toBeNull();
  });
});

// ── 캐시 추출과 같은 job 안 재추출 ──

describe("runAnalysis · 캐시가 유효하면 다시 추출하지 않는다", () => {
  it("PENDING_REVIEW 캐시도 유효하면 loadSource·/extract·save 를 하나도 부르지 않는다", async () => {
    const context = buildContext("FX-01", {
      extraction: {
        status: "PENDING_REVIEW",
        payload: loadExtraction("FX-01"),
        errorCode: null,
        translations: null,
      },
    });
    const { fake, store } = await run(context);
    expect(store.loads).toHaveLength(0);
    expect(fake.count("/extract")).toBe(0);
    expect(store.saves).toHaveLength(0);
  });
});

describe("runAnalysis · 캐시 행이 없으면 같은 job 안에서 다시 추출한다(e8 정정)", () => {
  const noCache = () => buildContext("FX-01", { extraction: null });
  const extracted = () => withExtract(jsonReply(extractBody(loadExtraction("FX-01"))));

  it("loadSource 를 그 context 로 한 번 부른다", async () => {
    const context = noCache();
    const { store } = await run(context, { routes: extracted() });
    expect(store.loads).toHaveLength(1);
    expect(store.loads[0]).toBe(context);
  });

  it("/extract 를 한 번 부르고 본문은 03 §2.1 ExtractRequest 다", async () => {
    const context = noCache();
    const source = sourceFor("FX-01");
    const { fake } = await run(context, { routes: extracted() });
    expect(fake.count("/extract")).toBe(1);
    expect(fake.bodyOf("/extract")).toEqual({
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

  it("200 COMPLETED 면 추출 레코드(payload 포함)를 save 에 한 번 넘긴다", async () => {
    const translations = { summary: "Sejong City is recruiting bidders." };
    const reply = jsonReply(extractBody(loadExtraction("FX-01"), { translations }));
    const { store } = await run(noCache(), { routes: withExtract(reply) });
    const expected: ExtractionRecord = {
      bidId: "bid-FX-01",
      revisionId: "FX-01#01",
      requestId: "req-FX-01",
      status: "COMPLETED",
      payload: loadExtraction("FX-01"),
      translations,
      errorCode: null,
      injectionSuspected: false,
      warnings: [],
      extractMs: EXTRACT_MS,
    };
    expect(store.saves).toEqual([expected]);
  });

  it("다시 추출한 값으로 분석해 COMPLETED 이고 /kev 를 부른다", async () => {
    const { record, fake } = await run(noCache(), { routes: extracted() });
    expect(record.result.status).toBe("COMPLETED");
    expect(fake.count("/kev")).toBe(1);
  });

  it("score·recommendation 이 같은 fixture 의 캐시 run 과 같다", async () => {
    const cached = await run(buildContext("FX-01"));
    const { record } = await run(noCache(), { routes: extracted() });
    expect(record.result.score).toBe(cached.record.result.score);
    expect(record.result.recommendation).toBe(cached.record.result.recommendation);
  });

  it("input.extraction 은 다시 추출한 값이고 aiUnavailableReason 키는 없다", async () => {
    const { record } = await run(noCache(), { routes: extracted() });
    expect(record.input.extraction).toEqual(loadExtraction("FX-01"));
    expect(Object.keys(record.input)).not.toContain("aiUnavailableReason");
  });

  it("meta.model.qwen 은 다시 추출한 값의 모델 정보다", async () => {
    const extraction = loadExtraction("FX-01");
    const { record } = await run(noCache(), { routes: extracted() });
    expect(record.meta.model.qwen).toEqual({
      name: extraction.model.name,
      promptVersion: extraction.model.promptVersion,
      promptHash: extraction.model.promptHash,
    });
  });

  it("fixtureId 가 null(live)이면 /extract 본문에 fixtureId 키가 없다", async () => {
    const context = buildContext("FX-01", { extraction: null, fixtureId: null });
    const { fake } = await run(context, { routes: extracted() });
    expect(Object.keys(fake.bodyOf("/extract"))).not.toContain("fixtureId");
  });
});

describe("runAnalysis · 쓸 수 없는 캐시도 없는 것으로 보고 다시 추출한다", () => {
  const extracted = () => withExtract(jsonReply(extractBody(loadExtraction("FX-01"))));

  it("캐시 FAILED(QWEN_UNAVAILABLE)면 /extract 를 다시 부르고 COMPLETED 가 된다", async () => {
    const context = buildContext("FX-01", {
      extraction: {
        status: "FAILED",
        payload: null,
        errorCode: "QWEN_UNAVAILABLE",
        translations: null,
      },
    });
    const { record, fake } = await run(context, { routes: extracted() });
    expect(fake.count("/extract")).toBe(1);
    expect(record.result.status).toBe("COMPLETED");
  });

  it("캐시 payload 가 스키마 위반이면 /extract 를 다시 부르고 COMPLETED 가 된다", async () => {
    const context = buildContext("FX-01", {
      extraction: {
        status: "COMPLETED",
        payload: invalidPayload(),
        errorCode: null,
        translations: null,
      },
    });
    const { record, fake } = await run(context, { routes: extracted() });
    expect(fake.count("/extract")).toBe(1);
    expect(record.result.status).toBe("COMPLETED");
  });
});

describe("runAnalysis · /extract 실패만 PARTIAL 이다", () => {
  const noCache = () => buildContext("FX-01", { extraction: null });

  it("연결 거부 → PARTIAL·AI_UNAVAILABLE 이고 input.extraction 은 null 이다", async () => {
    const { record } = await run(noCache(), { routes: withExtract(refusedReply) });
    expect(record.result).toMatchObject({ status: "PARTIAL", errorCode: "AI_UNAVAILABLE" });
    expect(record.input.extraction).toBeNull();
  });

  it("연결 거부 → save·/kev 를 부르지 않는다", async () => {
    const { fake, store } = await run(noCache(), { routes: withExtract(refusedReply) });
    expect(store.saves).toHaveLength(0);
    expect(fake.count("/kev")).toBe(0);
  });

  it("연결 거부 → 죽은 gateway 로 보고 /explain 도 부르지 않는다", async () => {
    const { record, fake } = await run(noCache(), { routes: withExtract(refusedReply) });
    expect(fake.count("/explain")).toBe(0);
    expect(record.meta.explanation.source).toBe("TEMPLATE");
  });

  it("422 → AI_UNAVAILABLE 로 분류된 run 이라 /explain 을 부르지 않는다(§5-5)", async () => {
    const reply = jsonReply({ detail: [{ loc: ["body"], msg: "x", type: "missing" }] }, 422);
    const { record, fake } = await run(noCache(), { routes: withExtract(reply) });
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
    expect(fake.count("/explain")).toBe(0);
  });

  it("연결 거부 → 레코드에 실패 상세를 싣지 않는다", async () => {
    const { record } = await run(noCache(), { routes: withExtract(refusedReply) });
    const text = JSON.stringify(record);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain(LEAKY_ADDRESS);
  });

  it("timeout → 한 번 재시도해 /extract 요청이 2번이고 PARTIAL·AI_UNAVAILABLE, save·/explain 없음", async () => {
    const { record, fake, store } = await run(noCache(), { routes: withExtract(timeoutReply) });
    expect(fake.count("/extract")).toBe(2);
    expect(record.result.errorCode).toBe("AI_UNAVAILABLE");
    expect(store.saves).toHaveLength(0);
    expect(fake.count("/explain")).toBe(0);
  });

  it("200 FAILED·QWEN_UNAVAILABLE → PARTIAL·QWEN_UNAVAILABLE 이다", async () => {
    const reply = jsonReply(extractFailedBody("QWEN_UNAVAILABLE"));
    const { record } = await run(noCache(), { routes: withExtract(reply) });
    expect(record.result).toMatchObject({ status: "PARTIAL", errorCode: "QWEN_UNAVAILABLE" });
    expect(record.result.reviewFlags).toContain("QWEN_UNAVAILABLE");
  });

  it("200 FAILED·QWEN_UNAVAILABLE → FAILED 행(payload null)을 save 에 한 번 넘긴다", async () => {
    const reply = jsonReply(extractFailedBody("QWEN_UNAVAILABLE"));
    const { store } = await run(noCache(), { routes: withExtract(reply) });
    const expected: ExtractionRecord = {
      bidId: "bid-FX-01",
      revisionId: "FX-01#01",
      requestId: "req-FX-01",
      status: "FAILED",
      payload: null,
      translations: null,
      errorCode: "QWEN_UNAVAILABLE",
      injectionSuspected: false,
      warnings: [],
      extractMs: EXTRACT_MS,
    };
    expect(store.saves).toEqual([expected]);
  });

  it("200 FAILED → /kev 는 부르지 않고 gateway 는 살아 있으니 /explain 은 부른다", async () => {
    const reply = jsonReply(extractFailedBody("QWEN_UNAVAILABLE"));
    const { fake } = await run(noCache(), { routes: withExtract(reply) });
    expect(fake.count("/kev")).toBe(0);
    expect(fake.count("/explain")).toBe(1);
  });

  it("200 FAILED·errorCode null → PARTIAL·EXTRACTION_FAILED 이고 FAILED 행을 errorCode 그대로(null) 저장한다", async () => {
    const reply = jsonReply(extractFailedBody(null));
    const { record, store } = await run(noCache(), { routes: withExtract(reply) });
    expect(record.result.errorCode).toBe("EXTRACTION_FAILED");
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]).toMatchObject({ status: "FAILED", payload: null, errorCode: null });
  });

  it("200 COMPLETED 인데 payload 가 스키마 위반 → PARTIAL·EXTRACTION_FAILED 이다", async () => {
    const reply = jsonReply(extractBody(invalidPayload()));
    const { record } = await run(noCache(), { routes: withExtract(reply) });
    expect(record.result).toMatchObject({ status: "PARTIAL", errorCode: "EXTRACTION_FAILED" });
    expect(record.input.aiUnavailableReason).toBe("EXTRACTION_FAILED");
  });

  it("200 COMPLETED 인데 payload 가 스키마 위반 → save·/kev 는 부르지 않고 /explain 은 부른다", async () => {
    const reply = jsonReply(extractBody(invalidPayload()));
    const { fake, store } = await run(noCache(), { routes: withExtract(reply) });
    expect(store.saves).toHaveLength(0);
    expect(fake.count("/kev")).toBe(0);
    expect(fake.count("/explain")).toBe(1);
  });

  it("200 PENDING_REVIEW(인젝션 의심) → 그 추출로 분석해 INJECTION_SUSPECTED 를 내고 /kev 를 부른다", async () => {
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.injectionSuspected = true;
    });
    const reply = jsonReply(
      extractBody(payload, { status: "PENDING_REVIEW", injectionSuspected: true }),
    );
    const { record, fake } = await run(noCache(), { routes: withExtract(reply) });
    expect(record.result.injectionSuspected).toBe(true);
    expect(record.result.reviewFlags).toContain("INJECTION_SUSPECTED");
    expect(fake.count("/kev")).toBe(1);
  });

  it("200 PENDING_REVIEW → PENDING_REVIEW 행을 save 에 한 번 넘긴다", async () => {
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.injectionSuspected = true;
    });
    const reply = jsonReply(
      extractBody(payload, { status: "PENDING_REVIEW", injectionSuspected: true }),
    );
    const { store } = await run(noCache(), { routes: withExtract(reply) });
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]).toMatchObject({
      status: "PENDING_REVIEW",
      payload,
      injectionSuspected: true,
    });
  });

  it("loadSource 가 던지면 그 오류를 그대로 던지고 /extract 는 부르지 않는다", async () => {
    const loadError = new Error("원문 읽기 실패");
    const fake = fakeGateway(withExtract(jsonReply(extractBody(loadExtraction("FX-01")))));
    const store = fakeExtractionStore({ loadError });
    await expect(runAnalysis(noCache(), buildDeps(fake.gateway, store.store))).rejects.toBe(
      loadError,
    );
    expect(fake.count("/extract")).toBe(0);
  });

  it("추출 save 가 던지면 그 오류를 그대로 던진다", async () => {
    const saveError = new Error("추출 저장 실패");
    const fake = fakeGateway(withExtract(jsonReply(extractBody(loadExtraction("FX-01")))));
    const store = fakeExtractionStore({ saveError });
    await expect(runAnalysis(noCache(), buildDeps(fake.gateway, store.store))).rejects.toBe(
      saveError,
    );
  });
});

// ── /explain ──

describe("runAnalysis · /explain 결과와 설명 문장(K3·K11)", () => {
  it("fallback=false 면 모델 문장이고 source=MODEL 이다", async () => {
    const routes = {
      ...healthyRoutes("FX-01"),
      "/explain": jsonReply(explainBody("모델 설명", false)),
    };
    const { record } = await run(buildContext("FX-01"), { routes });
    expect(record.meta.explanation).toEqual({ text: "모델 설명", source: "MODEL" });
  });

  it("fallback=true 면 gateway 문장이 아니라 C4 result.explanation 이고 source=TEMPLATE 다", async () => {
    const { record } = await run(buildContext("FX-01"));
    expect(record.meta.explanation).toEqual({
      text: record.result.explanation,
      source: "TEMPLATE",
    });
    expect(record.meta.explanation.text).not.toBe(MOCK_EXPLAIN_TEXT);
  });

  it("/explain 5xx 는 재시도 뒤 템플릿이고 status 는 COMPLETED 그대로다", async () => {
    const routes = { ...healthyRoutes("FX-01"), "/explain": jsonReply({ errorCode: "X" }, 500) };
    const { record, fake } = await run(buildContext("FX-01"), { routes });
    expect(fake.count("/explain")).toBe(2);
    expect(record.meta.explanation.source).toBe("TEMPLATE");
    expect(record.result.status).toBe("COMPLETED");
  });

  it("/explain 연결 거부는 result 를 바꾸지 않는다(정상 run 과 깊게 같다)", async () => {
    const normal = await run(buildContext("FX-01"));
    const routes = { ...healthyRoutes("FX-01"), "/explain": refusedReply };
    const { record } = await run(buildContext("FX-01"), { routes });
    expect(record.result).toEqual(normal.record.result);
    expect(record.meta.errorCode).toBeNull();
  });
});

// ── K1 인용 검증 실패 ──

describe("runAnalysis · K1 인용 검증 실패(FX-13 복사본)", () => {
  it("경고 CITATION_FAILED:qualifications 가 있으면 meta.extraReviewFlags 가 CITATION_FAILED 다", async () => {
    const { record } = await run(citationFailedContext("warning"), {
      routes: { "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)) },
    });
    expect(record.meta.extraReviewFlags).toEqual(["CITATION_FAILED"]);
  });

  it("필드 note 가 CITATION_FAILED 면 meta.extraReviewFlags 가 CITATION_FAILED 다", async () => {
    const { record } = await run(citationFailedContext("note"), {
      routes: { "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)) },
    });
    expect(record.meta.extraReviewFlags).toEqual(["CITATION_FAILED"]);
  });

  it("C4 result.reviewFlags 에는 CITATION_FAILED 를 넣지 않는다", async () => {
    const { record } = await run(citationFailedContext("note"), {
      routes: { "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)) },
    });
    expect(record.result.reviewFlags).not.toContain("CITATION_FAILED");
  });

  it("/explain 요청 reviewFlags 에는 CITATION_FAILED 를 싣는다", async () => {
    const { fake } = await run(citationFailedContext("warning"), {
      routes: { "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)) },
    });
    expect(fake.bodyOf("/explain")).toMatchObject({
      scoreBreakdown: { reviewFlags: expect.arrayContaining(["CITATION_FAILED"]) },
    });
  });
});

// ── 규칙 불변 ──

describe("runAnalysis · Kev 분포를 바꿔도 규칙 결과는 같다(03 §5.5)", () => {
  it("FX-01 에 NO_BID 0.9·필수위험 0.9 를 줘도 score·recommendation·자격·요소가 같다", async () => {
    const normal = await run(buildContext("FX-01"));
    const responses = withPatch(loadKevResponses("FX-01"), (draft) => {
      draft.recommendation = {
        choice: "NO_BID",
        confidence: 0.9,
        probabilities: { BID: 0.05, WATCH: 0.05, NO_BID: 0.9 },
      };
      draft.mandatoryRisk = { noul: 0.9 };
      draft.needsHumanReview = { noul: 0.9 };
    });
    const { record } = await run(buildContext("FX-01"), {
      routes: withKev(jsonReply(kevUsedBody(responses))),
    });
    expect(record.result.score).toBe(normal.record.result.score);
    expect(record.result.recommendation).toBe(normal.record.result.recommendation);
    expect(record.result.qualificationStatus).toBe(normal.record.result.qualificationStatus);
    expect(record.result.qualificationChecks).toEqual(normal.record.result.qualificationChecks);
    expect(record.result.factors).toEqual(normal.record.result.factors);
  });

  it("FX-03(골든 NO-BID)에 BID 0.9 를 줘도 권고는 골든 그대로다", async () => {
    const golden = loadGolden("FX-03");
    const responses = withPatch(loadKevResponses("FX-03"), (draft) => {
      draft.recommendation = {
        choice: "BID",
        confidence: 0.9,
        probabilities: { BID: 0.9, WATCH: 0.05, NO_BID: 0.05 },
      };
    });
    const { record } = await run(buildContext("FX-03"), {
      routes: withKev(jsonReply(kevUsedBody(responses))),
    });
    expect(record.result.recommendation).toBe(golden.recommendation);
    expect(record.result.score).toBe(golden.score);
  });
});

// ── 재현성 ──

describe("runAnalysis · 재현성", () => {
  it("같은 context·같은 가짜 gateway·같은 now 면 inputSnapshotHash 가 같다", async () => {
    const first = await run(buildContext("FX-02"));
    const second = await run(buildContext("FX-02"));
    expect(second.record.result.inputSnapshotHash).toBe(first.record.result.inputSnapshotHash);
    expect(first.record.result.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("같은 조건이면 레코드 전체가 깊게 같다", async () => {
    const first = await run(buildContext("FX-02"));
    const second = await run(buildContext("FX-02"));
    expect(second.record).toEqual(first.record);
  });
});

// ── 입력 오류 ──

describe("runAnalysis · 규칙 엔진 입력이 계약에 맞지 않으면 AnalysisInputError", () => {
  it("profile.revision=0 이면 AnalysisInputError 를 던진다", async () => {
    const context = withPatch(buildContext("FX-01"), (draft) => {
      draft.profile.revision = 0;
    });
    await expect(run(context)).rejects.toBeInstanceOf(AnalysisInputError);
  });

  it("AnalysisInputError 는 Error 이고 issues 에 틀린 경로를 싣는다", async () => {
    const context = withPatch(buildContext("FX-01"), (draft) => {
      draft.profile.revision = 0;
    });
    const error = await run(context).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AnalysisInputError);
    if (!(error instanceof AnalysisInputError)) return;
    expect(error.issues.some((issue) => issue.startsWith("profile.revision:"))).toBe(true);
  });

  it("오류 message·issues 에 틀린 값을 싣지 않는다", async () => {
    const secret = "예산-비공개-값-12억";
    const context = withPatch(buildContext("FX-01"), (draft) => {
      draft.bid.budgetKrw = secret;
    });
    const error = await run(context).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AnalysisInputError);
    if (!(error instanceof AnalysisInputError)) return;
    expect(error.issues.some((issue) => issue.startsWith("bid.budgetKrw:"))).toBe(true);
    expect(error.message).not.toContain(secret);
    expect(error.issues.join("\n")).not.toContain(secret);
  });
});

// ── analyzeAndSave ──

describe("analyzeAndSave · runAnalysis 뒤 sink.save", () => {
  function fakeSink(saveError?: Error) {
    const saved: AnalysisRunRecord[] = [];
    const sink: AnalysisRunSink = {
      save: async (record) => {
        saved.push(record);
        if (saveError) throw saveError;
      },
    };
    return { sink, saved };
  }

  it("runAnalysis 결과를 sink.save 에 한 번 넘기고 그 레코드를 돌려준다", async () => {
    const fake = fakeGateway(healthyRoutes("FX-01"));
    const store = fakeExtractionStore();
    const { sink, saved } = fakeSink();
    const returned = await analyzeAndSave(buildContext("FX-01"), {
      ...buildDeps(fake.gateway, store.store),
      sink,
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(returned);
    expect(returned.result.score).toBe(loadGolden("FX-01").score);
  });

  it("sink.save 가 던지면 그 오류를 그대로 던진다", async () => {
    const saveError = new Error("score_runs 저장 실패");
    const fake = fakeGateway(healthyRoutes("FX-01"));
    const store = fakeExtractionStore();
    const { sink } = fakeSink(saveError);
    await expect(
      analyzeAndSave(buildContext("FX-01"), { ...buildDeps(fake.gateway, store.store), sink }),
    ).rejects.toBe(saveError);
  });

  it("분석이 입력 오류로 실패하면 sink.save 를 부르지 않는다", async () => {
    const context = withPatch(buildContext("FX-01"), (draft) => {
      draft.profile.revision = 0;
    });
    const fake = fakeGateway(healthyRoutes("FX-01"));
    const store = fakeExtractionStore();
    const { sink, saved } = fakeSink();
    await expect(
      analyzeAndSave(context, { ...buildDeps(fake.gateway, store.store), sink }),
    ).rejects.toBeInstanceOf(AnalysisInputError);
    expect(saved).toHaveLength(0);
  });
});

// ── 배럴 ──

describe("@/server/analysis 배럴(설계 §3)", () => {
  it.each([
    "runAnalysis",
    "analyzeAndSave",
    "AnalysisInputError",
    "withStructuredSeq",
    "toKstDate",
    "toIdempotencyKey",
  ])("값 %s 를 내보낸다", (name) => {
    expect(Object.keys(analysisBarrel)).toContain(name);
  });

  it.each([
    "readCachedExtraction",
    "readExtractResult",
    "toExtractRequest",
    "toKevRequest",
    "toKevWire",
    "collectEvidence",
    "extraReviewFlags",
    "toExplainRequest",
    "chooseExplanation",
    "toModelMeta",
  ])("내부 순수 함수 %s 는 내보내지 않는다", (name) => {
    expect(Object.keys(analysisBarrel)).not.toContain(name);
  });

  it("배럴의 runAnalysis 는 analysis.service 의 runAnalysis 다", () => {
    expect(analysisBarrel.runAnalysis).toBe(runAnalysis);
  });
});
