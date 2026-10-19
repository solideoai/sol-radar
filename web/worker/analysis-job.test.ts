import { UnrecoverableError } from "bullmq";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ANALYSIS_JOB,
  type AnalysisRunRecord,
  type ExtractionRecord,
  type LoadedAnalysisContext,
  type RunMode,
} from "@/server/analysis";
import {
  createAnalysisJobDeps,
  createAnalysisProcessor,
  createAnalysisWorker,
  type AnalysisJobDeps,
  type AnalysisJobLike,
  type AnalysisJobSummary,
} from "@/worker/analysis-job";
import {
  CACHED_EXTRACTION_ID,
  CALCULATION_DATE,
  COMPANY_PROFILE_ID,
  HEALTH_QWEN,
  IDEMPOTENCY_KEY,
  LEAKY_ADDRESS,
  ORG_ID,
  OTHER_ORG_ID,
  OTHER_SCORE_RUN_ID,
  QUEUED_AT,
  REQUEST_ID,
  SCORE_RUN_ID,
  bidContent,
  clock,
  downRoutes,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  fakeLoader,
  fakeSink,
  fakeTracker,
  healthyRoutes,
  jsonReply,
  kevUsedBody,
  loadBid,
  loadExtraction,
  loadKevResponses,
  loadProfile,
  loaded,
  refusedReply,
  withPatch,
  type EventLog,
  type GatewayRoutes,
  type LoadCall,
} from "@/worker/analysis-job.test-support";

// worker analysis job 처리 함수(createAnalysisProcessor).
// gateway 는 실제 createGatewayClient + 가짜 fetch, port(loader·tracker·추출 저장·sink)는 가짜다. Redis·네트워크는 쓰지 않는다.
// 시계는 CALCULATION_DATE 의 KST 18:00 부근으로 고정한다(runAnalysis 의 기준일이 골든과 같은 날이 되게).

const JOB_ID = `analysis_${ORG_ID}_${SCORE_RUN_ID}`;

/** now() 가 차례로 돌려줄 시각. 처리 함수 시작(t0) → runAnalysis 시작 → runAnalysis 끝 → 로그. */
const T1 = `${CALCULATION_DATE}T09:00:00.000Z`;
const T2 = `${CALCULATION_DATE}T09:00:00.250Z`;
const T3 = `${CALCULATION_DATE}T09:00:02.500Z`;
const T4 = `${CALCULATION_DATE}T09:00:02.750Z`;

const jobData = () => ({
  orgId: ORG_ID,
  scoreRunId: SCORE_RUN_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
});

function job(overrides: Partial<AnalysisJobLike> = {}): AnalysisJobLike {
  return {
    id: JOB_ID,
    name: ANALYSIS_JOB,
    data: jobData(),
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  };
}

type LoadPlan = (
  index: number,
  state: { call: LoadCall; extractionSaves: ExtractionRecord[] },
) => LoadedAnalysisContext | null | Error;

type SetupOptions = {
  routes?: GatewayRoutes;
  load?: LoadPlan;
  tracker?: Parameters<typeof fakeTracker>[1];
  sinkErrors?: (Error | null)[];
  env?: { runMode: RunMode; given: boolean };
  times?: string[];
};

/** 처리 함수 하나와 그 가짜 port 들. 같은 처리 함수를 여러 번 부르면 BullMQ 의 재시도처럼 port·gateway 상태가 이어진다. */
function setup(options: SetupOptions = {}) {
  const events: EventLog = [];
  const fake = fakeGateway(options.routes ?? healthyRoutes());
  const extraction = fakeExtractionStore(events);
  const plan: LoadPlan = options.load ?? (() => loaded());
  const loader = fakeLoader(events, (call, index) =>
    plan(index, { call, extractionSaves: extraction.saves }),
  );
  const tracker = fakeTracker(events, options.tracker);
  const sink = fakeSink(events, options.sinkErrors);
  const time = clock(...(options.times ?? [T1, T2, T3, T4]));
  const lines: string[] = [];
  const deps: AnalysisJobDeps = {
    gateway: fake.gateway,
    loader: loader.loader,
    tracker: tracker.tracker,
    extraction: extraction.store,
    sink: sink.sink,
    now: time.now,
    env: options.env ?? { runMode: "mock", given: true },
    log: (line) => {
      lines.push(line);
    },
  };
  return {
    processor: createAnalysisProcessor(deps),
    events,
    fake,
    extraction,
    loader,
    tracker,
    sink,
    time,
    lines,
  };
}

type Settled = { ok: true; value: AnalysisJobSummary } | { ok: false; error: unknown };

async function settle(promise: Promise<AnalysisJobSummary>): Promise<Settled> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

/** 처리 함수를 한 번 부른다. 던져도 시험이 끝나지 않게 결과를 값으로 받는다. */
async function runJob(options: SetupOptions = {}, overrides: Partial<AnalysisJobLike> = {}) {
  const harness = setup(options);
  const settled = await settle(harness.processor(job(overrides)));
  return { ...harness, settled };
}

function summaryOf(settled: Settled): AnalysisJobSummary {
  if (!settled.ok) throw settled.error;
  return settled.value;
}

function errorOf(settled: Settled): unknown {
  if (settled.ok) throw new Error("job 이 던지지 않았다");
  return settled.error;
}

function savedRecord(harness: { sink: { attempts: AnalysisRunRecord[] } }): AnalysisRunRecord {
  const record = harness.sink.attempts.at(-1);
  if (!record) throw new Error("sink.save 가 불리지 않았다");
  return record;
}

/** 로그가 정확히 한 줄이고 JSON 객체라고 확인한 뒤 그 객체를 돌려준다. */
function onlyLog(lines: string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  const parsed: unknown = JSON.parse(lines[0]);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("로그가 JSON 객체가 아니다");
  }
  return { ...parsed };
}

const SUCCESS_LOG_KEYS = [
  "attempt",
  "bidId",
  "elapsedMs",
  "errorCode",
  "event",
  "jobId",
  "orgId",
  "recommendationBasis",
  "requestId",
  "runModeMismatch",
  "scoreRunId",
  "settingsSource",
  "status",
];

/** 캐시 추출이 없는 FX-01. 같은 job 안에서 /extract 를 부른다. */
const noCacheRoutes = (): GatewayRoutes => ({
  ...healthyRoutes(),
  "/extract": jsonReply(extractBody(loadExtraction("FX-01"))),
});

// ── 정상 ──

