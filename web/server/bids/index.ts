import "server-only";

export * from "./bid.model";
export type { ServiceErrorCode } from "./bid.model";
export * from "./bid-detail.model";
export * from "./analysis-view.model";
export * from "./review.model";
export * from "./notification.model";
export * from "./dashboard.model";
export * from "./bid-query";
export * from "./bids.repo";
export * from "./bids.service";
export * from "./review.service";
export * from "./what-if.service";
export * from "./notification.service";
export * from "./dashboard.service";
export { keysetFilter, likePattern, quoteValue, uniqueViolation } from "./postgrest";
export { createBidsRepo } from "./bids.supabase";
export { reviewRepo } from "./review.supabase";
export { notificationRepo } from "./notification.supabase";
export { createDashboardRepo } from "./dashboard.supabase";

export { reviewPendingBids, compareDueOrder } from "./review-pending";
export type { PendingBidCard, PendingSourceRow } from "./review-pending";

export * from "./analysis-history.model";
export { analysisHistoryRepo } from "./analysis-history.repo";
export { listAnalysisHistory } from "./analysis-history.service";

export {
  compareBidRevision,
  getBidRevision,
  listBidRevisions,
  parseRevisionParam,
} from "./revision.service";
export type {
  RevisionSnapshot,
  RevisionComparison,
  RevisionFieldChange,
  RevisionRef,
  TextSegment,
} from "./revision.model";
export { getStageLinks } from "./stage-links.service";
export { stageLinksRepo } from "./stage-links.supabase";
export type { StageLinksView, StageLinkItem, StageLinkCandidateItem } from "./stage-links.model";
