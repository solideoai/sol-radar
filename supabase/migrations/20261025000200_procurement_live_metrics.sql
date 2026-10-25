-- 20261025000200_procurement_live_metrics — 대시보드 실수집 지표(10-25 실수집 계획 B3)와 live 범위의 출처 확인.
--
-- 근거: docs/plans/2026-10-25-live-ingest-hourly-plan.md §1 "대시보드 9지표"(없음 2·부분 3), §4 B3.
-- live 범위: is_demo=false 이면서 저장된 source 가 데모 수집기(fixture)가 아닌 것만 실제 공고로 센다.
--   수집 경로는 isDemo = (source='fixture') 를 지키지만(web/server/ingestion/normalized-bid.model.ts) DB 는 강제하지 않는다.
--   어느 쪽인지 모르는 행(is_demo=false·source=fixture)은 live 지표에서 빠지고 전체(all)에만 남는다. demo 범위는 그대로 is_demo=true 다.
-- 이 파일에 든 것:
--   1. procurement_live_metrics(조직, 출처, 기준 시각, 기관 수) — 진행 중 WATCH 수와 기관별 공고 수 상위 N.
--      procurement_summary 와 같은 범위 규칙이다: 이 조직(org_id)의 사업기회 뷰, 출처, 기준 시각까지 처음 본 것,
--      입찰공고(NOTICE) 단계. 출처 사본은 뷰가 이미 사업기회 하나로 합쳤다.
--      security invoker 다. 뷰(security_invoker)와 그 아래 표의 RLS 를 부른 사람 권한으로 거친다(남의 조직은 0건).
--   2. procurement_last_scheduled_ingest(출처) — 마지막 정기(SCHEDULED) 수집 run 의 시작 시각 하나.
--      ingest_runs 는 ADMIN 만 읽는 운영 표라 procurement_source_health·latest_ingest_run 과 같은 방식(security definer +
--      업무 역할 확인)이다. 시각 하나만 돌려주고 job_key·params·요청자·오류는 내주지 않는다. 업무 역할이 없으면 null.
--   3. procurement_summary(20261023000200) 를 같은 서명·같은 반환 모양으로 다시 만든다. 바뀐 것은 live 범위의 출처 확인 하나다.
--      security invoker·search_path·권한은 그대로다.
-- 바꾸지 않는 것: 표·뷰·정책, 다른 함수, 기존 DEMO 공고·분석 이력(지우지 않는다).
--   화면의 "다음 수집 예정"은 2 의 시각 + 웹 env G2B_INGEST_INTERVAL_MINUTES 로 앱이 계산한다.
--
-- 되돌리기(새 마이그레이션으로): drop function public.procurement_live_metrics(uuid,text,timestamptz,integer);
--   drop function public.procurement_last_scheduled_ingest(text); procurement_summary 는 20261023000200 의 본문으로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

-- 1. 진행 중 WATCH·기관별 공고 수
-- 진행 중 WATCH 는 "BID 권고" 카드(bidRecommended)와 같은 조건에서 권고만 WATCH 다: 현재 유효 분석(COMPLETED·PARTIAL),
-- 진행 중 공고(OPEN·AMENDED, 마감이 지나면 뷰가 CLOSED 로 바꾼다), 출처 간 충돌 없음.
-- 기관은 대표 공고의 agency(G2B 는 수요기관)다. 이름이 없는 공고는 순위에서 뺀다. 기관 수는 1~20 으로 자른다.
create function public.procurement_live_metrics(
  p_org_id uuid,
  p_origin text,
  p_as_of timestamptz default now(),
  p_agency_limit integer default 5
)
returns jsonb language sql stable security invoker set search_path='' as $$
with scope as (select * from public.opportunity_list_items where org_id=p_org_id
 and (p_origin='all' or (p_origin='demo' and is_demo) or (p_origin<>'demo' and not is_demo and source<>'fixture'))
 and first_seen_at<=p_as_of and stage='NOTICE'),
 agencies as (select agency as name,count(*)::int as notices from scope
 where agency is not null and btrim(agency)<>''
 group by agency order by count(*) desc,agency
 limit least(greatest(coalesce(p_agency_limit,5),1),20))
