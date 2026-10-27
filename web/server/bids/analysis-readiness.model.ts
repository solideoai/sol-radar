import "server-only";
import { z } from "zod";

// ── 분석 원문 준비(10-26 운영 전환): 분석할 글이 없는 공고는 분석을 받지 않는다 ──
// 분석 job 이 AI(/extract)에 넘기는 것은 최신 revision 의 정규화 본문 bid_revisions.normalized.content(body)와
// 그 revision 의 첨부 텍스트(attachments)뿐이다(@/server/analysis toExtractSource·toExtractRequest).
// 첨부 텍스트는 파싱이 끝나(parse_status PARSED·PARTIAL) 텍스트 객체가 저장된(text_object_key 있음) 문서에만 있다
// (@/server/ingestion RevisionDocumentText.text, DB 제약 bid_documents_parsed_storage_fk).
// 나라장터 목록 API 정규화는 본문을 비워 두므로(normalize-g2b content = "") 첨부가 파싱되기 전에는 분석할 글이 없다.
// 분석 runtime 은 documents worker 가 저장한 첨부 텍스트를 AI 에 넘긴다(@/server/analysis ANALYSIS_READS_ATTACHMENT_TEXT = true,
// @/server/documents createAttachmentTextReader, 2026-10-27). 그래서 본문이 비어도 파싱된 첨부가 있으면 분석할 수 있다.
// fixture DEMO 공고는 fixtures/bids 의 content 가 모두 비어 있지 않아 그대로 분석된다(특례 없음).

export const ANALYSIS_READINESS_REASONS = ["SOURCE_TEXT_MISSING"] as const;
export const analysisReadinessSchema = z.strictObject({
  ready: z.boolean(),
  reason: z.enum(ANALYSIS_READINESS_REASONS).nullable(),
});
export type AnalysisReadiness = z.infer<typeof analysisReadinessSchema>;

/** 분석 가능한 첨부의 파싱 상태 */
export const ANALYZABLE_PARSE_STATUSES = ["PARSED", "PARTIAL"] as const;

const READY: AnalysisReadiness = { ready: true, reason: null };
const SOURCE_TEXT_MISSING: AnalysisReadiness = { ready: false, reason: "SOURCE_TEXT_MISSING" };

/** 정규화 본문이 공백이 아닌 글인가 */
export const hasSourceBody = (content: unknown): boolean =>
  typeof content === "string" && content.trim() !== "";

/** 첨부 한 건이 AI 에 넘길 텍스트를 가졌는가 */
export const isAnalyzableDocument = (row: {
  parse_status: string | null;
  text_object_key: string | null;
}): boolean =>
  row.text_object_key !== null &&
  ANALYZABLE_PARSE_STATUSES.some((status) => status === row.parse_status);

/**
 * 본문이 있거나, 분석이 첨부 텍스트를 읽고(readsAttachmentText) 분석 가능한 첨부가 있으면 분석할 수 있다.
 * readsAttachmentText 는 호출하는 쪽이 @/server/analysis ANALYSIS_READS_ATTACHMENT_TEXT 를 넘긴다(시험은 두 값을 모두 본다).
 */
export const analysisReadinessOf = (source: {
  content: unknown;
  hasAnalyzableDocument: boolean;
  readsAttachmentText: boolean;
}): AnalysisReadiness =>
  hasSourceBody(source.content) || (source.readsAttachmentText && source.hasAnalyzableDocument)
    ? READY
    : SOURCE_TEXT_MISSING;
