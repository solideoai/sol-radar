import "server-only";
import { getSupabase } from "@/server/supabase";
import {
  PROFILE_COLUMNS,
  SUMMARY_COLUMNS,
  type CompanyProfileRow,
  type CompanyProfileSummaryRow,
  type CompanyStaffing,
} from "./company-profile.model";

// 로그인한 사람의 클라이언트로 읽는다. 누가 읽는지는 RLS("조직 회사 프로필 읽기")가 정하고,
// 여기서는 화면이 고른 조직으로 한 번 더 거른다(org_id 직접 조건).
export type CompanyProfileRepo = {
  latest: (orgId: string) => Promise<CompanyProfileRow | null>;
  revisions: (orgId: string) => Promise<CompanyProfileSummaryRow[]>;
  staffing: (orgId: string) => Promise<CompanyStaffing>;
};

export const companyProfileRepo: CompanyProfileRepo = {
  async latest(orgId) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("company_profiles")
      .select(PROFILE_COLUMNS)
      .eq("org_id", orgId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async revisions(orgId) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("company_profiles")
      .select(SUMMARY_COLUMNS)
      .eq("org_id", orgId)
      .order("revision", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  async staffing(orgId) {
    const db = await getSupabase();
    // 행은 읽지 않고 개수만 센다(head).
    const [members, scoring] = await Promise.all([
      db.from("team_members").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      db
        .from("team_member_scoring")
        .select("member_id", { count: "exact", head: true })
        .eq("org_id", orgId),
    ]);
    if (members.error) throw members.error;
    if (scoring.error) throw scoring.error;
    return { totalCount: members.count ?? 0, scoringCount: scoring.count ?? 0 };
  },
};
