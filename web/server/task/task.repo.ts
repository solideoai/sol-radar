import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type {
  TaskEdit,
  TaskInput,
  TaskListFilters,
  TaskMemberRow,
  TaskRow,
  TaskStatsRow,
  TaskStatus,
} from "./task.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 예상한 실패(정책 거절·담당자 외래 키 거절·범위를 넘은 쪽)는 이름 붙은 값으로 돌려주고, 나머지는 그대로 던진다.
// RLS 는 내가 멤버인 조직을 모두 열므로 읽기·쓰기 모두 org_id 로 그 조직 하나에 좁힌다.

// PostgreSQL 오류 코드.
const RLS_VIOLATION = "42501";
const FOREIGN_KEY_VIOLATION = "23503";
// PostgREST 오류 코드.
const RANGE_NOT_SATISFIABLE = "PGRST103";

type DbError = { code: string; message: string };
// 다른 조직의 사람을 담당자로 넣으면 (org_id, assignee_id) → memberships 외래 키가 거절한다.
const isAssigneeRejected = (error: DbError) =>
  error.code === FOREIGN_KEY_VIOLATION && error.message.includes("tasks_assignee_fkey");

const TASK_COLUMNS =
  "id, title, description, status, due_date, assignee_id, created_by, completed_at, created_at";

const toColumns = (task: TaskInput) => ({
  title: task.title,
  description: task.description,
  due_date: task.dueDate,
  assignee_id: task.assigneeId,
});

export const taskRepo = {
  isConfigured: isSupabaseConfigured,

  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },

  async listMembers(orgId: string): Promise<TaskMemberRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("user_id, profile:profiles(email, display_name)")
      .eq("org_id", orgId);
    if (error) throw error;
    return data.map((row) => ({
      userId: row.user_id,
      email: row.profile.email,
      displayName: row.profile.display_name,
    }));
  },

  async isMember(orgId: string, userId: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  // 같은 마감일·같은 시각이면 id 로 순서를 고정한다(쪽을 넘겨도 줄이 겹치거나 빠지지 않게).
  // offset 이 범위를 넘으면 out-of-range 다(PostgREST 가 416 으로 거절하거나 빈 쪽이 온다).
  async listPage(
    orgId: string,
    filters: TaskListFilters,
    offset: number,
    limit: number,
  ): Promise<{ rows: TaskRow[]; total: number } | "out-of-range"> {
    const scoped = (await getSupabase())
      .from("tasks")
      .select(TASK_COLUMNS, { count: "exact" })
      .eq("org_id", orgId);
    const byStatus = filters.status === null ? scoped : scoped.eq("status", filters.status);
    const byAssignee =
      filters.assignee === null
        ? byStatus
        : filters.assignee === "none"
          ? byStatus.is("assignee_id", null)
          : byStatus.eq("assignee_id", filters.assignee);
    const sorted =
      filters.sort === "due"
        ? byAssignee
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
        : byAssignee.order("created_at", { ascending: false });
    const { data, error, count } = await sorted.order("id").range(offset, offset + limit - 1);
    if (error?.code === RANGE_NOT_SATISFIABLE) return "out-of-range";
    if (error) throw error;
    const total = count ?? 0;
    return data.length === 0 && offset > 0 && total > 0 ? "out-of-range" : { rows: data, total };
  },

  async listDueSoon(orgId: string, limit: number): Promise<TaskRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .neq("status", "done")
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw error;
    return data;
  },

  // 함수가 호출한 사람의 권한으로 돈다 — 내 조직이 아니면 모두 0 이다. asOf 를 넘기지 않으면 DB 의 지금이다.
  async dashboardStats(orgId: string, asOf?: string): Promise<TaskStatsRow> {
    const { data, error } = await (
      await getSupabase()
    )
      .rpc(
        "task_dashboard_stats",
        asOf === undefined ? { target_org: orgId } : { target_org: orgId, as_of: asOf },
      )
      .single();
    if (error) throw error;
    return data;
  },

  // 만든 사람(created_by)은 입력이 아니라 DB 가 로그인에서 채운다.
  async insert(
    orgId: string,
    task: TaskInput,
  ): Promise<"saved" | "not-in-org" | "assignee-not-member"> {
    const { error } = await (
      await getSupabase()
    )
      .from("tasks")
      .insert({ org_id: orgId, ...toColumns(task) });
    if (!error) return "saved";
    if (error.code === RLS_VIOLATION) return "not-in-org";
    if (isAssigneeRejected(error)) return "assignee-not-member";
    throw error;
  },

  // 바뀐 행이 없으면 missing 이다: 작업이 지워졌거나, 내가 그 조직에서 빠져 정책이 걸렀다.
  async update(
    orgId: string,
    id: string,
    changes: TaskEdit | { status: TaskStatus },
  ): Promise<"saved" | "missing" | "assignee-not-member"> {
    const values = "title" in changes ? { ...toColumns(changes), status: changes.status } : changes;
    const { data, error } = await (
      await getSupabase()
    )
      .from("tasks")
      .update(values)
      .eq("org_id", orgId)
      .eq("id", id)
      .select("id");
    if (error && isAssigneeRejected(error)) return "assignee-not-member";
    if (error) throw error;
    return data.length > 0 ? "saved" : "missing";
  },

  // 지울 수 없는 작업(남의 조직·member 가 남이 만든 작업)은 RLS 가 걸러 오류 없이 0행이 된다.
  async deleteById(orgId: string, id: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("tasks")
      .delete()
      .eq("org_id", orgId)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },

  async isVisible(orgId: string, id: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("tasks")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },
};

export type TaskRepo = typeof taskRepo;
