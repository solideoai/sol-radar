import "server-only";
import type { MyBusinessAccess, SolRole } from "./business-access.model";
import { getMyBusinessAccess } from "./business-access.service";
import { invitationMailer, type InvitationMailer } from "./organization.mail";
import { parseId, toInvitationMail } from "./organization.model";
import {
  countAdmins,
  ORG_AUDIT_LIMIT,
  type OrgAccessFailure,
  type OrgInvitationCancelResult,
  type OrgInvitationMailStatus,
  type OrgInviteResult,
  type OrgRoleChangeResult,
  type OrgSettingsPage,
  parseOrgInvite,
  parseSolRole,
  sortOrgMembers,
  toOrgAuditView,
  toOrgInvitationView,
  toOrgMemberView,
} from "./org-settings.model";
import { orgSettingsRepo, type OrgSettingsRepo } from "./org-settings.repo";

// ── N2 설정 조직 탭의 흐름 ──
// 쓰기는 지금 업무 조직(getMyBusinessAccess)에서만 한다. 조직 id 는 화면에서 받지 않는다 — 서버 함수는 화면 밖에서
// 직접 POST 로도 불린다. ADMIN 확인은 안내를 위한 편의이고, 최종 판정은 DB 정책과 트리거다.

export type OrgSettingsDeps = {
  repo: OrgSettingsRepo;
  access: () => Promise<MyBusinessAccess>;
  mailer: InvitationMailer;
};

const defaultDeps: OrgSettingsDeps = {
  repo: orgSettingsRepo,
  access: getMyBusinessAccess,
  mailer: invitationMailer,
};

type AdminScope = { status: "ready"; orgId: string; userId: string };

// 로그인 전·DB 없음은 signed-out, 업무 조직이 없거나 ADMIN 이 아니면 forbidden 이다.
async function requireOrgAdmin(
  access: OrgSettingsDeps["access"],
): Promise<AdminScope | OrgAccessFailure> {
  const result = await access();
  if (result.status === "signed-out" || result.status === "no-database")
    return { status: "signed-out" };
  if (result.status !== "ready" || result.current.solRole !== "ADMIN")
    return { status: "forbidden" };
  return { status: "ready", orgId: result.current.id, userId: result.userId };
}

