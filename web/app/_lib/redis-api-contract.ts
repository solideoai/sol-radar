import "server-only";
import { z } from "zod";
import { insightStatusSchema } from "@/server/insight";
import {
  EXTERNAL_SOURCE_KEYS,
  SOURCE_READINESS_STATES,
  sourceReadinessServicesSchema,
} from "@/server/ingestion";

export const analysisAcceptedSchema = z
  .object({
    analysisId: z.uuid(),
    status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    deduplicated: z.boolean(),
    pollUrl: z.string(),
  })
  .refine((value) => value.pollUrl === `/api/v1/analyses/${value.analysisId}`);

// 추천 분석 요청 202(@/server/insight InsightAccepted). pollUrl 은 요청한 경로 그대로의 GET 이다(보안 리뷰 하-4).
export const insightAcceptedSchema = z.object({
  insightId: z.uuid(),
  status: insightStatusSchema,
  deduplicated: z.boolean(),
  pollUrl: z.string(),
});
export const insightAcceptedFor = (targetPath: string) =>
  insightAcceptedSchema.refine((value) => value.pollUrl === targetPath);

const count = z.number().int().nonnegative();
const externalServiceKey = z.enum(EXTERNAL_SOURCE_KEYS);
export const ingestAcceptedSchema = z.object({
  id: z.uuid(),
  source: z.enum(["fixture", "g2b", "kwater", "lh", "kepco"]),
  serviceKey: z.enum(["g2b-bid-notice", ...EXTERNAL_SOURCE_KEYS]).optional(),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]).optional(),
  fetchedCount: count.optional(),
  runMode: z.enum(["mock", "fixture", "live"]),
  batch: z.enum(["seed", "live"]).nullable(),
  trigger: z.enum(["SCHEDULED", "MANUAL", "DEMO"]),
  status: z.enum(["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]),
  summary: z.object({
    created: count,
    changed: count,
    cancelled: count,
    skippedDuplicate: count,
    quarantined: count,
    retried: count,
  }),
  quotaUsed: count,
  errors: z.array(
    z.object({
      sourceKey: z.string(),
      errorCode: z.string(),
      resultCode: z.string().nullable(),
      detail: z.string(),
    }),
  ),
  cursor: z.string().nullable(),
  requestedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const sourceReadinessErrorSchema = z.object({
  error: z.object({
    code: z.literal("SERVICE_UNAVAILABLE"),
    details: z.object({
      component: z.literal("source"),
      source: z.enum(["g2b", "kwater", "lh", "kepco"]),
      serviceKey: externalServiceKey,
      reason: z.enum([
        "NOT_REGISTERED",
        "DISABLED",
        "NOT_VERIFIED",
        "NOT_APPROVED",
        "NO_ENDPOINT",
        "NO_FIELD_MAPPING",
        "NO_SERVICE_KEY_ENV",
        // ingest Worker 가 남긴 서비스 상태(source-readiness.model.ts). WORKER_NOT_READY 는 상태가 아직 없다
        "WORKER_NOT_READY",
        ...SOURCE_READINESS_STATES.filter((state) => state !== "READY"),
      ]),
    }),
    requestId: z.uuid(),
  }),
});

// 정기 수집 Job Scheduler 가 없어 수동 수집을 받지 않는다(회사 ingest 전용 Worker 미기동). 다시 시도해도 같아 그대로 전한다.
export const ingestWorkerUnavailableErrorSchema = z.object({
  error: z.object({
    code: z.literal("SERVICE_UNAVAILABLE"),
    details: z.object({
      component: z.literal("ingest-worker"),
      reason: z.literal("SCHEDULER_INACTIVE"),
    }),
    requestId: z.uuid(),
  }),
});

const isoInstant = z.iso.datetime({ offset: true });
// GET /admin/ingestion/manual-gate 200 본문(@/server/ingestion ManualIngestGateView).
export const manualIngestGateSchema = z.object({
  cooldownMinutes: count,
  nextAvailableAt: isoInstant.nullable(),
  sharedRun: z
    .object({ runId: z.uuid(), requestedAt: isoInstant, until: isoInstant, mine: z.boolean() })
    .nullable(),
  daily: z.object({ used: count, limit: count, resetsAt: isoInstant }),
  schedule: z.object({
    pattern: z.string().min(1).max(100),
    timezone: z.string().min(1).max(100),
    slotHoursKst: z.array(z.number().int().min(0).max(23)).max(24),
    active: z.boolean(),
    nextRunAt: isoInstant.nullable(),
  }),
  ingestMode: z.enum(["live", "fixture", "mock"]),
  // 새 redis-api 만 싣는다. 옛 redis-api 응답에는 없다(화면은 없으면 외부 서비스 단추를 막는다).
  // 아는 서비스의 올바른 항목만 남기고, 모양이 아예 다르면 null 로 둔다. 판정 전체([지금 불러오기])는 거절하지 않는다.
  services: sourceReadinessServicesSchema.nullable().optional().catch(null),
});

export const backendErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "UNAUTHENTICATED",
      "ACCOUNT_DISABLED",
      "CSRF_REJECTED",
      "PROFILE_INCOMPLETE",
      "VALIDATION_ERROR",
      "FORBIDDEN",
      "UNSUPPORTED_ACCOUNT_STATE",
      "INVALID_CURSOR",
      "ANALYSIS_IN_PROGRESS",
      "INGESTION_IN_PROGRESS",
      "RUN_MODE_MISMATCH",
      "IDEMPOTENCY_KEY_REUSED",
      "RATE_LIMITED",
      "MANUAL_COOLDOWN",
      "MANUAL_SHARED_RUN",
      "MANUAL_DAILY_LIMIT",
      "ANALYSIS_SOURCE_MISSING",
      "NOT_FOUND",
      "HOSTED_NOT_APPROVED",
    ]),
    message: z.string().max(500),
    details: z.record(z.string(), z.unknown()),
    requestId: z.uuid(),
  }),
});

export const backendReadinessSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  checks: z.object({
    db: z.enum(["ok", "unavailable"]),
    redis: z.enum(["ok", "unavailable"]),
    storage: z.enum(["ok", "unavailable"]),
    ai: z.enum(["mock", "local", "hosted", "unavailable"]),
  }),
});
