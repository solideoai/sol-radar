import "server-only";

// ── 배럴: organization 도메인의 공개 API. 바깥(app·components)은 @/server/organization 만 부른다 ──
export {
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  createTeam,
  declineInvitation,
  deleteTeam,
  getMembersPage,
  getMyHome,
  getCurrentOrganization,
  getMyWorkspace,
  getReceivedInvitations,
  inviteMember,
  leaveOrg,
  removeMember,
  renameTeam,
} from "./organization.service";
export { ORG_ROLE_LABELS, RESERVED_SLUGS } from "./organization.model";
export type { MyBusinessAccess, SolRole } from "./business-access.model";
export type {
  AcceptResult,
  CreateTeamResult,
  CurrentOrg,
  CurrentOrganizationResult,
  DeleteTeamResult,
  InvitationChangeResult,
  InvitationMailStatus,
  InvitationView,
  InviteResult,
  MembersPage,
  MembershipChangeResult,
  MemberView,
  MyHome,
  MyWorkspace,
  OrgRole,
  OrgSummary,
  ReceivedInvitations,
  ReceivedInvitationView,
  RenameTeamResult,
  TeamField,
} from "./organization.model";
