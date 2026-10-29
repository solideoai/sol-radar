import "server-only";
import { z } from "zod";
import type { Json, TablesInsert } from "@/lib/database.types";
import {
  ALGORITHM_VERSION,
  analysisInputSchema,
  analyze,
  type AnalysisInput,
  type AnalysisResult,
} from "@/server/scoring";
import { toFinishScoreRunPayload, type FinishScoreRunPayload } from "./analysis-store.model";
import {
  toIdempotencyKey,
  toModelMeta,
  type AiProvider,
  type AnalysisRunRecord,
  type ExtraReviewFlag,
  type RunMode,
} from "./analysis.model";
import { isItBatchIdempotencyKey, itBatchRescoreRequestId } from "./it-batch.model";

// ── 점수 재채점(`pnpm score:rescore`, ADR-071)의 순수 규칙 ──
// 공고마다 지금 화면에 보이는 분석(최신 revision·최신 회사 프로필의 최신 COMPLETED·PARTIAL run)의 input_snapshot 을
// 현재 알고리즘(ALGORITHM_VERSION)으로 다시 계산해 새 run 으로 남긴다. Qwen·Bosun 은 다시 부르지 않는다:
// 추출과 결정 모델 출력은 스냅샷·kev_output 그대로다. 옛 run 은 고치지 않는다(08 §2: 버전이 바뀌면 새 run).
// 같은 원본 run·같은 버전은 멱등 키가 같아 한 번만 남는다. 저장 port 구현은 analysis.repo 의 createRescoreStore 다.

/** 재채점 원본 run(score_runs 한 행). input_snapshot·kev_output 은 DB 값 그대로다. */
export type RescoreSource = {
  id: string;
  bidId: string;
  revisionId: string;
  companyProfileId: string;
  profileRevision: number;
  extractionId: string | null;
  algorithmVersion: string;
  runMode: string;
  aiProvider: string;
  idempotencyKey: string | null;
  reviewFlags: string[];
  /** 원본 run 의 점수·권고. 재채점 전후 분포를 셀 때만 쓴다. */
  score: number | null;
  recommendation: string | null;
  inputSnapshot: Json | null;
  kevOutput: Json | null;
};

/** 화면에 보이는 run 하나의 id 와 버전. 버전이 현재와 같으면 다시 계산하지 않는다. */
export type RescoreCandidate = { id: string; algorithmVersion: string };

/** 새 run 넣기 결과. EXISTING 은 같은 멱등 키 run 이 이미 있다, BUSY 는 같은 입력의 진행 중 run 이 있다. */
export type RescoreInsert =
  { kind: "CREATED"; id: string } | { kind: "EXISTING" } | { kind: "BUSY" };

/**
 * 재채점 저장 port. worker 컨테이너에서 service role 로 돈다.
 * 조직 표(company_profiles·score_runs)는 모든 질의·쓰기에 org_id 를 건다.
 */
export type RescoreStore = {
  findOrgBySlug(slug: string): Promise<string | null>;
  latestProfile(orgId: string): Promise<{ id: string; revision: number } | null>;
  /** 공고마다 화면에 보이는 분석 run(최신 revision·이 프로필·COMPLETED·PARTIAL 가운데 최신). 공고 id 순이다. */
  listShownRuns(orgId: string, companyProfileId: string): Promise<RescoreCandidate[]>;
  loadSources(orgId: string, ids: readonly string[]): Promise<RescoreSource[]>;
  insertRun(row: TablesInsert<"score_runs">): Promise<RescoreInsert>;
  /** finish_score_run(p). 그 run 이 RUNNING 이고 started_at 이 같을 때만 쓴다. */
  finish(payload: FinishScoreRunPayload): Promise<void>;
  /** 저장하지 못한 RUNNING run 을 FAILED 로 닫는다(멈춘 run 복구가 분석 job 으로 다시 넣지 않게). */
  markFailed(orgId: string, runId: string, finishedAt: string): Promise<void>;
};

const looseSnapshotSchema = z.looseObject({ config: z.looseObject({}) });

/** 원본 스냅샷의 config.algorithmVersion 만 현재 버전으로 바꿔 검증한다. 모양이 맞지 않으면 null. */
export function toRescoreInput(source: RescoreSource): AnalysisInput | null {
  const snapshot = looseSnapshotSchema.safeParse(source.inputSnapshot);
  if (!snapshot.success) return null;
  const parsed = analysisInputSchema.safeParse({
    ...snapshot.data,
    config: { ...snapshot.data.config, algorithmVersion: ALGORITHM_VERSION },
  });
  return parsed.success ? parsed.data : null;
}

