import "server-only";

// ── 배럴: 낙찰 이력 채우기(운영자 CLI web/worker/award-backfill.ts 전용). 바깥은 @/server/award-history 만 부른다 ──
export {
  AWARD_SKIP_REASONS,
  AWARD_WINDOW_MAX_DAYS,
  BACKFILL_MAX_MONTHS,
  BACKFILL_MIN_MONTHS,
  NOTICE_LEAD_MONTHS,
  backfillWindowsOf,
  buildAwardHistory,
  estimatedCallsOf,
  joinAwardWithNotice,
  parseAwardItems,
  parseNoticeItems,
  roundAwardRatio,
  suggestedMonthsOf,
} from "./award-history.model";
export type {
  AwardApiRow,
  AwardClassCount,
  AwardHistoryBuild,
  AwardHistoryInsert,
  AwardSkipReason,
  AwardSkipped,
  BackfillWindows,
  NoticeApiRow,
} from "./award-history.model";
export {
  AWARD_LIST_OPERATION,
  AWARD_SERVICE_ENDPOINT,
  BACKFILL_ROWS,
  BID_NOTICE_SERVICE_ENDPOINT,
  BackfillFetchFailed,
  CallLimitReached,
  collectBackfill,
  countAwardPages,
  createAwardBackfillFetcher,
} from "./award-history.fetch";
export type { AwardBackfillFetcher, CollectedBackfill } from "./award-history.fetch";
export {
  AWARD_UPSERT_CHUNK,
  AwardHistoryWriteFailed,
  createAwardHistoryRepo,
} from "./award-history.repo";
export type { AwardHistoryRepo } from "./award-history.repo";
