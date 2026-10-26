-- 01-inventory.sql — DEMO 공고 정리 전 조회(읽기 전용). 운영 DB 를 바꾸지 않는다.
--
-- 대상: bid_notices 중 is_demo = true AND source = 'fixture' 인 19건(아래 listed 목록과 같아야 한다).
-- 목록의 id 는 scripts/demo/plan.mjs demoIdFor(uuid v5, source+notice_id)로 정해지는 고정값이라 어느 DB 에서나 같다.
-- 운영 id 가 다르면 Q1 이 바로 보여 준다. 그때는 Q1 결과의 id 로 이 파일·02·03·04 의 listed 목록을 바꾼다.
--
-- 실행: 문장마다 따로 돌린다(MCP execute_sql 한 번에 문장 하나). 첫 문장 set timezone 은 Q2·Q3 의 확인값(sha256)이
-- 세션 시간대에 따라 달라지지 않게 한다. 같은 호출에 함께 넣거나, 따로 돌린다면 Q2 결과의 tz 열이 UTC 인지 본다.
--   Q1 대상 목록 — 19행, in_list·matches_condition 모두 true 여야 한다.
--   Q2 영향 보고 — section·item·actual·expected·ok. ok=false 가 하나라도 있으면 03 을 돌리지 않는다.
--   Q3 Storage 객체 목록 — 지우지 않고 남기는 첨부·텍스트 객체(03 이 정리 job 에서 보호한다).
--
-- 03 실행 뒤 다시 돌리면 B 절 삭제 대상이 0 이 되고, 04 복구 뒤 다시 돌리면 처음 결과와 같아야 한다(행 수·sha256).

set timezone to 'UTC';

-- ── Q1. 대상 목록 ───────────────────────────────────────────────
with listed(bid_id) as (values
  ('b9f00c0b-96e2-5949-9fc7-ef7bb7aea163'::uuid),
  ('687bd892-941f-56a9-9ea9-9754ea5e5f1a'::uuid),
  ('dcb0a308-6f3b-5457-8d0a-fbdf4be684b9'::uuid),
  ('9036e273-d51b-5090-8c89-53161dbb6714'::uuid),
  ('4f552925-ef52-591d-b31e-a33cf6465668'::uuid),
  ('b7df7a25-d4e7-566b-86f3-f8ceaf474e08'::uuid),
  ('cbc1beaa-65c3-5446-b0bb-b39577a24dc5'::uuid),
  ('1aca5230-53d0-58c9-93a1-5dab49a0c338'::uuid),
  ('009a7aa0-10c9-54f0-8be4-f124dbebcfb1'::uuid),
  ('0f43b834-130f-53d1-a075-26ef321b162f'::uuid),
  ('d6a7d9d4-f567-5226-a467-9986cf50e5b8'::uuid),
  ('b432b15d-96d1-5ef1-bf42-30547dbc066e'::uuid),
  ('29dc6ded-e564-5d29-82ec-ea9806ad48b1'::uuid),
  ('f66379fe-96c4-5ffc-a1c3-f36bad5c1299'::uuid),
  ('9f10f9dc-7a52-5616-8bfd-b65d74285a9d'::uuid),
  ('8db93cc7-fae2-557e-a8bc-ca4e5352e10c'::uuid),
  ('5f28b611-29d8-59fa-92eb-a0c453b91cd0'::uuid),
  ('f1b8fdee-7493-542e-b800-3a60b6ee7032'::uuid),
  ('1cfcc05b-daaf-5a55-950c-ce2422b996b5'::uuid)
),
cond as (select n.id from public.bid_notices n where n.is_demo = true and n.source = 'fixture')
select coalesce(l.bid_id, c.id) as bid_id, n.notice_id, n.title, n.is_demo, n.source, n.status,
  (l.bid_id is not null) as in_list, (c.id is not null) as matches_condition
from listed l
full join cond c on c.id = l.bid_id
left join public.bid_notices n on n.id = coalesce(l.bid_id, c.id)
order by n.notice_id nulls first, 1;

