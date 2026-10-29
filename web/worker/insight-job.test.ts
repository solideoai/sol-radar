import { describe, expect, it } from "vitest";
import {
  type GatewayClient,
  type GatewayFailure,
  type InsightFinishDone,
  type InsightFinishFailed,
  type InsightGatewayResponse,
  type InsightRunSource,
  type InsightStore,
} from "@/server/analysis";
import { INSIGHT_STALE_MS, type InsightJobData } from "@/server/insight";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  type AnalysisInput,
} from "@/server/scoring";
import {
  createInsightProcessor,
  processInsightJob,
  sweepStaleInsights,
  type InsightJobDeps,
} from "@/worker/insight-job";
import {
  CALCULATION_DATE,
  ORG_ID,
  SCORE_RUN_ID,
  loadBid,
  loadExtraction,
  loadProfile,
  loadTeam,
} from "@/worker/analysis-job.test-support";

// 추천 분석 job(ADR-066): PENDING 행 → 저장된 run 으로 /insight → DONE·FAILED 로 닫는다.
// 가짜 store·gateway 만 쓴다. 모든 실패는 행으로 닫고 job 은 던지지 않는다(attempts 1).

const INSIGHT_ID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const NOW = new Date(`${CALCULATION_DATE}T10:00:00.000Z`);
const DATA: InsightJobData = { insightId: INSIGHT_ID, orgId: ORG_ID };
const SUMMARY = "공고 요구 기술과 회사 보유 기술이 맞습니다.";

function runSource(): InsightRunSource {
  const input: AnalysisInput = {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: loadBid("FX-01"),
    extraction: loadExtraction("FX-01"),
    profile: loadProfile(),
    team: loadTeam(),
    kev: null,
    config: { ...SCORING_CONFIG_V0_1, today: CALCULATION_DATE },
  };
  return {
    scoreRunId: SCORE_RUN_ID,
    orgId: ORG_ID,
    input,
    score: 94,
    recommendation: "BID",
    recommendationBasis: "RULES_ONLY",
    reviewFlags: [],
    missingFactors: [],
    kevEnabled: false,
    kevReviewFlags: [],
    factors: [],
    checks: [],
  };
}

const modelResponse = (
  overrides: Partial<InsightGatewayResponse> = {},
): InsightGatewayResponse => ({
  summary: SUMMARY,
  strengths: [{ text: "요구 기술을 보유했습니다.", refIds: ["B1"] }],
  improvements: [],
  fallback: false,
  fallbackReason: null,
  model: "Qwen/Qwen3.8-Flash-Next",
  promptHash: "a".repeat(64),
  ...overrides,
});

type InsightResult = Awaited<ReturnType<GatewayClient["insight"]>>;

function fakeDeps(
  options: { store?: Partial<InsightStore>; result?: InsightResult } = {},
): InsightJobDeps & {
  done: InsightFinishDone[];
  failed: InsightFinishFailed[];
  requests: Parameters<GatewayClient["insight"]>[0][];
  swept: { before: string; finishedAt: string }[];
  lines: string[];
} {
  const done: InsightFinishDone[] = [];
  const failed: InsightFinishFailed[] = [];
  const requests: Parameters<GatewayClient["insight"]>[0][] = [];
  const swept: { before: string; finishedAt: string }[] = [];
  const lines: string[] = [];
  const store: InsightStore = {
    loadPending: () => Promise.resolve({ scoreRunId: SCORE_RUN_ID }),
    loadRunSource: () => Promise.resolve(runSource()),
    finishDone: (input) => {
      done.push(input);
      return Promise.resolve(true);
    },
    finishFailed: (input) => {
      failed.push(input);
      return Promise.resolve(true);
    },
    sweepStale: (before, finishedAt) => {
      swept.push({ before, finishedAt });
      return Promise.resolve(2);
    },
    ...options.store,
  };
  const result: InsightResult = options.result ?? {
    ok: true,
    value: modelResponse(),
    attempts: 1,
  };
  return {
    store,
    gateway: {
      insight: (request) => {
        requests.push(request);
        return Promise.resolve(result);
      },
    },
    now: () => NOW,
    log: (line) => {
      lines.push(line);
    },
    done,
    failed,
    requests,
    swept,
    lines,
  };
}

