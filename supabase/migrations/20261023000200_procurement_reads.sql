-- ADR-047: 조직별 현재 유효 분석만 결합하는 고유 사업기회 읽기. 모든 업무 읽기는 호출자 RLS를 유지한다.
grant select(service_key,completeness,fetched_count) on public.ingest_runs to authenticated;
create view public.opportunity_list_items with (security_invoker=true) as
select o.id,o.first_seen_at,o.is_demo,org.id org_id,b.id bid_id,rev.id revision_id,
 b.source,b.source_family,b.notice_id,b.title,b.agency,b.procuring_agency_id agency_id,
 b.provider_company_id company_id,b.stage,
 case when b.status in ('OPEN','AMENDED') and b.deadline_at<now() then 'CLOSED' else b.status end status,
 b.budget_krw::text budget_krw,b.budget_krw budget_krw_value,b.published_at,b.deadline_at,b.source_url,
 copies.sources,copies.source_families,copies.agency_ids,copies.company_ids,copies.source_count,copies.source_conflict,
 coalesce(rel.state,'UNCLASSIFIED') relevance_state,rel.relevance_score,
 coalesce(rel.categories,'{}'::text[]) categories,
 case coalesce(rel.state,'UNCLASSIFIED') when 'RELEVANT' then 0 when 'CANDIDATE' then 1
 when 'NEEDS_REVIEW' then 2 when 'UNCLASSIFIED' then 3 else 4 end relevance_rank,
 coalesce(sc.id,s.id) analysis_id,coalesce(sc.status,s.status) analysis_status,sc.score sol_score,sc.recommendation,
 s.id latest_run_id,s.status latest_run_status,
 r.decision latest_decision,r.decided_at latest_decision_at,
 greatest(b.updated_at,o.first_seen_at,rel.created_at,s.created_at,s.finished_at,sc.finished_at,r.decided_at,copies.changed_at) changed_at
from public.bid_opportunities o
join public.bid_notices b on b.id=o.canonical_notice_id
join public.bid_revisions rev on rev.bid_id=b.id and rev.revision=b.latest_revision
cross join public.organizations org
left join lateral (select cp.id from public.company_profiles cp where cp.org_id=org.id order by cp.revision desc limit 1) cp on true
left join lateral (select x.* from public.score_runs x where x.org_id=org.id and x.bid_id=b.id
 and x.revision_id=rev.id and x.company_profile_id=cp.id order by x.created_at desc,x.id desc limit 1) s on true
left join lateral (select x.* from public.score_runs x where x.org_id=org.id and x.bid_id=b.id
 and x.revision_id=rev.id and x.company_profile_id=cp.id and x.status in ('COMPLETED','PARTIAL')
 order by x.created_at desc,x.id desc limit 1) sc on true
left join lateral (select x.* from public.bid_reviews x where x.org_id=org.id and x.bid_id=b.id
 and x.revision_id=rev.id and (x.score_run_id is null or exists(select 1 from public.score_runs rs
 where rs.id=x.score_run_id and rs.org_id=org.id and rs.revision_id=rev.id and rs.company_profile_id=cp.id and rs.status in ('COMPLETED','PARTIAL')))
 order by x.decided_at desc,x.id desc limit 1) r on true
left join lateral (select x.* from public.bid_relevance_assessments x where x.revision_id=rev.id order by x.created_at desc,x.id desc limit 1) rel on true
join lateral (select count(*)::int source_count,
 jsonb_agg(jsonb_build_object('bidId',n.id,'source',n.source,'sourceFamily',n.source_family,'url',n.source_url,
 'urlKind',case when nr.normalized->'sourceMetadata'->>'sourceUrlKind'='SERVICE_DOCUMENTATION' then 'SERVICE_DOCUMENTATION' else 'NOTICE' end) order by n.id) sources,
 array_remove(array_agg(distinct n.source_family),null) source_families,
 array_remove(array_agg(distinct n.procuring_agency_id),null) agency_ids,
 array_remove(array_agg(distinct n.provider_company_id),null) company_ids,
 max(l.decided_at) changed_at,
 (count(distinct n.budget_krw) filter(where n.stage=b.stage and n.budget_krw is not null)>1
 or count(distinct n.deadline_at) filter(where n.stage=b.stage and n.deadline_at is not null)>1
 or (bool_or(n.status='CANCELLED') filter(where n.stage=b.stage) and bool_or(n.status<>'CANCELLED') filter(where n.stage=b.stage))) source_conflict
 from public.opportunity_notice_links l join public.bid_notices n on n.id=l.bid_id
 left join public.bid_revisions nr on nr.bid_id=n.id and nr.revision=n.latest_revision where l.opportunity_id=o.id) copies on copies.source_count>0
where o.superseded_by is null;
revoke all on public.opportunity_list_items from public,anon,authenticated;
grant select on public.opportunity_list_items to authenticated;

