import "server-only";
import { getAuthClaims, getSupabase } from "@/server/supabase";
import type { SolRole } from "./business-access.model";
import type { InvitationMailRow } from "./organization.model";
import { organizationRepo } from "./organization.repo";
import {
  ORG_AUDIT_ACTIONS,
  type OrgAuditRow,
  type OrgInvitationRow,
  type OrgMemberRow,
} from "./org-settings.model";

// ── N2 설정 조직 탭의 저장. 사용자 세션(anon 키) + RLS 로만 읽고 쓴다. 규칙은 두지 않는다 ──
// 누가 무엇을 읽고 바꾸는지는 정책이 정한다: 구성원·프로필 읽기 = 같은 조직 구성원(20261014000001),
// 초대 읽기·만들기·갱신·취소와 업무 역할 변경 = 그 조직 ADMIN(20261019000001), 감사 읽기 = 그 조직 ADMIN(20261019000006).
// 마지막 ADMIN 은 트리거 protect_last_sol_admin(20261019000014)이 지킨다.

// PostgreSQL 오류 코드.
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = "42501";
const RAISED = "P0001";

type DbError = { code: string; hint: string };
const isRaised = (error: DbError, hint: string) => error.code === RAISED && error.hint === hint;

export const orgSettingsRepo = {
  // 이메일은 초대 정책이 읽는 것과 같은 JWT 의 email 클레임이다(소문자로 맞춘다).
  async currentUser(): Promise<{ id: string; email: string } | null> {
    const claims = await getAuthClaims();
    return claims ? { id: claims.userId, email: (claims.email ?? "").toLowerCase() } : null;
  },

  async listMembers(orgId: string): Promise<OrgMemberRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("user_id, sol_role, created_at, profile:profiles(email, display_name, status)")
      .eq("org_id", orgId);
    if (error) throw error;
    return data.map((row) => ({
      userId: row.user_id,
      solRole: row.sol_role,
      joinedAt: row.created_at,
      email: row.profile.email,
      displayName: row.profile.display_name,
      status: row.profile.status,
    }));
  },

  async listInvitations(orgId: string): Promise<OrgInvitationRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .select("id, email, sol_role, expires_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      email: row.email,
      solRole: row.sol_role,
      expiresAt: row.expires_at,
    }));
  },

  async listAudit(orgId: string, limit: number): Promise<OrgAuditRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("audit_logs")
      .select("id, action, actor_id, target_id, before_after, created_at")
      .eq("org_id", orgId)
      .in("action", [...ORG_AUDIT_ACTIONS])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actor_id,
      targetId: row.target_id,
      beforeAfter: row.before_after,
      createdAt: row.created_at,
    }));
  },

  // 정책이 걸러 바뀐 행이 없으면 none 이다(ADMIN 이 아니거나 대상이 구성원이 아니다 — 서비스가 가른다).
  // protect_sol_role(42501)은 다른 정책이 update 를 열어 둔 경우의 두 번째 잠금이다.
  async updateSolRole(
    orgId: string,
    userId: string,
    solRole: SolRole,
  ): Promise<"saved" | "none" | "forbidden" | "last-admin"> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .update({ sol_role: solRole })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .select("user_id");
    if (error && isRaised(error, "last_admin")) return "last-admin";
    if (error?.code === RLS_VIOLATION) return "forbidden";
    if (error) throw error;
    return data.length > 0 ? "saved" : "none";
  },

  // 조직 역할은 member 로 넣는다. 이 화면은 업무 역할만 정한다(소유자 지정은 템플릿 멤버 화면 몫).
  async insertInvitation(
    orgId: string,
    email: string,
    solRole: SolRole,
  ): Promise<"invited" | "exists" | "already-member" | "personal-org" | "forbidden"> {
    const { error } = await (
      await getSupabase()
    )
      .from("invitations")
      .insert({ org_id: orgId, email, org_role: "member", sol_role: solRole });
    if (!error) return "invited";
    if (error.code === UNIQUE_VIOLATION) return "exists";
    if (isRaised(error, "already_member")) return "already-member";
    if (isRaised(error, "personal_org")) return "personal-org";
    if (error.code === RLS_VIOLATION) return "forbidden";
    throw error;
  },

  // 같은 이메일을 다시 초대하면 업무 역할을 새 값으로 적는다. update 마다 DB 트리거(renew_invitation)가 만료를 7일로 늘린다.
  async renewInvitation(orgId: string, email: string, solRole: SolRole): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .update({ sol_role: solRole })
      .eq("org_id", orgId)
      .eq("email", email)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },

  // 지금 조직의 초대만 지운다. 지운 행이 없어도(그새 수락·다른 탭에서 취소) 결과는 같다.
  async deleteInvitation(orgId: string, id: string): Promise<void> {
    const { error } = await (
      await getSupabase()
    )
      .from("invitations")
      .delete()
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
  },

  // 초대 메일에 넣을 값은 템플릿과 같은 길로 읽는다.
  findInvitationMail(
    orgId: string,
    email: string,
    inviterId: string,
  ): Promise<InvitationMailRow | null> {
    return organizationRepo.findInvitationMail(orgId, email, inviterId);
  },
};

export type OrgSettingsRepo = typeof orgSettingsRepo;