describe("processInsightJob", () => {
  it("PENDING 이 아니면 아무것도 하지 않는다", async () => {
    const deps = fakeDeps({ store: { loadPending: () => Promise.resolve(null) } });
    await processInsightJob(DATA, deps);
    expect(deps.requests).toHaveLength(0);
    expect(deps.done).toHaveLength(0);
    expect(deps.failed).toHaveLength(0);
  });

  it("모델 응답이면 DONE·MODEL 로 닫는다", async () => {
    const deps = fakeDeps();
    await processInsightJob(DATA, deps);
    expect(deps.requests[0]).toMatchObject({ requestId: INSIGHT_ID });
    expect(deps.done).toEqual([
      {
        insightId: INSIGHT_ID,
        orgId: ORG_ID,
        source: "MODEL",
        payload: {
          summary: SUMMARY,
          strengths: [{ text: "요구 기술을 보유했습니다.", refIds: ["B1"] }],
          improvements: [],
          refs: [expect.objectContaining({ id: "B1", kind: "BID" })],
        },
        fallbackReason: null,
        modelName: "Qwen/Qwen3.8-Flash-Next",
        promptHash: "a".repeat(64),
        finishedAt: NOW.toISOString(),
      },
    ]);
    // 로그에는 식별자·결과만 싣는다. 모델 문장은 싣지 않는다.
    expect(deps.lines.join("\n")).not.toContain(SUMMARY);
    expect(deps.lines.join("\n")).toContain(INSIGHT_ID);
  });

  it("fallback 이면 DONE·TEMPLATE 와 fallbackReason 으로 닫는다", async () => {
    const deps = fakeDeps({
      result: {
        ok: true,
        value: modelResponse({
          strengths: [{ text: "요구 기술을 보유했습니다.", refIds: [] }],
          fallback: true,
          fallbackReason: "FORBIDDEN_WORD",
          model: null,
        }),
        attempts: 1,
      },
    });
    await processInsightJob(DATA, deps);
    expect(deps.done[0]).toMatchObject({
      source: "TEMPLATE",
      fallbackReason: "FORBIDDEN_WORD",
      modelName: null,
      payload: { refs: [] },
    });
  });

  it.each<GatewayFailure>([
    { kind: "UNREACHABLE", code: "ECONNREFUSED" },
    { kind: "TIMEOUT" },
    { kind: "CIRCUIT_OPEN" },
    { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" },
  ])("gateway 실패($kind)면 FAILED GATEWAY_UNAVAILABLE 로 닫는다", async (failure) => {
    const deps = fakeDeps({ result: { ok: false, failure, attempts: 2 } });
    await processInsightJob(DATA, deps);
    expect(deps.done).toHaveLength(0);
    expect(deps.failed).toEqual([
      {
        insightId: INSIGHT_ID,
        orgId: ORG_ID,
        errorCode: "GATEWAY_UNAVAILABLE",
        finishedAt: NOW.toISOString(),
      },
    ]);
  });

  it("응답이 계약과 다르면 FAILED GATEWAY_INVALID 로 닫는다", async () => {
    const unknownRef = fakeDeps({
      result: {
        ok: true,
        value: modelResponse({ improvements: [{ text: "보완이 필요합니다.", refIds: ["C99"] }] }),
        attempts: 1,
      },
    });
    await processInsightJob(DATA, unknownRef);
    expect(unknownRef.failed[0]).toMatchObject({ errorCode: "GATEWAY_INVALID" });

    const invalid = fakeDeps({
      result: { ok: false, failure: { kind: "INVALID_RESPONSE", issues: [] }, attempts: 1 },
    });
    await processInsightJob(DATA, invalid);
    expect(invalid.failed[0]).toMatchObject({ errorCode: "GATEWAY_INVALID" });

    const rejected = fakeDeps({
      result: {
        ok: false,
        failure: { kind: "HTTP_ERROR", httpStatus: 422, errorCode: null },
        attempts: 1,
      },
    });
    await processInsightJob(DATA, rejected);
    expect(rejected.failed[0]).toMatchObject({ errorCode: "GATEWAY_INVALID" });
  });

  it("input_snapshot 을 읽지 못하면 FAILED SOURCE_INVALID 로 닫는다", async () => {
    const deps = fakeDeps({ store: { loadRunSource: () => Promise.resolve(null) } });
    await processInsightJob(DATA, deps);
    expect(deps.requests).toHaveLength(0);
    expect(deps.failed[0]).toMatchObject({ errorCode: "SOURCE_INVALID" });
  });

  it("job 은 다시 던지지 않는다", async () => {
    const broken = () => Promise.reject(new Error("db down"));
    for (const store of [
      { loadPending: broken },
      { loadRunSource: broken },
      { finishDone: broken },
    ] satisfies Partial<InsightStore>[]) {
      const deps = fakeDeps({ store });
      await expect(processInsightJob(DATA, deps)).resolves.toBeUndefined();
      expect(deps.lines.at(-1)).toContain("Error");
    }
    const processor = createInsightProcessor(fakeDeps());
    await expect(processor({ data: { insightId: "not-a-uuid" } })).resolves.toBeUndefined();
  });
});

describe("sweepStaleInsights", () => {
  it("정리는 10분 넘은 PENDING 을 FAILED STALE 로 닫는다", async () => {
    const deps = fakeDeps();
    await expect(sweepStaleInsights(deps)).resolves.toBe(2);
    expect(deps.swept).toEqual([
      {
        before: new Date(NOW.getTime() - INSIGHT_STALE_MS).toISOString(),
        finishedAt: NOW.toISOString(),
      },
    ]);
  });
});
