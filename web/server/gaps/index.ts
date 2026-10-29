import "server-only";
// 자격 갭 레이더(/gaps, 스펙 polaris/specs/done/2026-10-28-gaps-market-calendar.md §5).
export { getGapBuckets, getGapRadar } from "./gaps.service";
export { gapsRepo } from "./gaps.repo";
export type { GapsRepo } from "./gaps.repo";
export {
  GAPS_ASSUMPTION_NOTICE,
  GAPS_BUDGET_NOTICE,
  GAPS_SCOPE_NOTICE,
  GAPS_SOURCE_NOTICE,
  GAP_BLOCKER_KIND_LABELS,
  GAP_BUCKETS,
  GAP_BUCKET_LABELS,
  GAP_REVIEW_REASONS,
  GAP_REVIEW_REASON_LABELS,
  gapRadarHref,
  parseGapQuery,
  toggleAssume,
} from "./gaps.model";
export type {
  BlockerKind,
  BlockerRow,
  GapAssumption,
  GapBucket,
  GapBucketsView,
  GapQuery,
  GapRadar,
  GapRadarView,
  GapReviewReason,
  GapSummary,
  GapTotal,
  OpenedNotice,
} from "./gaps.model";
