-- 20261029000100_recommendation_insights — 추천 분석(ADR-066): 분석 run 하나에 붙는 Qwen 설명 요청과 결과.
--
-- 근거: polaris/specs/in-progress/2026-10-29-recommendation-insight.md(사용자 결정 2026-10-29),
-- docs/plans/2026-10-29-recommendation-insight.md 공통 계약 C1·Task 6, web/server/insight/insight.model.ts(값 이름의 정본).
-- 공고 상세의 [추천 분석] 버튼이 PENDING 행을 넣고, Analysis Worker(service role)가 gateway POST /insight 결과로
-- DONE·FAILED 로 닫는다. 판정(점수·권고)은 score_runs 그대로이고 이 표는 판단 이유·강점·보완할 점만 담는다.
--
-- 이 파일에 든 것:
--   1. recommendation_insights — 표·복합 FK(run 은 같은 조직)·상태 check·run 당 PENDING 하나(부분 유일 색인)·조회 색인.
--   2. 권한·정책 — 조직 전원 읽기. ADMIN·SALES·ANALYST 는 자기 조직의 완료(COMPLETED·PARTIAL) run 에 PENDING 만 넣는다.
--      update·delete 는 화면 역할에 없다. 마감은 worker 가 service role 로 `where id = $1 and status = 'PENDING'` 한다.
--      보안 정의자 함수는 두지 않는다.
--
-- 되돌리기(새 마이그레이션으로): drop table if exists public.recommendation_insights;
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. recommendation_insights
--
-- 요청 하나가 한 행이다. 다시 요청하면 새 행이 생기고 화면은 그 run 의 최신 행을 본다.
-- run 이 지워지면 설명도 지운다(옛 run 의 설명이 새 run 에 붙지 않는다).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.recommendation_insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  score_run_id uuid not null,
  status text not null default 'PENDING',
  source text,
  payload jsonb,
  fallback_reason text,
  model_name text,
  prompt_hash text,
  error_code text,
  requested_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint recommendation_insights_score_run_fkey foreign key (score_run_id, org_id)
    references public.score_runs (id, org_id) on delete cascade,
  constraint recommendation_insights_status_check check (status in ('PENDING', 'DONE', 'FAILED')),
  constraint recommendation_insights_source_check check (source in ('MODEL', 'TEMPLATE')),
  constraint recommendation_insights_payload_check check (jsonb_typeof(payload) = 'object'),
  -- 대체 이유는 gateway 가 규칙 결과로 대신 쓴 TEMPLATE 에만 붙는다.
  constraint recommendation_insights_fallback_reason_check check (
    fallback_reason is null
    or (
      fallback_reason in ('MODEL_UNAVAILABLE', 'INVALID_OUTPUT', 'FORBIDDEN_WORD', 'UNKNOWN_NUMBER', 'UNKNOWN_REF', 'LABEL_CONFLICT')
      and source = 'TEMPLATE'
    )
  ),
  constraint recommendation_insights_error_code_check check (
    error_code in ('GATEWAY_UNAVAILABLE', 'GATEWAY_INVALID', 'SOURCE_INVALID', 'STALE')
  ),
  -- 상태마다 채워진 열이 정해져 있다. worker 가 service role 로 써도 어긋난 행은 들어가지 않는다.
  constraint recommendation_insights_state_check check (
    case status
      when 'PENDING' then source is null and payload is null and fallback_reason is null
        and error_code is null and finished_at is null
      when 'DONE' then source is not null and payload is not null and error_code is null
        and finished_at is not null
      when 'FAILED' then error_code is not null and finished_at is not null and source is null
        and payload is null
      else false
    end
  )
);

alter table public.recommendation_insights enable row level security;

-- 두 번 누르기·relay 재시도에도 run 당 진행 중 요청은 하나다. 두 번째 insert 는 23505 로 막히고 서버가 있던 행을 돌려준다.
create unique index if not exists recommendation_insights_one_pending
  on public.recommendation_insights (score_run_id) where status = 'PENDING';
-- run 의 최신 1건 조회. 정책이 거르는 org_id 가 앞에 오고, run FK 의 cascade 도 이 색인으로 찾는다.
create index if not exists recommendation_insights_org_id_score_run_id_created_at_idx
  on public.recommendation_insights (org_id, score_run_id, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- 2. 권한과 정책
--
-- 기본 권한을 거두고 필요한 것만 연다. status·requested_by 는 열 권한이 없어 기본값(PENDING·auth.uid())만 들어가고,
-- 결과 열(source·payload·error_code·finished_at 등)은 화면 역할이 쓰지 못한다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.recommendation_insights from anon, authenticated, public;

grant select on table public.recommendation_insights to authenticated;
grant insert (org_id, score_run_id) on table public.recommendation_insights to authenticated;

drop policy if exists "조직 추천 분석 읽기" on public.recommendation_insights;
create policy "조직 추천 분석 읽기"
  on public.recommendation_insights for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- requested_by·status 검사는 열 권한 위의 두 번째 잠금이다. run 은 같은 조직의 완료 run 이어야 한다.
drop policy if exists "ADMIN·SALES·ANALYST 는 추천 분석 요청" on public.recommendation_insights;
create policy "ADMIN·SALES·ANALYST 는 추천 분석 요청"
  on public.recommendation_insights for insert
  to authenticated
  with check (
    org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST']))
    and requested_by = (select auth.uid())
    and status = 'PENDING'
    and exists (
      select 1
      from public.score_runs r
      where r.id = recommendation_insights.score_run_id
        and r.org_id = recommendation_insights.org_id
        and r.status in ('COMPLETED', 'PARTIAL')
    )
  );
