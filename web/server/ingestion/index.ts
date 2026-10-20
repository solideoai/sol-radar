import "server-only";
export { createPendingDocumentFinder } from "./pending-documents.repo";
export type { PendingDocument, PendingDocumentFinder } from "./pending-documents.repo";

// ── 배럴: ingestion 도메인의 공개 API. 바깥(worker·seed)은 @/server/ingestion 만 부른다 ──
// 테스트용 메모리 저장소(ingestion.repo.memory.ts)는 내보내지 않는다.
export {
  BID_SOURCES,
  BID_STAGES,
  BID_STATUSES,
  NORMALIZED_BID_SCHEMA_VERSION,
  STRUCTURED_REQUIREMENT_KINDS,
  bidAttachmentSchema,
  normalizedBidDraftSchema,
  normalizedBidSchema,
  structuredRequirementSchema,
} from "./normalized-bid.model";
export type {
  BidAttachment,
  BidSource,
  BidStage,
  BidStatus,
  NormalizedBid,
  NormalizedBidDraft,
  StructuredRequirement,
  StructuredRequirementKind,
} from "./normalized-bid.model";

export { normText } from "./text-normalize";
export { parseBudgetKrw } from "./normalize-amount";
export type { BudgetParse } from "./normalize-amount";
export { ASSUMED_HOUR_KST, KST_OFFSET_MINUTES, parseKstDateTime } from "./normalize-date";
export type { DateParse } from "./normalize-date";
export { canonicalJson, computeBidChecksum, finalizeRevision } from "./checksum";

export {
  CONNECTOR_BEHAVIORS,
  FIXTURE_BATCHES,
  fixtureFileSchema,
  fixtureManifestSchema,
  fixtureRecordSchema,
} from "./fixture.model";
export type {
  ConnectorBehavior,
  FixtureBatch,
  FixtureFile,
  FixtureManifest,
  FixtureRecord,
} from "./fixture.model";

export {
  ENCODING_DEGRADED_RATIO,
  QUARANTINE_CODES,
  REQUIRED_FIELDS,
  WARNING_CODES,
  replacementCharRatio,
  sourceKeyOf,
} from "./validation";
export type {
  IngestIssue,
  QuarantineCode,
  QuarantineIssue,
  WarningCode,
  WarningIssue,
} from "./validation";

export { normalizeFixtureRecord } from "./normalize";
export type { NormalizeContext, NormalizeOutcome } from "./normalize";

export {
  TRACKED_FIELDS,
  decideRevision,
  diffRevisions,
  isOlderAmendment,
  statusForRevision,
} from "./revision";
export type {
  BidEvent,
  BidEventType,
  ChangeDecision,
  FieldChange,
  StoredRevision,
  TrackedField,
} from "./revision";

export { STAGE_LINK_CANDIDATE_MIN_SIMILARITY, linkStages, titleSimilarity } from "./stage-link";
export type { StageLink, StageLinkCandidate, StageLinkInput } from "./stage-link";

export { isVisibleAt, revisionAsOf } from "./point-in-time";
export { REDACTED, redactSecrets, redactUrl } from "./redaction";
export {
  DAILY_LIMIT_RESULT_CODE,
  QUOTA_AUXILIARY_STOP_RATIO,
  isDailyLimitExceeded,
  quotaKey,
  quotaState,
} from "./quota";
export type { QuotaState } from "./quota";

// ── Stage 2: connector·재시도·첨부·저장 포트·수집 흐름 ──
export {
  CONNECTOR_FAILURE_KINDS,
  CONNECTOR_TIMEOUT_MS,
  ingestErrorCodeOf,
  isRetryableFailure,
} from "./connector.model";
export type {
  BidSourceConnector,
  ConnectorFailure,
  ConnectorFailureKind,
  FetchedPage,
  FetchPageInput,
  FetchPageOutcome,
  G2bItem,
  RateLimitInfo,
  SourceRecord,
} from "./connector.model";

export {
  FIXTURE_RATE_LIMIT_FAILURES,
  FIXTURE_RETRY_AFTER_SEC,
  createFixtureConnector,
  loadFixtureManifest,
} from "./fixture-connector";

export {
  RETRY_AFTER_MAX_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_MAX_MS,
  RETRY_MAX_RETRIES,
  fetchPageWithRetry,
  retryDelayMs,
  withRetry,
} from "./retry";
export type {
  RetryAttemptLog,
  RetryDeps,
  RetryOutcome,
  RetryResult,
  RetryableOutcome,
} from "./retry";

export {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_REDIRECTS,
  ATTACHMENT_TIMEOUT_MS,
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_EXT,
  DOCUMENT_FORMAT_MIME,
  DOWNLOAD_ERROR_CODES,
  attachmentObjectKey,
} from "./attachment.model";
export type {
  AttachmentDownload,
  AttachmentFetcher,
  AttachmentFetchResult,
  AttachmentRef,
  AttachmentTextReader,
  DocumentFormat,
  DownloadErrorCode,
  RevisionDocumentText,
} from "./attachment.model";
export { detectDocumentFormat } from "./document-format";
export {
  G2B_ATTACHMENT_HOSTS,
  G2B_ATTACHMENT_PATH_PREFIX,
  checkAttachmentUrl,
  checkDeclaredSize,
  checkRedirect,
  checkResolvedAddresses,
  classifyHttpStatus,
  exceedsMaxBytes,
  isPublicAddress,
} from "./attachment-allowlist";
export { createFixtureAttachmentFetcher } from "./fixture-attachment-fetcher";

