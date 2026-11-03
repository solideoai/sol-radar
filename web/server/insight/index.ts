import "server-only";

// ── 배럴: insight(추천 분석) 도메인의 공개 API. 바깥(app·components·worker)은 @/server/insight 만 부른다 ──
export {
  INSIGHT_JOB,
  INSIGHT_LIMITS,
  INSIGHT_POLL_LIMIT_MS,
  INSIGHT_PROMPT_VERSION,
  INSIGHT_QUEUE,
  INSIGHT_REQUEST_ROLES,
  INSIGHT_STALE_MS,
  insightCheckNoteSchema,
  insightErrorCodeSchema,
  insightFactorNoteSchema,
  insightFallbackReasonSchema,
  insightItemSchema,
  insightJobDataSchema,
  insightJobId,
  insightPayloadSchema,
  insightRefIdSchema,
  insightRefSchema,
  insightSourceSchema,
  insightStaffingSchema,
  insightStatusSchema,
} from "./insight.model";
export type {
  InsightAccepted,
  InsightCheckNote,
  InsightErrorCode,
  InsightFactorNote,
  InsightFallbackReason,
  InsightItem,
  InsightJobData,
  InsightPayload,
  InsightRef,
  InsightSource,
  InsightStaffing,
  InsightStatus,
  InsightView,
} from "./insight.model";
export { getInsight, readInsight, requestInsight } from "./insight.service";
export { insightRepo } from "./insight.repo";
export type {
  InsightContext,
  InsightRateLimiter,
  InsightReadData,
  InsightReadResult,
  InsightRepo,
  InsightRequestDeps,
  InsightRequestResult,
  InsightRunRef,
} from "./insight-request.model";
