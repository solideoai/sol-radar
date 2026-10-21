import "server-only";

// 입찰 프로젝트(P1 N6) 도메인의 바깥 입구. 화면·Route Handler 는 이 배럴로만 가져온다.
export {
  MANAGE_PROJECT_ROLES,
  PROJECT_NOTE_MAX,
  PROJECT_RESULTS,
  PROJECT_STATUSES,
  RESULT_NOTE_MAX,
  canManageProjects,
  effectiveDueAt,
  nextStatuses,
} from "./project.model";
export type {
  PendingBidCard,
  ProjectAnalysisSummary,
  ProjectBoard,
  ProjectCard,
  ProjectDetail,
  ProjectEntryState,
  ProjectEvent,
  ProjectOpenedBy,
  ProjectResult,
  ProjectStatus,
  ProjectWarnings,
} from "./project.model";
export {
  countActiveProjects,
  getProject,
  getProjectBoard,
  getProjectEntry,
  openProject,
  recordProjectResult,
  updateProject,
} from "./project.service";
export type { ProjectDeps, ProjectErrorCode, ProjectServiceResult } from "./project.service";
export type { ProjectRepo } from "./project.repo";
export { projectRepo } from "./project.supabase";
