-- 20261029000400_bid_list_it_scope — 공고 고르기 목록(bid_list_items)에도 IT 범위 판정 열을 붙인다(ADR-069 통합 리뷰 H1).
--
-- 근거: polaris/specs/in-progress/2026-10-29-it-bid-scope.md D1 "IT 범위 밖 공고는 어떤 화면에서도 안 보인다".
--   /workforce·/analysis 의 공고 고르기와 GET /api/v1/bids 는 opportunity_list_items 가 아니라 이 뷰를 읽는다.
-- 이 파일에 든 것:
--   1. bid_list_items 를 20261019000012 본문 그대로 다시 만들고 끝에 it_scope(public.it_scope(b), 20261029000300) 열 하나만 붙인다.
--      create or replace view 는 끝에 열을 붙이는 것만 되므로 기존 열의 이름·순서·형은 그대로다.
--      뷰는 IT 범위 밖 행도 돌려준다. 숨김은 목록 조회가 it_scope 로 건다(관심 목록·상세는 거르지 않는다).
--   2. watched_bid_list_items 를 20261022000100 본문 그대로 다시 만든다(select i.* 는 만들 때의 열 목록으로 굳는다).
-- security_invoker·권한은 원본과 같다. 바꾸지 않는 것: 표·정책·함수, 다른 뷰.
--
-- 되돌리기(새 마이그레이션으로): watched_bid_list_items 를 지운 뒤 bid_list_items 를 지우고(열을 줄이므로 create or replace
--   로는 안 된다) 두 뷰를 20261019000012·20261022000100 본문으로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

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
  docs.download_failed as docs_download_failed,
  public.it_scope(b) as it_scope
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

create or replace view public.watched_bid_list_items
with (security_invoker = true)
as
select i.*
from public.bid_list_items i
where exists (
  select 1
  from public.bid_watches w
  where w.bid_id = i.id
    and w.user_id = (select auth.uid())
);

revoke all on table public.watched_bid_list_items from anon, authenticated, public;
grant select on table public.watched_bid_list_items to authenticated;
