import "server-only";
import { nameOf } from "@/server/shared";
import { getSupabase } from "@/server/supabase";
import type { IngestionAdminRepo, IngestionRunPosition } from "./ingestion-admin.service";

// ── N8 수집 관리 읽기. 사용자 세션(anon 키) + RLS 로만 읽는다(service role 을 쓰지 않는다) ──
// ingest_runs·ingest_errors 는 정책 "ADMIN 은 수집 run·오류 읽기"(my_sol_org_ids(array['ADMIN']))가 연다.
// 조직 구분 없는 공용 운영 표라 org_id 로 거르지 않는다. 요청자 이름만 지금 조직 구성원으로 좁힌다.
// ingest_runs 는 화면 역할에 열 단위로만 열려 있다(20261019000019, W1). job_key·idempotency_key·requested_by·params 는
// 고르기·거르기 모두 권한 오류이므로 select=* 를 쓰지 않고 아래 열만 고른다. 요청자는 감사(audit_logs)에서 읽는다.

// 화면 역할이 고를 수 있는 열(마이그레이션의 grant 순서). supabase-js 가 행 타입을 뽑도록 문자열 그대로 둔다.
const RUN_COLUMNS =
  "id,source,run_mode,trigger,batch,cursor,status,summary,quota_used,started_at,finished_at";

// PostgREST 필터 값은 큰따옴표로 감싸고 안의 `"`·`\` 를 이스케이프한다(postgrest.ts quoteValue 와 같은 규칙).
const quote = (value: string): string => `"${value.replace(/["\\]/g, (ch) => `\\${ch}`)}"`;

// started_at desc, id desc 의 다음 쪽 조건. started_at 은 not null 이라 null 갈래가 없다.
const afterFilter = ({ startedAt, id }: IngestionRunPosition): string =>
  `started_at.lt.${quote(startedAt)},and(started_at.eq.${quote(startedAt)},id.lt.${quote(id)})`;

export const ingestionAdminRepo: IngestionAdminRepo = {
  async listRuns({ limit, after }) {
    const db = await getSupabase();
    const base = db.from("ingest_runs").select(RUN_COLUMNS);
    const paged = after === null ? base : base.or(afterFilter(after));
    const { data, error } = await paged
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async findRun(id) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("ingest_runs")
      .select(RUN_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listErrors(runIds) {
    if (runIds.length === 0) return [];
    const db = await getSupabase();
    const { data, error } = await db
      .from("ingest_errors")
      .select("*")
      .in("ingest_run_id", [...runIds])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return data;
  },

  async findRunningRun(source) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("ingest_runs")
      .select("id")
      .eq("source", source)
      .eq("status", "RUNNING")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // 소스별 카드의 "마지막 성공·실패". 끝난 시각이 늦은 것이 마지막이다(같은 소스 run 이 겹쳐 돌아도 맞다).
  // finished_at 이 빈 끝난 행은 맨 뒤로 보내고, 같은 시각이면 id 로 순서를 고정한다. 거르기·정렬 모두 허용 열만 쓴다(W1).
  async findLatestRun(source, statuses) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("ingest_runs")
      .select(RUN_COLUMNS)
      .eq("source", source)
      .in("status", [...statuses])
      .order("finished_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // 수동 수집 요청자는 worker 가 요청한 조직에 남긴 감사(INGEST_MANUAL, target_id = runId)의 행위자다.
  // action·target_type 은 worker 가 쓰는 값(ingestion.store.ts toManualAuditInsert)과 같아야 한다.
  // 감사는 조직 소유 표라 RLS 가 내 조직(ADMIN) 것만 열고, 지금 조직(orgId)으로 다시 좁힌다. 계정이 지워져 actor_id 가
  // null 이 된 감사는 뺀다.
  async findManualRequesters(orgId, runIds) {
    if (runIds.length === 0) return new Map();
    const db = await getSupabase();
    const { data, error } = await db
      .from("audit_logs")
      .select("target_id, actor_id")
      .eq("org_id", orgId)
      .eq("action", "INGEST_MANUAL")
      .eq("target_type", "ingest_run")
      .in("target_id", [...runIds]);
    if (error) throw error;
    return new Map(
      data.flatMap((row): [string, string][] =>
        row.actor_id === null ? [] : [[row.target_id, row.actor_id]],
      ),
    );
  },

  // 지금 조직(orgId)의 memberships 에 있는 사람만 이름을 낸다. 운영자는 profiles 를 모두 읽을 수 있어
  // profiles 가 읽히는지로 판단하면 다른 조직 사람이 드러난다(e8 판정 2). 같은 조직 프로필은 정책이 연다.
  async findMemberNames(orgId, userIds) {
    if (userIds.length === 0) return new Map();
    const db = await getSupabase();
    const { data, error } = await db
      .from("memberships")
      .select("user_id, profile:profiles(email, display_name)")
      .eq("org_id", orgId)
      .in("user_id", [...userIds]);
    if (error) throw error;
    return new Map(
      data.map((row) => [row.user_id, nameOf(row.profile.display_name, row.profile.email)]),
    );
  },
};
