-- 02b-backup-in-db.sql — 02 와 같은 백업을 운영 DB 안의 별도 스키마 표 하나로 남긴다. ⚠️ 운영 DB 에 쓴다(새 스키마·표 1개).
--
-- 언제: 02 결과(리허설 기준 약 2.2MB, 대부분 score_runs.input_snapshot — 가상 직원 명부 스냅샷이 들어 있다)를 MCP 응답으로 받지 않는다.
--   이 파일(DB 안 백업) + 로컬 pg_dump(DB 밖 사본)를 먼저 쓴다(summary.md 실행 순서 3).
--   백업이 DB 안에 있으면 03 이 v_expected 없이 이 표와 지금 행을 견주고(백업 뒤 바뀐 행이 있으면 중단), 04 도 짧은 SQL 로 복구한다.
--   DB 밖 사본은 이 표를 pg_dump --data-only --table=demo_cleanup_20261026.backup 으로 받는다(안 되면 summary.md 의 조각 SELECT).
-- 한 트랜잭션: begin … commit 으로 묶었다. 중간 문장이 하나라도 실패하면 스키마·표·권한 회수가 모두 되돌아간다(반쯤 적용되지 않는다).
--   psql 은 ON_ERROR_STOP 이 없어도 실패 뒤 문장이 모두 거절되고 commit 이 rollback 이 된다.
-- 노출: 새 스키마는 PostgREST 노출 스키마(public·graphql_public)가 아니다. public·anon·authenticated·service_role 의 스키마·표 권한을
--   모두 거두고 RLS 를 켠다(정책 없음). service_role 은 RLS 를 무시(BYPASSRLS)하므로 권한 자체를 거둔다.
--   커밋 전에 DO 블록이 네 역할의 권한을 다시 보고, 하나라도 남아 있으면 DC_BACKUP_EXPOSED 로 전체를 되돌린다.
-- 한 번만: 같은 이름 표가 있으면 create table 이 실패해 이전 백업을 덮어쓰지 않는다. 다 끝나 지울 때는 summary.md 의 정리 절.
-- 내용: 02 의 SELECT 와 글자까지 같다(build 스크립트가 02 에서 옮겼다). 열 ord·table_name·action·row_count·sha256·rows_text.
-- 끝의 확인 SELECT 두 개는 커밋 뒤에 돈다: 26행 sha_ok, 네 역할의 권한이 모두 false.

begin;
set local timezone to 'UTC';

create schema if not exists demo_cleanup_20261026;
revoke all on schema demo_cleanup_20261026 from public, anon, authenticated, service_role;

create table demo_cleanup_20261026.backup as
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
from (select * from meta union all select * from raw) q;

alter table demo_cleanup_20261026.backup add primary key (ord);
alter table demo_cleanup_20261026.backup enable row level security;
revoke all on table demo_cleanup_20261026.backup from public, anon, authenticated, service_role;
comment on table demo_cleanup_20261026.backup is 'DEMO 공고 19건 정리 전 백업(02-backup.sql 과 같은 형식). docs/evidence/demo-cleanup/20261026';

do $exposed$
begin
  if exists (
    select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
    where has_schema_privilege(r, 'demo_cleanup_20261026', 'USAGE')
       or has_schema_privilege(r, 'demo_cleanup_20261026', 'CREATE')
       or has_table_privilege(r, 'demo_cleanup_20261026.backup', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then
    raise exception 'DC_BACKUP_EXPOSED: 백업 스키마·표에 public·anon·authenticated·service_role 권한이 남아 있다 — 전체를 되돌린다';
  end if;
end
$exposed$;

commit;

-- 확인 1: 26행, sha_ok 모두 true. sha256 은 01 Q2 B 절과 같아야 한다.
select ord, table_name, action, row_count, sha256, octet_length(rows_text) as bytes,
  encode(sha256(convert_to(rows_text, 'UTF8')), 'hex') = sha256 as sha_ok
from demo_cleanup_20261026.backup order by ord;

-- 확인 2: 네 역할 모두 schema_usage·schema_create·table_any 가 false, rls 는 true 여야 한다.
select r as role,
  has_schema_privilege(r, 'demo_cleanup_20261026', 'USAGE') as schema_usage,
  has_schema_privilege(r, 'demo_cleanup_20261026', 'CREATE') as schema_create,
  has_table_privilege(r, 'demo_cleanup_20261026.backup', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as table_any,
  (select c.relrowsecurity from pg_class c where c.oid = 'demo_cleanup_20261026.backup'::regclass) as rls
from unnest(array['public', 'anon', 'authenticated', 'service_role']) r;
