import "server-only";
import { getSupabase } from "@/server/supabase";
import type { ActivityMemberRow, ActivityRow } from "./activity.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 정책은 내가 멤버인 조직의 활동을 모두 열므로 org_id 로 그 조직 하나에 좁힌다.
// 쓰는 길은 없다 — 기록은 DB 트리거만 남긴다.
export const activityRepo = {
  // 같은 시각(한 문장이 남긴 기록 둘)이면 id 로 순서를 고정한다.
  async listRecent(orgId: string, limit: number): Promise<ActivityRow[]> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("activities")
      .select(
        "id, kind, actor_id, task_title, target_user_id, target_name, old_role, new_role, created_at",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async listMembers(orgId: string): Promise<ActivityMemberRow[]> {
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
};

export type ActivityRepo = typeof activityRepo;
