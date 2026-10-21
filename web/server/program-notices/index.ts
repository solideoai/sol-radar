import "server-only";

// ── 배럴: program-notices 도메인의 공개 API. 바깥(app·worker)은 @/server/program-notices 만 부른다 ──
export {
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
