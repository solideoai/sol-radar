import "server-only";
import { z } from "zod";
import { nameOf } from "@/server/shared";
import { solRoleSchema, type SolRole } from "./business-access.model";
import { emailSchema } from "./organization.model";

// ── N2 설정 조직 탭(/settings/organization)의 규칙. 저장·화면을 모른다 ──
// 업무 역할(memberships.sol_role)을 다룬다. 템플릿 멤버 화면(org_role)과 따로 둔다
// (docs/plans/2026-10-21-n2-org-settings-design.md §10).

// 최근 변경 기록은 이 두 감사만 최근 20건 보인다(계획 결정 6).
export const ORG_AUDIT_ACTIONS = ["USER_ROLE_CHANGE", "USER_INVITE"] as const;
export const ORG_AUDIT_LIMIT = 20;

// sol_role 은 DB 제약이 네 값으로 묶는다. 다른 값이 오면 스키마와 코드가 어긋난 것이라 던진다.
export const toSolRole = (value: string): SolRole => {
  const parsed = solRoleSchema.safeParse(value);
  if (!parsed.success) throw new Error(`알 수 없는 업무 역할입니다: ${value}`);
  return parsed.data;
};

// ── 읽기 ──

export type OrgMemberRow = {
  userId: string;
  solRole: string;
  joinedAt: string;
  email: string | null;
  displayName: string | null;
  status: string;
};

export type OrgMemberView = {
  userId: string;
  name: string;
  email: string;
  solRole: SolRole;
  joinedAt: string;
  isMe: boolean;
  isSuspended: boolean;
};

export const toOrgMemberView = (row: OrgMemberRow, myUserId: string): OrgMemberView => ({
  userId: row.userId,
  name: nameOf(row.displayName, row.email),
  email: row.email ?? "",
  solRole: toSolRole(row.solRole),
  joinedAt: row.joinedAt,
  isMe: row.userId === myUserId,
  isSuspended: row.status === "suspended",
});

// 내 행 맨 위, 나머지는 이름 가나다순(같으면 이메일순). 역할을 바꿔도 행이 움직이지 않는다(디자인 스펙 D10).
export const sortOrgMembers = (members: OrgMemberView[]): OrgMemberView[] =>
  members.toSorted((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return a.name.localeCompare(b.name, "ko") || a.email.localeCompare(b.email);
  });

// 마지막 ADMIN 보호(protect_last_sol_admin, 20261019000014)와 같은 기준이다: 계정 상태를 보지 않는 멤버십 수.
export const countAdmins = (members: OrgMemberView[]): number =>
  members.filter((member) => member.solRole === "ADMIN").length;

export type OrgInvitationRow = { id: string; email: string; solRole: string; expiresAt: string };

export type OrgInvitationView = {
  id: string;
  email: string;
  solRole: SolRole;
  expiresAt: string;
  isExpired: boolean;
};

export const toOrgInvitationView = (row: OrgInvitationRow, now: Date): OrgInvitationView => ({
  id: row.id,
  email: row.email,
  solRole: toSolRole(row.solRole),
  expiresAt: row.expiresAt,
  isExpired: new Date(row.expiresAt).getTime() <= now.getTime(),
});

export type OrgAuditRow = {
  id: string;
  action: string;
  actorId: string | null;
  targetId: string;
  beforeAfter: unknown;
  createdAt: string;
};

// 기록의 사람. actor_id 가 null 이면 계정이 지워졌다(on delete set null). id 는 있는데 지금 구성원이 아니면
// 이름을 읽을 수 없다(profiles 는 같은 조직 구성원만 읽는다) — 조직을 떠난 사람이다(디자인 스펙 D11).
export type OrgAuditPerson =
  { kind: "member"; name: string; isMe: boolean } | { kind: "deleted" } | { kind: "left" };