-- ── Q2. 영향 보고 ───────────────────────────────────────────────
-- A 대상 확인 · B 지우거나 바꾸는 행(표별 행 수·sha256) · C 차단·위험 검사 · D 보존 표 행 수(03 뒤에도 같아야 한다)
with listed(bid_id) as (values
  ('b9f00c0b-96e2-5949-9fc7-ef7bb7aea163'::uuid),
  ('687bd892-941f-56a9-9ea9-9754ea5e5f1a'::uuid),
  ('dcb0a308-6f3b-5457-8d0a-fbdf4be684b9'::uuid),
  ('9036e273-d51b-5090-8c89-53161dbb6714'::uuid),
  ('4f552925-ef52-591d-b31e-a33cf6465668'::uuid),
  ('b7df7a25-d4e7-566b-86f3-f8ceaf474e08'::uuid),
  ('cbc1beaa-65c3-5446-b0bb-b39577a24dc5'::uuid),
  ('1aca5230-53d0-58c9-93a1-5dab49a0c338'::uuid),
  ('009a7aa0-10c9-54f0-8be4-f124dbebcfb1'::uuid),
  ('0f43b834-130f-53d1-a075-26ef321b162f'::uuid),
  ('d6a7d9d4-f567-5226-a467-9986cf50e5b8'::uuid),
  ('b432b15d-96d1-5ef1-bf42-30547dbc066e'::uuid),
  ('29dc6ded-e564-5d29-82ec-ea9806ad48b1'::uuid),
  ('f66379fe-96c4-5ffc-a1c3-f36bad5c1299'::uuid),
  ('9f10f9dc-7a52-5616-8bfd-b65d74285a9d'::uuid),
  ('8db93cc7-fae2-557e-a8bc-ca4e5352e10c'::uuid),
  ('5f28b611-29d8-59fa-92eb-a0c453b91cd0'::uuid),
  ('f1b8fdee-7493-542e-b800-3a60b6ee7032'::uuid),
  ('1cfcc05b-daaf-5a55-950c-ce2422b996b5'::uuid)
),
-- 대상은 목록과 조건을 둘 다 만족하는 공고만이다.
t as (select n.id from public.bid_notices n join listed l on l.bid_id = n.id where n.is_demo = true and n.source = 'fixture'),
t_txt as (select id::text as id from t),
rev as (select r.id from public.bid_revisions r where r.bid_id in (select id from t)),
run as (select s.id from public.score_runs s where s.bid_id in (select id from t)),
ext as (select e.id from public.requirement_extractions e where e.bid_id in (select id from t)),
rvw as (select r.id from public.bid_reviews r where r.bid_id in (select id from t)),
prj as (select p.id from public.bid_projects p where p.bid_id in (select id from t)),
opp as (select o.id from public.bid_opportunities o where o.canonical_notice_id in (select id from t)),
-- FK 없이 공고·run·결정·프로젝트 id 를 들고 있는 행
ntf as (select n.id from public.notifications n where n.payload ->> 'bidId' in (select id from t_txt)),
obx as (
  select e.id from public.outbox_events e
  where e.aggregate_id in (select id from t union all select id from run union all select id from rvw union all select id from prj)
     or e.payload ->> 'bidId' in (select id from t_txt)
),
dso as (
  select d.raw_storage_id as id from public.bid_documents d where d.bid_id in (select id from t) and d.raw_storage_id is not null
  union
  select d.parsed_storage_id from public.bid_documents d where d.bid_id in (select id from t) and d.parsed_storage_id is not null
),
known_fk(child, conname) as (values
  ('bid_documents', 'bid_documents_revision_fkey'), ('score_factors', 'score_factors_score_run_fkey'),
  ('bid_revisions', 'bid_revisions_bid_id_fkey'), ('bid_documents', 'bid_documents_bid_id_fkey'),
  ('bid_structured_requirements', 'bid_structured_requirements_bid_id_fkey'),
  ('bid_structured_requirements', 'bid_structured_requirements_revision_fkey'),
  ('requirement_extractions', 'requirement_extractions_bid_id_fkey'), ('requirement_extractions', 'requirement_extractions_revision_fkey'),
  ('score_runs', 'score_runs_bid_id_fkey'), ('score_runs', 'score_runs_extraction_id_fkey'), ('score_runs', 'score_runs_revision_fkey'),
  ('qualification_checks', 'qualification_checks_bid_id_fkey'), ('qualification_checks', 'qualification_checks_score_run_fkey'),
  ('qualification_checks', 'qualification_checks_revision_fkey'), ('requirement_assessments', 'requirement_assessments_score_run_fkey'),
  ('assignments', 'assignments_bid_id_fkey'), ('bid_reviews', 'bid_reviews_bid_id_fkey'), ('bid_reviews', 'bid_reviews_revision_fkey'),
  ('bid_reviews', 'bid_reviews_score_run_fkey'), ('bid_documents', 'bid_documents_raw_storage_fk'),
  ('bid_documents', 'bid_documents_parsed_storage_fk'), ('bid_watches', 'bid_watches_bid_id_fkey'),
  ('bid_projects', 'bid_projects_bid_id_fkey'), ('bid_projects', 'bid_projects_opened_by_review_fkey'),
  ('bid_project_events', 'bid_project_events_project_fkey'), ('tasks', 'tasks_bid_project_fkey'),
  ('bid_opportunities', 'bid_opportunities_canonical_notice_id_fkey'), ('bid_opportunities', 'bid_opportunities_superseded_by_fkey'),
  ('opportunity_notice_links', 'opportunity_notice_links_bid_id_fkey'), ('opportunity_notice_links', 'opportunity_notice_links_opportunity_id_fkey'),
  ('notice_match_candidates', 'notice_match_candidates_left_bid_id_fkey'), ('notice_match_candidates', 'notice_match_candidates_right_bid_id_fkey'),
  ('bid_notice_events', 'bid_notice_events_bid_id_fkey'), ('bid_notice_events', 'bid_notice_events_revision_id_fkey'),
  ('bid_notice_events', 'bid_notice_events_related_bid_id_fkey'), ('bid_notice_events', 'bid_notice_events_revision_id_bid_id_fkey'),
  ('bid_relevance_assessments', 'bid_relevance_assessments_revision_id_fkey'), ('ingest_run_items', 'ingest_run_items_bid_id_fkey'),
  ('ingest_run_items', 'ingest_run_items_revision_id_fkey'), ('kakao_send_claims', 'kakao_send_claims_bid_id_fkey'),
  ('kakao_send_claims', 'kakao_send_claims_outbox_event_id_fkey'), ('kakao_send_claims', 'kakao_send_claims_notification_id_fkey')
),
scope_tables(name) as (values
  ('bid_notices'), ('bid_revisions'), ('bid_documents'), ('bid_structured_requirements'), ('requirement_extractions'),
  ('score_runs'), ('score_factors'), ('qualification_checks'), ('requirement_assessments'), ('bid_reviews'), ('bid_projects'),
  ('bid_project_events'), ('tasks'), ('assignments'), ('bid_watches'), ('kakao_send_claims'), ('notifications'), ('outbox_events'),
  ('bid_opportunities'), ('opportunity_notice_links'), ('notice_match_candidates'), ('bid_notice_events'),
  ('bid_relevance_assessments'), ('ingest_run_items'), ('document_storage_objects')
),
-- B 절: 표별 행 수·sha256·바이트. txt 는 02 의 rows_text 와 같은 식이다(to_jsonb 행을 그 text 순으로 모은 jsonb 배열의 text).
-- bytes 합이 크면(MCP 응답 한도) 02 대신 02b 로 백업한다.
bt(ord, item, cnt, txt) as (
  select 1, 'bid_notices', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_notices x where x.id in (select id from t)
  union all select 2, 'bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_revisions x where x.id in (select id from rev)
  union all select 3, 'bid_documents', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_documents x where x.bid_id in (select id from t)
  union all select 4, 'bid_structured_requirements', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_structured_requirements x where x.bid_id in (select id from t)
  union all select 5, 'requirement_extractions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.requirement_extractions x where x.id in (select id from ext)
  union all select 6, 'score_runs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.score_runs x where x.id in (select id from run)
  union all select 7, 'score_factors', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.score_factors x where x.score_run_id in (select id from run)
  union all select 8, 'qualification_checks', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.qualification_checks x where x.score_run_id in (select id from run) or x.bid_id in (select id from t)
  union all select 9, 'requirement_assessments', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.requirement_assessments x where x.score_run_id in (select id from run)
  union all select 10, 'bid_reviews', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_reviews x where x.id in (select id from rvw)
  union all select 11, 'bid_projects', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_projects x where x.id in (select id from prj)
  union all select 12, 'bid_project_events', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_project_events x where x.bid_project_id in (select id from prj)
  union all select 13, 'tasks', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.tasks x where x.bid_project_id in (select id from prj)
  union all select 14, 'assignments', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.assignments x where x.bid_id in (select id from t)
  union all select 15, 'bid_watches', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_watches x where x.bid_id in (select id from t)
  union all select 16, 'kakao_send_claims', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.kakao_send_claims x where x.bid_id in (select id from t)
  union all select 17, 'notifications', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.notifications x where x.id in (select id from ntf)
  union all select 18, 'outbox_events', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.outbox_events x where x.id in (select id from obx)
  union all select 19, 'bid_opportunities', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_opportunities x where x.id in (select id from opp)
  union all select 20, 'opportunity_notice_links', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.opportunity_notice_links x where x.bid_id in (select id from t) or x.opportunity_id in (select id from opp)
  union all select 21, 'notice_match_candidates', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.notice_match_candidates x where x.left_bid_id in (select id from t) or x.right_bid_id in (select id from t)
  union all select 22, 'bid_notice_events', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_notice_events x where x.bid_id in (select id from t)
  union all select 23, 'bid_relevance_assessments', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_relevance_assessments x where x.revision_id in (select id from rev)
  union all select 24, 'ingest_run_items', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.ingest_run_items x where x.bid_id in (select id from t) or x.revision_id in (select id from rev)
  union all select 25, 'document_storage_objects', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.document_storage_objects x where x.id in (select id from dso)
),
b as (select ord, item, cnt, encode(sha256(convert_to(txt, 'UTF8')), 'hex') as sha, octet_length(txt) as bytes from bt),
report(section, ord, item, actual, expected, note) as (
  -- A. 대상 확인
  select 'A 대상', 1, 'tz', null::bigint, null::bigint, current_setting('TimeZone')
  union all select 'A 대상', 2, '목록 id 수', (select count(*) from listed), 19, '목록에 적힌 id'
  union all select 'A 대상', 3, '조건(is_demo AND fixture) 공고 수', (select count(*) from public.bid_notices where is_demo = true and source = 'fixture'), 19, null
  union all select 'A 대상', 4, '목록∩조건(실제 대상)', (select count(*) from t), 19, null
  union all select 'A 대상', 5, '목록에 있지만 조건 밖(is_demo=false 등)', (select count(*) from listed l join public.bid_notices n on n.id = l.bid_id where not (n.is_demo = true and n.source = 'fixture')), 0, '0 이 아니면 중단'
  union all select 'A 대상', 6, '목록에 있지만 DB 에 없음', (select count(*) from listed l where not exists (select 1 from public.bid_notices n where n.id = l.bid_id)), 0, '03 뒤에는 19'
  union all select 'A 대상', 7, '조건에 맞지만 목록 밖', (select count(*) from public.bid_notices n where n.is_demo = true and n.source = 'fixture' and n.id not in (select bid_id from listed)), 0, '있으면 Q1 로 목록을 다시 정한다'
  -- B. 지우거나 바꾸는 행
  union all select 'B 대상 행', 10 + b.ord, b.item, b.cnt,
    case b.item when 'bid_notices' then 19 when 'score_runs' then 19 end,
    case b.item
      when 'ingest_run_items' then 'UPDATE bid_id·revision_id → null(FK SET NULL). 행은 남는다. bytes=' || b.bytes || ' sha256=' || b.sha
      when 'document_storage_objects' then 'UPDATE lease_until → infinity(정리 job 보호). 행·객체는 남는다. bytes=' || b.bytes || ' sha256=' || b.sha
      else 'DELETE. bytes=' || b.bytes || ' sha256=' || b.sha end
  from b
  union all select 'B 대상 행', 36, '백업 크기 합계(bytes, 02 rows_text)', (select sum(bytes) from b), null, '수 MB 면 02b(DB 안 백업 표)를 쓴다'
  -- C. 차단·위험(모두 0 이어야 한다)
  union all select 'C 차단', 41, 'bid_notice_events: 대상 밖 행이 related_bid_id 로 대상 공고를 가리킴', (select count(*) from public.bid_notice_events e where e.related_bid_id in (select id from t) and e.bid_id not in (select id from t)), 0, 'FK NO ACTION — 삭제 실패'
  union all select 'C 차단', 42, 'bid_opportunities: 대상 밖 기회가 superseded_by 로 대상 기회를 가리킴', (select count(*) from public.bid_opportunities o where o.superseded_by in (select id from opp) and o.id not in (select id from opp)), 0, 'FK NO ACTION — 삭제 실패'
  union all select 'C 차단', 43, 'bid_projects: 대상 밖 프로젝트가 대상 결정을 여는 결정으로 가리킴', (select count(*) from public.bid_projects p where p.opened_by_review_id in (select id from rvw) and p.id not in (select id from prj)), 0, 'FK NO ACTION — 삭제 실패'
  union all select 'C 차단', 44, 'opportunity_notice_links: 보존 공고가 대상 기회에 묶임', (select count(*) from public.opportunity_notice_links k where k.opportunity_id in (select id from opp) and k.bid_id not in (select id from t)), 0, 'CASCADE 로 보존 공고의 연결이 지워진다'
  union all select 'C 차단', 45, 'opportunity_notice_links: 대상 공고가 보존 기회에 묶임', (select count(*) from public.opportunity_notice_links k where k.bid_id in (select id from t) and k.opportunity_id not in (select id from opp)), 0, '보존 기회의 대표 재선정이 필요해진다'
  union all select 'C 차단', 46, 'notice_match_candidates: 대상-보존 공고 쌍', (select count(*) from public.notice_match_candidates m where (m.left_bid_id in (select id from t)) <> (m.right_bid_id in (select id from t))), 0, 'CASCADE 로 보존 공고의 중복 후보 이력이 지워진다'
  union all select 'C 차단', 47, 'bid_reviews: 보존 결정이 대상 run 을 가리킴', (select count(*) from public.bid_reviews r where r.score_run_id in (select id from run) and r.id not in (select id from rvw)), 0, 'SET NULL 로 보존 결정이 바뀐다'
  union all select 'C 차단', 48, 'score_runs: 보존 run 이 대상 추출을 가리킴', (select count(*) from public.score_runs s where s.extraction_id in (select id from ext) and s.id not in (select id from run)), 0, 'SET NULL 로 보존 run 이 바뀐다'
  union all select 'C 차단', 49, 'kakao_send_claims: 대상 밖 claim 이 지울 알림·outbox 를 가리킴', (select count(*) from public.kakao_send_claims k where (k.bid_id is null or k.bid_id not in (select id from t)) and (k.notification_id in (select id from ntf) or k.outbox_event_id in (select id from obx))), 0, 'SET NULL 로 보존 claim 이 바뀐다'
  union all select 'C 차단', 50, 'score_runs: 대상 run 이 진행 중(QUEUED·RUNNING)', (select count(*) from public.score_runs s where s.id in (select id from run) and s.status in ('QUEUED', 'RUNNING')), 0, 'worker 가 끝내려다 실패한다 — 끝난 뒤 실행'
  union all select 'C 차단', 51, 'bid_documents: 대상 첨부가 처리 중(lease 유효)', (select count(*) from public.bid_documents d where d.bid_id in (select id from t) and d.processing_lease_until > now()), 0, 'documents job 이 끝난 뒤 실행'
  union all select 'C 차단', 52, 'score_runs: 대상 run 이 NOT VALID 검사(idempotency_key 접두어)를 어김', (select count(*) from public.score_runs s where s.id in (select id from run) and not (s.idempotency_key is null or starts_with(s.idempotency_key, s.org_id::text || ':'))), 0, '복구 insert 가 거절된다'
  union all select 'C 차단', 53, 'document_storage_objects: 대상 객체를 보존 첨부도 참조', (select count(*) from public.bid_documents d where d.bid_id not in (select id from t) and (d.raw_storage_id in (select id from dso) or d.parsed_storage_id in (select id from dso))), 0, null
  union all select 'C 차단', 54, 'document_storage_objects: 대상 객체가 STORED 아님', (select count(*) from public.document_storage_objects o where o.id in (select id from dso) and o.status <> 'STORED'), 0, '복구 때 첨부 참조를 다시 걸 수 없다'
  union all select 'C 차단', 55, '카탈로그: 범위 표를 가리키는 FK 중 이 실행서가 모르는 것', (select count(*) from pg_constraint c join pg_class p on p.oid = c.confrelid join pg_class ch on ch.oid = c.conrelid where c.contype = 'f' and p.relnamespace = 'public'::regnamespace and p.relname in (select name from scope_tables) and (ch.relname, c.conname) not in (select child, conname from known_fk)), 0, '있으면 실행서를 고친 뒤 실행'
  union all select 'C 차단', 56, '카탈로그: 범위 표의 DELETE 사용자 트리거(tasks_log_activity 제외)', (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in (select name from scope_tables) and (g.tgtype & 8) = 8 and g.tgname <> 'tasks_log_activity'), 0, '삭제를 막거나 부수 행을 쓰는 트리거'
  union all select 'C 차단', 57, 'ingest_run_items: 대상 공고·개정을 가리키는 항목의 run 이 fixture 가 아님', (select count(*) from public.ingest_run_items i join public.ingest_runs r on r.id = i.run_id where (i.bid_id in (select id from t) or i.revision_id in (select id from rev)) and r.source <> 'fixture'), 0, '03 이 bid_id·revision_id 를 비우면 실수집 이력이 바뀐다'
  -- C 참고(0 이 아니어도 된다)
  union all select 'C 참고', 61, 'outbox_events: 대상 이벤트 중 PENDING·FAILED', (select count(*) from public.outbox_events e where e.id in (select id from obx) and e.status in ('PENDING', 'FAILED')), null, '지우면 그 알림은 나가지 않는다(의도)'
  union all select 'C 참고', 62, 'assignments: 대상 공고 인력 배정', (select count(*) from public.assignments a where a.bid_id in (select id from t)), null, '인력 화면·가용 FTE 입력에서 빠진다'
  union all select 'C 참고', 63, 'tasks: 지울 체크리스트(activities 기록 없이 지운다)', (select count(*) from public.tasks x where x.bid_project_id in (select id from prj)), null, null
  union all select 'C 참고', 64, 'audit_logs: 대상 공고·run·결정·프로젝트를 가리키는 감사(남긴다)', (select count(*) from public.audit_logs a where a.target_id in (select id from t union all select id from run union all select id from rvw union all select id from prj) or a.before_after -> 'after' ->> 'bidId' in (select id from t_txt)), null, 'append-only 감사. 지우지 않는다'
  union all select 'C 참고', 65, 'storage.objects: 대상 공고 경로의 객체(남긴다)', (select count(*) from storage.objects o where exists (select 1 from t where o.name like 'raw/bids/' || t.id::text || '/%' or o.name like 'parsed/bids/' || t.id::text || '/%')), null, 'Q3 목록'
  -- D. 보존(03 전후 같아야 한다)
  union all select 'D 보존', 71, 'bid_notices: 대상 밖', (select count(*) from public.bid_notices n where n.id not in (select id from t)), null, null
  union all select 'D 보존', 72, 'bid_notices: is_demo=false', (select count(*) from public.bid_notices n where n.is_demo = false), null, null
  union all select 'D 보존', 73, 'bid_revisions: 대상 밖', (select count(*) from public.bid_revisions r where r.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 74, 'score_runs: 대상 밖', (select count(*) from public.score_runs s where s.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 75, 'bid_reviews: 대상 밖', (select count(*) from public.bid_reviews r where r.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 76, 'bid_projects: 대상 밖', (select count(*) from public.bid_projects p where p.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 77, 'tasks: 전체', (select count(*) from public.tasks), null, '03 뒤 = 처음 - C63'
  union all select 'D 보존', 78, 'bid_watches: 대상 밖', (select count(*) from public.bid_watches w where w.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 79, 'assignments: 대상 밖', (select count(*) from public.assignments a where a.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 80, 'notifications: 대상 밖', (select count(*) from public.notifications n where n.id not in (select id from ntf)), null, null
  union all select 'D 보존', 81, 'outbox_events: 대상 밖', (select count(*) from public.outbox_events e where e.id not in (select id from obx)), null, null
  union all select 'D 보존', 82, 'kakao_send_claims: 대상 밖', (select count(*) from public.kakao_send_claims k where k.bid_id is null or k.bid_id not in (select id from t)), null, null
  union all select 'D 보존', 83, 'bid_opportunities: 대상 밖', (select count(*) from public.bid_opportunities o where o.id not in (select id from opp)), null, null
  union all select 'D 보존', 84, 'ingest_runs: 전체', (select count(*) from public.ingest_runs), null, 'fixture run 도 남긴다'
  union all select 'D 보존', 85, 'ingest_runs: source=fixture', (select count(*) from public.ingest_runs where source = 'fixture'), null, null
  union all select 'D 보존', 86, 'ingest_errors: 전체', (select count(*) from public.ingest_errors), null, null
  union all select 'D 보존', 87, 'ingest_payloads: 전체', (select count(*) from public.ingest_payloads), null, null
  union all select 'D 보존', 88, 'ingest_run_items: 전체', (select count(*) from public.ingest_run_items), null, '행 수 그대로(B24 는 열만 비운다)'
  union all select 'D 보존', 89, 'audit_logs: 전체', (select count(*) from public.audit_logs), null, null
  union all select 'D 보존', 90, 'activities: 전체', (select count(*) from public.activities), null, null
  union all select 'D 보존', 91, 'organizations', (select count(*) from public.organizations), null, null
  union all select 'D 보존', 92, 'profiles', (select count(*) from public.profiles), null, null
  union all select 'D 보존', 93, 'auth.users', (select count(*) from auth.users), null, null
  union all select 'D 보존', 94, 'memberships', (select count(*) from public.memberships), null, null
  union all select 'D 보존', 95, 'team_members(가상 직원)', (select count(*) from public.team_members), null, null
  union all select 'D 보존', 96, 'company_profiles', (select count(*) from public.company_profiles), null, null
  union all select 'D 보존', 97, 'document_storage_objects: 전체', (select count(*) from public.document_storage_objects), null, null
  union all select 'D 보존', 98, 'procurement_agencies', (select count(*) from public.procurement_agencies), null, null
  union all select 'D 보존', 99, 'eval_runs', (select count(*) from public.eval_runs), null, null
)
select section, item, actual, expected,
  case when expected is null then null else actual = expected end as ok,
  note
from report
order by ord;

-- ── Q3. Storage 객체 목록(지우지 않는다) ──────────────────────────
-- 원장(document_storage_objects)이 대상 첨부와 이어진 객체 + 버킷에 실제로 있는 대상 공고 경로의 객체.
with listed(bid_id) as (values
  ('b9f00c0b-96e2-5949-9fc7-ef7bb7aea163'::uuid),
  ('687bd892-941f-56a9-9ea9-9754ea5e5f1a'::uuid),
  ('dcb0a308-6f3b-5457-8d0a-fbdf4be684b9'::uuid),
  ('9036e273-d51b-5090-8c89-53161dbb6714'::uuid),
  ('4f552925-ef52-591d-b31e-a33cf6465668'::uuid),
  ('b7df7a25-d4e7-566b-86f3-f8ceaf474e08'::uuid),
  ('cbc1beaa-65c3-5446-b0bb-b39577a24dc5'::uuid),
  ('1aca5230-53d0-58c9-93a1-5dab49a0c338'::uuid),
  ('009a7aa0-10c9-54f0-8be4-f124dbebcfb1'::uuid),
  ('0f43b834-130f-53d1-a075-26ef321b162f'::uuid),
  ('d6a7d9d4-f567-5226-a467-9986cf50e5b8'::uuid),
  ('b432b15d-96d1-5ef1-bf42-30547dbc066e'::uuid),
  ('29dc6ded-e564-5d29-82ec-ea9806ad48b1'::uuid),
  ('f66379fe-96c4-5ffc-a1c3-f36bad5c1299'::uuid),
  ('9f10f9dc-7a52-5616-8bfd-b65d74285a9d'::uuid),
  ('8db93cc7-fae2-557e-a8bc-ca4e5352e10c'::uuid),
  ('5f28b611-29d8-59fa-92eb-a0c453b91cd0'::uuid),
  ('f1b8fdee-7493-542e-b800-3a60b6ee7032'::uuid),
  ('1cfcc05b-daaf-5a55-950c-ce2422b996b5'::uuid)
),
t as (select n.id from public.bid_notices n join listed l on l.bid_id = n.id where n.is_demo = true and n.source = 'fixture')
select 'ledger' as kind, d.bid_id, o.bucket, o.path, o.status, o.size_bytes, o.lease_until,
  case when o.id = d.raw_storage_id then 'raw' else 'parsed' end as role
from public.bid_documents d
join public.document_storage_objects o on o.id in (d.raw_storage_id, d.parsed_storage_id)
where d.bid_id in (select id from t)
union all
select 'bucket', t.id, o.bucket_id, o.name, null, (o.metadata ->> 'size')::bigint, null, null
from storage.objects o
join t on o.name like 'raw/bids/' || t.id::text || '/%' or o.name like 'parsed/bids/' || t.id::text || '/%'
order by 1, 2, 4;
