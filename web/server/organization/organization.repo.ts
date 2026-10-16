import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type {
  InvitationMailRow,
  InvitationRow,
  MemberRow,
  MyOrgRow,
  OrgRole,
  ReceivedInvitationRow,
} from "./organization.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 누가 무엇을 읽고 바꾸는지는 정책(마이그레이션 20261014000001, 팀 이름 바꾸기·지우기는 20261015000002)이 정한다.
// 예상한 실패(주소 중복·정책 거절·트리거가 막음)는 이름 붙은 값으로 돌려주고, 나머지는 그대로 던진다.

// PostgreSQL 오류 코드.
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = "42501";
// 트리거가 올린 오류(raise exception). 무엇인지는 hint 로 가른다.
const RAISED = "P0001";

type DbError = { code: string; hint: string };
const isRaised = (error: DbError, hint: string) => error.code === RAISED && error.hint === hint;

// org_role 은 DB 제약이 owner·member 로 묶는다. 다른 값이 오면 스키마와 코드가 어긋난 것이라 던진다.
const toRole = (value: string): OrgRole => {
  if (value === "owner" || value === "member") return value;
  throw new Error(`알 수 없는 조직 역할입니다: ${value}`);
};

// 정책이 걸러 바뀐 행이 없으면 forbidden, 트리거가 마지막 소유자를 지키면 last-owner.
const membershipChange = (error: DbError | null, changed: number) => {
  if (error && isRaised(error, "last_owner")) return "last-owner" as const;
  if (error) throw error;
  return changed > 0 ? ("saved" as const) : ("forbidden" as const);
};