select jsonb_build_object('generatedAt',p_as_of,'origin',p_origin,
 'activeWatch',(select count(*) from scope where recommendation='WATCH'
 and analysis_status in ('COMPLETED','PARTIAL') and status in ('OPEN','AMENDED') and not source_conflict),
 'topAgencies',coalesce((select jsonb_agg(jsonb_build_object('name',name,'count',notices)
 order by notices desc,name) from agencies),'[]'::jsonb));
$$;
revoke all on function public.procurement_live_metrics(uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.procurement_live_metrics(uuid,text,timestamptz,integer) to authenticated;

-- 2. 마지막 정기 수집 시각
-- 출처 규칙은 procurement_source_health 와 같다(demo → fixture run, live → fixture 가 아닌 run, all → 전부).
create function public.procurement_last_scheduled_ingest(p_origin text)
returns timestamptz language sql stable security definer set search_path='' as $$
select max(r.started_at) from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','VIEWER']))
 and r.trigger='SCHEDULED'
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'));
$$;
revoke all on function public.procurement_last_scheduled_ingest(text) from public,anon,authenticated;
grant execute on function public.procurement_last_scheduled_ingest(text) to authenticated;

-- 3. 대시보드 요약의 live 범위에 출처 확인을 더한다. 나머지 본문은 20261023000200 과 같다.
-- 옛 본문과 같이 demo·all 이 아닌 값은 live 로 읽는다.
create or replace function public.procurement_summary(p_org_id uuid,p_origin text,p_as_of timestamptz default now())
returns jsonb language sql stable set search_path='' as $$
with scope as (select * from public.opportunity_list_items where org_id=p_org_id
 and (p_origin='all' or (p_origin='demo' and is_demo) or (p_origin<>'demo' and not is_demo and source<>'fixture'))
 and first_seen_at<=p_as_of),
 n as (select * from scope where stage='NOTICE')
select jsonb_build_object('generatedAt',p_as_of,'origin',p_origin,'isDemo',p_origin='demo',
 'newlyDiscovered',(select count(*) from n where first_seen_at>p_as_of-interval '24 hours'),
 'pendingAnalysis',(select count(*) from n where analysis_status is null or analysis_status in ('QUEUED','RUNNING','FAILED')),
 'bidRecommended',(select count(*) from n where recommendation='BID' and analysis_status in ('COMPLETED','PARTIAL') and status in ('OPEN','AMENDED') and not source_conflict),
 'closingSoon',(select count(*) from n where not source_conflict and status in ('OPEN','AMENDED') and deadline_at between p_as_of and p_as_of+interval '7 days'),
 'portfolio',jsonb_build_object('BID',(select count(*) from n where recommendation='BID' and not source_conflict),
 'WATCH',(select count(*) from n where recommendation='WATCH' and not source_conflict),'NO_BID',(select count(*) from n where recommendation='NO_BID' and not source_conflict),
 'PENDING',(select count(*) from n where recommendation is null and not source_conflict)),
 'sourceConflictCount',(select count(*) from n where source_conflict),
 'knownBudgetKrw',(select coalesce(sum(budget_krw::numeric) filter(where not source_conflict),0)::text from n),
 'unknownBudgetCount',(select count(*) from n where budget_krw is null or source_conflict),
 'totalOpportunities',(select count(*) from n),
 'earlyCount',(select count(*) from scope where stage in ('PLAN','PROCUREMENT_REQUEST','PRE_SPEC')),
 'potentialDuplicateCount',(select count(*) from (
 select distinct on (left_bid_id,right_bid_id) * from public.notice_match_candidates order by left_bid_id,right_bid_id,created_at desc,id desc
 ) c join public.bid_notices b on b.id=c.left_bid_id
 join public.opportunity_notice_links ll on ll.bid_id=c.left_bid_id
 join public.opportunity_notice_links rr on rr.bid_id=c.right_bid_id
 where c.outcome='CANDIDATE' and ll.opportunity_id<>rr.opportunity_id
 and (p_origin='all' or (p_origin='demo' and b.is_demo) or (p_origin<>'demo' and not b.is_demo and b.source<>'fixture'))));
$$;
revoke all on function public.procurement_summary(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.procurement_summary(uuid,text,timestamptz) to authenticated;
