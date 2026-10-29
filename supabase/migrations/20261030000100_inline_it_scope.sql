-- 20261030000100_inline_it_scope — 목록·집계 속도: IT 범위 판정·정렬 함수를 풀어 넣을 수 있게 하고, 집계의 공고별 it_scope(b) 를 조인으로 바꾼다(ADR-070).
--
-- 근거(2026-10-30 운영 읽기 전용 측정, authenticated, 사업기회 3,324건):
--   1. 20261029000300 의 판정·정렬 함수 다섯 개는 `set search_path=''` 가 붙어 planner 가 SQL 함수를 풀어 넣지(inline) 못하고
--      행마다 함수로 부른다. 같은 판정을 3,324행에 돌리면 함수 호출 165ms, 같은 식을 풀어 쓰면 11ms 였다(결과 570건 같음).
--      목록 뷰 opportunity_list_items 를 읽는 목록·summary·live_metrics 가 모두 이 값을 계산한다.
--      opportunity_recommend_key 는 immutable 인데 본문의 to_char·extract(timestamptz) 가 stable 이라 그대로는 풀리지 않는다.
--   2. procurement_summary 의 중복 후보 수와 procurement_filter_options 는 공고마다 it_scope(b)(서브쿼리 두 개)를 부른다.
--      같은 판정을 조인으로 바꾸면 중복 후보 265ms → 38ms(27건 같음), 필터 선택지 1,729ms → 197ms(결과 jsonb 같음)였다.
-- 바꾸는 것:
--   1. it_scope_ai_title·it_scope_it_class·it_scope_of·opportunity_priority_tier·opportunity_recommend_key 를 같은 서명·같은 식의
--      SQL 표준 본문(return)으로 다시 만든다. 본문은 만들 때 해석되어 이름이 고정되므로 search_path 를 두지 않는다
--      (search_path 를 두면 inline 이 안 된다). opportunity_recommend_key 는 stable 로 바꾸고(식은 같다),
--      opportunity_priority_tier 는 분야 인자를 한 번만 읽는 식으로 바꾸고 stable 로 둔다(값은 같다, 아래 주석).
--      security invoker·권한·주석은 create or replace 가 그대로 둔다. 이 함수들은 인덱스·생성 열에 쓰지 않는다.
--   2. procurement_summary·procurement_filter_options 는 20261029000300 본문에서 public.it_scope(b) 만
--      "최신 revision left join + 최신 관련성 lateral + it_scope_of" 로 바꾼다. it_scope(b) 본문과 같은 판정이다
--      (revision 이 없으면 분류 null, 판정이 없으면 UNCLASSIFIED). (bid_id, revision) 은 unique 라 행이 늘지 않는다.
-- 바꾸지 않는 것: 판정 결과·정렬 키 값, 뷰·표, it_scope(bid_notices) 계산 열(달력·공백·bid_list_items), 웹 코드.
--   Supabase advisor 는 search_path 를 두지 않은 다섯 함수를 function_search_path_mutable 로 알린다.
--   scripts/db-verify.mjs 의 search_path 고정 검사는 SECURITY DEFINER 함수만 본다.
--
-- 되돌리기(새 마이그레이션으로): 20261029000300_it_bid_scope.sql 의 해당 함수 본문으로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

-- 1. 판정·정렬 함수: 20261029000300 과 같은 식이다.
create or replace function public.it_scope_ai_title(p_title text)
returns boolean language sql immutable
return coalesce(p_title,'') ~* '(^|[^a-z0-9_])(ai|ax|llm|rag)([^a-z0-9_]|$)|인공지능|생성형|챗봇|머신러닝|딥러닝|초거대';

create or replace function public.it_scope_it_class(p_procurement_class text)
returns boolean language sql immutable
return coalesce(p_procurement_class,'') ~ '정보시스템|소프트웨어|데이터|정보인프라|클라우드|공간정보DB|정보통신|네트워크|전산|정보화';