export const organizationRepo = {
  isConfigured: isSupabaseConfigured,

  // 이메일은 초대 정책이 읽는 것과 같은 JWT 의 email 클레임이고, 비교가 대소문자를 가리지 않도록 소문자로 맞춘다.
  async currentUser(): Promise<{ id: string; email: string } | null> {
    const claims = await getAuthClaims();
    return claims ? { id: claims.userId, email: (claims.email ?? "").toLowerCase() } : null;
  },

  async listMyOrgs(userId: string): Promise<MyOrgRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("org_role, organization:organizations(id, slug, name, personal_owner_id)")
      .eq("user_id", userId);
    if (error) throw error;
    return data.map((row) => ({
      orgId: row.organization.id,
      slug: row.organization.slug,
      name: row.organization.name,
      isPersonal: row.organization.personal_owner_id !== null,
      role: toRole(row.org_role),
    }));
  },

  // owner 는 자기 팀의 초대도 읽을 수 있어서 이메일로 좁힌다.
  async countReceivedInvitations(email: string): Promise<number> {
    const { count, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gt("expires_at", new Date().toISOString());
    if (error) throw error;
    return count ?? 0;
  },

  // 만든 사람을 owner 로 넣는 일은 DB 트리거가 한다.
  // 넣은 행을 돌려받지 않는다: 넣는 순간에는 아직 멤버가 아니라 읽기 정책에 걸린다.
  async insertTeam(name: string, slug: string): Promise<"created" | "slug-taken"> {
    const { error } = await (await getSupabase()).from("organizations").insert({ name, slug });
    if (error?.code === UNIQUE_VIOLATION) return "slug-taken";
    if (error) throw error;
    return "created";
  },

  // 정책이 멤버(와 초대받은 사람)에게만 연다. 읽지 못하면 null 이다(없는 조직과 남의 조직을 가리지 않는다).
  async findOrg(orgId: string): Promise<{ name: string; isPersonal: boolean } | null> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("organizations")
      .select("name, personal_owner_id")
      .eq("id", orgId)
      .maybeSingle();
    if (error) throw error;
    return data ? { name: data.name, isPersonal: data.personal_owner_id !== null } : null;
  },

  // 팀의 활동 회원 owner 만 바꾼다(마이그레이션 20261015000002). 아니면 정책이 걸러 바뀐 행이 없다(false).
  async updateTeamName(orgId: string, name: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("organizations")
      .update({ name })
      .eq("id", orgId)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },

  // 이름까지 맞춰 지운다: 확인한 뒤 그새 다른 owner 가 이름을 바꿨으면 지우지 않는다.
  // 멤버십·초대·작업·활동은 DB 가 연쇄로 지운다. 누가 지울 수 있는지는 정책이 정한다(아니면 false).
  async deleteTeam(orgId: string, name: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("organizations")
      .delete()
      .eq("id", orgId)
      .eq("name", name)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },

  // 초대 메일에 넣을 값. 방금 넣거나 갱신한 초대라 owner 가 읽는다(정책). 초대한 사람은 지금 로그인한 사람이다
  // — 다시 초대는 처음 초대한 사람(invited_by)이 아닌 owner 도 누른다.
  async findInvitationMail(
    orgId: string,
    email: string,
    inviterId: string,
  ): Promise<InvitationMailRow | null> {
    const supabase = await getSupabase();
    const [invitation, inviter] = await Promise.all([
      supabase
        .from("invitations")
        .select("org_role, expires_at, organization:organizations(name)")
        .eq("org_id", orgId)
        .eq("email", email)
        .maybeSingle(),
      supabase.from("profiles").select("email, display_name").eq("id", inviterId).maybeSingle(),
    ]);
    if (invitation.error) throw invitation.error;
    if (inviter.error) throw inviter.error;
    return invitation.data
      ? {
          orgName: invitation.data.organization.name,
          role: toRole(invitation.data.org_role),
          expiresAt: invitation.data.expires_at,
          inviterDisplayName: inviter.data?.display_name ?? null,
          inviterEmail: inviter.data?.email ?? null,
        }
      : null;
  },

  // 같은 조직 멤버의 프로필은 정책이 열어 둔다.
  async listMembers(orgId: string): Promise<MemberRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("user_id, org_role, profile:profiles(email, display_name)")
      .eq("org_id", orgId);
    if (error) throw error;
    return data.map((row) => ({
      userId: row.user_id,
      role: toRole(row.org_role),
      email: row.profile.email,
      displayName: row.profile.display_name,
    }));
  },

  // 정책이 owner 에게만 연다(member 에게는 빈 목록이다).
  async listInvitations(orgId: string): Promise<InvitationRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .select("id, email, org_role, expires_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      email: row.email,
      role: toRole(row.org_role),
      expiresAt: row.expires_at,
    }));
  },

  async insertInvitation(
    orgId: string,
    email: string,
    role: OrgRole,
  ): Promise<"invited" | "exists" | "already-member" | "personal-org" | "forbidden"> {
    const { error } = await (
      await getSupabase()
    )
      .from("invitations")
      .insert({ org_id: orgId, email, org_role: role });
    if (!error) return "invited";
    if (error.code === UNIQUE_VIOLATION) return "exists";
    if (isRaised(error, "already_member")) return "already-member";
    if (isRaised(error, "personal_org")) return "personal-org";
    if (error.code === RLS_VIOLATION) return "forbidden";
    throw error;
  },

  // 역할을 다시 적으면 DB 트리거가 만료를 7일로 새로 늘린다.
  async renewInvitation(orgId: string, email: string, role: OrgRole): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .update({ org_role: role })
      .eq("org_id", orgId)
      .eq("email", email)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },

  // owner 의 취소와 받은 사람의 거절이 같은 길이다. 누가 지울 수 있는지는 정책이 정한다.
  async deleteInvitation(id: string): Promise<void> {
    const { error } = await (await getSupabase()).from("invitations").delete().eq("id", id);
    if (error) throw error;
  },

  async updateRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<"saved" | "forbidden" | "last-owner"> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .update({ org_role: role })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .select("user_id");
    return membershipChange(error, data?.length ?? 0);
  },

  // owner 의 내보내기와 멤버의 나가기가 같은 길이다.
  async deleteMembership(
    orgId: string,
    userId: string,
  ): Promise<"saved" | "forbidden" | "last-owner"> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .select("user_id");
    return membershipChange(error, data?.length ?? 0);
  },

  // 초대받은 사람은 수락 전에도 조직 이름을 읽는다(정책이 연다).
  async listReceivedInvitations(email: string): Promise<ReceivedInvitationRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .select("id, email, org_role, expires_at, organization:organizations(name, slug)")
      .eq("email", email)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      email: row.email,
      role: toRole(row.org_role),
      expiresAt: row.expires_at,
      orgName: row.organization.name,
      orgSlug: row.organization.slug,
    }));
  },

  async findReceivedInvitation(
    id: string,
    email: string,
  ): Promise<{ orgId: string; orgSlug: string; role: OrgRole; expiresAt: string } | null> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("invitations")
      .select("org_id, org_role, expires_at, organization:organizations(slug)")
      .eq("id", id)
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          orgId: data.org_id,
          orgSlug: data.organization.slug,
          role: toRole(data.org_role),
          expiresAt: data.expires_at,
        }
      : null;
  },

  // 들어오는 길은 정책의 "초대 수락" 하나이고, 받은 초대는 DB 트리거가 지운다.
  // 이미 멤버였다면(다른 탭에서 먼저 수락) 들어온 것과 같다.
  async insertMembership(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<"joined" | "rejected"> {
    const { error } = await (
      await getSupabase()
    )
      .from("memberships")
      .insert({ org_id: orgId, user_id: userId, org_role: role });
    if (!error || error.code === UNIQUE_VIOLATION) return "joined";
    if (error.code === RLS_VIOLATION) return "rejected";
    throw error;
  },
};

export type OrganizationRepo = typeof organizationRepo;
