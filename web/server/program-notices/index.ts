import "server-only";

// ── 배럴: program-notices 도메인의 공개 API. 바깥(app·worker)은 @/server/program-notices 만 부른다 ──
export { runProgramNoticeRound } from "./collect.service";
export { parseBizinfoBody } from "./bizinfo";
export { parseMssRss } from "./mss-rss";
export { decodeServiceKey, parseMsitBody } from "./msit";
export type { CollectRunMode, RoundDeps } from "./collect.service";
export { loadProgramNoticesConfig, MSIT_KEY_ENV } from "./config";
export type { LoadConfigResult, ProgramNoticesConfig } from "./config";
export { kstToday } from "./dates";
export type { FetchLike } from "./http";
export { LIST_MAX_ITEMS, listProgramNotices, parseProgramNoticeListQuery } from "./list.service";
export type {
  ProgramNoticeList,
  ProgramNoticeListItem,
  ProgramNoticeListQuery,
  ProgramNoticeSort,
} from "./list.service";
export { programNoticesRepo } from "./program-notices.repo";
export { createSupabaseProgramNoticesStore } from "./program-notices.store";
export type { ProgramNoticesStore, ProgramRun } from "./program-notices.store";
export {
  isItProgramNotice,
  normalizedProgramNoticeSchema,
  PROGRAM_NOTICE_LIMITS,
  PROGRAM_NOTICE_SOURCE_LABELS,
  PROGRAM_NOTICE_SOURCES,
  RUN_ERROR_CODES,
  RUN_MODES,
  RUN_STATUSES,
} from "./program-notice.model";
export type {
  NormalizedProgramNotice,
  ProgramRunErrorCode,
  ProgramNoticeRunMode,
  ProgramNoticeRunStatus,
  ProgramNoticeSource,
} from "./program-notice.model";
