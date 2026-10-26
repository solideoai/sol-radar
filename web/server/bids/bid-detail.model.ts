import "server-only";
import { z } from "zod";
import { analysisReadinessSchema } from "./analysis-readiness.model";
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
  // 공고기관(G2B ntceInsttNm). 원본 응답에 있을 때만 싣는다. agency 는 수요기관(dminsttNm)이다.
  noticeAgency: z.string().nullable(),
  // 저장된 sourceUrl 의 종류. SERVICE_DOCUMENTATION 은 공공데이터 서비스 안내 페이지라 원본 공고가 아니다(external-normalize).
  sourceUrlKind: z.enum(["NOTICE", "SERVICE_DOCUMENTATION"]),
  original: bidOriginalSchema,
  revisions: z.array(bidRevisionSummarySchema),
  documents: z.array(bidDocumentSchema),
  stageLinks: z.strictObject({ planRef: z.string().nullable(), preSpecRef: z.string().nullable() }),
  structuredQualifications: z.array(structuredRequirementSchema),
  extraction: z.unknown().nullable(),
  extractionStatus: extractionStatusSchema,
  latestAnalysis: analysisViewSchema.nullable(),
  reviews: z.array(reviewSchema),
  // 분석 원문(최신 revision 본문·분석 가능한 첨부) 준비. ready=false 면 분석 요청은 409 ANALYSIS_SOURCE_MISSING 이다.
  analysisReadiness: analysisReadinessSchema,
});
export type BidDetail = z.infer<typeof bidDetailSchema>;
