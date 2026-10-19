import "server-only";
import { z } from "zod";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  analyze,
  type AnalysisInput,
  type AnalysisResult,
  type KevMockResponse,
  type RequirementExtraction,
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
  toIdempotencyKey,
  toKevRequest,
  toKevWire,
  toKstDate,
  toModelMeta,
  type AnalysisContext,
  type AnalysisRunRecord,
  type ExtractSource,
  type ExtractionRecord,
  type KevOutput,
} from "./analysis.model";
import {
  pickAiUnavailableReason,
  toExplainOutcome,
  toKevOutcome,
  type AiUnavailableReason,
  type ExtractionOutcome,
  type KevOutcome,
} from "./fallback.model";
import type { GatewayClient } from "./gateway.client";
import { toIssueList } from "./gateway.model";

// ── 분석 흐름: 03 §2.1 analysis job ①~⑤. gateway·추출 저장·시계는 주입받는다 ──
// AI 가 죽어도 규칙만으로 끝낸다(PARTIAL). score_runs 저장은 sink port 호출까지만 하고, 로그는 남기지 않는다(worker job 몫).
// gateway 실패 상세(오류 메시지·주소)는 레코드에 싣지 않는다. 코드만 result.errorCode·플래그로 남는다.

/** 추출 port. 캐시를 쓸 수 없을 때만 부른다. Supabase·MinIO 구현은 C2 병합 뒤다. */
export type ExtractionStore = {
  loadSource(context: AnalysisContext): Promise<ExtractSource>;
  /** 성공 추출만 받는다. 저장한 requirement_extractions.id 를 돌려준다(score_runs.extraction_id). */
  save(record: ExtractionRecord): Promise<{ id: string }>;
};

export type AnalysisDeps = {
  gateway: GatewayClient;
  /** startedAt·finishedAt 에 한 번씩, 이 순서로 부른다. 시험이 고정할 수 있게 주입받는다. */
  now: () => Date;
  extraction: ExtractionStore;
};

/** score_runs 저장 port. 같은 idempotencyKey 는 on conflict 로 upsert 한다(C2 repo 몫). */
export type AnalysisRunSink = { save(record: AnalysisRunRecord): Promise<void> };

/** 규칙 엔진 입력이 계약에 맞지 않을 때. message 에는 값 없이 issue 목록("경로: 코드")만 싣는다. */
export class AnalysisInputError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`규칙 엔진 입력 오류: ${issues.join(", ")}`);
    this.name = "AnalysisInputError";
    this.issues = issues;
  }
}

type ExtractionStep = {
  extraction: RequirementExtraction | null;
  /** 이번 run 에 /extract 를 불렀을 때만 있다. 캐시를 썼으면 null 이다. */
  outcome: ExtractionOutcome | null;
  /** /kev 에 실을 번역. 다시 추출했으면 그 응답의 값, 캐시를 썼으면 캐시 행의 값이다. */
  translations: Record<string, string> | null;
  /** 쓴 추출의 requirement_extractions.id. 캐시를 썼으면 그 행, 다시 추출했으면 save 가 돌려준 값, 추출이 없으면 null. */
  extractionId: string | null;
};

/**
 * ① 캐시 추출을 쓰고, 쓸 수 없으면 같은 job 안에서 /extract 를 부른다(e8 정정).
 * 성공 응답(COMPLETED·PENDING_REVIEW)만 저장한다. 200 FAILED·전송 실패·payload 스키마 위반은 저장하지 않는다(e8 판정 2).
 * loadSource·save 가 던지면 그대로 던진다(job 재시도 몫).
 */
async function prepareExtraction(
  context: AnalysisContext,
  deps: AnalysisDeps,
): Promise<ExtractionStep> {
  const row = context.extraction;
  const cached = readCachedExtraction(row);
  // readCachedExtraction(null) 은 늘 null 이다. row 비교는 row.id 를 읽으려고 타입을 좁히는 것이다.
  if (row !== null && cached !== null) {
    return {
      extraction: cached,
      outcome: null,
      translations: row.translations,
      extractionId: row.id,
    };
  }

  const source = await deps.extraction.loadSource(context);
  const reading = readExtractResult(await deps.gateway.extract(toExtractRequest(context, source)));
  if (reading.kind === "EXTRACTED") {
    const saved = await deps.extraction.save(
      toExtractionRecord(context, reading.response, reading.extraction),
    );
    return {
      extraction: reading.extraction,
      outcome: { kind: "EXTRACTED", response: reading.response },
      translations: reading.response.translations,
      extractionId: saved.id,
    };
  }
  // 쓸 수 없던 캐시 행의 id 는 이 run 이 쓰지 않았으므로 남기지 않는다.
  return {
    extraction: null,
    outcome: { kind: "UNAVAILABLE", reason: reading.reason },
    translations: null,
    extractionId: null,
  };
}

type KevStep = {
  /** /kev 를 부르지 않았으면 null 이다. */
  outcome: KevOutcome | null;
  /** analyze 의 kev 입력. Kev 를 쓰지 않았으면 null 이다. */
  wire: KevMockResponse | null;
  output: KevOutput | null;
};

const KEV_NOT_USED: KevStep = { outcome: null, wire: null, output: null };