describe("createAnalysisProcessor · 정상(FX-01, 캐시 추출 + 3b mock gateway)", () => {
  it("summary 는 ANALYZED·COMPLETED·RULES_WITH_KEV_ASSIST·errorCode null·job 의 idempotencyKey 다", async () => {
    const { settled } = await runJob();
    expect(summaryOf(settled)).toEqual({
      outcome: "ANALYZED",
      idempotencyKey: IDEMPOTENCY_KEY,
      status: "COMPLETED",
      errorCode: null,
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
    });
  });

  it("sink.save 를 한 번 부른다", async () => {
    const { sink } = await runJob();
    expect(sink.attempts).toHaveLength(1);
  });

  it("markRunning 을 한 번, health 설정과 첫 now(t0)로 부른다", async () => {
    const { tracker } = await runJob();
    expect(tracker.running).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        runMode: "mock",
        aiProvider: "mock",
        startedAt: T1,
      },
    ]);
  });

  it("markFailed 는 부르지 않는다", async () => {
    const { tracker } = await runJob();
    expect(tracker.failed).toHaveLength(0);
  });

  it("port 호출 순서는 loader.load → markRunning → sink.save 다", async () => {
    const { events } = await runJob();
    expect(events).toEqual(["loader.load", "tracker.markRunning", "sink.save"]);
  });

  it("loader 를 부르기 전에 /health 를 한 번 부른다", async () => {
    let healthCountAtLoad = -1;
    const harness = setup({
      load: () => {
        healthCountAtLoad = harness.fake.count("/health");
        return loaded();
      },
    });
    await harness.processor(job());
    expect(healthCountAtLoad).toBe(1);
  });

  it("loader 에 job 데이터의 orgId·scoreRunId 만 넘긴다", async () => {
    const { loader } = await runJob();
    expect(loader.calls.map((call) => call.target)).toEqual([
      { orgId: ORG_ID, scoreRunId: SCORE_RUN_ID },
    ]);
  });

  it("loader 에 넘긴 cacheKey 는 health.qwen 의 model·promptHash 다", async () => {
    const { loader } = await runJob();
    expect(loader.calls[0]?.cacheKey).toEqual({
      modelName: HEALTH_QWEN.model,
      promptHash: HEALTH_QWEN.promptHash,
    });
  });

  it("캐시를 썼으므로 /extract·loadSource·추출 save 를 부르지 않는다", async () => {
    const { fake, extraction } = await runJob();
    expect(fake.count("/extract")).toBe(0);
    expect(extraction.sources).toHaveLength(0);
    expect(extraction.saves).toHaveLength(0);
  });

  it("/health·/kev·/explain 을 한 번씩 부른다", async () => {
    const { fake } = await runJob();
    expect([fake.count("/health"), fake.count("/kev"), fake.count("/explain")]).toEqual([1, 1, 1]);
  });

  it("저장 레코드의 orgId·scoreRunId·requestId·idempotencyKey 는 job 데이터 값이다", async () => {
    const record = savedRecord(await runJob());
    expect({
      orgId: record.orgId,
      scoreRunId: record.scoreRunId,
      requestId: record.requestId,
      idempotencyKey: record.idempotencyKey,
    }).toEqual({
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("저장 레코드의 bidId·revisionId·companyProfileId 는 loader 값이다", async () => {
    const record = savedRecord(await runJob());
    expect({
      bidId: record.bidId,
      revisionId: record.revisionId,
      companyProfileId: record.companyProfileId,
    }).toEqual({
      bidId: "bid-FX-01",
      revisionId: loadBid("FX-01").revisionId,
      companyProfileId: COMPANY_PROFILE_ID,
    });
  });

  it("캐시를 썼으면 record.extractionId 는 캐시 행의 id 다", async () => {
    expect(savedRecord(await runJob()).extractionId).toBe(CACHED_EXTRACTION_ID);
  });

  it("meta.runMode·meta.model.provider 는 health 의 runMode·provider 다", async () => {
    const record = savedRecord(
      await runJob({ routes: healthyRoutes("FX-01", { runMode: "fixture", provider: "local" }) }),
    );
    expect([record.meta.runMode, record.meta.model.provider]).toEqual(["fixture", "local"]);
  });

  it("meta.queuedAt 은 loader 가 준 queuedAt 이다", async () => {
    expect(savedRecord(await runJob()).meta.queuedAt).toBe(QUEUED_AT);
  });
});

// ── 로그 ──

describe("createAnalysisProcessor · 성공 로그", () => {
  it("log 를 정확히 한 번, 줄바꿈 없는 JSON 한 줄로 부른다", async () => {
    const { lines } = await runJob();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("필드는 13개뿐이다", async () => {
    const { lines } = await runJob();
    expect(Object.keys(onlyLog(lines)).toSorted()).toEqual(SUCCESS_LOG_KEYS);
  });

  it("필드 값은 job·loader·결과·설정에서 온다", async () => {
    const { lines } = await runJob();
    expect(onlyLog(lines)).toEqual({
      event: "analysis.completed",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      bidId: "bid-FX-01",
      attempt: 1,
      status: "COMPLETED",
      errorCode: null,
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
      settingsSource: "HEALTH",
      runModeMismatch: false,
      elapsedMs: 2_750,
    });
  });

  it("공고 제목·발주기관·공고 원문·회사 이름을 싣지 않는다", async () => {
    const { lines } = await runJob();
    const bid = loadBid("FX-01");
    const forbidden = [
      bid.title,
      bid.agency,
      bidContent("FX-01").slice(0, 20),
      loadProfile().name,
    ].filter((text): text is string => typeof text === "string" && text !== "");
    // fixture 에 네 값이 모두 있어야 이 시험이 무언가를 본다.
    expect(forbidden).toHaveLength(4);
    expect(forbidden.filter((text) => lines[0].includes(text))).toEqual([]);
  });

  it("attempt 는 attemptsMade + 1 이다", async () => {
    const { lines } = await runJob({}, { attemptsMade: 2 });
    expect(onlyLog(lines).attempt).toBe(3);
  });

  it("job.id 가 없으면 jobId 는 null 이다", async () => {
    const { lines } = await runJob({}, { id: undefined });
    expect(onlyLog(lines).jobId).toBeNull();
  });

  it("env SOL_RUN_MODE 와 health runMode 가 다르면 runModeMismatch=true 이고 처리는 health 값이다", async () => {
    const { lines, tracker } = await runJob({ env: { runMode: "live", given: true } });
    expect(onlyLog(lines)).toMatchObject({ runModeMismatch: true, settingsSource: "HEALTH" });
    expect(tracker.running[0]?.runMode).toBe("mock");
  });
});

// ── 성공 로그의 진단(C5-B 실패 분류) ──
// 3e 처럼 gateway 가 200 을 냈는데 분석이 틀어지면 어느 쪽(/extract·/kev)이 무엇(실패 종류·issue 경로)으로 틀렸는지 로그로 바로 찾게 한다.
// 레코드의 diagnostics(extract·kev)를 extractFailure·extractIssues·kevFailure·kevIssues 로 옮긴다.
// 진단이 없는 쪽은 키를 넣지 않는다(실패 로그의 errorCode·markFailedError 와 같은 방식). 그래서 정상 run 의 13개 필드는 그대로다.
// issues 는 "경로: 코드" 만이고 값·message 를 싣지 않는다(docs/14).

const DIAGNOSTIC_KEYS = ["extractFailure", "extractIssues", "kevFailure", "kevIssues"];

/** 3e 통합 결함 재현: 3b mock 공식 경로의 /kev 200 본문. wire 의 fit 에 probabilities·confidence 가 없다(services/ai 13fcb96 이 고침). */
function kevFitDefectBody() {
  const responses = loadKevResponses("FX-01");
  return {
    ...kevUsedBody(responses),
    wire: [
      {
        responses: {
          ...responses,
          fit: { score: responses.fit.score, legend: responses.fit.legend },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
        latency_ms: 0,
      },
    ],
  };
}

/** issue 한 줄의 모양: "경로: 코드". */
const ISSUE_LINE = /^[A-Za-z0-9_.()]+: [a-z_]+$/;

describe("createAnalysisProcessor · 성공 로그의 진단(C5-B 실패 분류)", () => {
  it("정상 run 이면 진단 키를 넣지 않는다", async () => {
    const { lines } = await runJob();
    const log = onlyLog(lines);
    expect(DIAGNOSTIC_KEYS.filter((key) => key in log)).toEqual([]);
  });

  it("/kev 3b fit 결함이면 kevFailure WIRE_INVALID·kevIssues 두 경로를 싣고 COMPLETED·RULES_ONLY 다", async () => {
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/kev": jsonReply(kevFitDefectBody()) },
    });
    expect(onlyLog(lines)).toMatchObject({
      event: "analysis.completed",
      status: "COMPLETED",
      errorCode: null,
      recommendationBasis: "RULES_ONLY",
      kevFailure: "WIRE_INVALID",
      kevIssues: [
        "responses.fit.probabilities: invalid_type",
        "responses.fit.confidence: invalid_type",
      ],
    });
  });

  it("/kev 만 진단이 있으면 extractFailure·extractIssues 키는 없다", async () => {
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/kev": jsonReply(kevFitDefectBody()) },
    });
    const log = onlyLog(lines);
    expect(["extractFailure", "extractIssues"].filter((key) => key in log)).toEqual([]);
  });

  it("/kev 3b fit 결함이면 필드는 13개 + kevFailure·kevIssues 의 15개다", async () => {
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/kev": jsonReply(kevFitDefectBody()) },
    });
    expect(Object.keys(onlyLog(lines)).toSorted()).toEqual(
      [...SUCCESS_LOG_KEYS, "kevFailure", "kevIssues"].toSorted(),
    );
  });

  it("/kev 422 면 kevFailure HTTP_4XX·kevIssues [] 이고 오류 본문의 message 를 싣지 않는다", async () => {
    const reply = jsonReply(
      { errorCode: "KO_STATE_NOT_ALLOWED", message: "SECRET-원문-문장" },
      422,
    );
    const { lines } = await runJob({ routes: { ...healthyRoutes(), "/kev": reply } });
    expect(onlyLog(lines)).toMatchObject({
      status: "COMPLETED",
      kevFailure: "HTTP_4XX",
      kevIssues: [],
    });
    expect(lines[0]).not.toContain("SECRET");
    expect(lines[0]).not.toContain("KO_STATE_NOT_ALLOWED");
  });

  it("/kev 연결 거부면 kevFailure UNREACHABLE·kevIssues [] 이고 PARTIAL·AI_UNAVAILABLE 이며 내부 주소를 싣지 않는다", async () => {
    const { lines } = await runJob({ routes: { ...healthyRoutes(), "/kev": refusedReply } });
    expect(onlyLog(lines)).toMatchObject({
      status: "PARTIAL",
      errorCode: "AI_UNAVAILABLE",
      kevFailure: "UNREACHABLE",
      kevIssues: [],
    });
    expect(lines[0]).not.toContain(LEAKY_ADDRESS);
    expect(lines[0]).not.toContain("ECONNREFUSED");
  });

  it("캐시가 없고 /extract 가 422 면 extractFailure HTTP_4XX·extractIssues [] 이고 PARTIAL·EXTRACTION_FAILED 이며 kev 키는 없다", async () => {
    const reply = jsonReply({ detail: [{ loc: ["body"], msg: "x", type: "missing" }] }, 422);
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/extract": reply },
      load: () => loaded("FX-01", { extraction: null }),
    });
    const log = onlyLog(lines);
    expect(log).toMatchObject({
      status: "PARTIAL",
      errorCode: "EXTRACTION_FAILED",
      extractFailure: "HTTP_4XX",
      extractIssues: [],
    });
    expect(["kevFailure", "kevIssues"].filter((key) => key in log)).toEqual([]);
  });

  it("캐시가 없고 /extract payload 가 스키마 위반이면 extractIssues 는 경로·코드뿐이고 값을 싣지 않는다", async () => {
    const secret = "SECRET-예산-12억";
    const payload = withPatch(loadExtraction("FX-01"), (draft) => {
      draft.budgetKrw.value = secret;
    });
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/extract": jsonReply(extractBody(payload)) },
      load: () => loaded("FX-01", { extraction: null }),
    });
    const issues = onlyLog(lines).extractIssues;
    expect(
      Array.isArray(issues) && issues.some((issue) => String(issue).startsWith("budgetKrw.value:")),
    ).toBe(true);
    expect(Array.isArray(issues) && issues.every((issue) => ISSUE_LINE.test(String(issue)))).toBe(
      true,
    );
    expect(lines[0]).not.toContain(secret);
  });

  it("진단이 있어도 로그는 줄바꿈 없는 JSON 한 줄이다", async () => {
    const { lines } = await runJob({
      routes: { ...healthyRoutes(), "/kev": jsonReply(kevFitDefectBody()) },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("gateway 가 모두 연결 거부(S6)면 kevFailure UNREACHABLE·kevIssues [] 를 싣는다", async () => {
    const { lines } = await runJob({
      routes: downRoutes,
      env: { runMode: "fixture", given: true },
    });
    expect(onlyLog(lines)).toMatchObject({ kevFailure: "UNREACHABLE", kevIssues: [] });
  });
});

// ── 시계 ──

describe("createAnalysisProcessor · 시계(now)", () => {
  it("정상 run 에서 now 를 4번 부른다(처리 시작·runAnalysis 시작·끝·로그)", async () => {
    const { time } = await runJob();
    expect(time.calls()).toBe(4);
  });

  it("markRunning.startedAt 은 첫 now, meta.startedAt·finishedAt 은 두·세 번째 now 다", async () => {
    const harness = await runJob();
    const record = savedRecord(harness);
    expect([
      harness.tracker.running[0]?.startedAt,
      record.meta.startedAt,
      record.meta.finishedAt,
    ]).toEqual([T1, T2, T3]);
  });

  it("elapsedMs 는 마지막 now 와 첫 now 의 차(ms)다", async () => {
    const { lines } = await runJob({ times: [T1, T2, T3, `${CALCULATION_DATE}T09:00:07.001Z`] });
    expect(onlyLog(lines).elapsedMs).toBe(7_001);
  });
});

// ── context 조립 ──

describe("createAnalysisProcessor · AnalysisContext 조립(캐시 없음 → loadSource 가 context 를 받는다)", () => {
  const noCache = () =>
    runJob({ routes: noCacheRoutes(), load: () => loaded("FX-01", { extraction: null }) });

  async function contextOf() {
    const { extraction } = await noCache();
    const context = extraction.sources[0];
    if (!context) throw new Error("loadSource 가 불리지 않았다");
    return context;
  }

  // 보안 검토 후속: 시도 식별자(attemptStartedAt)가 더해져 16개다. 예전 기대(15개)는 이 결정으로 바뀌었다.
  it("context 키는 AnalysisContext 의 16개뿐이다(loader 의 status·idempotencyKey 는 넣지 않는다)", async () => {
    expect(Object.keys(await contextOf()).toSorted()).toEqual(
      [
        "aiProvider",
        "attemptStartedAt",
        "bid",
        "bidId",
        "companyProfileId",
        "documentIssues",
        "extraction",
        "fixtureId",
        "kev",
        "orgId",
        "profile",
        "queuedAt",
        "requestId",
        "runMode",
        "scoreRunId",
        "team",
      ].toSorted(),
    );
  });

  it("orgId 는 job 데이터 값, requestId 는 job 데이터 idempotencyKey 에서 꺼낸 값이다", async () => {
    const context = await contextOf();
    expect([context.orgId, context.requestId]).toEqual([ORG_ID, REQUEST_ID]);
  });

  it("runMode·aiProvider·kev 는 health 에서 정한 설정이다", async () => {
    const context = await contextOf();
    expect({ runMode: context.runMode, aiProvider: context.aiProvider, kev: context.kev }).toEqual({
      runMode: "mock",
      aiProvider: "mock",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
    });
  });

  it("scoreRunId·companyProfileId·fixtureId·queuedAt 은 loader 값이다", async () => {
    const context = await contextOf();
    expect({
      scoreRunId: context.scoreRunId,
      companyProfileId: context.companyProfileId,
      fixtureId: context.fixtureId,
      queuedAt: context.queuedAt,
    }).toEqual({
      scoreRunId: SCORE_RUN_ID,
      companyProfileId: COMPANY_PROFILE_ID,
      fixtureId: "FX-01.r01",
      queuedAt: QUEUED_AT,
    });
  });

  it("다시 추출해 저장했으면 record.extractionId 는 save 가 돌려준 id 다", async () => {
    const harness = await noCache();
    expect(savedRecord(harness).extractionId).toBe(harness.extraction.savedId);
  });
});

// ── 설정 ──

describe("createAnalysisProcessor · health 로 정한 설정을 쓴다", () => {
  it("health.kevEnabled=false 면 /kev 를 부르지 않고 RULES_ONLY·COMPLETED 다", async () => {
    const { fake, settled } = await runJob({
      routes: healthyRoutes("FX-01", { kevEnabled: false }),
    });
    expect(fake.count("/kev")).toBe(0);
    expect(summaryOf(settled)).toMatchObject({
      status: "COMPLETED",
      recommendationBasis: "RULES_ONLY",
    });
  });

  it("health.qwen 이 null 이면 loader 에 cacheKey null 을 넘긴다", async () => {
    const { loader } = await runJob({ routes: healthyRoutes("FX-01", { qwen: null }) });
    expect(loader.calls[0]?.cacheKey).toBeNull();
  });
});

// ── gateway 다운 ──

describe("createAnalysisProcessor · gateway 가 모든 요청을 연결 거부(S6)", () => {
  const down = () => runJob({ routes: downRoutes, env: { runMode: "fixture", given: true } });

  it("job 은 던지지 않고 PARTIAL·AI_UNAVAILABLE·RULES_ONLY 로 끝난다", async () => {
    const { settled } = await down();
    expect(summaryOf(settled)).toEqual({
      outcome: "ANALYZED",
      idempotencyKey: IDEMPOTENCY_KEY,
      status: "PARTIAL",
      errorCode: "AI_UNAVAILABLE",
      recommendationBasis: "RULES_ONLY",
    });
  });

  it("health 실패라 loader 에 cacheKey null 을 넘긴다", async () => {
    const { loader } = await down();
    expect(loader.calls[0]?.cacheKey).toBeNull();
  });

  it("markRunning 은 env 기준 설정(fixture·local)으로 부른다", async () => {
    const { tracker } = await down();
    expect(tracker.running[0]).toMatchObject({ runMode: "fixture", aiProvider: "local" });
  });

  it("PARTIAL 레코드를 sink 에 한 번 저장하고 markFailed 는 부르지 않는다", async () => {
    const harness = await down();
    expect(harness.sink.attempts).toHaveLength(1);
    expect(harness.tracker.failed).toHaveLength(0);
  });

  it("/kev 를 한 번 보내고 /explain 은 부르지 않는다", async () => {
    const { fake } = await down();
    expect([fake.count("/kev"), fake.count("/explain")]).toEqual([1, 0]);
  });

  it("로그 settingsSource 는 ENV, runModeMismatch 는 false, status 는 PARTIAL 이다", async () => {
    const { lines } = await down();
    expect(onlyLog(lines)).toMatchObject({
      event: "analysis.completed",
      settingsSource: "ENV",
      runModeMismatch: false,
      status: "PARTIAL",
      errorCode: "AI_UNAVAILABLE",
    });
  });

  it("로그에 연결 오류의 내부 주소를 싣지 않는다", async () => {
    const { lines } = await down();
    expect(lines.join("\n")).not.toContain(LEAKY_ADDRESS);
  });
});

// ── 대상 없음·불일치 ──

const MISMATCHES: [string, Partial<LoadedAnalysisContext>][] = [
  ["orgId", { orgId: OTHER_ORG_ID }],
  ["scoreRunId", { scoreRunId: OTHER_SCORE_RUN_ID }],
  ["idempotencyKey", { idempotencyKey: `${ORG_ID}:req-other` }],
];

describe("createAnalysisProcessor · 대상 없음(loader null)", () => {
  const notFound = (attemptsMade = 0) => runJob({ load: () => null }, { attemptsMade });

  it('UnrecoverableError("ANALYSIS_TARGET_NOT_FOUND") 를 던진다', async () => {
    const error = errorOf((await notFound()).settled);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toHaveProperty("message", "ANALYSIS_TARGET_NOT_FOUND");
  });

  it("markRunning·markFailed·sink.save 를 부르지 않는다", async () => {
    const { events } = await notFound();
    expect(events).toEqual(["loader.load"]);
  });

  it("마지막 시도여도 markFailed 를 부르지 않는다(남의 run 일 수 있다)", async () => {
    const { tracker } = await notFound(2);
    expect(tracker.failed).toHaveLength(0);
  });

  it("실패 로그 필드는 영구 실패 10개다", async () => {
    const { lines } = await notFound();
    expect(onlyLog(lines)).toEqual({
      event: "analysis.failed",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      attempt: 1,
      errorName: "UnrecoverableError",
      errorCode: "ANALYSIS_TARGET_NOT_FOUND",
      permanent: true,
      elapsedMs: 250,
    });
  });
});

describe("createAnalysisProcessor · 대상 불일치(다른 조직·다른 run 을 섞지 않는다)", () => {
  const mismatch = (overrides: Partial<LoadedAnalysisContext>, attemptsMade = 0) =>
    runJob({ load: () => loaded("FX-01", overrides) }, { attemptsMade });

  it.each(MISMATCHES)(
    '%s 가 다르면 UnrecoverableError("ANALYSIS_TARGET_MISMATCH") 를 던진다',
    async (_field, overrides) => {
      const error = errorOf((await mismatch(overrides)).settled);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toHaveProperty("message", "ANALYSIS_TARGET_MISMATCH");
    },
  );

  it.each(MISMATCHES)(
    "%s 가 다르면 markRunning·markFailed·sink.save 를 부르지 않는다",
    async (_field, overrides) => {
      const { events } = await mismatch(overrides);
      expect(events).toEqual(["loader.load"]);
    },
  );

  it.each(MISMATCHES)(
    "%s 가 다르면 마지막 시도여도 markFailed 를 부르지 않는다",
    async (_field, overrides) => {
      const { tracker } = await mismatch(overrides, 2);
      expect(tracker.failed).toHaveLength(0);
    },
  );

  it("로그의 orgId 는 job 데이터 값이고 loader 가 준 다른 조직 id 는 싣지 않는다", async () => {
    const { lines } = await mismatch({ orgId: OTHER_ORG_ID });
    expect(onlyLog(lines)).toMatchObject({
      orgId: ORG_ID,
      errorCode: "ANALYSIS_TARGET_MISMATCH",
      permanent: true,
    });
    expect(lines[0]).not.toContain(OTHER_ORG_ID);
  });

  it("loader 의 idempotencyKey 가 null 이면 불일치로 보지 않고 job 데이터의 requestId 로 분석한다", async () => {
    const harness = await mismatch({ idempotencyKey: null });
    expect(summaryOf(harness.settled).outcome).toBe("ANALYZED");
    expect(savedRecord(harness).requestId).toBe(REQUEST_ID);
  });
});

// ── job 이름·데이터 오류 ──

const INVALID_DATA: [string, unknown][] = [
  ["orgId 가 uuid 가 아님", { ...jobData(), orgId: "org-SECRET-1" }],
  ["scoreRunId 없음", { orgId: ORG_ID, idempotencyKey: IDEMPOTENCY_KEY }],
  ["idempotencyKey 가 다른 조직 접두어", { ...jobData(), idempotencyKey: `${OTHER_ORG_ID}:req-1` }],
  ["null", null],
  ["문자열", "analysis"],
];

describe("createAnalysisProcessor · job 이름 오류", () => {
  const unknownName = () => runJob({}, { name: "analyse" });

  it('UnrecoverableError("ANALYSIS_JOB_UNKNOWN") 를 던진다', async () => {
    const error = errorOf((await unknownName()).settled);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toHaveProperty("message", "ANALYSIS_JOB_UNKNOWN");
  });

  it("/health·loader 를 부르지 않는다", async () => {
    const { fake, loader } = await unknownName();
    expect([fake.count("/health"), loader.calls.length]).toEqual([0, 0]);
  });

  it("실패 로그에 errorCode ANALYSIS_JOB_UNKNOWN·permanent true 를 싣는다", async () => {
    const { lines } = await unknownName();
    expect(onlyLog(lines)).toMatchObject({
      event: "analysis.failed",
      errorCode: "ANALYSIS_JOB_UNKNOWN",
      permanent: true,
    });
  });
});

describe("createAnalysisProcessor · job 데이터 오류", () => {
  const invalid = (data: unknown, attemptsMade = 0) => runJob({}, { data, attemptsMade });

  it.each(INVALID_DATA)(
    '%s → UnrecoverableError("ANALYSIS_JOB_INVALID")(값·경로를 싣지 않는다)',
    async (_label, data) => {
      const error = errorOf((await invalid(data)).settled);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toHaveProperty("message", "ANALYSIS_JOB_INVALID");
    },
  );

  it.each(INVALID_DATA)("%s → /health·loader 를 부르지 않는다", async (_label, data) => {
    const { fake, loader } = await invalid(data);
    expect([fake.count("/health"), loader.calls.length]).toEqual([0, 0]);
  });

  it("마지막 시도여도 markFailed 를 부르지 않는다", async () => {
    const { tracker } = await invalid(INVALID_DATA[0][1], 2);
    expect(tracker.failed).toHaveLength(0);
  });

  it("실패 로그는 requestId·orgId·scoreRunId 없이 7개 필드다", async () => {
    const { lines } = await invalid(INVALID_DATA[0][1]);
    expect(onlyLog(lines)).toEqual({
      event: "analysis.failed",
      jobId: JOB_ID,
      attempt: 1,
      errorName: "UnrecoverableError",
      errorCode: "ANALYSIS_JOB_INVALID",
      permanent: true,
      elapsedMs: 250,
    });
  });

  it("실패 로그에 받은 job 데이터 값을 싣지 않는다", async () => {
    const { lines } = await invalid({
      ...jobData(),
      orgId: "org-SECRET-1",
      title: "공고 제목 비밀",
    });
    expect(lines.join("\n")).not.toMatch(/SECRET|공고 제목 비밀/);
  });
});

// ── 이미 끝난 run ──

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "FAILED"] as const;

describe("createAnalysisProcessor · 이미 끝난 run 은 건너뛴다", () => {
  const skip = (status: (typeof DONE_STATUSES)[number]) =>
    runJob({ load: () => loaded("FX-01", { status }) });

  it.each(DONE_STATUSES)("%s → SKIPPED 와 그 상태를 돌려준다", async (status) => {
    const { settled } = await skip(status);
    expect(summaryOf(settled)).toEqual({ outcome: "SKIPPED", scoreRunStatus: status });
  });

  it.each(DONE_STATUSES)(
    "%s → markRunning·markFailed·sink.save 를 부르지 않는다",
    async (status) => {
      const { events } = await skip(status);
      expect(events).toEqual(["loader.load"]);
    },
  );

  it.each(DONE_STATUSES)("%s → /kev·/explain·/extract 를 부르지 않는다", async (status) => {
    const { fake } = await skip(status);
    expect([fake.count("/kev"), fake.count("/explain"), fake.count("/extract")]).toEqual([0, 0, 0]);
  });

  it("건너뜀 로그 필드는 8개다", async () => {
    const { lines } = await skip("COMPLETED");
    expect(onlyLog(lines)).toEqual({
      event: "analysis.skipped",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      attempt: 1,
      scoreRunStatus: "COMPLETED",
      elapsedMs: 250,
    });
  });

  it("RUNNING(앞 시도가 죽음)은 건너뛰지 않고 분석한다", async () => {
    const { settled, tracker, sink } = await runJob({
      load: () => loaded("FX-01", { status: "RUNNING" }),
    });
    expect(summaryOf(settled).outcome).toBe("ANALYZED");
    expect([tracker.running.length, sink.attempts.length]).toEqual([1, 1]);
  });
});

// ── 규칙 엔진 입력 오류 ──

describe("createAnalysisProcessor · 규칙 엔진 입력 오류(AnalysisInputError)", () => {
  const badProfile = (attemptsMade = 0) =>
    runJob(
      {
        load: () =>
          withPatch(loaded(), (draft) => {
            draft.profile.revision = 0;
          }),
      },
      { attemptsMade },
    );

  it('첫 시도여도 UnrecoverableError("ANALYSIS_INPUT_INVALID") 로 바꿔 던진다', async () => {
    const error = errorOf((await badProfile()).settled);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toHaveProperty("message", "ANALYSIS_INPUT_INVALID");
  });

  // 보안 검토 후속: markRunning 뒤의 영구 실패라 이 시도의 시작 시각(t0=T1)을 attemptStartedAt 으로 넘긴다(예전 기대에 더했다).
  it("markFailed 를 한 번 ANALYSIS_INPUT_INVALID·그때의 now·이 시도의 attemptStartedAt 으로 부른다", async () => {
    const { tracker } = await badProfile();
    // now: t0(T1) → runAnalysis 시작(T2) → 규칙 엔진이 던짐 → markFailed(T3)
    expect(tracker.failed).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        errorCode: "ANALYSIS_INPUT_INVALID",
        finishedAt: T3,
        attemptStartedAt: T1,
      },
    ]);
  });

  it("markRunning 은 한 번 불렸고 sink.save 는 부르지 않는다", async () => {
    const { tracker, sink } = await badProfile();
    expect([tracker.running.length, sink.attempts.length]).toEqual([1, 0]);
  });

  it("실패 로그에 errorCode ANALYSIS_INPUT_INVALID·permanent true 를 싣는다", async () => {
    const { lines } = await badProfile();
    expect(onlyLog(lines)).toMatchObject({
      event: "analysis.failed",
      errorCode: "ANALYSIS_INPUT_INVALID",
      permanent: true,
    });
  });

  it("오류 message·로그에 틀린 입력 값을 싣지 않는다", async () => {
    const secret = "예산-비공개-값-12억";
    const harness = await runJob({
      load: () =>
        withPatch(loaded(), (draft) => {
          draft.bid.budgetKrw = secret;
        }),
    });
    expect(errorOf(harness.settled)).toHaveProperty("message", "ANALYSIS_INPUT_INVALID");
    expect(harness.lines.join("\n")).not.toContain(secret);
  });
});

