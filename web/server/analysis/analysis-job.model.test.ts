import { describe, expect, expectTypeOf, it } from "vitest";
import * as analysisBarrel from "@/server/analysis";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  ANALYSIS_QUEUE,
  analysisJobDataSchema,
  readRunMode,
  requestIdOf,
  toAnalysisJobId,
  toAnalysisSettings,
  toFixtureStem,
} from "./analysis-job.model";
import {
  extractRequestSchema,
  type GatewayFailure,
  type GatewayHealth,
  type GatewayResult,
} from "./gateway.model";

// 큐 계약(이름·job 데이터·옵션·jobId)과 처리 설정(실행 모드·공급자·Kev·추출 캐시 키) 결정.
// Route Handler(C6)와 worker 가 함께 쓰는 순수 규칙이다. gateway·큐·DB 는 부르지 않는다.

const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_ORG_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SCORE_RUN_ID = "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
const OTHER_SCORE_RUN_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";

const validData = () => ({
  orgId: ORG_ID,
  scoreRunId: SCORE_RUN_ID,
  idempotencyKey: `${ORG_ID}:req-FX-01`,
});

/** safeParse 실패 issue 의 경로들("." 로 이은 문자열). 성공하면 빈 목록. */
function issuePaths(value: unknown): string[] {
  const parsed = analysisJobDataSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

// ── 큐 계약 ──

describe("analysis 큐 이름·job 이름", () => {
  it('큐 이름은 "analysis" 다', () => {
    expect(ANALYSIS_QUEUE).toBe("analysis");
  });

  it('job 이름은 "analyze" 다', () => {
    expect(ANALYSIS_JOB).toBe("analyze");
  });
});

describe("ANALYSIS_JOB_OPTIONS(결정 4: 재시도·DLQ)", () => {
  it("3번 시도·지수 backoff 2초·완료 1일·실패 7일 보관이다", () => {
    expect(ANALYSIS_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
  });
});

describe("analysisJobDataSchema · 받는 값", () => {
  it("orgId·scoreRunId(uuid)와 그 조직 접두어의 idempotencyKey 를 받는다", () => {
    expect(analysisJobDataSchema.parse(validData())).toEqual(validData());
  });

  it("모르는 필드(공고 제목 등)는 버린다", () => {
    const parsed = analysisJobDataSchema.parse({
      ...validData(),
      title: "공고 제목",
      body: "원문",
    });
    expect(Object.keys(parsed).toSorted()).toEqual(["idempotencyKey", "orgId", "scoreRunId"]);
  });

  // 낮음 (b): requestId 는 `^[A-Za-z0-9_-]{1,128}$` 라 키 전체는 uuid 36 + ':' + 128 = 165자까지다.
  // 예전 기대("300자까지 받는다", requestId 263자)는 이 결정으로 바뀌었다.
  it("idempotencyKey 는 requestId 128자(키 전체 165자)까지 받는다", () => {
    const key = `${ORG_ID}:${"r".repeat(128)}`;
    expect(key).toHaveLength(165);
    expect(analysisJobDataSchema.safeParse({ ...validData(), idempotencyKey: key }).success).toBe(
      true,
    );
  });

  it("idempotencyKey 접두어 뒤 한 글자도 받는다", () => {
    const parsed = analysisJobDataSchema.safeParse({
      ...validData(),
      idempotencyKey: `${ORG_ID}:r`,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("analysisJobDataSchema · 거부하는 값", () => {
  it("orgId 가 uuid 가 아니면 거부한다", () => {
    expect(issuePaths({ ...validData(), orgId: "org-solideo-demo" })).toContain("orgId");
  });

  it("scoreRunId 가 uuid 가 아니면 거부한다", () => {
    expect(issuePaths({ ...validData(), scoreRunId: "run-1" })).toContain("scoreRunId");
  });

  it("orgId 가 없으면 거부한다", () => {
    const data = { scoreRunId: SCORE_RUN_ID, idempotencyKey: `${ORG_ID}:req-FX-01` };
    expect(issuePaths(data)).toContain("orgId");
  });

  it("scoreRunId 가 없으면 거부한다", () => {
    const data = { orgId: ORG_ID, idempotencyKey: `${ORG_ID}:req-FX-01` };
    expect(issuePaths(data)).toContain("scoreRunId");
  });

  it("idempotencyKey 가 없으면 거부한다", () => {
    const data = { orgId: ORG_ID, scoreRunId: SCORE_RUN_ID };
    expect(issuePaths(data)).toContain("idempotencyKey");
  });

  it("idempotencyKey 가 빈 문자열이면 거부한다", () => {
    expect(issuePaths({ ...validData(), idempotencyKey: "" })).toContain("idempotencyKey");
  });

  it("idempotencyKey 가 301자면 거부한다", () => {
    const key = `${ORG_ID}:${"r".repeat(301 - ORG_ID.length - 1)}`;
    expect(key).toHaveLength(301);
    expect(issuePaths({ ...validData(), idempotencyKey: key })).toContain("idempotencyKey");
  });

  it("idempotencyKey 가 다른 조직의 접두어면 idempotencyKey 경로로 거부한다", () => {
    expect(issuePaths({ ...validData(), idempotencyKey: `${OTHER_ORG_ID}:req-FX-01` })).toEqual([
      "idempotencyKey",
    ]);
  });

  it("idempotencyKey 가 접두어만 있고 뒤가 비면 거부한다", () => {
    expect(issuePaths({ ...validData(), idempotencyKey: `${ORG_ID}:` })).toEqual([
      "idempotencyKey",
    ]);
  });

  it("idempotencyKey 가 orgId 뿐이고 ':' 가 없으면 거부한다", () => {
    expect(issuePaths({ ...validData(), idempotencyKey: ORG_ID })).toEqual(["idempotencyKey"]);
  });

  it("idempotencyKey 가 접두어 없는 requestId 뿐이면 거부한다", () => {
    expect(issuePaths({ ...validData(), idempotencyKey: "req-FX-01" })).toEqual(["idempotencyKey"]);
  });

  it("객체가 아니면 거부한다", () => {
    expect(analysisJobDataSchema.safeParse("analysis").success).toBe(false);
  });
});

// ── requestId 형식(낮음 (b)) ──
// C6 의 Idempotency-Key 는 UUID 이고 없으면 randomUUID 다(e8). demo:preanalyze 키는 `demo-pre-FX-01-r01` 모양이다.
// `${orgId}:` 뒤 requestId 는 `^[A-Za-z0-9_-]{1,128}$` 이어야 한다. 로그·jobId·필터에 섞여도 줄·구분자를 깨지 않게 한다.

describe("analysisJobDataSchema · requestId 형식", () => {
  it.each<[string, string]>([
    ["uuid(C6 randomUUID)", "7d9f5c2e-4b1a-4e8f-9c3d-2a6b8e0f1c4d"],
    ["대문자 uuid", "7D9F5C2E-4B1A-4E8F-9C3D-2A6B8E0F1C4D"],
    ["demo:preanalyze 키", "demo-pre-FX-01-r01"],
    ["밑줄", "req_FX_01"],
    ["한 글자", "r"],
    ["128자", "a".repeat(128)],
  ])("%s 는 받는다", (_label, requestId) => {
    expect(issuePaths({ ...validData(), idempotencyKey: `${ORG_ID}:${requestId}` })).toEqual([]);
  });

  it.each<[string, string]>([
    ["129자", "a".repeat(129)],
    ["공백", "req FX-01"],
    ["':'", "req:FX-01"],
    ["한글", "요청-01"],
    ["개행", "req\nFX-01"],
    ["'.'", "req.FX-01"],
    ["'/'", "req/FX-01"],
    ["'%'", "req%3AFX-01"],
  ])("%s 가 든 requestId 는 idempotencyKey 경로로 거부한다", (_label, requestId) => {
    expect(issuePaths({ ...validData(), idempotencyKey: `${ORG_ID}:${requestId}` })).toEqual([
      "idempotencyKey",
    ]);
  });

  it("거부 issue 의 message 에 받은 requestId 를 싣지 않는다", () => {
    const requestId = "SECRET 요청값";
    const parsed = analysisJobDataSchema.safeParse({
      ...validData(),
      idempotencyKey: `${ORG_ID}:${requestId}`,
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues ?? [])).not.toContain("SECRET");
  });
});

describe("requestIdOf", () => {
  it("`${orgId}:` 접두어 뒤를 requestId 로 꺼낸다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: `${ORG_ID}:req-FX-01` })).toBe("req-FX-01");
  });

  it("접두어 뒤에 ':' 가 더 있어도 접두어 뒤 전부를 꺼낸다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: `${ORG_ID}:a:b` })).toBe("a:b");
  });

  it("다른 조직의 접두어면 null 이다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: `${OTHER_ORG_ID}:req-FX-01` })).toBeNull();
  });

  it("접두어 뒤가 비면 null 이다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: `${ORG_ID}:` })).toBeNull();
  });

  it("접두어가 없으면 null 이다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: "req-FX-01" })).toBeNull();
  });

  it("orgId 뒤에 ':' 가 없으면 null 이다", () => {
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey: `${ORG_ID}req-FX-01` })).toBeNull();
  });
});