-- 집계는 현재 페이지와 독립적으로 DB 전체 범위를 센다. early는 NOTICE KPI/포트폴리오와 분리한다.
create function public.procurement_summary(p_org_id uuid,p_origin text,p_as_of timestamptz default now())
returns jsonb language sql stable set search_path='' as $$
with scope as (select * from public.opportunity_list_items where org_id=p_org_id
 and (p_origin='all' or is_demo=(p_origin='demo')) and first_seen_at<=p_as_of),
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
 where c.outcome='CANDIDATE' and ll.opportunity_id<>rr.opportunity_id and (p_origin='all' or b.is_demo=(p_origin='demo'))));
$$;
revoke all on function public.procurement_summary(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.procurement_summary(uuid,text,timestamptz) to authenticated;

-- 安全한 상태 투영: 운영 표의 params/job_key/요청자/오류본문/인증키는 반환하지 않는다.
create function public.procurement_source_health(p_origin text)
returns table(service_key text,source text,status text,completeness text,started_at timestamptz,
 finished_at timestamptz,last_success_at timestamptz,summary jsonb,fetched_count integer,auth_status text,error_count integer)
language sql stable security definer set search_path='' as $$
select distinct on (coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end))
 coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end),r.source,r.status,r.completeness,
 r.started_at,r.finished_at,
 (select max(s.finished_at) from public.ingest_runs s where s.source=r.source
 and s.service_key is not distinct from r.service_key and s.status='SUCCEEDED' and s.completeness='COMPLETE'),r.summary,r.fetched_count,
 case when exists(select 1 from public.ingest_errors e where e.ingest_run_id=r.id and e.error_code='API_SERVICE_KEY_INVALID') then 'FAILED'
 when r.source<>'fixture' and r.status='SUCCEEDED' and r.completeness='COMPLETE' then 'VERIFIED' else 'NOT_VERIFIED' end,
 (select count(*)::int from public.ingest_errors e where e.ingest_run_id=r.id)
from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','VIEWER']))
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'))
order by coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end),r.started_at desc,r.id desc;
$$;
revoke all on function public.procurement_source_health(text) from public,anon,authenticated;
grant execute on function public.procurement_source_health(text) to authenticated;

create function public.procurement_filter_options(p_origin text) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('agencies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
 from (select distinct b.procuring_agency_id id,a.name from public.bid_notices b join public.procurement_agencies a on a.id=b.procuring_agency_id
 where p_origin='all' or b.is_demo=(p_origin='demo')) a),'[]'::jsonb),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by id)
 from (select distinct b.provider_company_id id,b.agency name from public.bid_notices b where b.provider_company_id is not null
 and (p_origin='all' or b.is_demo=(p_origin='demo'))) c),'[]'::jsonb));
$$;
revoke all on function public.procurement_filter_options(text) from public,anon,authenticated;
grant execute on function public.procurement_filter_options(text) to authenticated;

-- Worker의 한 번에 100건 이하 보완. 화면에서는 실행할 수 없다.
create function public.procurement_missing_relevance_revisions(p_limit integer default 100)
returns table(bid_id uuid,revision_id uuid,normalized jsonb,raw_payload jsonb)
language sql stable set search_path='' as $$
select b.id,r.id,r.normalized,r.raw_payload from public.bid_notices b
join public.bid_revisions r on r.bid_id=b.id and r.revision=b.latest_revision
where not exists(select 1 from public.bid_relevance_assessments a where a.revision_id=r.id)
order by b.id limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.procurement_missing_relevance_revisions(integer) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.procurement_missing_relevance_revisions(integer) to service_role;
end if; end $$;

-- 상수 메모리 상태 해시. created_at이 바뀌지 않는 분석 상태/점수 갱신도 cursor를 무효화한다.
-- RLS를 통과한 해당 조직의 표시 내용만 DB에서 해시하고 모든 행을 앱으로 가져오지 않는다.
create function public.procurement_dataset_version(p_org_id uuid) returns text language sql stable set search_path='' as $$
select md5(count(*)::text||':'||coalesce(bit_xor(hashtextextended(to_jsonb(v)::text,0))::text,''))
from public.opportunity_list_items v where org_id=p_org_id;
$$;
revoke all on function public.procurement_dataset_version(uuid) from public,anon,authenticated;
grant execute on function public.procurement_dataset_version(uuid) to authenticated;

-- 업무 셸의 기존 신선도 요약도 live의 모든 외부 계열을 포함한다. 안전한 반환 열/권한은 유지한다.
create or replace function public.latest_ingest_run(p_origin text)
returns table(status text,started_at timestamptz,finished_at timestamptz,summary jsonb)
language sql stable security definer set search_path='' as $$
select r.status,r.started_at,r.finished_at,r.summary from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','VIEWER']))
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'))
order by r.started_at desc,r.id desc limit 1;
$$;
revoke all on function public.latest_ingest_run(text) from public,anon,authenticated;
grant execute on function public.latest_ingest_run(text) to authenticated;