// ── 저장 실패와 재시도 ──

const saveError = () =>
  Object.assign(new Error("score_runs 저장 실패: 세종특별자치시 차세대 행정정보시스템"), {
    code: "ECONNRESET",
  });

describe("createAnalysisProcessor · sink.save 실패(일시 오류 → BullMQ 재시도)", () => {
  it.each([0, 1])(
    "attemptsMade %i(3번 중 마지막 아님) → 같은 오류 객체를 다시 던진다",
    async (attemptsMade) => {
      const error = saveError();
      const { settled } = await runJob({ sinkErrors: [error] }, { attemptsMade });
      expect(errorOf(settled)).toBe(error);
    },
  );

  it("마지막이 아닌 시도의 오류는 UnrecoverableError 로 바꾸지 않는다", async () => {
    const { settled } = await runJob({ sinkErrors: [saveError()] });
    expect(errorOf(settled)).not.toBeInstanceOf(UnrecoverableError);
  });

  it.each([0, 1])("attemptsMade %i → markFailed 를 부르지 않는다", async (attemptsMade) => {
    const { tracker } = await runJob({ sinkErrors: [saveError()] }, { attemptsMade });
    expect(tracker.failed).toHaveLength(0);
  });

  it("마지막이 아닌 시도의 실패 로그는 errorCode 없이 permanent false 다", async () => {
    const { lines } = await runJob({ sinkErrors: [saveError()] });
    expect(onlyLog(lines)).toEqual({
      event: "analysis.failed",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      attempt: 1,
      errorName: "Error",
      permanent: false,
      elapsedMs: 2_750,
    });
  });

  it("실패 로그에 오류 message 를 싣지 않는다", async () => {
    const { lines } = await runJob({ sinkErrors: [saveError()] });
    expect(lines.join("\n")).not.toMatch(/저장 실패|세종특별자치시/);
  });
});