// 화면(page.tsx)이 requireWork 로 ADMIN 을 확인한 뒤 부른다. 셋 중 하나라도 실패하면 던진다(error.tsx).
export async function getOrgSettingsPage(
  { orgId, userId }: { orgId: string; userId: string },
  repo: OrgSettingsRepo = orgSettingsRepo,
  now?: Date,
): Promise<OrgSettingsPage> {
  const [memberRows, invitationRows, auditRows] = await Promise.all([
    repo.listMembers(orgId),
    repo.listInvitations(orgId),
    repo.listAudit(orgId, ORG_AUDIT_LIMIT),
  ]);
  const members = sortOrgMembers(memberRows.map((row) => toOrgMemberView(row, userId)));
  const byId = new Map(members.map((member) => [member.userId, member]));
  // 기준 시각은 시험이 넘길 수 있다. 넘기지 않으면 목록을 읽은 뒤에 잰다.
  const at = now ?? new Date();
  return {
    members,
    adminCount: countAdmins(members),
    // 만료가 늦은 순(= 최근에 초대한 순). 템플릿 멤버 화면과 같다.
    invitations: invitationRows
      .map((row) => toOrgInvitationView(row, at))
      .toSorted((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
    audit: auditRows.map((row) => toOrgAuditView(row, byId)),
  };
}

async function saveSolRole(
  scope: AdminScope,
  userId: string,
  role: SolRole,
  deps: OrgSettingsDeps,
): Promise<OrgRoleChangeResult> {
  const saved = await deps.repo.updateSolRole(scope.orgId, userId, role);
  if (saved !== "none") return { status: saved };
  // 정책이 걸러 바뀐 행이 없다. 그새 내가 ADMIN 이 아니게 됐는지 다시 보고, 아니면 대상이 구성원이 아니다.
  const again = await requireOrgAdmin(deps.access);
  return again.status === "ready" ? { status: "not-member" } : again;
}

// 같은 값으로 바꾸면 DB 는 행을 그대로 두고(감사도 남지 않는다) saved 다.
export async function changeOrgMemberSolRole(
  userIdInput: unknown,
  roleInput: unknown,
  deps: OrgSettingsDeps = defaultDeps,
): Promise<OrgRoleChangeResult> {
  const userId = parseId(userIdInput);
  const role = parseSolRole(roleInput);
  if (!userId.ok || !role.ok) return { status: "invalid" };
  const scope = await requireOrgAdmin(deps.access);
  if (scope.status !== "ready") return scope;
  return saveSolRole(scope, userId.id, role.role, deps);
}

// 내 업무 역할(자기 강등). 누구의 행인지는 입력이 아니라 로그인에서 읽는다.
export async function changeMySolRole(
  roleInput: unknown,
  deps: OrgSettingsDeps = defaultDeps,
): Promise<OrgRoleChangeResult> {
  const role = parseSolRole(roleInput);
  if (!role.ok) return { status: "invalid" };
  const scope = await requireOrgAdmin(deps.access);
  if (scope.status !== "ready") return scope;
  return saveSolRole(scope, scope.userId, role.role, deps);
}

// 초대(새 초대·다시 초대)가 저장된 뒤에 메일을 보낸다. 메일이 어떻게 되든 초대는 되돌리지 않는다.
async function mailInvitation(
  orgId: string,
  email: string,
  me: { id: string; email: string },
  deps: OrgSettingsDeps,
): Promise<OrgInvitationMailStatus> {
  if (!deps.mailer.isConfigured()) return "not-configured";
  const row = await deps.repo.findInvitationMail(orgId, email, me.id);
  return row ? deps.mailer.send(toInvitationMail(row, email, me.email)) : "failed";
}

export async function inviteOrgMember(
  input: unknown,
  deps: OrgSettingsDeps = defaultDeps,
): Promise<OrgInviteResult> {
  const parsed = parseOrgInvite(input);
  if (!parsed.ok) return { status: "invalid", message: parsed.message };
  const scope = await requireOrgAdmin(deps.access);
  if (scope.status !== "ready") return scope;
  const me = await deps.repo.currentUser();
  if (!me) return { status: "signed-out" };
  if (parsed.email === me.email)
    return { status: "invalid", message: "내 이메일은 초대할 수 없습니다" };
  switch (await deps.repo.insertInvitation(scope.orgId, parsed.email, parsed.solRole)) {
    case "invited":
      return { status: "invited", mail: await mailInvitation(scope.orgId, parsed.email, me, deps) };
    case "exists":
      return (await deps.repo.renewInvitation(scope.orgId, parsed.email, parsed.solRole))
        ? { status: "renewed", mail: await mailInvitation(scope.orgId, parsed.email, me, deps) }
        : { status: "forbidden" };
    case "already-member":
      return { status: "already-member" };
    case "personal-org":
      return { status: "invalid", message: "개인 공간에는 초대할 수 없습니다" };
    case "forbidden":
      return { status: "forbidden" };
  }
}

// 지운 행이 없어도(그새 수락·다른 탭에서 취소) done 이다. 이 초대는 이제 목록에 없다.
export async function cancelOrgInvitation(
  idInput: unknown,
  deps: OrgSettingsDeps = defaultDeps,
): Promise<OrgInvitationCancelResult> {
  const id = parseId(idInput);
  if (!id.ok) return { status: "invalid" };
  const scope = await requireOrgAdmin(deps.access);
  if (scope.status !== "ready") return scope;
  await deps.repo.deleteInvitation(scope.orgId, id.id);
  return { status: "done" };
}