export type OrgAuditView =
  | {
      id: string;
      kind: "role-change";
      at: string;
      actor: OrgAuditPerson;
      target: OrgAuditPerson;
      fromRole: SolRole;
      toRole: SolRole;
    }
  | {
      id: string;
      kind: "invite";
      at: string;
      actor: OrgAuditPerson;
      email: string;
      toRole: SolRole;
    };

// 감사 행의 before_after 는 트리거가 쓴 모양이다(20261021000300·20261019000007 §5). 어긋나면 던진다.
const roleChangeShape = z.object({
  before: z.object({ solRole: solRoleSchema }),
  after: z.object({ solRole: solRoleSchema }),
});
const inviteShape = z.object({ after: z.object({ email: z.string(), solRole: solRoleSchema }) });

const personOf = (
  id: string | null,
  members: ReadonlyMap<string, OrgMemberView>,
): OrgAuditPerson => {
  if (id === null) return { kind: "deleted" };
  const member = members.get(id);
  return member ? { kind: "member", name: member.name, isMe: member.isMe } : { kind: "left" };
};

export function toOrgAuditView(
  row: OrgAuditRow,
  members: ReadonlyMap<string, OrgMemberView>,
): OrgAuditView {
  const actor = personOf(row.actorId, members);
  switch (row.action) {
    case "USER_ROLE_CHANGE": {
      const { before, after } = roleChangeShape.parse(row.beforeAfter);
      return {
        id: row.id,
        kind: "role-change",
        at: row.createdAt,
        actor,
        target: personOf(row.targetId, members),
        fromRole: before.solRole,
        toRole: after.solRole,
      };
    }
    case "USER_INVITE": {
      const { after } = inviteShape.parse(row.beforeAfter);
      return {
        id: row.id,
        kind: "invite",
        at: row.createdAt,
        actor,
        email: after.email,
        toRole: after.solRole,
      };
    }
    default:
      throw new Error(`조직 설정 기록에 없는 감사 종류입니다: ${row.action}`);
  }
}

export type OrgSettingsPage = {
  members: OrgMemberView[];
  adminCount: number;
  invitations: OrgInvitationView[];
  audit: OrgAuditView[];
};

// ── 쓰기 입력 ──

export const parseSolRole = (input: unknown): { ok: true; role: SolRole } | { ok: false } => {
  const parsed = solRoleSchema.safeParse(input);
  return parsed.success ? { ok: true, role: parsed.data } : { ok: false };
};

export function parseOrgInvite(
  input: unknown,
): { ok: true; email: string; solRole: SolRole } | { ok: false; message: string } {
  const parsed = z.object({ email: emailSchema, solRole: solRoleSchema }).safeParse(input);
  return parsed.success
    ? { ok: true, email: parsed.data.email, solRole: parsed.data.solRole }
    : { ok: false, message: parsed.error.issues[0].message };
}

// ── 쓰기 결과. 예상한 실패는 던지지 않고 값으로 돌려준다 ──

export type OrgAccessFailure = { status: "signed-out" } | { status: "forbidden" };

export type OrgRoleChangeResult =
  | { status: "saved" }
  // 조직에 업무 ADMIN 이 한 명은 남아야 한다(protect_last_sol_admin).
  | { status: "last-admin" }
  // 대상이 이제 이 조직의 구성원이 아니다(그새 내보내짐).
  | { status: "not-member" }
  | { status: "invalid" }
  | OrgAccessFailure;

export type OrgInvitationMailStatus = "sent" | "not-configured" | "failed";

export type OrgInviteResult =
  | { status: "invited"; mail: OrgInvitationMailStatus }
  // 같은 이메일의 초대가 이미 있었다. 업무 역할을 새로 고른 값으로 바꾸고 만료를 7일로 늘렸다.
  | { status: "renewed"; mail: OrgInvitationMailStatus }
  | { status: "already-member" }
  | { status: "invalid"; message: string }
  | OrgAccessFailure;

export type OrgInvitationCancelResult =
  { status: "done" } | { status: "invalid" } | OrgAccessFailure;
