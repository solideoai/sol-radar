import "server-only";
import { z } from "zod";

// 05 §4.1 공통 + §4.3 공고 DTO. 타입은 z.infer 로 얻는다(ADR-016).

export const bidStageSchema = z.enum(["PLAN", "PRE_SPEC", "NOTICE"]);
export const bidStatusSchema = z.enum(["OPEN", "AMENDED", "CANCELLED", "CLOSED"]);
export const recommendationSchema = z.enum(["BID", "WATCH", "NO_BID"]);
export const recommendationBasisSchema = z.enum(["RULES_ONLY", "RULES_WITH_KEV_ASSIST"]);
export const analysisStatusSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]);
// 규칙 판정·Kev 항목 질문·평가셋 라벨이 같은 3값(08 §5.1)
export const qualificationOutcomeSchema = z.enum(["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"]);
export const needsReviewReasonSchema = z.enum([
  "NOTICE_INFO_MISSING",
  "NOTICE_CONFLICTED",
  "COMPANY_EVIDENCE_MISSING",
  "AMBIGUOUS_MATCH",
  "PARSE_UNSUPPORTED",
  "STAGE_NOT_APPLICABLE",
]);
export const requirementBasisSchema = z.enum(["API_FIELD", "EXTRACTION"]);
export const requirementItemKindSchema = z.enum([
  "SKILL",
  "PAST_PERFORMANCE",
  "STAFFING",
  "QUALIFICATION",
]);
export const reviewFlagSchema = z.enum([
  "MODEL_RULE_DISAGREEMENT",
  "KEV_MANDATORY_RISK",
  "KEV_NEEDS_REVIEW",
  "KEV_REQUIREMENT_DISAGREEMENT",
  "KEV_DELIVERY_RISK",
  "CITATION_FAILED",
  "EXTRACTION_FAILED",
  "EXTRACTION_LOW_CONFIDENCE",
  "AI_UNAVAILABLE",
  "QWEN_UNAVAILABLE",
  "KEV_UNAVAILABLE",
  "MOCK_FALLBACK",
  "PARSE_UNSUPPORTED",
  "DOCUMENT_DOWNLOAD_FAILED",
  "INSUFFICIENT_DATA",
  "INJECTION_SUSPECTED",
  "SCALE_LIMIT_EXCEEDED",
]);
export const factorKeySchema = z.enum([
  "skillMatch",
  "pastPerformance",
  "staffAvailability",
  "scaleFit",
  "strategicPreference",
]);
// C4 MissingReason 8개. 스펙 §5.4.5 라벨 표의 키다.
export const missingReasonSchema = z.enum([
  "NO_REQUIREMENTS_EXTRACTED",
  "PROFILE_TECHNOLOGIES_EMPTY",
  "BID_DOMAIN_UNKNOWN",
  "PROFILE_PROJECTS_EMPTY",
  "REQUIRED_FTE_UNKNOWN",
  "TEAM_EMPTY",
  "BUDGET_UNKNOWN",
  "PREFERENCES_NOT_SET",
]);
export const runModeSchema = z.enum(["live", "fixture", "mock"]);
export const bidOriginSchema = z.enum(["live", "demo"]);
// memberships.sol_role. 도메인 간 런타임 import 를 피해 여기에 두고, 시험이 SolRole 과 같음을 고정한다.
export const roleSchema = z.enum(["ADMIN", "SALES", "ANALYST", "VIEWER"]);

// Route Handler 가 apiError 로 옮기는 서비스 오류 코드(T1 ApiErrorCode 와 같은 문자열).
export type ServiceErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ANALYSIS_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RATE_LIMITED"
  | "INVALID_CURSOR"
  | "SERVICE_UNAVAILABLE";

export const pageInfoSchema = z.strictObject({
  cursor: z.string().nullable(),
  nextCursor: z.string().nullable(),
  hasNext: z.boolean(),
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), pageInfo: pageInfoSchema });
}

const isoString = z.string().min(1);
const krwString = z.string().regex(/^\d+$/, "원 단위 숫자 문자열이어야 한다");
const count = z.number().int().nonnegative();

export const documentsStatusSchema = z.strictObject({
  total: count,
  pending: count,
  parsed: count,
  partial: count,
  unsupported: count,
  failed: count,
  downloadFailed: count,
});

export const bidLatestAnalysisSchema = z.strictObject({
  id: z.string().min(1),
  status: analysisStatusSchema,
  solScore: z.number().min(0).max(100).nullable(),
  recommendation: recommendationSchema.nullable(),
  recommendationBasis: recommendationBasisSchema.nullable(),
  reviewFlags: z.array(reviewFlagSchema),
  createdAt: isoString,
});

export const bidLatestReviewSchema = z.strictObject({
  decision: recommendationSchema,
  decidedAt: isoString,
  reviewerName: z.string(),
});