export { EMPTY_INGEST_SUMMARY } from "./ingestion.port";
export { createSupabaseIngestAudit, createSupabaseIngestionRepo } from "./ingestion.repo";
export type {
  IngestErrorInput,
  IngestionRepo,
  IngestRunMode,
  IngestRunSource,
  IngestRunStatus,
  IngestSummary,
  IngestTrigger,
  SavedRevision,
  SavedRevisionDecision,
  SaveRevisionInput,
  StartedRun,
  StartRunInput,
} from "./ingestion.port";

export { FIXTURE_ANCHOR_PARAM, SEED_ANCHOR_MISSING, runIngest } from "./ingestion.service";
export type {
  IdFor,
  IngestRunResult,
  QuarantinedRecord,
  RunIngestInput,
  SavedBidRevision,
} from "./ingestion.service";
// demo:reset 의 공고 SEED 적재 진입점(6-5)
export { DEMO_RESET_SEED_JOB_KEY, seedFixtureBids } from "./seed-fixture-bids";
export type {
  SeedFixtureBid,
  SeedFixtureBidsInput,
  SeedFixtureBidsResult,
} from "./seed-fixture-bids";

// ── Stage 3: 나라장터 입찰공고 목록(OfficialApiConnector) ──
export {
  G2B_API_HOST,
  G2B_AUX_OPERATIONS,
  G2B_BID_NOTICE_LIST_OPERATION,
  G2B_BID_NOTICE_SERVICE_ID,
  G2B_CONTACT_FIELDS,
  G2B_DEFAULT_ROWS,
  G2B_EORDER_ATTACH_OPERATION,
  G2B_GATEWAY_KEY_ERROR_CODES,
  G2B_LICENSE_LIMIT_OPERATION,
  G2B_MAX_ROWS,
  G2B_REGION_OPERATION,
  G2B_RESPONSE_MAX_BYTES,
  G2B_WINDOW_MAX_MS,
  looksLikeXml,
  parseG2bAuxEnvelope,
  parseG2bEnvelope,
  parseG2bGatewayError,
  stripContactFields,
} from "./g2b.model";
export type { G2bAuxOperation, G2bAuxRegistryKey, G2bEnvelope, G2bGatewayError } from "./g2b.model";
export {
  G2B_AUX_INQRY_DIV,
  G2B_AUX_WINDOW_DAYS_AFTER,
  G2B_AUX_WINDOW_DAYS_BEFORE,
  auxWindowOf,
  buildG2bAuxUrl,
  buildG2bListUrl,
  formatG2bDateTime,
  splitG2bWindow,
} from "./g2b-request";
export type { G2bWindowSlice } from "./g2b-request";
// 보조 조회 3종(07 §2.2): live 의 새 revision 마다 공고 1건 단위로 부른다
export { G2B_AUX_MAX_PAGES, auxRowsForNotice, createG2bAuxFetcher } from "./g2b-aux";
export type {
  G2bAuxFailure,
  G2bAuxFetcher,
  G2bAuxFetcherOptions,
  G2bAuxOutcome,
  G2bAuxRequest,
  G2bAuxRows,
} from "./g2b-aux";
export {
  G2B_EORDER_ATTACHMENT_PATH,
  eorderAttachmentsOf,
  licenseRequirementsOf,
  listOnlyRevision,
  mergeG2bAux,
  regionRequirementsOf,
  registeredAtOf,
  splitNameAndCode,
} from "./normalize-g2b-aux";
export {
  DEFAULT_INFO_BIZ_FILTER,
  INFO_BIZ_CLASSIFICATION_KEYWORDS,
  INFO_BIZ_SUCSFBID_MARKER,
  isInfoBizNoticeBroad,
  isInfoBizNoticeStrict,
} from "./g2b-filter";
export {
  G2B_NOTICE_KIND_STATUS,
  normalizeG2bBidNotice,
  sortStructuredRequirements,
} from "./normalize-g2b";
export { createOfficialApiConnector } from "./official-api-connector";
export type { FetchLike, OfficialApiConnectorOptions } from "./official-api-connector";

// ── Stage 4: 녹음 응답 재생(시험·개발 스크립트 전용. worker 의 실행 모드 선택에는 넣지 않는다) ──
export {
  RECORDED_REPLAY_SERVICE_KEY,
  RECORDED_SCHEMA_VERSION,
  createRecordedApiConnector,
  createRecordedAuxFetcher,
  loadRecordedResponse,
  parseRecordedResponse,
} from "./recorded-api";
export type { RecordedResponse } from "./recorded-api";

// ── Stage 6: 큐·수집 소스 registry ──
export {
  DOCUMENTS_JOB_NAME,
  DOCUMENTS_QUEUE,
  INGEST_JOB_NAME,
  INGEST_QUEUE,
  documentsJobDataSchema,
  enqueueDocuments,
  enqueueIngestRun,
  INGEST_WINDOW_FUTURE_TOLERANCE_MS,
  ingestJobDataSchema,
  ingestJobDataSchemaAt,
  toBullJobId,
} from "./ingestion.queue";
export type { DocumentsJobData, IngestJobData, JobQueue } from "./ingestion.queue";
export {
  APPROVAL_STATUSES,
  SOURCE_REGISTRY_SCHEMA_VERSION,
  callableSource,
  loadSourceRegistry,
  sourceRegistrySchema,
} from "./source-registry";
export type {
  CallableSource,
  CallableSourceResult,
  SourceEntry,
  SourceRegistry,
} from "./source-registry";
