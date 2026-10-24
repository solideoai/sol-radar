import "server-only";
import type { DepartmentRow, JobTitle, MemberRow, ScoringRow } from "./people.model";
import { signPhotoPaths } from "@/server/photos";
import { getSupabase } from "@/server/supabase";
// 연결 계정의 제공자 사진은 같은 조직 멤버 프로필 읽기 정책(20261014000001)으로 읽힌다. 연결 전이면 null.
const memberColumns =
  "id,person_code,name,email,department_id,job_title_id,portrait_path,is_demo,user_id,photo_path,profile:profiles!team_members_user_id_fkey(avatar_url)";
type MemberSelect = Omit<MemberRow, "linked_avatar_url"> & {
  profile: { avatar_url: string | null } | null;
};
const toMemberRow = ({ profile, ...row }: MemberSelect): MemberRow => ({
  ...row,
  linked_avatar_url: profile?.avatar_url ?? null,
});
const scoringColumns =
  "member_id,role,grade,skills,availability,certifications,past_projects,capability_source,capability_version";
export const peopleRepo = {
  async listDepartments(orgId: string): Promise<DepartmentRow[]> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("departments")
      .select("id,code,name,kind,parent_id,target_count")
      .eq("org_id", orgId)
      .order("code");
    if (error) throw error;
    return data ?? [];
  },
  async listJobTitles(orgId: string): Promise<JobTitle[]> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("job_titles")
      .select("id,code,label")
      .eq("org_id", orgId)
      .order("sort_order")
      .order("id");
    if (error) throw error;
    return data ?? [];
  },
  async listMembers(orgId: string): Promise<MemberRow[]> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("team_members")
      .select(memberColumns)
      .eq("org_id", orgId)
      .order("person_code")
      .order("id");
    if (error) throw error;
    return (data ?? []).map(toMemberRow);
  },
  async listScoring(orgId: string): Promise<ScoringRow[]> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("team_member_scoring")
      .select(scoringColumns)
      .eq("org_id", orgId);
    if (error) throw error;
    return data ?? [];
  },
  async findMember(orgId: string, id: string): Promise<MemberRow | null> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("team_members")
      .select(memberColumns)
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toMemberRow(data) : null;
  },
  async findScoring(orgId: string, id: string): Promise<ScoringRow | null> {
    const db = await getSupabase();
    const { data, error } = await db
      .from("team_member_scoring")
      .select(scoringColumns)
      .eq("org_id", orgId)
      .eq("member_id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  // 사용자 JWT 로 서명한다(profile_photos_read 정책). 서명하지 못한 경로는 빠진다.
  signPhotos: (paths: readonly string[]): Promise<Map<string, string>> => signPhotoPaths(paths),
};
export type PeopleRepo = typeof peopleRepo;
