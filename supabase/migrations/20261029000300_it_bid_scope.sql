-- 20261029000300_it_bid_scope — IT 공고만 보이기: IT 범위 판정·AI·SI 우선 묶음·추천순 키(ADR-069, 규칙 이름 it-scope-v1).
--
-- 근거: polaris/specs/in-progress/2026-10-29-it-bid-scope.md §4, docs/plans/2026-10-29-it-bid-scope.md Task 1.
-- 수집·저장은 바꾸지 않는다(ADR-047 보존). IT 범위 밖 공고는 저장된 채로 읽기에서만 숨긴다.
-- 판정은 공고의 최신 revision 하나로 한다.
--   1. 데모(is_demo 또는 source=fixture)는 늘 IT 범위다(데모 경로 촬영 화면 유지).
--   2. 나라장터(g2b-bid-notice)이고 공공조달분류명(raw_payload.pubPrcrmntClsfcNm)이 있으면
--      (공식 IT 분류) 또는 (제목에 AI·AX 단어 그리고 분류명에 '연구조사') 이다.
--   3. 그 밖(분류가 없는 나라장터, 한전·LH 등)은 관련성 규칙(relevance-v0.1) 상태가 RELEVANT·CANDIDATE 이다.
-- 이 파일에 든 것:
--   1. 판정 함수 it_scope_ai_title·it_scope_it_class·it_scope_of, 우선 묶음 opportunity_priority_tier,
--      추천순 키 opportunity_recommend_key. 모두 immutable·security invoker 이고 authenticated·service_role 만 실행한다.
--   2. 계산 열 it_scope(bid_notices). PostgREST 에서 select=...,it_scope 와 it_scope=eq.true 로 쓴다(달력·공백 화면).
--   3. opportunity_list_items 를 같은 열 순서로 다시 만든다(create or replace view 는 기존 열의 이름·순서·형을 바꿀 수 없고
--      끝에 열을 붙이는 것만 된다). 그래서 relevance_rank 는 이름을 두고 값만 우선 묶음(1 AI·AX, 2 SI·SW, 3 나머지)으로 바꾼다.
--      categories 는 유효 분야(관련성 분야 + 제목 AI 단어의 AI_AX + 관련성 분야가 없는 공식 IT 분류의 SI_SW)다.
--      관련성 규칙은 분야를 못 찾으면 OTHER 하나를 저장하므로 OTHER 만 있는 것도 "분야 없음"으로 본다.
--      끝에 tags(관련성 태그 + 분류명에 '유지'가 있으면 maintenance)·it_scope·recommend_key 를 붙인다.
--      뷰는 IT 범위 밖 행도 돌려준다(관심 공고는 범위 밖이어도 보인다). 목록의 숨김은 화면 조회가 it_scope 로 건다.
--   4. watched_opportunity_list_items 를 다시 만든다(i.* 가 만들 때 펼쳐져 새 열을 받으려면 다시 만들어야 한다).
--   5. procurement_summary·procurement_live_metrics 는 it_scope 행만 센다. procurement_filter_options 는 IT 범위 공고의
--      기관·회사만 돌려준다. 서명·반환 모양·security invoker·권한은 그대로다.
-- 바꾸지 않는 것: 표·정책, SOL Score·관련성 분류기, 다른 함수.
--
-- 되돌리기(새 마이그레이션으로): 뷰 두 개를 20261023000200·20261023000300 본문으로 drop 뒤 다시 만들고(열을 줄이므로
--   create or replace 로는 안 된다), procurement_summary·procurement_live_metrics 는 20261025000200, procurement_filter_options 는
--   20261023000200 본문으로 다시 만든 뒤, 이 파일의 함수 여섯 개를 지운다.
-- 이 파일은 고치지 않는다(append-only).

-- 1. 판정 함수
-- AI·AX 단어: 관련성 규칙 AI_AX 와 같은 영문 단어 경계(AI·AX·LLM·RAG)에 생성형·챗봇·초거대를 더했다.
-- "지능형"은 넣지 않는다(실측 오탐: 지능형교통시스템 유지관리).
create function public.it_scope_ai_title(p_title text)
returns boolean language sql immutable set search_path='' as $$
select coalesce(p_title,'') ~* '(^|[^a-z0-9_])(ai|ax|llm|rag)([^a-z0-9_]|$)|인공지능|생성형|챗봇|머신러닝|딥러닝|초거대';
$$;

-- 공식 IT 분류: 2026-10-29 실측 공공조달분류명(정보시스템유지관리서비스·소프트웨어유지및지원서비스 등)에서 왔다.
create function public.it_scope_it_class(p_procurement_class text)
returns boolean language sql immutable set search_path='' as $$
select coalesce(p_procurement_class,'') ~ '정보시스템|소프트웨어|데이터|정보인프라|클라우드|공간정보DB|정보통신|네트워크|전산|정보화';
$$;

