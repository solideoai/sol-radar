-- 20261019000012_c6_screen_reads — 화면(C6)의 공고 목록·대시보드·분석 요청이 쓰는 읽기·요청 보조를 더한다.
--
-- 근거: docs/04-DATABASE.md §3.4(score_runs)·§3.6(ingest_runs), docs/05-API-SPEC.md §1(멱등: 같은 키 + 다른 본문이면
-- 409 IDEMPOTENCY_KEY_REUSED)·§3(GET /bids 필터·정렬), docs/16-DECISIONS.md ADR-030 B14(CLOSED 는 정규화가 만들지 않고
-- 조회할 때 deadlineAt 으로 계산)·B20(큐 등록에 실패하면 run 을 FAILED(ENQUEUE_FAILED)로 바꾸고 멱등 키를 푼다).
-- 화면 역할은 score_runs 를 고치지 못하고(20261019000004 §5), ingest_runs 는 ADMIN 만 읽으며(20261019000006 §6),
-- supabase-js 질의로는 조직의 최신 분석·결정을 공고와 함께 거르고 정렬할 수 없다. 이 파일은 그 빈틈만 좁게 메운다.
--
-- 이 파일에 든 것:
--   1. score_runs.request_hash — 분석 요청 본문의 지문(null 허용). 같은 Idempotency-Key 에 다른 본문이 오면 서버가 이 값과
--      비교해 409 를 낸다. 화면 역할은 요청 행을 넣을 때만 쓴다(열 단위 insert 권한). 고치기 권한은 없다.
--   2. release_unqueued_score_run(uuid) — 큐 등록에 실패한 요청을 푼다. 부른 사람이 직접 넣은 QUEUED run 이고 그 조직에서
--      지금도 ADMIN·SALES·ANALYST 일 때만 FAILED·ENQUEUE_FAILED·finished_at=now() 로 바꾸고 멱등 키를 비운다. 바꿨으면 true.
--   3. latest_ingest_run(text) — 업무 역할(ADMIN·SALES·ANALYST·VIEWER)이 하나라도 있는 사용자에게 출처(demo=fixture,
--      live=g2b, all=전부)의 최신 수집 run 한 건의 status·started_at·finished_at·summary 만 준다. 수집 run 은 조직 소유가
--      아니라 어느 조직의 역할이든 같은 행을 본다. job_key·params·requested_by·멱등 키와 ingest_errors 는 주지 않는다.
--   4. 뷰 bid_list_items(security_invoker) — 공고 한 건에 부른 사람 조직의 최신 run(상태 무관)·최신 점수 run(COMPLETED·
--      PARTIAL)·최신 결정(검토자 이름·이메일)·최신 revision 첨부 집계를 붙인다. status 는 OPEN·AMENDED 이고 마감이 지났으면
--      CLOSED, 아니면 저장 값이다(B14). budget_krw_text 는 API 가 금액을 문자열로 내보내는 값이다(04 §1).
--
-- 바꾸지 않는 것: 표의 정책·기존 권한. 뷰는 security_invoker 라 밑 표의 RLS(공고·첨부는 활동 중 회원, 분석·결정은 자기
-- 조직, 프로필은 본인·같은 조직 멤버)를 부른 사람 권한으로 그대로 받는다. 두 함수는 security definer 지만 대상을 부른 사람
-- (auth.uid())과 업무 역할(my_sol_org_ids)로 다시 좁히고 로그인 역할만 실행한다. scripts/db-verify.mjs 의 허용 목록에
-- 이유와 함께 올라 있다. 알림 읽음 처리는 이미 있는 열 권한·정책(20261019000006)과 감사 트리거(20261019000007)로 된다.
--
-- 되돌리기(새 마이그레이션으로): 뷰 bid_list_items 와 함수 latest_ingest_run(text)·release_unqueued_score_run(uuid) 을
-- drop 하고, score_runs 의 request_hash insert 권한을 거둔 뒤 열을 drop 한다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. score_runs.request_hash
--
-- 값은 서버가 정규화한 요청 본문의 해시다. DB 는 형식을 묶지 않는다(서버 시험이 지킨다). 이전 행은 null 이다.
-- ────────────────────────────────────────────────────────────────
alter table public.score_runs add column if not exists request_hash text;

