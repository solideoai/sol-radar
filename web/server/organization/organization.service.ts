import "server-only";
import { invitationMailer, type InvitationMailer } from "./organization.mail";
import {
  type AcceptResult,
  type CreateTeamResult,
  type CurrentOrg,
  DELETE_CONFIRM_MISMATCH,
  type DeleteTeamResult,
  type InvitationChangeResult,
  type InvitationMailStatus,
  type InviteResult,
  type MembersPage,
  type MembershipChangeResult,
  type MyHome,
  type MyWorkspace,
  parseDeleteConfirmation,
  parseId,
  parseInvite,
  parseNewTeam,
  parseRole,
  parseTeamName,
  type ReceivedInvitations,
  type RenameTeamResult,
  sortMembers,
  sortOrgs,
  toCurrentOrg,
  toInvitationMail,
  toInvitationView,
  toMemberView,
  toOrgSummary,
} from "./organization.model";
import { organizationRepo, type OrganizationRepo } from "./organization.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──
// 누구의 행인지는 입력이 아니라 로그인에서 읽는다 — 서버 함수는 화면 밖에서 직접 POST 로도 불린다.
// 조직 id 는 화면이 보내지만 믿지 않는다: 그 조직의 멤버인지·owner 인지는 DB 정책이 다시 본다.

// 형식이 틀린 id 는 화면이 보낼 수 없는 값이다. 예상한 실패가 아니라 잘못된 호출이라 던진다.
function requireId(input: unknown, what: string): string {
  const parsed = parseId(input);
  if (!parsed.ok) throw new Error(`${what} id 형식이 올바르지 않습니다`);
  return parsed.id;
}

export async function getMyWorkspace(
  slug: string,
  repo: OrganizationRepo = organizationRepo,
): Promise<MyWorkspace> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const me = await repo.currentUser();
  if (!me) return { status: "signed-out" };
  const [rows, pendingInvitationCount] = await Promise.all([
    repo.listMyOrgs(me.id),
    repo.countReceivedInvitations(me.email),
  ]);
  const orgs = sortOrgs(rows);
  const current = orgs.find((row) => row.slug === slug);
  if (!current) return { status: "not-found" };
  return {
    status: "ready",
    userId: me.id,
    current: toCurrentOrg(current),
    orgs: orgs.map(toOrgSummary),
    pendingInvitationCount,
  };
}

export async function getMyHome(repo: OrganizationRepo = organizationRepo): Promise<MyHome> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const me = await repo.currentUser();
  if (!me) return { status: "signed-out" };
  const personal = (await repo.listMyOrgs(me.id)).find((row) => row.isPersonal);
  return personal ? { status: "ready", personalSlug: personal.slug } : { status: "missing" };
}