describe("createAnalysisProcessor · sink.save 실패(마지막 시도 → 영구 실패)", () => {
  const lastAttempt = (error: Error, tracker: SetupOptions["tracker"] = {}) =>
    runJob({ sinkErrors: [error], tracker }, { attemptsMade: 2 });

  it("같은 오류 객체를 다시 던진다", async () => {
    const error = saveError();
    const { settled } = await lastAttempt(error);
    expect(errorOf(settled)).toBe(error);
  });

  // 보안 검토 후속: markRunning 뒤의 영구 실패라 이 시도의 시작 시각(t0=T1)을 attemptStartedAt 으로 넘긴다(예전 기대에 더했다).
  it("markFailed 를 한 번 ANALYSIS_JOB_FAILED·그때의 now·이 시도의 attemptStartedAt 으로 부른다", async () => {
    const { tracker } = await lastAttempt(saveError());
    // now: t0(T1) → runAnalysis 시작(T2)·끝(T3) → sink 실패 → markFailed(T4)
    expect(tracker.failed).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        errorCode: "ANALYSIS_JOB_FAILED",
        finishedAt: T4,
        attemptStartedAt: T1,
      },
    ]);
  });

  it("실패 로그는 attempt 3·errorCode ANALYSIS_JOB_FAILED·permanent true 다", async () => {
    const { lines } = await lastAttempt(saveError());
    expect(onlyLog(lines)).toEqual({
      event: "analysis.failed",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      orgId: ORG_ID,
      scoreRunId: SCORE_RUN_ID,
      attempt: 3,
      errorName: "Error",
      errorCode: "ANALYSIS_JOB_FAILED",
      permanent: true,
      elapsedMs: 2_750,
    });
  });

  it("opts.attempts 가 없으면 첫 시도가 마지막이라 markFailed 를 부른다", async () => {
    const { tracker } = await runJob({ sinkErrors: [saveError()] }, { opts: {} });
    expect(tracker.failed.map((input) => input.errorCode)).toEqual(["ANALYSIS_JOB_FAILED"]);
  });

  it("markFailed 가 던져도 원래 오류 객체를 던진다", async () => {
    const error = saveError();
    const trackerDown = Object.assign(new Error("tracker 비밀 메시지"), {
      name: "TrackerDownError",
    });
    const { settled } = await lastAttempt(error, { failedError: trackerDown });
    expect(errorOf(settled)).toBe(error);
  });

  it("markFailed 가 던지면 로그 한 줄에 markFailedError(오류 name)만 더한다", async () => {
    const trackerDown = Object.assign(new Error("tracker 비밀 메시지"), {
      name: "TrackerDownError",
    });
    const { lines } = await lastAttempt(saveError(), { failedError: trackerDown });
    expect(onlyLog(lines)).toMatchObject({
      event: "analysis.failed",
      errorCode: "ANALYSIS_JOB_FAILED",
      markFailedError: "TrackerDownError",
    });
    expect(lines[0]).not.toContain("tracker 비밀 메시지");
  });
});

