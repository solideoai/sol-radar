import "server-only";
import { z } from "zod";
import { reviewInputSchema } from "@/server/shared";
import { recommendationSchema, roleSchema } from "./bid.model";

// 05 §4.6. 입력 규칙은 브라우저와 공유하므로 shared 층에 한 번만 있다.
export { reviewInputSchema };
export type { ReviewInput } from "@/server/shared";

export const reviewSchema = z.strictObject({
  id: z.string().min(1),
  bidId: z.string().min(1),
  revisionId: z.string().min(1),
  scoreRunId: z.string().nullable(),
  reviewer: z.strictObject({ id: z.string().min(1), name: z.string(), role: roleSchema }),
  decision: recommendationSchema,
  reason: z.string(),
  decidedAt: z.string().min(1),
  assignee: z.strictObject({ id: z.string().min(1), name: z.string() }).nullable(),
  systemRecommendationAtDecision: recommendationSchema.nullable(),
  disagreementFlag: z.boolean(),
});
export type Review = z.infer<typeof reviewSchema>;
