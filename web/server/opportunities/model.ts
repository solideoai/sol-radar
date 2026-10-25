import "server-only";
import { z } from "zod";

export const sourceFamilySchema = z.enum(["G2B", "KWATER", "LH", "KEPCO"]);
export const opportunityStageSchema = z.enum([
  "PLAN",
  "PROCUREMENT_REQUEST",
  "PRE_SPEC",
  "NOTICE",
  "OPENING",
  "AWARD",
  "CONTRACT",
]);
export const categorySchema = z.enum([
  "AI_AX",
  "SI_SW",
  "CLOUD",
  "DATA",
  "SECURITY",
  "DIGITAL_TWIN",
  "OTHER",
]);
export const recommendationSchema = z.enum(["BID", "WATCH", "NO_BID"]);
export const opportunityItemSchema = z.object({
  id: z.uuid(),
  bidId: z.uuid(),
  revisionId: z.uuid(),
  source: z.string(),
  sourceFamily: sourceFamilySchema.nullable(),
  sources: z.array(
    z.object({
      bidId: z.uuid(),
      source: z.string(),
      sourceFamily: sourceFamilySchema.nullable(),
      url: z.string(),
      urlKind: z.enum(["NOTICE", "SERVICE_DOCUMENTATION"]).optional(),
    }),
  ),
  noticeId: z.string(),
  title: z.string(),
  agency: z.string().nullable(),
  agencyId: z.uuid().nullable(),
  companyId: z.string().nullable(),
  stage: opportunityStageSchema,
  status: z.enum(["OPEN", "AMENDED", "CANCELLED", "CLOSED"]),
  budgetKrw: z.string().nullable(),
  publishedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  isDemo: z.boolean(),
  firstSeenAt: z.string(),
  categories: z.array(categorySchema),
  relevanceState: z.enum([
    "UNCLASSIFIED",
    "CANDIDATE",
    "RELEVANT",
    "LOW_RELEVANCE",
    "NEEDS_REVIEW",
  ]),
  relevanceScore: z.number().nullable(),
  sourceCount: z.number(),
  sourceConflict: z.boolean().optional(),
  latestRun: z
    .object({
      id: z.uuid(),
      status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    })
    .nullable()
    .optional(),
  latestAnalysis: z
    .object({
      id: z.uuid(),
      status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
      solScore: z.number().nullable(),
      recommendation: recommendationSchema.nullable(),
    })
    .nullable(),
  latestDecision: recommendationSchema.nullable(),
  latestDecisionAt: z.string().nullable(),
  // 이 조직에서 본 사업기회의 마지막 변경 시각(공고 갱신·분석·결정·출처 연결 중 가장 늦은 것).
  changedAt: z.string().nullable(),
});
export type SourceFamily = z.infer<typeof sourceFamilySchema>;
export type OpportunityItem = z.infer<typeof opportunityItemSchema>;
export type OpportunityStage = z.infer<typeof opportunityStageSchema>;
export type OpportunityPage = {
  items: OpportunityItem[];
  pageInfo: { cursor: string | null; nextCursor: string | null; hasNext: boolean };
  total: number;
  asOf: string;
};
export const opportunitySummarySchema = z.object({
  generatedAt: z.string(),
  origin: z.enum(["live", "demo", "all"]),
  isDemo: z.boolean(),
  newlyDiscovered: z.number(),
  pendingAnalysis: z.number(),
  bidRecommended: z.number(),
  closingSoon: z.number(),
  portfolio: z.object({
    BID: z.number(),
    WATCH: z.number(),
    NO_BID: z.number(),
    PENDING: z.number(),
  }),
  knownBudgetKrw: z.string(),
  unknownBudgetCount: z.number(),
  totalOpportunities: z.number(),
  potentialDuplicateCount: z.number(),
  sourceConflictCount: z.number().optional(),
  earlyCount: z.number(),
});
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;
// 대시보드 실수집 지표(procurement_live_metrics, 10-25 계획 B3). 범위는 procurement_summary 와 같다.
export const opportunityLiveMetricsSchema = z.object({
  generatedAt: z.string(),
  origin: z.enum(["live", "demo", "all"]),
  activeWatch: z.number(),
  topAgencies: z.array(z.object({ name: z.string(), count: z.number() })),
});
export type OpportunityLiveMetrics = z.infer<typeof opportunityLiveMetricsSchema>;
export type SourceServiceStatus = {
  key: string;
  sourceFamily: SourceFamily;
  serviceId: string;
  displayName: string;
  enabled: boolean;
  connectionStatus: "NOT_VERIFIED" | "CONNECTED" | "ERROR";
  authStatus: "NOT_VERIFIED" | "VERIFIED" | "FAILED";
  lastIngestAt: string | null;
  lastSuccessAt: string | null;
  status: "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED";
  counts: {
    fetched: number;
    created: number;
    updated: number;
    duplicates: number;
    errors: number;
    quarantined: number;
  };
  blockedReason: string | null;
  keyIssuance: "ISSUED" | "UNKNOWN";
};
export type SourceGroupStatus = {
  sourceFamily: SourceFamily;
  label: string;
  services: SourceServiceStatus[];
  healthyServices: number;
  enabledServices: number;
  lastSuccessAt: string | null;
  status: "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED";
};
export type SourceSummary = { groups: SourceGroupStatus[]; isDemo: boolean; generatedAt: string };
export type SourceServiceConfig = Pick<
  SourceServiceStatus,
  "key" | "sourceFamily" | "serviceId" | "displayName" | "enabled" | "blockedReason" | "keyIssuance"
>;
export class OpportunityReadError extends Error {
  constructor(
    public readonly code: "INVALID_CURSOR" | "SERVICE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "OpportunityReadError";
  }
}