// ── 늦은 마감(sink NOT_RUNNING) → 영구 실패(C5-B 덧붙임) ──
// finish_score_run 이 SCORE_RUN_NOT_RUNNING 으로 거절하면 sink 는 "analysis store 오류: score_runs.finish NOT_RUNNING" 을 던진다.
// 다른 시도가 이미 끝냈거나 다시 잡은 run 이라 재시도해도 같은 거절이고 gateway 만 다시 부른다.
// 그래서 시도 횟수와 상관없이 UnrecoverableError("ANALYSIS_RUN_SUPERSEDED") 로 바꿔 던지고, markFailed 는 이 시도의 attemptStartedAt 으로 한 번 부른다
// (그 조건 때문에 다른 시도의 run 은 0행이다). 다른 sink 오류는 예전처럼 마지막 시도 전에는 BullMQ 재시도다.

const notRunningError = () => new Error("analysis store 오류: score_runs.finish NOT_RUNNING");

describe("createAnalysisProcessor · 늦은 마감(sink NOT_RUNNING) → 영구 실패 ANALYSIS_RUN_SUPERSEDED", () => {
  const superseded = (attemptsMade: number) =>
    runJob({ sinkErrors: [notRunningError()] }, { attemptsMade });

  it.each([0, 1, 2])(
    'attemptsMade %i → UnrecoverableError("ANALYSIS_RUN_SUPERSEDED") 로 바꿔 던진다',
    async (attemptsMade) => {
      const error = errorOf((await superseded(attemptsMade)).settled);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toHaveProperty("message", "ANALYSIS_RUN_SUPERSEDED");
    },
  );

  it.each([0, 1, 2])(
    "attemptsMade %i → markFailed 를 한 번 ANALYSIS_RUN_SUPERSEDED·그때의 now·이 시도의 attemptStartedAt 으로 부른다",
    async (attemptsMade) => {
      const { tracker } = await superseded(attemptsMade);
      // now: t0(T1) → runAnalysis 시작(T2) → 끝(T3) → sink 가 던짐 → markFailed(T4)
      expect(tracker.failed).toEqual([
        {
          orgId: ORG_ID,
          scoreRunId: SCORE_RUN_ID,
          errorCode: "ANALYSIS_RUN_SUPERSEDED",
          finishedAt: T4,
          attemptStartedAt: T1,
        },
      ]);
    },
  );

  it("markFailed 의 attemptStartedAt 은 markRunning 에 넘긴 startedAt 이다", async () => {
    const { tracker } = await superseded(0);
    expect(tracker.failed.map((input) => input.attemptStartedAt)).toEqual([
      tracker.running[0]?.startedAt,
    ]);
  });

  it.each([0, 1, 2])(
    "attemptsMade %i → 실패 로그는 errorCode ANALYSIS_RUN_SUPERSEDED·permanent true 다",
    async (attemptsMade) => {
      const { lines } = await superseded(attemptsMade);
      expect(onlyLog(lines)).toMatchObject({
        event: "analysis.failed",
        requestId: REQUEST_ID,
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        attempt: attemptsMade + 1,
        errorCode: "ANALYSIS_RUN_SUPERSEDED",
        permanent: true,
      });
    },
  );

  it("실패 로그에 sink 오류 message 를 싣지 않는다", async () => {
    const { lines } = await superseded(0);
    expect(lines.join("\n")).not.toContain("score_runs.finish");
    expect(lines.join("\n")).not.toContain("NOT_RUNNING");
  });

  it("sink.save 는 한 번 불렸고(분석은 끝났다) 결과를 돌려주지 않는다", async () => {
    const { sink, settled } = await superseded(0);
    expect(sink.attempts).toHaveLength(1);
    expect(settled.ok).toBe(false);
  });

  it("다른 마감 거절(NOT_FOUND)은 바꾸지 않고 마지막 시도 전이면 같은 오류 객체를 다시 던진다(재시도)", async () => {
    const notFound = new Error("analysis store 오류: score_runs.finish NOT_FOUND");
    const { settled, tracker } = await runJob({ sinkErrors: [notFound] }, { attemptsMade: 0 });
    expect(errorOf(settled)).toBe(notFound);
    expect(tracker.failed).toHaveLength(0);
  });

  it("message 가 NOT_RUNNING 으로 끝나지 않는 sink 오류(일시 오류)는 마지막 시도 전이면 재시도다", async () => {
    const error = new Error("analysis store 오류: score_runs.finish NOT_RUNNING_RETRY");
    const { settled } = await runJob({ sinkErrors: [error] }, { attemptsMade: 0 });
    expect(errorOf(settled)).toBe(error);
  });
});