/** 다시 계산한 결과. 스냅샷이 맞지 않거나 계산이 던지면 null(원본 run 은 그대로 둔다). */
export function rescore(
  source: RescoreSource,
): { input: AnalysisInput; result: AnalysisResult } | null {
  const input = toRescoreInput(source);
  if (input === null) return null;
  try {
    return { input, result: analyze(input) };
  } catch {
    return null;
  }
}

/** requestId. 원본이 IT 일괄 분석 run 이면 일괄 분석 run 으로 남긴다(검토 대기 판정 유지). */
export function rescoreRequestId(source: RescoreSource): string {
  return isItBatchIdempotencyKey(source.idempotencyKey)
    ? itBatchRescoreRequestId(source.id, ALGORITHM_VERSION)
    : `rescore-${ALGORITHM_VERSION}-${source.id}`;
}

const RUN_MODES: Record<string, RunMode> = { LIVE: "live", FIXTURE: "fixture", MOCK: "mock" };
const AI_PROVIDERS: Record<string, AiProvider> = { LOCAL: "local", MOCK: "mock", HOSTED: "hosted" };
const EXTRA_REVIEW_FLAGS: readonly ExtraReviewFlag[] = [
  "CITATION_FAILED",
  "EXTRACTION_LOW_CONFIDENCE",
  "KEV_UNAVAILABLE",
  "TRANSLATION_INCOMPLETE",
];
const isExtraReviewFlag = (flag: string): flag is ExtraReviewFlag =>
  EXTRA_REVIEW_FLAGS.some((extra) => extra === flag);

/**
 * 새 run 행(RUNNING). 열 값은 원본 run 을 잇고 algorithm_version 만 현재 버전이다.
 * requested_by 는 넣지 않는다: finish_score_run 은 requested_by 가 있을 때만 BID_RECOMMENDED outbox 를 써서 알림이 나가지 않는다.
 */
export function toRescoreRunRow(
  orgId: string,
  source: RescoreSource,
  startedAt: string,
): TablesInsert<"score_runs"> {
  return {
    org_id: orgId,
    bid_id: source.bidId,
    revision_id: source.revisionId,
    company_profile_id: source.companyProfileId,
    profile_revision: source.profileRevision,
    extraction_id: source.extractionId,
    algorithm_version: ALGORITHM_VERSION,
    run_mode: source.runMode,
    ai_provider: source.aiProvider,
    idempotency_key: toIdempotencyKey(orgId, rescoreRequestId(source)),
    status: "RUNNING",
    queued_at: startedAt,
    started_at: startedAt,
  };
}

/**
 * finish_score_run 본문. 파이프라인과 같은 매핑(toFinishScoreRunPayload)을 쓰고 kev_output 만 원본 값을 옮긴다.
 * 설명은 규칙 템플릿이다(원본 run 도 모두 TEMPLATE 였다, 2026-10-29 운영 실측). 모르는 run_mode·ai_provider 면 null.
 */
export function toRescorePayload(args: {
  orgId: string;
  runId: string;
  source: RescoreSource;
  input: AnalysisInput;
  result: AnalysisResult;
  startedAt: string;
  finishedAt: string;
}): FinishScoreRunPayload | null {
  const { orgId, runId, source, input, result, startedAt, finishedAt } = args;
  const runMode = RUN_MODES[source.runMode];
  const aiProvider = AI_PROVIDERS[source.aiProvider];
  if (runMode === undefined || aiProvider === undefined) return null;
  const requestId = rescoreRequestId(source);
  const record: AnalysisRunRecord = {
    orgId,
    scoreRunId: runId,
    bidId: source.bidId,
    revisionId: source.revisionId,
    companyProfileId: source.companyProfileId,
    extractionId: source.extractionId,
    requestId,
    idempotencyKey: toIdempotencyKey(orgId, requestId),
    attemptStartedAt: startedAt,
    input,
    result,
    meta: {
      runMode,
      model: toModelMeta({ aiProvider, extraction: input.extraction, result }),
      fallbackReason: null,
      evidence: [],
      errorCode: result.errorCode,
      queuedAt: startedAt,
      startedAt,
      finishedAt,
      extraReviewFlags: source.reviewFlags.filter(isExtraReviewFlag),
      explanation: { text: result.explanation, source: "TEMPLATE" },
    },
    kevOutput: null,
    diagnostics: { extract: null, kev: null },
  };
  const payload = toFinishScoreRunPayload(record);
  return { ...payload, run: { ...payload.run, kev_output: source.kevOutput } };
}