export const bidListItemSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  noticeId: z.string().min(1),
  title: z.string().min(1),
  agency: z.string().nullable(),
  stage: bidStageSchema,
  status: bidStatusSchema,
  budgetKrw: krwString.nullable(),
  publishedAt: isoString.nullable(),
  deadlineAt: isoString.nullable(),
  latestRevision: z.number().int().positive(),
  planRef: z.string().nullable(),
  isDemo: z.boolean(),
  sourceUrl: z.string().min(1),
  lastSyncedAt: isoString,
  origin: bidOriginSchema,
  documentsStatus: documentsStatusSchema,
  latestAnalysis: bidLatestAnalysisSchema.nullable(),
  latestReview: bidLatestReviewSchema.nullable(),
});

export const bidRevisionSummarySchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  amendmentNo: z.string().nullable(),
  fetchedAt: isoString,
  checksum: z.string().min(1),
  changedFields: z.array(z.string()),
});

export const bidDocumentSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  format: z.string().nullable(),
  downloadStatus: z.enum(["PENDING", "OK", "FAILED"]),
  parseStatus: z.enum(["PENDING", "PARSED", "PARTIAL", "UNSUPPORTED", "FAILED"]).nullable(),
  downloadErrorCode: z
    .enum([
      "AUTH_REQUIRED",
      "HTTP_4XX",
      "HTTP_5XX",
      "REDIRECT_BLOCKED",
      "HOST_NOT_ALLOWED",
      "TOO_LARGE",
      "TIMEOUT",
    ])
    .nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  parseErrorCode: z
    .enum([
      "UNSUPPORTED_FORMAT",
      "NO_TEXT_LAYER",
      "ENCRYPTED",
      "DISTRIBUTION_PROTECTED",
      "TOO_LARGE",
      "CORRUPTED",
      "PARSER_ERROR",
    ])
    .nullable(),
  downloadPath: z.string().nullable(),
});

export const structuredRequirementSchema = z.strictObject({
  kind: z.enum([
    "LICENSE_LIMIT",
    "PERMITTED_INDUSTRY",
    "PARTICIPATION_REGION",
    "REGIONAL_JOINT_CONTRACT",
  ]),
  code: z.string().nullable(),
  name: z.string().nullable(),
  value: z.record(z.string(), z.unknown()),
  sourceOperation: z.string(),
});

export const extractionStatusSchema = z.enum([
  "PENDING",
  "COMPLETED",
  "PENDING_REVIEW",
  "FAILED",
  "NONE",
]);

// NormalizedBid.original: 정규화 전 원본 문자열(15 §3)
export const bidOriginalSchema = z.strictObject({
  noticeNo: z.string().optional(),
  budget: z.string().optional(),
  noticeDate: z.string().optional(),
  deadline: z.string().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

// ADR-030 B14: CLOSED 는 저장하지 않고 조회할 때 마감으로 계산한다. 뷰 bid_list_items 와 같은 규칙이다.
export function effectiveStatus(
  status: z.infer<typeof bidStatusSchema>,
  deadlineAt: string | null,
  now: Date,
): z.infer<typeof bidStatusSchema> {
  if (status !== "OPEN" && status !== "AMENDED") return status;
  if (deadlineAt === null) return status;
  return Date.parse(deadlineAt) < now.getTime() ? "CLOSED" : status;
}

export type BidStage = z.infer<typeof bidStageSchema>;
export type BidStatus = z.infer<typeof bidStatusSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type RecommendationBasis = z.infer<typeof recommendationBasisSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type QualificationOutcome = z.infer<typeof qualificationOutcomeSchema>;
export type NeedsReviewReason = z.infer<typeof needsReviewReasonSchema>;
export type RequirementBasis = z.infer<typeof requirementBasisSchema>;
export type RequirementItemKind = z.infer<typeof requirementItemKindSchema>;
export type ReviewFlag = z.infer<typeof reviewFlagSchema>;
export type FactorKey = z.infer<typeof factorKeySchema>;
export type MissingReason = z.infer<typeof missingReasonSchema>;
export type RunMode = z.infer<typeof runModeSchema>;
export type BidOrigin = z.infer<typeof bidOriginSchema>;
export type Role = z.infer<typeof roleSchema>;
export type PageInfo = z.infer<typeof pageInfoSchema>;
export type Page<T> = { items: T[]; pageInfo: PageInfo };
export type DocumentsStatus = z.infer<typeof documentsStatusSchema>;
export type BidListItem = z.infer<typeof bidListItemSchema>;
export type BidRevisionSummary = z.infer<typeof bidRevisionSummarySchema>;
export type BidDocument = z.infer<typeof bidDocumentSchema>;
export type StructuredRequirement = z.infer<typeof structuredRequirementSchema>;
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;
