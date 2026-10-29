import "server-only";
export { getDocumentDownload } from "./documents.service";
export {
  STORAGE_MAX_BYTES,
  STORAGE_OWNER,
  STORAGE_SENTINEL,
  readStorageSettings,
} from "./documents.model";
export type { StorageSettings } from "./documents.model";

// ── 첨부 처리(documents job)와 첨부 텍스트 reader. worker 가 service role 클라이언트를 넘긴다 ──
export {
  PARSED_DOCUMENT_SCHEMA_VERSION,
  PARSE_ERROR_CODES,
  RECORDABLE_DOWNLOAD_ERROR_CODES,
  parsedDocumentSchema,
  readAttachmentTextSettings,
  readDocumentsSettings,
  toParsedDocumentObject,
} from "./document-processing.model";
export type {
  AttachmentTextSettings,
  ClaimResult,
  ClaimedDocument,
  DocumentProcessingRepo,
  DocumentsSettings,
  ParseErrorCode,
  ParsedDocument,
  ProcessingRevision,
  RecordableDownloadErrorCode,
} from "./document-processing.model";
export {
  documentPriorityOf,
  hasParserExtension,
  needsDocumentWork,
  pendingDocumentsOf,
  rankDocuments,
  scopeSkipReasonOf,
  selectDocuments,
} from "./document-selection.model";
export type { DocumentPriority, ScopeNotice, ScopeSkipReason } from "./document-selection.model";
export {
  NIL_UUID,
  createDocumentCandidateFinder,
  createDocumentProcessingRepo,
} from "./document-processing.repo";
export { createAttachmentTextReader, truncateContent } from "./document-text.repo";
