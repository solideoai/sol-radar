import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type { Database } from "@/lib/database.types";
import type { EmploymentInfo, EmploymentInput } from "@/server/shared";
import type { ProfileRow } from "./profile.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 요청마다 await getSupabase() 를 부른다. 모듈 변수에 담아 두면 다른 사람의 요청에 로그인이 섞인다.
// 서비스 시험은 이 객체와 같은 모양의 가짜를 넘기므로 포트 인터페이스·메모리 어댑터를 두지 않는다.

// DB 함수가 올린 오류(raise exception). 무엇인지는 hint 로 가른다(supabase/migrations/20261015000001).
const RAISED = "P0001";
type DbError = { code: string; hint: string };
const isRaised = (error: DbError, hint: string) => error.code === RAISED && error.hint === hint;

const isInvalidEmployment = (error: { code: string; message: string }): boolean =>
  error.code === "22023" && error.message === "invalid_employment";

export class InvalidEmploymentError extends Error {
  constructor() {
    super("invalid_employment");
  }
}

type EmploymentResolution =
  Database["public"]["Functions"]["resolve_solideo_employment"]["Returns"][number];
const toEmploymentInfo = (resolved: EmploymentResolution): EmploymentInfo => ({
  companyName: "솔리데오",
  departmentId: resolved.department_code,
  departmentName: resolved.department_name,
  jobTitleId: resolved.job_title_code,
  jobTitleLabel: resolved.job_title_label,
});

export const profileRepo = {
  isConfigured: isSupabaseConfigured,

  // 서명·발급자를 확인한 토큰의 사람(쿠키든 Bearer 든). 로그인 전이면 null.
  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },

  // RLS 는 본인 행만 열지만 운영자에게는 모든 행을 연다. "내 프로필"은 id 로 좁혀야 운영자에게도 한 행이다.
  async findById(id: string): Promise<ProfileRow | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "email, is_admin, display_name, avatar_url, status, created_at, declared_department_id, declared_job_title_id",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    let employment: EmploymentInfo | null = null;
    if (data.status === "active" && data.declared_department_id && data.declared_job_title_id) {
      const resolved = await supabase.rpc("resolve_solideo_employment", {
        p_department: data.declared_department_id,
        p_job_title: data.declared_job_title_id,
      });
      if (resolved.error && !isInvalidEmployment(resolved.error)) throw resolved.error;
      if (!resolved.error) {
        if (resolved.data.length !== 1)
          throw new Error("가입 카탈로그 변환 결과가 올바르지 않습니다");
        employment = toEmploymentInfo(resolved.data[0]);
      }
    }
    return { ...data, employment };
  },
  // 고친 행이 있었는지 돌려준다. 남의 id 를 넘기거나 정지된 사람이면 RLS 가 걸러 오류 없이 0행이 된다.
  async updateDisplayName(id: string, displayName: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    return data.length > 0;
  },
  async updateEmployment(id: string, input: EmploymentInput): Promise<boolean> {
    const supabase = await getSupabase();
    const resolved = await supabase.rpc("resolve_solideo_employment", {
      p_department: input.departmentId,
      p_job_title: input.jobTitleId,
    });
    if (resolved.error) {
      if (isInvalidEmployment(resolved.error)) throw new InvalidEmploymentError();
      throw resolved.error;
    }
    if (resolved.data.length !== 1) throw new Error("가입 카탈로그 변환 결과가 올바르지 않습니다");
    const selection = resolved.data[0];
    const { data, error } = await supabase
      .from("profiles")
      .update({
        display_name: input.name,
        declared_department_id: selection.department_id,
        declared_job_title_id: selection.job_title_id,
      })
      .eq("id", id)
      .select("id");
    if (error) {
      if (isInvalidEmployment(error)) throw new InvalidEmploymentError();
      throw error;
    }
    return data.length > 0;
  },
  // 지우는 대상은 DB 함수가 JWT 에서 읽는다(인자가 없다). 지우면 그 사람의 세션도 함께 지워진다.
  async deleteAccount(): Promise<"deleted" | "sole-owner" | "sole-admin" | "suspended"> {
    const { error } = await (await getSupabase()).rpc("delete_my_account");
    if (!error) return "deleted";
    if (isRaised(error, "sole_owner")) return "sole-owner";
    if (isRaised(error, "last_admin")) return "sole-admin";
    if (isRaised(error, "suspended")) return "suspended";
    throw error;
  },
};

export type ProfileRepo = typeof profileRepo;