create function public.it_scope_of(p_source text,p_is_demo boolean,p_title text,p_procurement_class text,p_relevance_state text)
returns boolean language sql immutable set search_path='' as $$
select case
 when coalesce(p_is_demo,false) or p_source='fixture' then true
 when p_source='g2b-bid-notice' and nullif(btrim(p_procurement_class),'') is not null then
  public.it_scope_it_class(p_procurement_class)
  or (public.it_scope_ai_title(p_title) and strpos(p_procurement_class,'연구조사')>0)
 else coalesce(p_relevance_state,'UNCLASSIFIED') in ('RELEVANT','CANDIDATE') end;
$$;
comment on function public.it_scope_of(text,boolean,text,text,text) is 'it-scope-v1 (ADR-069)';

-- AI·SI 우선 묶음: 1 AI·AX(AI_AX 분야 또는 제목 AI 단어, SI·SW 를 함께 가져도 1), 2 SI·SW, 3 나머지.
create function public.opportunity_priority_tier(p_categories text[],p_title text)
returns integer language sql immutable set search_path='' as $$
select case when 'AI_AX'=any(coalesce(p_categories,'{}'::text[])) or public.it_scope_ai_title(p_title) then 1
 when 'SI_SW'=any(coalesce(p_categories,'{}'::text[])) then 2 else 3 end;
$$;

-- 추천순 키(오름차순이 추천순). 분석됨(0 비추천 아님·1 NO_BID) 안에서는 점수 높은 순 → 마감 이른 순,
-- 분석 안 됨(2)은 최근 공고 순. 같은 키 사이의 안정 순서는 조회가 id 로 잇는다.
create function public.opportunity_recommend_key(p_score numeric,p_recommendation text,p_deadline_at timestamptz,p_published_at timestamptz)
returns text language sql immutable set search_path='' as $$
select case when p_score is not null then
  case when p_recommendation='NO_BID' then '1' else '0' end
  || lpad((1000-round(p_score*10))::int::text,4,'0')
  || coalesce(to_char(p_deadline_at at time zone 'UTC','YYYYMMDDHH24MISS'),'99999999999999')
 else '2' || '0000'
  || coalesce(lpad((9999999999-floor(extract(epoch from p_published_at)))::bigint::text,10,'0'),'9999999999') end;
$$;

-- 2. 계산 열: 최신 revision 의 공식 분류와 최신 관련성 판정으로 같은 함수를 부른다. 부른 사람 권한(RLS)으로 읽는다.
create function public.it_scope(p_bid public.bid_notices)
returns boolean language sql stable set search_path='' as $$
select public.it_scope_of(p_bid.source,p_bid.is_demo,p_bid.title,
 (select r.raw_payload->>'pubPrcrmntClsfcNm' from public.bid_revisions r
 where r.bid_id=p_bid.id and r.revision=p_bid.latest_revision),
 coalesce((select x.state from public.bid_revisions r join public.bid_relevance_assessments x on x.revision_id=r.id
 where r.bid_id=p_bid.id and r.revision=p_bid.latest_revision order by x.created_at desc,x.id desc limit 1),'UNCLASSIFIED'));
$$;

revoke all on function public.it_scope_ai_title(text) from public,anon;
revoke all on function public.it_scope_it_class(text) from public,anon;
revoke all on function public.it_scope_of(text,boolean,text,text,text) from public,anon;
revoke all on function public.opportunity_priority_tier(text[],text) from public,anon;
revoke all on function public.opportunity_recommend_key(numeric,text,timestamptz,timestamptz) from public,anon;
revoke all on function public.it_scope(public.bid_notices) from public,anon;
grant execute on function public.it_scope_ai_title(text) to authenticated,service_role;
grant execute on function public.it_scope_it_class(text) to authenticated,service_role;
grant execute on function public.it_scope_of(text,boolean,text,text,text) to authenticated,service_role;
grant execute on function public.opportunity_priority_tier(text[],text) to authenticated,service_role;
grant execute on function public.opportunity_recommend_key(numeric,text,timestamptz,timestamptz) to authenticated,service_role;
grant execute on function public.it_scope(public.bid_notices) to authenticated,service_role;