create or replace function public.it_scope_of(p_source text,p_is_demo boolean,p_title text,p_procurement_class text,p_relevance_state text)
returns boolean language sql immutable
return case
 when coalesce(p_is_demo,false) or p_source='fixture' then true
 when p_source='g2b-bid-notice' and nullif(btrim(p_procurement_class),'') is not null then
  public.it_scope_it_class(p_procurement_class)
  or (public.it_scope_ai_title(p_title) and strpos(p_procurement_class,'연구조사')>0)
 else coalesce(p_relevance_state,'UNCLASSIFIED') in ('RELEVANT','CANDIDATE') end;

-- 뷰가 넘기는 분야 인자(cat.categories)는 연산자가 많은 식이라, 본문이 두 번 읽으면 planner 가 풀어 넣지 않는다.
-- 그래서 분야는 한 번만 읽는다: ",분야,분야," 문자열에서 AI_AX 가 있으면 '1', 그다음 SI_SW 가 있으면 '2' 로 바꾼다.
-- 값은 20261029000300 과 같다(1 AI·AX 분야 또는 제목 AI 단어, 2 SI·SW, 3 나머지). array_to_string 이 stable 이라 stable 이다.
create or replace function public.opportunity_priority_tier(p_categories text[],p_title text)
returns integer language sql stable
return case when public.it_scope_ai_title(p_title) then 1
 else case regexp_replace(regexp_replace(','||array_to_string(coalesce(p_categories,'{}'::text[]),',')||',',
  '^.*,AI_AX,.*$','1'),'^.*,SI_SW,.*$','2') when '1' then 1 when '2' then 2 else 3 end end;

create or replace function public.opportunity_recommend_key(p_score numeric,p_recommendation text,p_deadline_at timestamptz,p_published_at timestamptz)
returns text language sql stable
return case when p_score is not null then
  case when p_recommendation='NO_BID' then '1' else '0' end
  || lpad((1000-round(p_score*10))::int::text,4,'0')
  || coalesce(to_char(p_deadline_at at time zone 'UTC','YYYYMMDDHH24MISS'),'99999999999999')
 else '2' || '0000'
  || coalesce(lpad((9999999999-floor(extract(epoch from p_published_at)))::bigint::text,10,'0'),'9999999999') end;

-- 2. 집계: 20261029000300 본문에서 public.it_scope(b) 만 조인으로 바꿨다.
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
 left join public.bid_revisions br on br.bid_id=b.id and br.revision=b.latest_revision
 left join lateral (select x.state from public.bid_relevance_assessments x where x.revision_id=br.id
 order by x.created_at desc,x.id desc limit 1) rel on true
 where c.outcome='CANDIDATE' and ll.opportunity_id<>rr.opportunity_id
 and (p_origin='all' or (p_origin='demo' and b.is_demo) or (p_origin<>'demo' and not b.is_demo and b.source<>'fixture'))
 and public.it_scope_of(b.source,b.is_demo,b.title,br.raw_payload->>'pubPrcrmntClsfcNm',coalesce(rel.state,'UNCLASSIFIED'))));
$$;

create or replace function public.procurement_filter_options(p_origin text) returns jsonb language sql stable set search_path='' as $$
with it as (select b.procuring_agency_id,b.provider_company_id,b.agency from public.bid_notices b
 left join public.bid_revisions br on br.bid_id=b.id and br.revision=b.latest_revision
 left join lateral (select x.state from public.bid_relevance_assessments x where x.revision_id=br.id
 order by x.created_at desc,x.id desc limit 1) rel on true
 where (p_origin='all' or b.is_demo=(p_origin='demo'))
 and public.it_scope_of(b.source,b.is_demo,b.title,br.raw_payload->>'pubPrcrmntClsfcNm',coalesce(rel.state,'UNCLASSIFIED')))
select jsonb_build_object('agencies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
 from (select distinct it.procuring_agency_id id,a.name from it join public.procurement_agencies a on a.id=it.procuring_agency_id) a),'[]'::jsonb),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by id)
 from (select distinct it.provider_company_id id,it.agency name from it where it.provider_company_id is not null) c),'[]'::jsonb));
$$;
