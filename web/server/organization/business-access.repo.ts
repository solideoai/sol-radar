import "server-only";
import { getSupabase } from "@/server/supabase";

export const businessAccessRepo = {
  async findSolRole(orgId: string, userId: string): Promise<string | null> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("memberships")
      .select("sol_role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.sol_role ?? null;
  },
};
