import "server-only";
import type {
  SubmitJoinInput,
  JoinDbError,
  JoinRequestRow,
  MyJoinRequestRow,
} from "./join-request.model";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";

// ── 저장: 가입 신청 표 읽기와 DB 함수 호출. 규칙은 두지 않는다 ──
// 요청마다 await getSupabase() 를 부른다(사용자 JWT). 누가 무엇을 읽고 쓰는지는 RLS 와 DB 함수가 정한다.

const asDbError = (error: { code?: string; hint?: string } | null): JoinDbError | null =>
  error ? { code: error.code ?? "", hint: error.hint ?? "" } : null;

// 부서·직급은 신청 행과 같은 조직 카탈로그를 가리키는 복합 외래 키로, 연결 대상은 team_member_id 로 붙여 읽는다.
// 한 문자열 리터럴로 둔다 — 이어 붙이면 supabase-js 가 행 타입을 추론하지 못한다.
const pendingColumns =
  "id,kind,applicant_name,applicant_email,applicant_photo_path,created_at,department:departments!member_join_requests_department_fkey(name),job_title:job_titles!member_join_requests_job_title_fkey(label),member:team_members!member_join_requests_team_member_id_fkey(name,person_code)";

export const joinRequestRepo = {
  isConfigured: isSupabaseConfigured,
  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },
  // 관리자는 조직의 다른 신청도 읽으므로 내 것만 거른다.
  async myLatestRequest(userId: string): Promise<MyJoinRequestRow | null> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("member_join_requests")
      .select("kind,status,member:team_members!member_join_requests_team_member_id_fkey(name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async submit(input: SubmitJoinInput): Promise<{ id: string | null; error: JoinDbError | null }> {
    const { data, error } = await (
      await getSupabase()
    ).rpc(
      "submit_join_request",
      input.kind === "EXISTING"
        ? { p_kind: input.kind, p_team_member: input.teamMemberId, p_name: input.name }
        : { p_kind: input.kind },
    );
    return { id: data ?? null, error: asDbError(error) };
  },
  async findUnlinked(
    departmentCode: string,
    name: string,
  ): Promise<{
    rows: { id: string; person_code: string; name: string; job_title_label: string }[];
    error: JoinDbError | null;
  }> {
    const { data, error } = await (
      await getSupabase()
    ).rpc("find_unlinked_member", { p_department: departmentCode, p_name: name });
    return { rows: data ?? [], error: asDbError(error) };
  },
  async listPending(orgId: string): Promise<JoinRequestRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("member_join_requests")
      .select(pendingColumns)
      .eq("org_id", orgId)
      .eq("status", "PENDING")
      .order("created_at")
      .order("id");
    if (error) throw error;
    return data ?? [];
  },
  async decide(
    requestId: string,
    approve: boolean,
    solRole: string,
  ): Promise<{ result: string | null; error: JoinDbError | null }> {
    const { data, error } = await (
      await getSupabase()
    ).rpc("decide_join_request", {
      p_request: requestId,
      p_approve: approve,
      p_sol_role: solRole,
    });
    return { result: data ?? null, error: asDbError(error) };
  },
};

export type JoinRequestRepo = typeof joinRequestRepo;