export async function createTeam(
  input: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<CreateTeamResult> {
  const parsed = parseNewTeam(input);
  if (!parsed.ok) return { status: "invalid", field: parsed.field, message: parsed.message };
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  return (await repo.insertTeam(parsed.name, parsed.slug)) === "slug-taken"
    ? { status: "invalid", field: "slug", message: "이미 쓰는 주소입니다" }
    : { status: "created", slug: parsed.slug };
}

// 개인 조직은 혼자 쓰므로 목록 대신 팀을 만들라는 안내를 그린다.
export async function getMembersPage(
  { org, userId }: { org: CurrentOrg; userId: string },
  repo: OrganizationRepo = organizationRepo,
  now?: Date,
): Promise<MembersPage> {
  if (org.isPersonal) return { status: "personal" };
  const canManage = org.myRole === "owner";
  const [memberRows, invitationRows] = await Promise.all([
    repo.listMembers(org.id),
    canManage ? repo.listInvitations(org.id) : Promise.resolve([]),
  ]);
  const members = sortMembers(memberRows.map((row) => toMemberView(row, userId)));
  // 기준 시각은 시험이 넘길 수 있다. 넘기지 않으면 목록을 읽은 뒤에 잰다.
  const at = now ?? new Date();
  return {
    status: "team",
    canManage,
    members,
    // 기한이 늦은 순(= 최근에 초대한 순). 만료된 초대는 자연히 아래로 간다.
    invitations: invitationRows
      .map((row) => toInvitationView(row, at))
      .toSorted((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
    ownerCount: members.filter((member) => member.role === "owner").length,
  };
}

// 초대(새 초대·다시 초대)가 저장된 뒤에 메일을 보낸다. 메일이 어떻게 되든 초대는 되돌리지 않는다.
// 설정이 없으면 메일에 넣을 값도 읽지 않는다. 그새 초대가 없어졌으면(다른 탭에서 취소·이미 수락) 보내지 않고 failed 다.
async function mailInvitation(
  orgId: string,
  email: string,
  me: { id: string; email: string },
  repo: OrganizationRepo,
  mailer: InvitationMailer,
): Promise<InvitationMailStatus> {
  if (!mailer.isConfigured()) return "not-configured";
  const row = await repo.findInvitationMail(orgId, email, me.id);
  return row ? mailer.send(toInvitationMail(row, email, me.email)) : "failed";
}

export async function inviteMember(
  orgIdInput: unknown,
  input: unknown,
  repo: OrganizationRepo = organizationRepo,
  mailer: InvitationMailer = invitationMailer,
): Promise<InviteResult> {
  const orgId = requireId(orgIdInput, "조직");
  const parsed = parseInvite(input);
  if (!parsed.ok) return { status: "invalid", message: parsed.message };
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  if (parsed.email === me.email)
    return { status: "invalid", message: "내 이메일은 초대할 수 없습니다" };

  switch (await repo.insertInvitation(orgId, parsed.email, parsed.role)) {
    case "invited":
      return {
        status: "invited",
        mail: await mailInvitation(orgId, parsed.email, me, repo, mailer),
      };
    case "exists":
      return (await repo.renewInvitation(orgId, parsed.email, parsed.role))
        ? { status: "renewed", mail: await mailInvitation(orgId, parsed.email, me, repo, mailer) }
        : { status: "forbidden" };
    case "already-member":
      return { status: "invalid", message: "이미 멤버입니다" };
    case "personal-org":
      return {
        status: "invalid",
        message: "개인 공간에는 초대할 수 없습니다. 팀을 만들어 초대하세요",
      };
    case "forbidden":
      return { status: "forbidden" };
  }
}

// ── 팀 설정 ──
// 이름 바꾸기·지우기는 팀의 활동 회원 owner 만 한다. 판단은 DB 정책이 하고(member·조직 밖·정지면 0행), 서비스는
// 그 전에 화면이 안내할 수 있는 경우(개인 조직·확인용 이름이 다름)를 가른다. 읽지 못하는 조직은 forbidden 이다.

export async function renameTeam(
  orgIdInput: unknown,
  input: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<RenameTeamResult> {
  const orgId = requireId(orgIdInput, "조직");
  const parsed = parseTeamName(input);
  if (!parsed.ok) return { status: "invalid", field: "name", message: parsed.message };
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  const org = await repo.findOrg(orgId);
  if (!org) return { status: "forbidden" };
  if (org.isPersonal) return { status: "personal-org" };
  return (await repo.updateTeamName(orgId, parsed.name))
    ? { status: "renamed", name: parsed.name }
    : { status: "forbidden" };
}

// 확인용 이름은 서버에서도 DB 의 지금 이름과 견준다(서버 함수는 화면 밖에서 직접 POST 로도 불린다).
export async function deleteTeam(
  orgIdInput: unknown,
  input: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<DeleteTeamResult> {
  const orgId = requireId(orgIdInput, "조직");
  const parsed = parseDeleteConfirmation(input);
  if (!parsed.ok) return { status: "invalid", field: "confirmName", message: parsed.message };
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  const org = await repo.findOrg(orgId);
  if (!org) return { status: "forbidden" };
  if (org.isPersonal) return { status: "personal-org" };
  if (parsed.confirmName !== org.name)
    return { status: "invalid", field: "confirmName", message: DELETE_CONFIRM_MISMATCH };
  return (await repo.deleteTeam(orgId, org.name)) ? { status: "deleted" } : { status: "forbidden" };
}

// 지운 행이 없어도(다른 탭에서 먼저 취소·이미 수락) 결과는 같다: 이 초대는 이제 목록에 없다.
export async function cancelInvitation(
  idInput: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<InvitationChangeResult> {
  const id = requireId(idInput, "초대");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  await repo.deleteInvitation(id);
  return { status: "done" };
}

export async function changeMemberRole(
  orgIdInput: unknown,
  userIdInput: unknown,
  roleInput: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<MembershipChangeResult> {
  const orgId = requireId(orgIdInput, "조직");
  const userId = requireId(userIdInput, "멤버");
  const role = parseRole(roleInput);
  if (!role.ok) throw new Error("역할 값이 올바르지 않습니다");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  return { status: await repo.updateRole(orgId, userId, role.role) };
}

export async function removeMember(
  orgIdInput: unknown,
  userIdInput: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<MembershipChangeResult> {
  const orgId = requireId(orgIdInput, "조직");
  const userId = requireId(userIdInput, "멤버");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  return { status: await repo.deleteMembership(orgId, userId) };
}

// 누가 나가는지는 입력이 아니라 로그인에서 읽는다.
export async function leaveOrg(
  orgIdInput: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<MembershipChangeResult> {
  const orgId = requireId(orgIdInput, "조직");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  return { status: await repo.deleteMembership(orgId, me.id) };
}

export async function getReceivedInvitations(
  repo: OrganizationRepo = organizationRepo,
  now?: Date,
): Promise<ReceivedInvitations> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const me = await repo.currentUser();
  if (!me) return { status: "signed-out" };
  const [rows, orgs] = await Promise.all([
    repo.listReceivedInvitations(me.email),
    repo.listMyOrgs(me.id),
  ]);
  const at = now ?? new Date();
  return {
    status: "ready",
    invitations: rows.map((row) => ({
      ...toInvitationView(row, at),
      orgName: row.orgName,
      orgSlug: row.orgSlug,
    })),
    homeSlug: orgs.find((row) => row.isPersonal)?.slug ?? null,
  };
}

// 들어갈 수 있는지(내 이메일·만료 전·초대받은 역할)는 DB 정책이 다시 본다.
export async function acceptInvitation(
  idInput: unknown,
  repo: OrganizationRepo = organizationRepo,
  now?: Date,
): Promise<AcceptResult> {
  const id = requireId(idInput, "초대");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  const invitation = await repo.findReceivedInvitation(id, me.email);
  const at = now ?? new Date();
  if (!invitation || new Date(invitation.expiresAt).getTime() <= at.getTime())
    return { status: "unavailable" };
  return (await repo.insertMembership(invitation.orgId, me.id, invitation.role)) === "joined"
    ? { status: "accepted", slug: invitation.orgSlug }
    : { status: "unavailable" };
}

// 이미 없어도 결과는 같다.
export async function declineInvitation(
  idInput: unknown,
  repo: OrganizationRepo = organizationRepo,
): Promise<InvitationChangeResult> {
  const id = requireId(idInput, "초대");
  const me = repo.isConfigured() ? await repo.currentUser() : null;
  if (!me) return { status: "signed-out" };
  await repo.deleteInvitation(id);
  return { status: "done" };
}