describe("createAnalysisProcessor · 대상 확인 뒤 다른 단계 실패", () => {
  it("markRunning 이 마지막 시도에서 던지면 같은 오류를 던지고 markFailed 를 부른다", async () => {
    const runningError = new Error("score_runs 갱신 실패");
    const { settled, tracker, sink } = await runJob(
      { tracker: { runningError } },
      { attemptsMade: 2 },
    );
    expect(errorOf(settled)).toBe(runningError);
    // now: t0(T1) → markRunning 실패 → markFailed(T2)
    expect(tracker.failed).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        errorCode: "ANALYSIS_JOB_FAILED",
        finishedAt: T2,
      },
    ]);
    expect(sink.attempts).toHaveLength(0);
  });

  // 보안 검토 후속: markRunning 이 성공하지 않았으면 이 시도가 잡은 run 이 없다. 시도 조건 없이(QUEUED·RUNNING) 닫는다.
  it("markRunning 이 마지막 시도에서 던지면 markFailed 에 attemptStartedAt 을 넘기지 않는다", async () => {
    const { tracker } = await runJob(
      { tracker: { runningError: new Error("score_runs 갱신 실패") } },
      { attemptsMade: 2 },
    );
    expect(tracker.failed).toHaveLength(1);
    expect(tracker.failed[0]?.attemptStartedAt).toBeUndefined();
  });

  it("markRunning 이 마지막이 아닌 시도에서 던지면 markFailed 를 부르지 않는다", async () => {
    const { tracker } = await runJob({ tracker: { runningError: new Error("갱신 실패") } });
    expect(tracker.failed).toHaveLength(0);
  });

  it("loader 가 마지막 시도에서 던지면 같은 오류를 던지고 markFailed 는 부르지 않는다(대상 확인 전)", async () => {
    const loadError = new Error("bid_revisions 읽기 실패");
    const { settled, tracker } = await runJob({ load: () => loadError }, { attemptsMade: 2 });
    expect(errorOf(settled)).toBe(loadError);
    expect(tracker.failed).toHaveLength(0);
  });
});

