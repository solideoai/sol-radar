import "server-only";

// ── 배럴: insight(추천 분석) 도메인의 공개 API. 바깥(app·components·worker)은 @/server/insight 만 부른다 ──
export {
  INSIGHT_JOB,
  INSIGHT_POLL_LIMIT_MS,
  INSIGHT_QUEUE,
  INSIGHT_REQUEST_ROLES,
  INSIGHT_STALE_MS,
  insightErrorCodeSchema,
  insightFallbackReasonSchema,
  insightItemSchema,
  insightJobDataSchema,
  insightJobId,
  insightPayloadSchema,
  insightRefIdSchema,
  insightRefSchema,
  insightSourceSchema,
  insightStatusSchema,
} from "./insight.model";
export type {
  InsightAccepted,
  InsightErrorCode,
  InsightFallbackReason,
  InsightItem,
  InsightJobData,
  InsightPayload,
  InsightRef,
  InsightSource,
  InsightStatus,
  InsightView,
} from "./insight.model";
