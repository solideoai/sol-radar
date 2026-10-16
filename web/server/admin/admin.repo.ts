import "server-only";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import { type UserRow, type UserStatus, userSearchFilter } from "./admin.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 관리 키(service_role)는 쓰지 않는다. 운영자의 전체 프로필 읽기는 정책 "운영자는 전체 프로필 읽기"(마이그레이션 20261013000001)가
// 연다 — 운영자가 아닌 사람이 불러도 RLS 가 본인 행만 돌려준다. 정지·해제도 운영자만 부르는 DB 함수가 한다.

// PostgREST·PostgreSQL 오류 코드.
const RANGE_NOT_SATISFIABLE = "PGRST103";
const INSUFFICIENT_PRIVILEGE = "42501";

const USER_COLUMNS = "id, email, display_name, is_admin, status, created_at";

// DB 함수가 올린 오류(raise exception)는 hint 로 가른다(supabase/migrations/20261015000001 의 admin_set_user_status).
const STATUS_REFUSALS = {
  invalid_status: "invalid",
  self: "self",
  admin_target: "admin-target",
  not_found: "not-found",
} as const;
const hintOf = (error: { hint: string }) =>
  Object.entries(STATUS_REFUSALS).find(([hint]) => hint === error.hint)?.[1];

export const adminRepo = {
  isConfigured: isSupabaseConfigured,

  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },

  // 요청마다 DB 에서 읽는다 — 운영자에서 빠지거나 정지되면 다음 요청부터 false 다. 행이 없으면(가입 트리거보다 먼저 만든 계정) 운영자가 아니다.
  async isAdmin(userId: string): Promise<boolean> {
    const { data, error } = await (
      await getSupabase()
    )
      .from("profiles")
      .select("is_admin, status")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.is_admin === true && data.status === "active";
  },

  // 운영자인지·대상이 누구인지는 DB 함수가 다시 본다. 정지하면 그 사람의 로그인이 막히고 세션이 끊긴다.
  async setUserStatus(
    userId: string,
    status: UserStatus,
  ): Promise<"saved" | "forbidden" | "invalid" | "self" | "admin-target" | "not-found"> {
    const { error } = await (
      await getSupabase()
    ).rpc("admin_set_user_status", { target: userId, next_status: status });
    if (!error) return "saved";
    if (error.code === INSUFFICIENT_PRIVILEGE) return "forbidden";
    const refusal = hintOf(error);
    if (refusal) return refusal;
    throw error;
  },

  // 같은 시각이면 id 로 순서를 고정한다(쪽을 넘겨도 줄이 겹치거나 빠지지 않게). 필터 글은 모델이 이스케이프한다.
  // offset 이 범위를 넘으면 out-of-range 다(PostgREST 가 416 으로 거절하거나 빈 쪽이 온다).
  async listUsers(
    search: string | null,
    offset: number,
    limit: number,
  ): Promise<{ rows: UserRow[]; total: number } | "out-of-range"> {
    const all = (await getSupabase()).from("profiles").select(USER_COLUMNS, { count: "exact" });
    const filtered = search === null ? all : all.or(userSearchFilter(search));
    const { data, error, count } = await filtered
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + limit - 1);
    if (error?.code === RANGE_NOT_SATISFIABLE) return "out-of-range";
    if (error) throw error;
    const total = count ?? 0;
    return data.length === 0 && offset > 0 && total > 0 ? "out-of-range" : { rows: data, total };
  },
};

export type AdminRepo = typeof adminRepo;
