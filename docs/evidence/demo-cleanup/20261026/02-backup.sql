-- 02-backup.sql — 지울·바꿀 행 전부를 표별 JSON 으로 내보낸다(읽기 전용). 운영 DB 를 바꾸지 않는다.
--
-- 범위는 01 Q2 B 절과 같은 식이다(같은 listed 목록·같은 조건). 01 의 listed 를 바꿨다면 여기도 똑같이 바꾼다.
-- 결과: 행 26개 = meta 1 + 표 25. 열은 ord·table_name·action·row_count·sha256·rows_text.
--   rows_text 는 to_jsonb(행)을 그 text 순으로 모은 jsonb 배열의 text 다. 숫자·시각을 그대로 보존하려고 jsonb 가 아니라 text 로
--   내보낸다(클라이언트가 jsonb 를 JS 값으로 풀면 0.5000 → 0.5 처럼 글자가 바뀌어 확인값이 어긋난다).
--   sha256 = sha256(rows_text 의 UTF-8 바이트). 01 Q2 B 절의 sha256 과 같아야 한다.
--   meta 행의 rows_text 는 {"targetIds":[…],"tz":…,"generatedAt":…,"database":…}.
--
-- 먼저: 결과(리허설 약 2.2MB, score_runs.input_snapshot 에 가상 직원 명부 스냅샷 포함)를 MCP 응답으로 받지 않는다.
--   백업은 02b(DB 안) + 로컬 pg_dump 를 먼저 쓴다. 이 파일은 pg_dump 를 쓸 수 없을 때 로컬 psql 로만 돌린다(summary.md 실행 순서 3).
-- 저장: 결과 행 배열을 그대로 JSON 파일 하나로 저장한다(예: docs/evidence/demo-cleanup/20261026/backup-<시각>.json).
--   [{"ord":0,"table_name":"meta",…,"rows_text":"{…}"}, {"ord":1,"table_name":"bid_notices",…}, …]
--   저장한 뒤 파일에서 표마다 sha256(rows_text) 를 다시 계산해 sha256 열과 같은지 본다(summary.md 의 확인 명령).
--   결과가 너무 커서 잘리면 마지막 where 절의 주석을 풀고 ord 범위를 나눠 여러 번 받는다(26행이 다 모여야 한다).
-- 04-restore.sql 은 이 배열을 그대로 입력으로 받는다.
--
-- 시간대: 첫 문장 set timezone 과 SELECT 를 같은 호출로 돌린다. meta 의 tz 가 UTC 가 아니면 다시 받는다.

set timezone to 'UTC';

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
raw(ord, table_name, action, row_count, rows_text) as (
  select 1, 'bid_notices', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_notices x where x.id in (select id from t)
  union all select 2, 'bid_revisions', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_revisions x where x.id in (select id from rev)
  union all select 3, 'bid_documents', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_documents x where x.bid_id in (select id from t)
  union all select 4, 'bid_structured_requirements', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_structured_requirements x where x.bid_id in (select id from t)
  union all select 5, 'requirement_extractions', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.requirement_extractions x where x.id in (select id from ext)
  union all select 6, 'score_runs', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.score_runs x where x.id in (select id from run)
  union all select 7, 'score_factors', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.score_factors x where x.score_run_id in (select id from run)
  union all select 8, 'qualification_checks', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.qualification_checks x where x.score_run_id in (select id from run) or x.bid_id in (select id from t)
  union all select 9, 'requirement_assessments', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.requirement_assessments x where x.score_run_id in (select id from run)
  union all select 10, 'bid_reviews', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_reviews x where x.id in (select id from rvw)
  union all select 11, 'bid_projects', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_projects x where x.id in (select id from prj)
  union all select 12, 'bid_project_events', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_project_events x where x.bid_project_id in (select id from prj)
  union all select 13, 'tasks', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.tasks x where x.bid_project_id in (select id from prj)
  union all select 14, 'assignments', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.assignments x where x.bid_id in (select id from t)
  union all select 15, 'bid_watches', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_watches x where x.bid_id in (select id from t)
  union all select 16, 'kakao_send_claims', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.kakao_send_claims x where x.bid_id in (select id from t)
  union all select 17, 'notifications', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.notifications x where x.id in (select id from ntf)
  union all select 18, 'outbox_events', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.outbox_events x where x.id in (select id from obx)
  union all select 19, 'bid_opportunities', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_opportunities x where x.id in (select id from opp)
  union all select 20, 'opportunity_notice_links', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.opportunity_notice_links x where x.bid_id in (select id from t) or x.opportunity_id in (select id from opp)
  union all select 21, 'notice_match_candidates', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.notice_match_candidates x where x.left_bid_id in (select id from t) or x.right_bid_id in (select id from t)
  union all select 22, 'bid_notice_events', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_notice_events x where x.bid_id in (select id from t)
  union all select 23, 'bid_relevance_assessments', 'DELETE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.bid_relevance_assessments x where x.revision_id in (select id from rev)
  union all select 24, 'ingest_run_items', 'UPDATE_SET_NULL', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.ingest_run_items x where x.bid_id in (select id from t) or x.revision_id in (select id from rev)
  union all select 25, 'document_storage_objects', 'UPDATE_FENCE', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
  from public.document_storage_objects x where x.id in (select id from dso)
),
meta as (
  select 0 as ord, 'meta'::text as table_name, 'META'::text as action, (select count(*) from t) as row_count,
    jsonb_build_object(
      'targetIds', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from t),
      'tz', current_setting('TimeZone'),
      'generatedAt', now(),
      'database', current_database(),
      'schemaVersion', 'sol-demo-cleanup-backup/v1'
    )::text as rows_text
)
select ord, table_name, action, row_count, encode(sha256(convert_to(rows_text, 'UTF8')), 'hex') as sha256, rows_text
from (select * from meta union all select * from raw) q
-- where ord between 0 and 12   -- 잘리면 범위를 나눠 받는다
order by ord;