/** ③ KEV_ENABLED 이고 추출이 있을 때만 /kev 를 부른다. 요청에 규칙 결과를 넣지 않는다(03 §5.6). */
async function consultKev(
  context: AnalysisContext,
  step: ExtractionStep,
  deps: AnalysisDeps,
): Promise<KevStep> {
  if (!context.kev.enabled || step.extraction === null) return KEV_NOT_USED;

  const request = toKevRequest(context, step.extraction, step.translations);
  const outcome = toKevOutcome(await deps.gateway.kev(request));
  if (outcome.kind !== "USED") return { ...KEV_NOT_USED, outcome };

  const { response } = outcome;
  const wire = toKevWire(response);
  // enabled=true 인데 쓸 수 있는 wire 가 없다. 1단계의 INVALID_RESPONSE 와 같이 gateway 불가로 본다.
  // response.wire 비교는 toKevWire 가 이미 거른 경우라 타입을 좁히려는 것이다.
  if (wire === null || response.wire === null) {
    return { ...KEV_NOT_USED, outcome: { kind: "GATEWAY_DOWN" } };
  }
  return {
    outcome,
    wire,
    output: {
      questionSetVersion: wire.questionSetVersion,
      wire: response.wire,
      stateHash: response.stateHash,
      stateTrace: response.kev.stateTrace ?? null,
      requirements: response.requirements,
    },
  };
}

function toAnalysisInput(
  context: AnalysisContext,
  extraction: RequirementExtraction | null,
  kev: KevMockResponse | null,
  today: string,
  aiUnavailableReason: AiUnavailableReason | null,
): AnalysisInput {
  return {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: context.bid,
    extraction,
    profile: context.profile,
    team: context.team,
    kev,
    config: { ...SCORING_CONFIG_V0_1, today },
    // 사유가 없으면 키를 넣지 않는다. 입력 스냅샷이 사유 없는 C4 입력과 같은 모양이 되게 한다.
    ...(aiUnavailableReason === null ? {} : { aiUnavailableReason }),
  };
}

/** ② 규칙 계산. 입력 계약 위반(ZodError)은 값이 메시지로 새지 않게 경로·코드만 옮겨 던진다. 그 밖의 오류는 그대로 던진다. */
function analyzeInput(input: AnalysisInput): AnalysisResult {
  try {
    return analyze(input);
  } catch (error) {
    if (error instanceof z.ZodError) throw new AnalysisInputError(toIssueList(error));
    throw error;
  }
}

/** 03 §2.1 analysis job ②~⑤. 저장은 하지 않는다. */
export async function runAnalysis(
  context: AnalysisContext,
  deps: AnalysisDeps,
): Promise<AnalysisRunRecord> {
  const startedAt = deps.now();
  const extractionStep = await prepareExtraction(context, deps);
  const { extraction } = extractionStep;
  const kevStep = await consultKev(context, extractionStep, deps);

  // 캐시 FAILED 행은 다시 추출했으므로 캐시 실패 코드는 늘 보지 않는다.
  const aiUnavailableReason = pickAiUnavailableReason({
    extraction: extractionStep.outcome,
    cachedExtractionFailed: null,
    kev: kevStep.outcome,
  });
  const input = toAnalysisInput(
    context,
    extraction,
    kevStep.wire,
    toKstDate(startedAt),
    aiUnavailableReason,
  );
  const result = analyzeInput(input);

  // ④ C4 결과는 고치지 않고 파이프라인 플래그·근거는 meta 에 둔다.
  const extraFlags = extraReviewFlags({
    extraction,
    kev: kevStep.outcome,
    resultFlags: result.reviewFlags,
  });
  const evidence = collectEvidence(result);

  // ⑤ gateway 불가(AI_UNAVAILABLE)로 분류된 run 은 /explain 을 부르지 않는다. 죽은 gateway 에 timeout 만큼 더 기다리지 않게 한다.
  // Kev 를 끈 run·Kev 만 불가한 run·추출만 실패한 run 은 gateway 가 살아 있으므로 부른다(K11). 실패해도 템플릿이고 status 는 그대로다.
  const explainOutcome =
    aiUnavailableReason === "AI_UNAVAILABLE"
      ? null
      : toExplainOutcome(
          await deps.gateway.explain(
            toExplainRequest({
              requestId: context.requestId,
              result,
              extraFlags,
              evidence,
              documentIssues: context.documentIssues,
            }),
          ),
        );
  const finishedAt = deps.now();

  return {
    orgId: context.orgId,
    scoreRunId: context.scoreRunId,
    bidId: context.bidId,
    revisionId: context.bid.revisionId,
    companyProfileId: context.companyProfileId,
    extractionId: extractionStep.extractionId,
    requestId: context.requestId,
    idempotencyKey: toIdempotencyKey(context.orgId, context.requestId),
    input,
    result,
    meta: {
      runMode: context.runMode,
      model: toModelMeta({ aiProvider: context.aiProvider, extraction, result }),
      fallbackReason: null,
      evidence,
      errorCode: result.errorCode,
      queuedAt: context.queuedAt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      extraReviewFlags: extraFlags,
      explanation: chooseExplanation(explainOutcome, result),
    },
    kevOutput: kevStep.output,
  };
}

/** runAnalysis 뒤 sink.save. 분석이 던지면 저장하지 않고, save 실패는 그대로 던진다(job 재시도 몫). */
export async function analyzeAndSave(
  context: AnalysisContext,
  deps: AnalysisDeps & { sink: AnalysisRunSink },
): Promise<AnalysisRunRecord> {
  const record = await runAnalysis(context, deps);
  await deps.sink.save(record);
  return record;
}