describe("toAnalysisJobId(BullMQ custom jobId)", () => {
  it("`analysis_${orgId}_${scoreRunId}` 다", () => {
    expect(toAnalysisJobId({ orgId: ORG_ID, scoreRunId: SCORE_RUN_ID })).toBe(
      `analysis_${ORG_ID}_${SCORE_RUN_ID}`,
    );
  });

  it("uuid 두 개로 만든 jobId 에 ':' 가 없다(BullMQ 6 은 custom id 의 ':' 를 거부한다)", () => {
    expect(toAnalysisJobId({ orgId: ORG_ID, scoreRunId: SCORE_RUN_ID })).not.toContain(":");
  });

  it("같은 run 은 같은 jobId 다", () => {
    expect(toAnalysisJobId({ orgId: ORG_ID, scoreRunId: SCORE_RUN_ID })).toBe(
      toAnalysisJobId({ orgId: ORG_ID, scoreRunId: SCORE_RUN_ID }),
    );
  });

  it("다른 run 은 다른 jobId 다", () => {
    expect(toAnalysisJobId({ orgId: ORG_ID, scoreRunId: SCORE_RUN_ID })).not.toBe(
      toAnalysisJobId({ orgId: ORG_ID, scoreRunId: OTHER_SCORE_RUN_ID }),
    );
  });
});

