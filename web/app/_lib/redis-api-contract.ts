import "server-only";
import { z } from "zod";
import { EXTERNAL_SOURCE_KEYS } from "@/server/ingestion";

export const analysisAcceptedSchema = z
  .object({
    analysisId: z.uuid(),
    status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    deduplicated: z.boolean(),
    pollUrl: z.string(),
  })
  .refine((value) => value.pollUrl === `/api/v1/analyses/${value.analysisId}`);

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
      ]),
    }),
    requestId: z.uuid(),
  }),
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
