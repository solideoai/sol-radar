import "server-only";

// ── analysis 도메인 배럴. 바깥(worker·화면)은 이 파일만 부른다 ──
export { createGatewayClient, createParseClient } from "./gateway.client";
export type { GatewayClient, GatewayClientDeps, ParseClient } from "./gateway.client";
export {
  extractRequestSchema,
  insightResponseSchema,
  parseResponseSchema,
  readGatewayConfig,
  readParseConfig,
} from "./gateway.model";
export type {
  ExplainResponse,
  ExtractRequest,
  ExtractResponse,
  GatewayConfig,
  GatewayFailure,
  GatewayHealth,
  GatewayRequestBody,
  GatewayResult,
  InsightGatewayRequest,
  InsightGatewayResponse,
  KevResponse,
  ParseClientConfig,
  ParseResponse,
  QualificationStatus,
} from "./gateway.model";

// 추천 분석(ADR-066) gateway 요청 조립과 저장 port. worker 의 insight job 이 쓴다. 행 매핑 함수는 내보내지 않는다.
export { toInsightPayload, toInsightRequest } from "./insight-request.model";
export type { InsightRunSource } from "./insight-request.model";
export { createInsightStore } from "./insight-store";
export type { InsightFinishDone, InsightFinishFailed, InsightStore } from "./insight-store";
export type { BreakerState } from "./circuit-breaker.model";
export {
  pickAiUnavailableReason,
  toExplainOutcome,
  toExtractionOutcome,
  toKevOutcome,
} from "./fallback.model";
export type {
  AiUnavailableReason,
  DiagnosticFailure,
  ExplainOutcome,
  ExtractionOutcome,
  FailureDiagnostic,
  KevOutcome,
  KevUnusableFailure,
} from "./fallback.model";

// 분석 오케스트레이션(03 §2.1 ②~⑤). 요청 조립·플래그 같은 내부 순수 함수는 내보내지 않는다.
export { AnalysisInputError, analyzeAndSave, runAnalysis } from "./analysis.service";
export type { AnalysisDeps, AnalysisRunSink, ExtractionStore } from "./analysis.service";
export { toIdempotencyKey, toKstDate, withStructuredSeq } from "./analysis.model";
export type {
  AiProvider,
  AnalysisContext,
  AnalysisRunDiagnostics,
  AnalysisRunMeta,
  AnalysisRunRecord,
  CachedExtraction,
  DocumentIssue,
  ExplainRequest,
  ExtractSource,
  ExtractionRecord,
  ExtraReviewFlag,
  KevOutput,
  KevQuestionSetVersion,
  KevRequest,
  RunMode,
} from "./analysis.model";

// analysis 큐 계약·처리 설정. Route Handler(C6)와 worker 가 함께 쓴다.
export {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  ANALYSIS_QUEUE,
  FINISH_NOT_RUNNING_MESSAGE,
  analysisJobDataSchema,
  nextAttemptStartedAt,
  readRunMode,
  requestIdOf,
  toAnalysisJobId,
  toAnalysisSettings,
  toFixtureStem,
} from "./analysis-job.model";
export type {
  AnalysisContextLoader,
  AnalysisJobData,
  AnalysisRunTracker,
  AnalysisSettings,
  ExtractionCacheKey,
  LoadedAnalysisContext,
  RunClaim,
  ScoreRunStatus,
  StaleRun,
  StaleRunCursor,
  StaleRunFinder,
} from "./analysis-job.model";

// 분석 port 네 개와 멈춘 run 찾기 port 의 Supabase 구현. worker 가 service role 클라이언트와 첨부 port 를 넘긴다. 행 매핑 함수는 내보내지 않는다.
export { createAnalysisStores, createItBatchStore, createPreanalyzeStore } from "./analysis.repo";
export type { AnalysisStores } from "./analysis.repo";

// 사전 분석(`pnpm demo:preanalyze`, C5-B). 대상 고르기·멱등 키·요약 줄과 저장 port. 행 매핑 함수는 내보내지 않는다.
export {
  DEMO_ORG_SLUG,
  PREANALYZE_EXCLUDED_FIXTURES,
  preanalyzeIdempotencyKey,
  selectPreanalyzeTargets,
  summarize,
  summaryLine,
} from "./preanalyze.model";
export type {
  DemoBidRow,
  PreanalyzeRun,
  PreanalyzeRunInput,
  PreanalyzeStore,
  PreanalyzeSummary,
  PreanalyzeTarget,
  RunState,
} from "./preanalyze.model";
export { ANALYSIS_READS_ATTACHMENT_TEXT, EMPTY_ATTACHMENT_READER } from "./analysis-store.model";
export type { AttachmentTextReader, RevisionDocumentText } from "./analysis-store.model";

// IT 공고 1회 일괄 분석(`pnpm it:batch-analyze`, ADR-069). 멱등 키(만들기·가르기)와 저장 port. 원문 판정·행 매핑 함수는 내보내지 않는다.
export { isItBatchIdempotencyKey, itBatchIdempotencyKey } from "./it-batch.model";

// 점수 재채점(`pnpm score:rescore`, ADR-071). 화면에 보이는 run 의 스냅샷을 현재 알고리즘으로 다시 계산한다.
export { rescore, toRescorePayload, toRescoreRunRow } from "./rescore.model";
export type { RescoreSource, RescoreStore } from "./rescore.model";
export { createRescoreStore } from "./rescore.repo";
export type { ItBatchRun, ItBatchRunInput, ItBatchStore, ItBatchTarget } from "./it-batch.model";
