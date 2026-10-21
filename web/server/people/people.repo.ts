import "server-only";
import type { DepartmentRow, JobTitle, MemberRow, ScoringRow } from "./people.model";
import { getSupabase } from "@/server/supabase";
const memberColumns = "id,person_code,name,department_id,job_title_id,portrait_path,is_demo";
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
    return data ?? [];
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
    return data;
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
};
export type PeopleRepo = typeof peopleRepo;
