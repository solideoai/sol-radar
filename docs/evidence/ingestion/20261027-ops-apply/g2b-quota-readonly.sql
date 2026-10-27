-- 10-27 조달청 입찰공고(15129394) 사용량·보조 조회 누락 점검. 전부 SELECT 다(운영 DB 를 바꾸지 않는다).
-- 열 이름은 web/lib/database.types.ts(main 8cfaac31)와 대조했다. 실행 전 0번으로 운영 프로젝트인지 먼저 본다.
-- ingest_runs.source = 'g2b' 에는 조달요청(15129468, service_key 'g2b-procurement-request')도 섞일 수 있어
-- 입찰공고는 coalesce(service_key, 'g2b-bid-notice') = 'g2b-bid-notice' 로 거른다.

-- 0. 접속 대상 확인
select current_database(), inet_server_addr();

-- 1-a. 10-26·10-27 KST 입찰공고 run 목록
select id,
  (started_at at time zone 'Asia/Seoul') as started_kst,
  (finished_at at time zone 'Asia/Seoul') as finished_kst,
  trigger, status, completeness, job_key, quota_used, fetched_count,
  summary->>'fetched' as fetched, summary->>'created' as created, summary->>'changed' as changed,
  summary->>'skippedDuplicate' as dup, summary->>'quarantined' as quar,
  summary->>'cancelled' as canc, summary->>'retried' as retried,
  params->'window'->>'from' as w_from, params->'window'->>'to' as w_to,
  params->'windowCap' as cap, params->'timing' as timing
from public.ingest_runs
where source = 'g2b' and coalesce(service_key, 'g2b-bid-notice') = 'g2b-bid-notice'
  and (started_at >= timestamptz '2026-10-26 00:00+09'
       or finished_at >= timestamptz '2026-10-26 00:00+09'
       or status = 'RUNNING')
order by started_at;

-- 1-b. KST 날짜·trigger 별 quota_used 합계(오늘 합계 = Redis quota:15129394:20261027 의 하한 추정)
select (started_at at time zone 'Asia/Seoul')::date as kst_day, trigger, count(*), sum(quota_used)
from public.ingest_runs
where source = 'g2b' and coalesce(service_key, 'g2b-bid-notice') = 'g2b-bid-notice'
  and started_at >= timestamptz '2026-10-26 00:00+09'
group by 1, 2 order by 1, 2;

-- 2. run 별 보조 조회 결과 분포. bid_revisions 에 run FK 가 없어 fetched_at 구간으로 붙인다(근사).
--    목록 호출 추정 ≈ quota_used − 3×aux_ok − (aux_failed 1건당 1~3회) − (다시 채우기 실패분)
with r as (
  select id, started_at, coalesce(finished_at, now()) as fin, quota_used
  from public.ingest_runs
  where source = 'g2b' and coalesce(service_key, 'g2b-bid-notice') = 'g2b-bid-notice'
    and started_at >= timestamptz '2026-10-26 00:00+09'
)
select r.id, r.quota_used,
  count(v.id) filter (where v.normalized->'auxLookup'->>'status' = 'OK') as aux_ok,
  count(v.id) filter (where v.normalized->'auxLookup'->>'status' = 'FAILED') as aux_failed,
  count(v.id) filter (where v.normalized->'auxLookup'->>'status' = 'SKIPPED_QUOTA') as aux_skipped,
  count(v.id) filter (where v.id is not null and v.normalized->'auxLookup' is null) as aux_none,
  count(v.id) filter (where n.status = 'CANCELLED') as cancelled_rev
from r
left join public.bid_revisions v on v.fetched_at between r.started_at and r.fin
left join public.bid_notices n on n.id = v.bid_id and n.source = 'g2b-bid-notice' and not n.is_demo
where v.id is null or n.id is not null
group by r.id, r.quota_used, r.started_at
order by r.started_at;

-- 3. 오늘(KST) 생긴 revision 의 보조 조회 상태 — SKIPPED_QUOTA·FAILED 건수
select coalesce(v.normalized->'auxLookup'->>'status', 'NONE') as aux_status, count(*)
from public.bid_revisions v
join public.bid_notices n on n.id = v.bid_id
where n.source = 'g2b-bid-notice' and not n.is_demo
  and v.created_at >= timestamptz '2026-10-27 00:00+09'
group by 1 order by 1;

-- 4. 최신 revision 기준 공고 상태 × 보조 조회 상태별 면허·지역·e발주 첨부 보유 건수
--    aux = OK 인데 has_* 가 0 이면 원래 그 정보가 없는 공고, FAILED·SKIPPED_QUOTA·NONE 이면 조회를 못 해 모르는 공고다.
with latest as (
  select distinct on (v.bid_id) v.*, n.status as bid_status
  from public.bid_revisions v
  join public.bid_notices n on n.id = v.bid_id
  where n.source = 'g2b-bid-notice' and not n.is_demo
  order by v.bid_id, v.revision desc
)
select bid_status, coalesce(normalized->'auxLookup'->>'status', 'NONE') as aux, count(*) as total,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(coalesce(normalized->'structuredQualifications', '[]')) q
    where q->>'kind' in ('LICENSE_LIMIT', 'PERMITTED_INDUSTRY'))) as has_license,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(coalesce(normalized->'structuredQualifications', '[]')) q
    where q->>'kind' = 'PARTICIPATION_REGION')) as has_region,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(coalesce(normalized->'attachments', '[]')) a
    where a->>'url' like '%/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do%')) as has_eorder,
  count(*) filter (where jsonb_array_length(coalesce(normalized->'attachments', '[]')) > 0) as has_any_attach
from latest
group by 1, 2 order by 1, 2;

-- 5. 정기 창 연결 — prev_to 와 f 가 다르면 겹침(f < prev_to) 또는 빈 구간(f > prev_to). cap 이 있으면 잘린 구간이 실제 빈 구간이다.
select job_key, trigger, status, completeness,
  params->'window'->>'from' as f, params->'window'->>'to' as t,
  lag(params->'window'->>'to') over (partition by trigger order by params->'window'->>'from') as prev_to,
  params->'windowCap' as cap
from public.ingest_runs
where source = 'g2b' and coalesce(service_key, 'g2b-bid-notice') = 'g2b-bid-notice'
  and started_at >= timestamptz '2026-10-26 00:00+09'
order by trigger, f;

-- 6. 오늘 오류 코드(QUOTA_*·보조 조회 실패 등)
select split_part(e.source_key, ':', 1) as src, e.error_code, e.result_code, count(*)
from public.ingest_errors e
join public.ingest_runs r on r.id = e.ingest_run_id
where r.source = 'g2b' and coalesce(r.service_key, 'g2b-bid-notice') = 'g2b-bid-notice'
  and r.started_at >= timestamptz '2026-10-27 00:00+09'
group by 1, 2, 3 order by 4 desc;
