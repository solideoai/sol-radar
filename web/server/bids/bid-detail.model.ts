import "server-only";
import { z } from "zod";
import { analysisViewSchema } from "./analysis-view.model";
import {
  bidDocumentSchema,
  bidListItemSchema,
  bidOriginalSchema,
  bidRevisionSummarySchema,
  extractionStatusSchema,
  structuredRequirementSchema,
} from "./bid.model";
import { reviewSchema } from "./review.model";

// 05 §4.3 BidDetail = BidListItem 확장. latestAnalysis 는 요약 대신 전체(AnalysisView)다.
// extraction(RequirementExtraction)은 모양을 여기서 다시 적지 않고 unknown 으로 받는다.
// 화면은 itemId 경로 조회 함수로만 읽는다.
export const bidDetailSchema = bidListItemSchema.omit({ latestAnalysis: true }).extend({
  content: z.string(),
  original: bidOriginalSchema,
  revisions: z.array(bidRevisionSummarySchema),
  documents: z.array(bidDocumentSchema),
  stageLinks: z.strictObject({ planRef: z.string().nullable(), preSpecRef: z.string().nullable() }),
  structuredQualifications: z.array(structuredRequirementSchema),
  extraction: z.unknown().nullable(),
  extractionStatus: extractionStatusSchema,
  latestAnalysis: analysisViewSchema.nullable(),
  reviews: z.array(reviewSchema),
});
export type BidDetail = z.infer<typeof bidDetailSchema>;
