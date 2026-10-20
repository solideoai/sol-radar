import "server-only";
import { z } from "zod";
import { bidStageSchema, bidStatusSchema, recommendationSchema } from "./bid.model";

// 05 §4.6 DashboardSummary
const count = z.number().int().nonnegative();
const providerSchema = z.enum(["mock", "local", "hosted"]);

export const dashboardSummarySchema = z.strictObject({
  generatedAt: z.string().min(1),
  dataFreshness: z.strictObject({
    lastIngestAt: z.string().nullable(),
    lastIngestStatus: z.enum(["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]).nullable(),
    isDemo: z.boolean(),
    lastIngestSummary: z
      .strictObject({
        created: count,
        changed: count,
        cancelled: count,
        skippedDuplicate: count,
        quarantined: count,
        retried: count,
      })
      .nullable(),
  }),
  ai: z.strictObject({
    provider: providerSchema,
    kevEnabled: z.boolean(),
    lastGatewayCheckAt: z.string().nullable(),
    healthy: z.boolean(),
  }),
  bids: z.strictObject({
    total: count,
    byStage: z.record(bidStageSchema, count),
    byStatus: z.record(bidStatusSchema, count),
    deadlineWithin7Days: count,
  }),
  analyses: z.strictObject({
    total: count,
    byRecommendation: z.record(recommendationSchema, count),
    partial: count,
    withReviewFlags: count,
    latestByStatus: z.strictObject({ completed: count, partial: count, failed: count }),
  }),
  reviews: z.strictObject({
    pending: count,
    byDecision: z.record(recommendationSchema, count),
    disagreementWithSystem: count,
  }),
  upcoming: z.array(
    z.strictObject({
      bidId: z.string().min(1),
      title: z.string(),
      deadlineAt: z.string().min(1),
      recommendation: recommendationSchema.nullable(),
      decision: recommendationSchema.nullable(),
    }),
  ),
  unreadNotifications: count,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// 업무 틀 상단바용 요약(수집 신선도·안 읽은 알림 수). DashboardSummary 의 두 칸과 같은 모양이다(M3).
export type StatusSummary = Pick<DashboardSummary, "dataFreshness" | "unreadNotifications">;