// ── 시도 식별자(보안 검토 후속) ──
// 시도 식별자 = markRunning 이 쓴 started_at(처리 시작 시각 t0). context·레코드에 실려 finish_score_run 의 attempt_started_at 이 되고,
// markRunning 뒤의 영구 실패는 markFailed 에도 넘겨 그 시도가 잡은 run 만 닫는다. 늦게 끝난 시도가 다른 시도의 run 을 덮지 않게 한다.

describe("createAnalysisProcessor · 시도 식별자(attemptStartedAt)", () => {
  it("context.attemptStartedAt 은 markRunning 에 넘긴 startedAt(첫 now)이다", async () => {
    const harness = await runJob({
      routes: noCacheRoutes(),
      load: () => loaded("FX-01", { extraction: null }),
    });
    const context = harness.extraction.sources[0];
    expect(context?.attemptStartedAt).toBe(T1);
    expect(context?.attemptStartedAt).toBe(harness.tracker.running[0]?.startedAt);
  });

  it("저장 레코드의 attemptStartedAt 은 markRunning 의 startedAt 이고 meta.startedAt(runAnalysis 시작)과 다르다", async () => {
    const harness = await runJob();
    const record = savedRecord(harness);
    expect(record.attemptStartedAt).toBe(T1);
    expect(record.attemptStartedAt).toBe(harness.tracker.running[0]?.startedAt);
    expect(record.meta.startedAt).toBe(T2);
  });

  it("markRunning 뒤 sink 가 마지막 시도에서 실패하면 markFailed 의 attemptStartedAt 은 markRunning 의 startedAt 이다", async () => {
    const { tracker } = await runJob({ sinkErrors: [saveError()] }, { attemptsMade: 2 });
    expect(tracker.failed.map((input) => input.attemptStartedAt)).toEqual([
      tracker.running[0]?.startedAt,
    ]);
  });

  // C5-B 덧붙임(늦은 마감은 영구 실패): NOT_RUNNING 은 ANALYSIS_RUN_SUPERSEDED 로 닫는다. 예전 기대(ANALYSIS_JOB_FAILED)는 이 결정으로 바뀌었다.
  // attemptStartedAt 조건(다른 시도의 run 을 닫지 않는다)은 그대로다.
  it("markRunning 뒤 sink 가 NOT_RUNNING 으로 실패해도(다른 시도가 끝냈다) markFailed 는 이 시도의 attemptStartedAt 으로만 닫는다", async () => {
    const notRunning = new Error("analysis store 오류: score_runs.finish NOT_RUNNING");
    const { tracker } = await runJob({ sinkErrors: [notRunning] }, { attemptsMade: 2 });
    expect(tracker.failed).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: SCORE_RUN_ID,
        errorCode: "ANALYSIS_RUN_SUPERSEDED",
        finishedAt: T4,
        attemptStartedAt: T1,
      },
    ]);
  });

  it("규칙 엔진 입력 오류(markRunning 뒤)도 markFailed 에 이 시도의 attemptStartedAt 을 넘긴다", async () => {
    const { tracker } = await runJob({
      load: () =>
        withPatch(loaded(), (draft) => {
          draft.profile.revision = 0;
        }),
    });
    expect(tracker.failed.map((input) => input.attemptStartedAt)).toEqual([T1]);
  });

  it("재시도하면 시도마다 그 시도의 처리 시작 시각이 attemptStartedAt 이다", async () => {
    const T5 = `${CALCULATION_DATE}T09:05:00.000Z`;
    const T6 = `${CALCULATION_DATE}T09:05:00.250Z`;
    const T7 = `${CALCULATION_DATE}T09:05:02.500Z`;
    const T8 = `${CALCULATION_DATE}T09:05:02.750Z`;
    const harness = setup({
      sinkErrors: [saveError(), null],
      times: [T1, T2, T3, T4, T5, T6, T7, T8],
      load: (index) => loaded("FX-01", { status: index === 0 ? "QUEUED" : "RUNNING" }),
    });
    await settle(harness.processor(job({ attemptsMade: 0 })));
    await settle(harness.processor(job({ attemptsMade: 1 })));
    expect(harness.tracker.running.map((input) => input.startedAt)).toEqual([T1, T5]);
    expect(harness.sink.attempts.map((record) => record.attemptStartedAt)).toEqual([T1, T5]);
  });
});