// ── fixtureId(ee 규칙) ──

describe("toFixtureStem", () => {
  it.each([
    ["FX-07", 1, "FX-07.r01"],
    ["FX-07", 12, "FX-07.r12"],
    ["FX-01", 99, "FX-01.r99"],
  ])("(%s, %i) → %s", (raw, revision, stem) => {
    expect(toFixtureStem(raw, revision)).toBe(stem);
  });

  it.each([
    ["두 자리가 아닌 번호 FX-7", "FX-7"],
    ["세 자리 번호 FX-007", "FX-007"],
    ["소문자 fx-07", "fx-07"],
    ["이미 revision 이 붙은 FX-07.r01", "FX-07.r01"],
    ["빈 문자열", ""],
    ["null", null],
    ["undefined", undefined],
    ["숫자 7", 7],
    ["객체", { fixtureId: "FX-07" }],
  ])("rawFixtureId 가 %s 면 null 이다", (_label, raw) => {
    expect(toFixtureStem(raw, 1)).toBeNull();
  });

  it.each([
    ["0", 0],
    ["100", 100],
    ["음수 -1", -1],
    ["소수 1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("revision 이 %s 면 null 이다", (_label, revision) => {
    expect(toFixtureStem("FX-07", revision)).toBeNull();
  });

  it("revision 1~99 의 결과는 모두 /extract 요청의 fixtureId 형식을 통과한다", () => {
    const stems = Array.from({ length: 99 }, (_, index) => toFixtureStem("FX-20", index + 1));
    expect(
      stems.every((stem) => extractRequestSchema.shape.fixtureId.safeParse(stem).success),
    ).toBe(true);
  });
});

// ── 실행 모드 ──

describe("readRunMode(worker env SOL_RUN_MODE)", () => {
  it('키가 없으면 "mock" 이고 given=false 다', () => {
    expect(readRunMode({})).toEqual({ runMode: "mock", given: false });
  });

  it('빈 문자열이면 "mock" 이고 given=false 다', () => {
    expect(readRunMode({ SOL_RUN_MODE: "" })).toEqual({ runMode: "mock", given: false });
  });

  it('공백만 있으면 "mock" 이고 given=false 다', () => {
    expect(readRunMode({ SOL_RUN_MODE: "  \n" })).toEqual({ runMode: "mock", given: false });
  });

  it.each(["live", "fixture", "mock"] as const)("%s 는 그대로이고 given=true 다", (mode) => {
    expect(readRunMode({ SOL_RUN_MODE: mode })).toEqual({ runMode: mode, given: true });
  });

  it("앞뒤 공백을 지운다", () => {
    expect(readRunMode({ SOL_RUN_MODE: " fixture \n" })).toEqual({
      runMode: "fixture",
      given: true,
    });
  });

  it("다른 env 키는 보지 않는다", () => {
    expect(readRunMode({ RUN_MODE: "live", AI_PROVIDER: "local" })).toEqual({
      runMode: "mock",
      given: false,
    });
  });

  it("세 값이 아니면 키 이름만 담아 던진다", () => {
    expect(() => readRunMode({ SOL_RUN_MODE: "production" })).toThrowError(
      "worker env 오류: SOL_RUN_MODE",
    );
  });

  it("대문자 LIVE 도 세 값이 아니라 던진다", () => {
    expect(() => readRunMode({ SOL_RUN_MODE: "LIVE" })).toThrowError(
      "worker env 오류: SOL_RUN_MODE",
    );
  });

  it("오류 메시지에 받은 값을 싣지 않는다", () => {
    const secret = "live-SECRET-9f3a";
    const error = (() => {
      try {
        readRunMode({ SOL_RUN_MODE: secret });
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
  });
});

// ── 처리 설정(결정 1: gateway /health 가 기준) ──

const QWEN = { model: "qwen2.5-7b-instruct", promptHash: "a".repeat(64) };

function health(overrides: Partial<GatewayHealth> = {}): GatewayResult<GatewayHealth> {
  return {
    ok: true,
    attempts: 1,
    value: {
      status: "ok",
      runMode: "mock",
      provider: "mock",
      kevEnabled: true,
      qwen: QWEN,
      kev: { modelId: "kev-mock", registryMatch: null },
      questionSets: ["kev-qs/v0.1"],
      parsers: [{ format: "pdf", parserId: "mock" }],
      ...overrides,
    },
  };
}

const failed = (failure: GatewayFailure): GatewayResult<GatewayHealth> => ({
  ok: false,
  failure,
  attempts: failure.kind === "CIRCUIT_OPEN" ? 0 : 1,
});

const HEALTH_FAILURES: [GatewayFailure["kind"], GatewayResult<GatewayHealth>][] = [
  ["UNREACHABLE", failed({ kind: "UNREACHABLE", code: "ECONNREFUSED" })],
  ["TIMEOUT", failed({ kind: "TIMEOUT" })],
  ["HTTP_ERROR", failed({ kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" })],
  ["INVALID_RESPONSE", failed({ kind: "INVALID_RESPONSE", issues: ["runMode: invalid_value"] })],
  ["CIRCUIT_OPEN", failed({ kind: "CIRCUIT_OPEN" })],
];

const MOCK_ENV = { runMode: "mock", given: true } as const;

describe("toAnalysisSettings · /health 성공", () => {
  it("mock 모드: health 의 runMode·provider·kevEnabled·qwen 을 쓰고 질문 세트는 v0.1 이다", () => {
    expect(toAnalysisSettings(health(), MOCK_ENV)).toEqual({
      runMode: "mock",
      aiProvider: "mock",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
      cacheKey: { modelName: QWEN.model, promptHash: QWEN.promptHash },
      source: "HEALTH",
      runModeMismatch: false,
    });
  });

  it("fixture 모드: provider local·질문 세트 v0.2 다", () => {
    expect(
      toAnalysisSettings(health({ runMode: "fixture", provider: "local" }), {
        runMode: "fixture",
        given: true,
      }),
    ).toEqual({
      runMode: "fixture",
      aiProvider: "local",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.2" },
      cacheKey: { modelName: QWEN.model, promptHash: QWEN.promptHash },
      source: "HEALTH",
      runModeMismatch: false,
    });
  });

  it("live 모드: provider local·질문 세트 v0.2 다", () => {
    expect(
      toAnalysisSettings(health({ runMode: "live", provider: "local" }), {
        runMode: "live",
        given: true,
      }),
    ).toEqual({
      runMode: "live",
      aiProvider: "local",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.2" },
      cacheKey: { modelName: QWEN.model, promptHash: QWEN.promptHash },
      source: "HEALTH",
      runModeMismatch: false,
    });
  });

  it("provider hosted 도 health 값 그대로다", () => {
    const settings = toAnalysisSettings(health({ runMode: "live", provider: "hosted" }), {
      runMode: "live",
      given: true,
    });
    expect(settings.aiProvider).toBe("hosted");
  });

  it("kevEnabled=false 면 kev.enabled=false 다", () => {
    expect(toAnalysisSettings(health({ kevEnabled: false }), MOCK_ENV).kev.enabled).toBe(false);
  });

  it("qwen 이 null 이면 cacheKey 는 null 이다", () => {
    expect(toAnalysisSettings(health({ qwen: null }), MOCK_ENV).cacheKey).toBeNull();
  });

  it("질문 세트는 env 가 아니라 health 의 runMode 를 따른다(env live·health mock → v0.1)", () => {
    const settings = toAnalysisSettings(health({ runMode: "mock" }), {
      runMode: "live",
      given: true,
    });
    expect(settings.kev.questionSetVersion).toBe("kev-qs/v0.1");
  });

  it("처리 runMode 는 env 와 달라도 health 값이다", () => {
    const settings = toAnalysisSettings(health({ runMode: "fixture", provider: "local" }), {
      runMode: "live",
      given: true,
    });
    expect(settings.runMode).toBe("fixture");
  });
});

describe("toAnalysisSettings · runModeMismatch", () => {
  it("env 에 SOL_RUN_MODE 가 있고 health 와 다르면 true 다", () => {
    const settings = toAnalysisSettings(health({ runMode: "mock" }), {
      runMode: "live",
      given: true,
    });
    expect(settings.runModeMismatch).toBe(true);
  });

  it("env 에 SOL_RUN_MODE 가 있고 health 와 같으면 false 다", () => {
    const settings = toAnalysisSettings(health({ runMode: "live", provider: "local" }), {
      runMode: "live",
      given: true,
    });
    expect(settings.runModeMismatch).toBe(false);
  });

  it("env 에 SOL_RUN_MODE 가 없으면(given=false) 기본값 mock 과 health 가 달라도 false 다", () => {
    const settings = toAnalysisSettings(health({ runMode: "live", provider: "local" }), {
      runMode: "mock",
      given: false,
    });
    expect(settings.runModeMismatch).toBe(false);
  });
});

describe("toAnalysisSettings · /health 실패(어떤 kind 든 env 기준)", () => {
  it.each(HEALTH_FAILURES)("%s → env mock 기준 설정·cacheKey null·source ENV", (_kind, result) => {
    expect(toAnalysisSettings(result, MOCK_ENV)).toEqual({
      runMode: "mock",
      aiProvider: "mock",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
      cacheKey: null,
      source: "ENV",
      runModeMismatch: false,
    });
  });

  it.each(HEALTH_FAILURES)("%s → env live 면 provider local·질문 세트 v0.2", (_kind, result) => {
    expect(toAnalysisSettings(result, { runMode: "live", given: true })).toEqual({
      runMode: "live",
      aiProvider: "local",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.2" },
      cacheKey: null,
      source: "ENV",
      runModeMismatch: false,
    });
  });

  it.each(HEALTH_FAILURES)("%s → env fixture 면 provider local·질문 세트 v0.2", (_kind, result) => {
    expect(toAnalysisSettings(result, { runMode: "fixture", given: true })).toEqual({
      runMode: "fixture",
      aiProvider: "local",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.2" },
      cacheKey: null,
      source: "ENV",
      runModeMismatch: false,
    });
  });

  it("env 가 비었을 때(given=false, 기본 mock)도 mock·v0.1 이다", () => {
    const [, result] = HEALTH_FAILURES[0];
    expect(toAnalysisSettings(result, { runMode: "mock", given: false })).toEqual({
      runMode: "mock",
      aiProvider: "mock",
      kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
      cacheKey: null,
      source: "ENV",
      runModeMismatch: false,
    });
  });
});

// ── 배럴 ──

describe("@/server/analysis 배럴", () => {
  it.each([
    "ANALYSIS_QUEUE",
    "ANALYSIS_JOB",
    "ANALYSIS_JOB_OPTIONS",
    "analysisJobDataSchema",
    "toAnalysisJobId",
    "requestIdOf",
    "toFixtureStem",
    "readRunMode",
    "toAnalysisSettings",
  ])("값 %s 를 내보낸다", (name) => {
    expect(Object.keys(analysisBarrel)).toContain(name);
  });

  it("배럴의 toAnalysisSettings 는 analysis-job.model 의 것이다", () => {
    expect(analysisBarrel.toAnalysisSettings).toBe(toAnalysisSettings);
  });
});

// 시도 식별자(보안 검토 후속). 타입만 있어 값으로는 볼 수 없으므로 type-check(tsc) 가 단언을 잡는다.
describe("@/server/analysis 배럴 · 시도 식별자(타입)", () => {
  it("AnalysisContext.attemptStartedAt 은 string 이다(markRunning 의 startedAt)", () => {
    expectTypeOf<analysisBarrel.AnalysisContext["attemptStartedAt"]>().toEqualTypeOf<string>();
  });

  it("AnalysisRunRecord.attemptStartedAt 은 string 이다", () => {
    expectTypeOf<analysisBarrel.AnalysisRunRecord["attemptStartedAt"]>().toEqualTypeOf<string>();
  });

  it("AnalysisRunTracker.markFailed 입력은 attemptStartedAt 을 선택으로 받는다", () => {
    expectTypeOf<Parameters<analysisBarrel.AnalysisRunTracker["markFailed"]>[0]>().toEqualTypeOf<{
      orgId: string;
      scoreRunId: string;
      errorCode: string;
      finishedAt: string;
      attemptStartedAt?: string;
    }>();
  });
});

// 멈춘 run 찾기 port(C5-B). 타입만 있어 값으로는 볼 수 없으므로 type-check(tsc) 가 단언을 잡는다.
// 보안 후속 (g): keyset 페이지로 StaleRun 에 queuedAt(ISO)이, 입력에 after(앞 페이지 마지막 run 의 queuedAt·id, 첫 페이지는 null)가 더해졌다.
describe("@/server/analysis 배럴 · 멈춘 run 찾기 port(타입)", () => {
  it("StaleRun 은 orgId·scoreRunId·idempotencyKey(null 가능)·status(QUEUED·RUNNING)·queuedAt 이다", () => {
    expectTypeOf<analysisBarrel.StaleRun>().toEqualTypeOf<{
      orgId: string;
      scoreRunId: string;
      idempotencyKey: string | null;
      status: "QUEUED" | "RUNNING";
      queuedAt: string;
    }>();
  });

  it("StaleRunFinder.findStaleRuns 는 { queuedBefore, runningBefore, limit, after } 하나를 받는다", () => {
    expectTypeOf<analysisBarrel.StaleRunFinder["findStaleRuns"]>().parameters.toEqualTypeOf<
      [
        {
          queuedBefore: string;
          runningBefore: string;
          limit: number;
          after: { queuedAt: string; id: string } | null;
        },
      ]
    >();
  });

  it("StaleRunFinder.findStaleRuns 는 StaleRun 목록을 돌려준다", () => {
    expectTypeOf<analysisBarrel.StaleRunFinder["findStaleRuns"]>().returns.toEqualTypeOf<
      Promise<analysisBarrel.StaleRun[]>
    >();
  });

  it("StaleRunFinder 는 findStaleRuns 하나만 가진다", () => {
    expectTypeOf<keyof analysisBarrel.StaleRunFinder>().toEqualTypeOf<"findStaleRuns">();
  });
});
