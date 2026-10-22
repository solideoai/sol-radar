import "server-only";
import { z } from "zod";
import { analysisViewSchema } from "./analysis-view.model";
import { analysisStatusSchema, recommendationSchema, runModeSchema } from "./bid.model";
import type { ListAfter, PagedRows } from "./bids.repo";
import type { ParseResult, RawQuery } from "./bid-query";

export const analysisHistoryItemSchema = analysisViewSchema
  .pick({
    id: true,
    bidId: true,
    revision: true,
    profileRevision: true,
    status: true,
    runMode: true,
    solScore: true,
    recommendation: true,
    errorCode: true,
    reviewFlags: true,
    queuedAt: true,
    finishedAt: true,
  })
  .extend({
    bidTitle: z.string(),
    isDemo: z.boolean(),
    model: z.object({ algorithmVersion: z.string() }),
  });
export type AnalysisHistoryItem = z.infer<typeof analysisHistoryItemSchema>;
const querySchema = z.object({
  bidId: z.uuid().nullable(),
  status: analysisStatusSchema.nullable(),
  recommendation: recommendationSchema.nullable(),
  runMode: runModeSchema.nullable(),
  cursor: z.string().min(1).nullable(),
  limit: z.coerce.number().int().min(1).max(100),
});
export type AnalysisHistoryQuery = z.infer<typeof querySchema>;
export type AnalysisHistoryRepo = {
  list(
    orgId: string,
    query: AnalysisHistoryQuery,
    after: ListAfter,
  ): Promise<PagedRows<AnalysisHistoryItem>>;
};
export function parseAnalysisHistoryQuery(raw: RawQuery): ParseResult<AnalysisHistoryQuery> {
  const result = querySchema.safeParse(
    Object.fromEntries(
      ["bidId", "status", "recommendation", "runMode", "cursor", "limit"].map((key) => [
        key,
        raw[key] === "" || raw[key] === undefined ? (key === "limit" ? 20 : null) : raw[key],
      ]),
    ),
  );
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
}