// ── 재시도 시뮬레이션 ──

describe("createAnalysisProcessor · 재시도: 앞 시도가 저장한 추출을 다음 시도가 캐시로 쓴다", () => {
  /** 1번째 시도: 캐시 없음 → /extract·추출 save → sink 실패. 2번째 시도: loader 가 저장된 추출을 캐시로 준다. */
  async function retry() {
    const firstError = saveError();
    const harness = setup({
      routes: noCacheRoutes(),
      sinkErrors: [firstError, null],
      times: [T1, T2, T3, T4, T1, T2, T3, T4],
      load: (index, { extractionSaves }) => {
        const saved = extractionSaves[0];
        if (index === 0 || !saved) return loaded("FX-01", { extraction: null });
        return loaded("FX-01", {
          status: "RUNNING",
          extraction: {
            id: harness.extraction.savedId,
            status: saved.status,
            payload: saved.payload,
            translations: saved.translations,
          },
        });
      },
    });
    const first = await settle(harness.processor(job({ attemptsMade: 0 })));
    const second = await settle(harness.processor(job({ attemptsMade: 1 })));
    return { ...harness, first, second, firstError };
  }

  it("첫 시도는 sink 오류를 그대로 던지고 두 번째 시도는 ANALYZED 다", async () => {
    const { first, second, firstError } = await retry();
    expect(errorOf(first)).toBe(firstError);
    expect(summaryOf(second).outcome).toBe("ANALYZED");
  });

  it("시도마다 loader.load 를 부른다(2번)", async () => {
    const { loader } = await retry();
    expect(loader.calls).toHaveLength(2);
  });

  it("/extract 는 첫 시도에서만 부른다(전체 1번)", async () => {
    const { fake } = await retry();
    expect(fake.count("/extract")).toBe(1);
  });

  it("추출 save 는 첫 시도에서만 부른다(전체 1번)", async () => {
    const { extraction } = await retry();
    expect(extraction.saves).toHaveLength(1);
  });

  it("두 번째 시도의 record.extractionId 는 앞 시도가 저장한 행의 id 다", async () => {
    const harness = await retry();
    expect(savedRecord(harness).extractionId).toBe(harness.extraction.savedId);
  });

  it("markRunning 은 시도마다, markFailed 는 한 번도 부르지 않는다", async () => {
    const { tracker } = await retry();
    expect([tracker.running.length, tracker.failed.length]).toEqual([2, 0]);
  });
});

// ── 기본 deps·Worker ──

describe("createAnalysisJobDeps", () => {
  const ports = () => {
    const events: EventLog = [];
    return {
      loader: fakeLoader(events, () => null).loader,
      tracker: fakeTracker(events).tracker,
      extraction: fakeExtractionStore(events).store,
      sink: fakeSink(events).sink,
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("env SOL_RUN_MODE 로 env 설정을 만든다", () => {
    const deps = createAnalysisJobDeps({ SOL_RUN_MODE: " fixture " }, ports());
    expect(deps.env).toEqual({ runMode: "fixture", given: true });
  });

  it("SOL_RUN_MODE 가 없으면 mock·given=false 다", () => {
    expect(createAnalysisJobDeps({}, ports()).env).toEqual({ runMode: "mock", given: false });
  });

  it("받은 port 를 그대로 쓴다", () => {
    const given = ports();
    const deps = createAnalysisJobDeps({}, given);
    const same = [
      deps.loader === given.loader,
      deps.tracker === given.tracker,
      deps.extraction === given.extraction,
      deps.sink === given.sink,
    ];
    expect(same).toEqual([true, true, true, true]);
  });

  it("now 는 현재 시각의 Date 를 돌려준다", () => {
    const before = Date.now();
    const at = createAnalysisJobDeps({}, ports()).now();
    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("log 는 console.log 로 그 줄을 쓴다", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    createAnalysisJobDeps({}, ports()).log('{"event":"x"}');
    expect(spy).toHaveBeenCalledWith('{"event":"x"}');
  });

  it("SOL_RUN_MODE 가 세 값이 아니면 키 이름만 담아 던진다", () => {
    expect(() => createAnalysisJobDeps({ SOL_RUN_MODE: "prod" }, ports())).toThrowError(
      "worker env 오류: SOL_RUN_MODE",
    );
  });

  it("AI_GATEWAY_URL 이 틀리면 gateway 설정 오류를 그대로 던진다", () => {
    expect(() => createAnalysisJobDeps({ AI_GATEWAY_URL: "ftp://gw" }, ports())).toThrowError(
      "AI gateway 설정 오류: AI_GATEWAY_URL",
    );
  });
});

describe("createAnalysisWorker", () => {
  it("Redis 연결 없이 부르지 않는다. close 가 있는 핸들을 돌려주는 함수로 내보낸다", () => {
    expect(typeof createAnalysisWorker).toBe("function");
    expectTypeOf(createAnalysisWorker).returns.toEqualTypeOf<{ close(): Promise<void> }>();
  });
});
