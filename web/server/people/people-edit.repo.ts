import "server-only";
import { getSupabase } from "@/server/supabase";
import {
  isTeamMemberDbCode,
  type CreateTeamMemberInput,
  type TeamMemberRpcResult,
  type UpdateTeamMemberInput,
} from "./people-edit.model";

// 사용자 세션(anon 키 + JWT)으로 DB 함수를 부른다. service role 은 쓰지 않는다.
// 알려진 거절(P0001 + 코드)만 결과로 돌려주고, 나머지 오류는 던진다(라우트가 500 봉투로 바꾼다).
type DbError = { code?: string | null; message: string };
const RAISED = "P0001";

function rejection(error: DbError): TeamMemberRpcResult {
  if (error.code !== RAISED || !isTeamMemberDbCode(error.message)) throw error;
  return { ok: false, code: error.message };
}

export const teamMemberEditRepo = {
  async create(orgId: string, input: CreateTeamMemberInput): Promise<TeamMemberRpcResult> {
    const db = await getSupabase();
    const { data, error } = await db.rpc("create_team_member", {
      p_org_id: orgId,
      p_name: input.name,
      p_department_id: input.departmentId,
      p_job_title_id: input.jobTitleId,
      ...(input.email ? { p_email: input.email } : {}),
    });
    return error ? rejection(error) : { ok: true, value: data };
  },
  async update(id: string, input: UpdateTeamMemberInput): Promise<TeamMemberRpcResult> {
    const db = await getSupabase();
    const { data, error } = await db.rpc("update_team_member", {
      p_member_id: id,
      ...(input.departmentId ? { p_department_id: input.departmentId } : {}),
      ...(input.jobTitleId ? { p_job_title_id: input.jobTitleId } : {}),
      ...(input.employmentStatus ? { p_employment_status: input.employmentStatus } : {}),
    });
    return error ? rejection(error) : { ok: true, value: data };
  },
};
export type TeamMemberEditRepo = typeof teamMemberEditRepo;
