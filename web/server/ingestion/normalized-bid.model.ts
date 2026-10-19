import "server-only";
import { z } from "zod";

// ── 수집 도메인 모델: 15 §3 NormalizedBid. 모든 connector 가 이 모양으로 공고를 넘긴다 ──
export const NORMALIZED_BID_SCHEMA_VERSION = "normalized-bid/v0.2";

export const BID_SOURCES = ["fixture", "g2b-bid-notice", "g2b-pre-spec", "g2b-order-plan"] as const;
export type BidSource = (typeof BID_SOURCES)[number];

export const BID_STAGES = ["PLAN", "PRE_SPEC", "NOTICE"] as const;
export type BidStage = (typeof BID_STAGES)[number];

export const BID_STATUSES = ["OPEN", "AMENDED", "CANCELLED", "CLOSED"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const STRUCTURED_REQUIREMENT_KINDS = [
  "LICENSE_LIMIT",
  "PERMITTED_INDUSTRY",
  "PARTICIPATION_REGION",
  "REGIONAL_JOINT_CONTRACT",
] as const;
export type StructuredRequirementKind = (typeof STRUCTURED_REQUIREMENT_KINDS)[number];

const KRW_INTEGER = /^(0|[1-9]\d*)$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// 저장 값은 언제나 UTC(Z) 다. 오프셋이 붙은 값이 들어오면 정규화가 덜 된 것이다.
const isoUtcDateTime = z.iso.datetime();
// null 을 허용하지 않는다: 값이 없으면 정규화가 키를 뺀다.
const optionalIdentifier = z.string().min(1).optional();

export const structuredRequirementSchema = z.strictObject({
  kind: z.enum(STRUCTURED_REQUIREMENT_KINDS),
  code: z.string().nullable(),
  name: z.string().nullable(),
  value: z.record(z.string(), z.unknown()),
  sourceOperation: z.string().min(1),
});
export type StructuredRequirement = z.infer<typeof structuredRequirementSchema>;

export const bidAttachmentSchema = z.strictObject({
  name: z.string().min(1),
  url: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().min(0).optional(),
});
export type BidAttachment = z.infer<typeof bidAttachmentSchema>;

const bidOriginalSchema = z.strictObject({
  noticeNo: z.string().optional(),
  budget: z.string().optional(),
  noticeDate: z.string().optional(),
  deadline: z.string().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
});

const draftShape = {
  schemaVersion: z.literal(NORMALIZED_BID_SCHEMA_VERSION),
  source: z.enum(BID_SOURCES),
  noticeId: z.string().min(1),
  amendmentNo: optionalIdentifier,
  planRef: optionalIdentifier,
  preSpecRef: optionalIdentifier,
  stage: z.enum(BID_STAGES),
  status: z.enum(BID_STATUSES),
  title: z.string().min(1),
  agency: z.string().min(1).nullable(),
  budgetKrw: z.string().regex(KRW_INTEGER).nullable(),
  noticeDate: isoUtcDateTime.nullable(),
  deadlineAt: isoUtcDateTime.nullable(),
  sourceUrl: z.url({ protocol: /^https?$/ }),
  content: z.string(),
  attachments: z.array(bidAttachmentSchema),
  structuredQualifications: z.array(structuredRequirementSchema),
  original: bidOriginalSchema,
  normalizationNotes: z.array(z.string()).min(1).optional(),
  isDemo: z.boolean(),
  fetchedAt: isoUtcDateTime,
};

// fixture 출처만 데모 배지를 단다. live 공고가 데모로 보이거나 그 반대가 되면 화면이 사용자를 속인다.
const isDemoMatchesSource = (bid: { isDemo: boolean; source: BidSource }): boolean =>
  bid.isDemo === (bid.source === "fixture");
const IS_DEMO_RULE = { error: "isDemo 는 source 가 fixture 일 때만 true 다", path: ["isDemo"] };

// zod v4 는 refine 이 걸린 객체에 omit 을 쓸 수 없어서, 규칙을 거는 대상을 두 모양으로 따로 만든다.
export const normalizedBidDraftSchema = z
  .strictObject(draftShape)
  .refine(isDemoMatchesSource, IS_DEMO_RULE);

export const normalizedBidSchema = z
  .strictObject({
    ...draftShape,
    revision: z.number().int().min(1),
    checksum: z.string().regex(SHA256_HEX),
  })
  .refine(isDemoMatchesSource, IS_DEMO_RULE);

export type NormalizedBid = z.infer<typeof normalizedBidSchema>;
export type NormalizedBidDraft = z.infer<typeof normalizedBidDraftSchema>;