-- 3. 목록 뷰: 20261023000200 본문과 같고 categories·relevance_rank 값과 끝의 세 열만 다르다.
create or replace view public.opportunity_list_items with (security_invoker=true) as
select o.id,o.first_seen_at,o.is_demo,org.id org_id,b.id bid_id,rev.id revision_id,
 b.source,b.source_family,b.notice_id,b.title,b.agency,b.procuring_agency_id agency_id,
 b.provider_company_id company_id,b.stage,
 case when b.status in ('OPEN','AMENDED') and b.deadline_at<now() then 'CLOSED' else b.status end status,
 b.budget_krw::text budget_krw,b.budget_krw budget_krw_value,b.published_at,b.deadline_at,b.source_url,
 copies.sources,copies.source_families,copies.agency_ids,copies.company_ids,copies.source_count,copies.source_conflict,
 coalesce(rel.state,'UNCLASSIFIED') relevance_state,rel.relevance_score,
 cat.categories,
 public.opportunity_priority_tier(cat.categories,b.title) relevance_rank,
 coalesce(sc.id,s.id) analysis_id,coalesce(sc.status,s.status) analysis_status,sc.score sol_score,sc.recommendation,
 s.id latest_run_id,s.status latest_run_status,
 r.decision latest_decision,r.decided_at latest_decision_at,
 greatest(b.updated_at,o.first_seen_at,rel.created_at,s.created_at,s.finished_at,sc.finished_at,r.decided_at,copies.changed_at) changed_at,
 coalesce(rel.tags,'{}'::text[])
 || case when strpos(coalesce(cls.procurement_class,''),'유지')>0 and not 'maintenance'=any(coalesce(rel.tags,'{}'::text[]))
 then array['maintenance'] else '{}'::text[] end tags,
 public.it_scope_of(b.source,b.is_demo,b.title,cls.procurement_class,coalesce(rel.state,'UNCLASSIFIED')) it_scope,
 public.opportunity_recommend_key(sc.score,sc.recommendation,b.deadline_at,b.published_at) recommend_key
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
cross join lateral (select rev.raw_payload->>'pubPrcrmntClsfcNm' procurement_class,
 array_remove(coalesce(rel.categories,'{}'::text[]),'OTHER') found) cls
cross join lateral (select cls.found
 || case when public.it_scope_ai_title(b.title) and not 'AI_AX'=any(cls.found) then array['AI_AX'] else '{}'::text[] end
 || case when cardinality(cls.found)=0 and public.it_scope_it_class(cls.procurement_class) then array['SI_SW'] else '{}'::text[] end
 effective) eff
cross join lateral (select case when cardinality(eff.effective)>0 then eff.effective
 else coalesce(rel.categories,'{}'::text[]) end categories) cat
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

-- 4. 관심 목록 뷰: 20261023000300 본문 그대로 다시 만들어 새 열을 받는다. IT 범위 조건은 걸지 않는다.
create or replace view public.watched_opportunity_list_items with (security_invoker = true) as
select i.*
from public.opportunity_list_items i
where exists (
  select 1 from public.bid_watches w
  where w.org_id = i.org_id and w.bid_id = i.bid_id and w.user_id = (select auth.uid())
);
revoke all on table public.watched_opportunity_list_items from public, anon, authenticated;
grant select on table public.watched_opportunity_list_items to authenticated;

-- 5. 집계: 20261025000200 본문에 it_scope 조건만 더했다. 중복 후보 수는 왼쪽 공고가 IT 범위일 때만 센다.
create or replace function public.procurement_summary(p_org_id uuid,p_origin text,p_as_of timestamptz default now())
returns jsonb language sql stable set search_path='' as $$
with scope as (select * from public.opportunity_list_items where org_id=p_org_id
 and (p_origin='all' or (p_origin='demo' and is_demo) or (p_origin<>'demo' and not is_demo and source<>'fixture'))
 and first_seen_at<=p_as_of and it_scope),
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
 and (p_origin='all' or (p_origin='demo' and b.is_demo) or (p_origin<>'demo' and not b.is_demo and b.source<>'fixture'))
 and public.it_scope(b)));
$$;
revoke all on function public.procurement_summary(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.procurement_summary(uuid,text,timestamptz) to authenticated;

create or replace function public.procurement_live_metrics(
  p_org_id uuid,
  p_origin text,
  p_as_of timestamptz default now(),
  p_agency_limit integer default 5
)
returns jsonb language sql stable security invoker set search_path='' as $$
with scope as (select * from public.opportunity_list_items where org_id=p_org_id
 and (p_origin='all' or (p_origin='demo' and is_demo) or (p_origin<>'demo' and not is_demo and source<>'fixture'))
 and first_seen_at<=p_as_of and stage='NOTICE' and it_scope),
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

-- 필터 선택지: 20261023000200 본문에 IT 범위 조건만 더했다.
create or replace function public.procurement_filter_options(p_origin text) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('agencies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
 from (select distinct b.procuring_agency_id id,a.name from public.bid_notices b join public.procurement_agencies a on a.id=b.procuring_agency_id
 where (p_origin='all' or b.is_demo=(p_origin='demo')) and public.it_scope(b)) a),'[]'::jsonb),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by id)
 from (select distinct b.provider_company_id id,b.agency name from public.bid_notices b where b.provider_company_id is not null
 and (p_origin='all' or b.is_demo=(p_origin='demo')) and public.it_scope(b)) c),'[]'::jsonb));
$$;
revoke all on function public.procurement_filter_options(text) from public,anon,authenticated;
grant execute on function public.procurement_filter_options(text) to authenticated;
