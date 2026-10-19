import "server-only";
export {
  getDepartments,
  getJobTitles,
  getPeopleDirectory,
  getTeamMember,
  listTeamMembers,
} from "./people.service";
export type { PeopleAccess } from "./people.service";
export { parsePeopleQuery } from "./people.model";
export type {
  Department,
  JobTitle,
  TeamMemberListItem,
  TeamMemberDetail,
  PeopleSummary,
  PeopleDirectory,
  PeoplePage,
  PeopleQuery,
  PeopleResult,
  PeopleErrorCode,
} from "./people.model";