grant insert (request_hash) on table public.score_runs to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. release_unqueued_score_run(p_score_run_id)
--
-- Route Handler 가 QUEUED 행을 넣은 뒤 큐 등록이 실패했을 때 부른다(503 응답 전). 화면 역할에는 score_runs 의 update
-- 권한이 없어(상태 전이는 worker 몫) security definer 로 이 한 가지 전이만 연다. 대상은 부른 사람이 요청자인 QUEUED
-- 행뿐이고, 그 조직에서 분석을 요청할 수 있는 역할이어야 한다(분석 요청 정책과 같은 역할). RUNNING 이후는 worker 가
-- 끝맺으므로 건드리지 않는다. 멱등 키를 비워 같은 키의 재요청이 새 run 을 만들게 한다(B20). 조건에 맞는 행이 없으면
-- 아무것도 바꾸지 않고 false 다(남의 run·없는 run 을 구별해 알려 주지 않는다).
-- ────────────────────────────────────────────────────────────────
create or replace function public.release_unqueued_score_run(p_score_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.score_runs s
  set status = 'FAILED',
      error_code = 'ENQUEUE_FAILED',
      idempotency_key = null,
      finished_at = now()
  where s.id = p_score_run_id
    and s.status = 'QUEUED'
    and s.requested_by = auth.uid()
    and s.org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST']));
  return found;
end;
$$;

revoke execute on function public.release_unqueued_score_run(uuid) from public, anon, authenticated;
grant execute on function public.release_unqueued_score_run(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. latest_ingest_run(p_origin)
--
-- 대시보드의 수집 신선도 한 줄. ingest_runs 는 ADMIN 만 읽어(운영 표) 발표 계정(SALES)에는 보이지 않으므로, 업무 역할이
-- 있는 사용자에게 최신 한 건의 상태·시각·요약만 내준다. 모르는 출처 값은 0행이다. 같은 시각이면 id 로 순서를 고정한다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.latest_ingest_run(p_origin text)
returns table (status text, started_at timestamptz, finished_at timestamptz, summary jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.status, r.started_at, r.finished_at, r.summary
  from public.ingest_runs r
  where exists (select 1 from public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST', 'VIEWER']))
    and (
      p_origin = 'all'
      or (p_origin = 'demo' and r.source = 'fixture')
      or (p_origin = 'live' and r.source = 'g2b')
    )
  order by r.started_at desc, r.id desc
  limit 1;
$$;

revoke execute on function public.latest_ingest_run(text) from public, anon, authenticated;
grant execute on function public.latest_ingest_run(text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. bid_list_items — 공고 목록·대시보드가 읽는 한 줄
--
-- security_invoker 라 부른 사람의 RLS 로 밑 표를 읽는다. 다른 조직 사용자는 같은 공고 행을 보지만 run·결정 열에는 자기
-- 조직 것만 나오고, 없으면 null 이다. 최신 run 은 상태와 상관없이(created_at desc, id desc), 점수·권고 필터는 마지막
-- COMPLETED·PARTIAL run 에서, 결정은 decided_at desc, id desc 첫 행이다. 첨부 집계는 공고의 latest_revision 첨부만 센다:
-- 대기 = 다운로드 PENDING 또는 다운로드 OK + 파싱 null·PENDING. 대기·PARSED·PARTIAL·UNSUPPORTED·파싱 FAILED·다운로드 FAILED
-- 여섯 집계는 서로 겹치지 않고 합이 total 이다(파싱은 다운로드 OK 뒤에만 기록한다 — bid_documents_parse_after_download_check).
-- 화면 역할은 읽기만 한다(여러 표를 잇는 뷰라 쓰기도 되지 않지만 권한부터 주지 않는다).
-- ────────────────────────────────────────────────────────────────
create or replace view public.bid_list_items
with (security_invoker = true)
as
select
  b.id,
  b.source,
  b.notice_id,
  b.title,
  b.agency,
  b.stage,
  b.budget_krw,
  b.budget_krw::text as budget_krw_text,
  b.published_at,
  b.deadline_at,
  b.latest_revision,
  b.plan_ref,
  b.is_demo,
  b.source_url,
  b.last_synced_at,
  case
    when b.status in ('OPEN', 'AMENDED') and b.deadline_at < now() then 'CLOSED'
    else b.status
  end as status,
  latest_run.id as latest_run_id,
  latest_run.status as latest_run_status,
  latest_run.score as latest_run_score,
  latest_run.recommendation as latest_run_recommendation,
  latest_run.recommendation_basis as latest_run_basis,
  latest_run.review_flags as latest_run_flags,
  latest_run.created_at as latest_run_created_at,
  scored_run.score as scored_score,
  scored_run.recommendation as scored_recommendation,
  latest_review.decision as latest_decision,
  latest_review.decided_at as latest_decided_at,
  latest_review.display_name as latest_reviewer_display_name,
  latest_review.email as latest_reviewer_email,
  docs.total as docs_total,
  docs.pending as docs_pending,
  docs.parsed as docs_parsed,
  docs.partial as docs_partial,
  docs.unsupported as docs_unsupported,
  docs.failed as docs_failed,
  docs.download_failed as docs_download_failed
from public.bid_notices b
left join lateral (
  select s.id, s.status, s.score, s.recommendation, s.recommendation_basis, s.review_flags, s.created_at
  from public.score_runs s
  where s.bid_id = b.id
  order by s.created_at desc, s.id desc
  limit 1
) latest_run on true
left join lateral (
  select s.score, s.recommendation
  from public.score_runs s
  where s.bid_id = b.id and s.status in ('COMPLETED', 'PARTIAL')
  order by s.created_at desc, s.id desc
  limit 1
) scored_run on true
left join lateral (
  select r.decision, r.decided_at, p.display_name, p.email
  from public.bid_reviews r
  left join public.profiles p on p.id = r.reviewer_id
  where r.bid_id = b.id
  order by r.decided_at desc, r.id desc
  limit 1
) latest_review on true
left join lateral (
  select
    count(*)::int as total,
    (count(*) filter (
      where d.download_status = 'PENDING' or (d.download_status = 'OK' and coalesce(d.parse_status, 'PENDING') = 'PENDING')
    ))::int as pending,
    (count(*) filter (where d.parse_status = 'PARSED'))::int as parsed,
    (count(*) filter (where d.parse_status = 'PARTIAL'))::int as partial,
    (count(*) filter (where d.parse_status = 'UNSUPPORTED'))::int as unsupported,
    (count(*) filter (where d.parse_status = 'FAILED'))::int as failed,
    (count(*) filter (where d.download_status = 'FAILED'))::int as download_failed
  from public.bid_documents d
  join public.bid_revisions rev on rev.id = d.revision_id and rev.bid_id = d.bid_id
  where d.bid_id = b.id and rev.revision = b.latest_revision
) docs on true;

revoke all on table public.bid_list_items from anon, authenticated, public;
grant select on table public.bid_list_items to authenticated;
