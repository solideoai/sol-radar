import "server-only";

// ── analysis 도메인 배럴. 바깥(worker·화면)은 이 파일만 부른다 ──
export { createGatewayClient } from "./gateway.client";
export type { GatewayClient, GatewayClientDeps } from "./gateway.client";
export { extractRequestSchema, readGatewayConfig } from "./gateway.model";
export type {
  ExplainResponse,
  ExtractRequest,
  ExtractResponse,
  GatewayConfig,
  GatewayFailure,
  GatewayHealth,
  GatewayRequestBody,
  GatewayResult,
  KevResponse,
} from "./gateway.model";
export type { BreakerState } from "./circuit-breaker.model";
export {
  pickAiUnavailableReason,
  toExplainOutcome,
  toExtractionOutcome,
  toKevOutcome,
} from "./fallback.model";
export type {
  AiUnavailableReason,
  ExplainOutcome,
  ExtractionOutcome,
  KevOutcome,
} from "./fallback.model";

// 분석 오케스트레이션(03 §2.1 ②~⑤). 요청 조립·플래그 같은 내부 순수 함수는 내보내지 않는다.
export { AnalysisInputError, analyzeAndSave, runAnalysis } from "./analysis.service";
export type { AnalysisDeps, AnalysisRunSink, ExtractionStore } from "./analysis.service";
export { toIdempotencyKey, toKstDate, withStructuredSeq } from "./analysis.model";
export type {
  AiProvider,
  AnalysisContext,
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
  analysisJobDataSchema,
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
  ScoreRunStatus,
} from "./analysis-job.model";

// 분석 port 네 개의 Supabase 구현. worker 가 service role 클라이언트와 첨부 port 를 넘긴다. 행 매핑 함수는 내보내지 않는다.
export { createAnalysisStores } from "./analysis.repo";
export type { AnalysisStores } from "./analysis.repo";
export { EMPTY_ATTACHMENT_READER } from "./analysis-store.model";
export type { AttachmentTextReader, RevisionDocumentText } from "./analysis-store.model";
