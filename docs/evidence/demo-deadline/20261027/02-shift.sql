-- 02-shift.sql — DEMO 공고 16건의 마감을 +15일 옮긴다. ⚠️ DB 에 쓴다(사용자 승인 뒤, 01 Q2 A 절이 모두 ok 일 때만).
--
-- 바꾸는 것(두 가지뿐):
--   1. public.bid_notices.deadline_at                — 마감 있는 DEMO 공고 16건, + interval '15 days'
--   2. public.bid_revisions.normalized -> 'deadlineAt' — 같은 16건의 revision 1, 같은 순간의 글자(YYYY-MM-DDTHH:MI:SS.MSZ)
--   그 밖의 열·표(게시일·수집 시각·생성 시각·updated_at·checksum·분석 기록·결정 등)는 그대로 둔다(README "옮길 것·둘 것").
--   updated_at 을 그대로 두려고 이 트랜잭션 안에서만 bid_notices_touch_updated_at 트리거를 끈다(커밋 전 다시 켜고 확인한다).
--   deadline_at 만 고치므로 refresh_changed_bid_opportunity(status·stage·published_at·source·latest_revision 갱신 때만)는 돌지 않는다.
--
-- 대상: is_demo = true AND source = 'fixture' 인 공고 19건(아래 expected, 01 과 같은 목록)과 그 revision 19건. 마감 없는 3건은 기록만 한다.
--
-- 안전장치(하나라도 어긋나면 전체를 되돌린다 — 반쯤 적용되지 않는다):
--   DDS_ALREADY_APPLIED   기록 스키마 demo_deadline_shift_20261027 가 이미 있다(두 번 옮기지 않는다. 04 로 되돌린 뒤에도 남는다)
--   DDS_TARGET_MISMATCH   조건에 맞는 공고가 목록과 다르거나, 마감이 기존 값(seed 10-20 + 상대일)이 아니다
--   DDS_REVISION_MISMATCH revision 이 19건(모두 1차·latest)이 아니거나 normalized.deadlineAt 이 공고 마감과 다른 글자다
--   DDS_SHAPE             normalized 에 sourceMetadata 가 있거나 isDemo·noticeId 가 다르다(fixture v0.2 모양이 아니다)
--   DDS_LINK_FOREIGN      대상 사업기회에 대상 밖 공고가 묶여 있다
--   DDS_OVERRIDE_PRESENT  대상 입찰 프로젝트에 마감 덮어쓰기가 있다(옮길지 사람이 정한다)
--   DDS_TRIGGER           updated_at 트리거가 처음부터 꺼져 있었거나, 다시 켜지지 않았다
--   DDS_PRIVILEGE         실행 역할이 bid_notices 주인이 아니다(트리거를 못 끈다), bid_revisions UPDATE·DB CREATE 권한이 없다
--   DDS_UPDATE_COUNT      옮긴 행 수가 16·16 이 아니다
--   DDS_VERIFY            옮긴 뒤 행을 기존 값으로 되돌려 본 해시가 옮기기 전 해시와 다르다(다른 열이 바뀌었다)
--   DDS_COLLATERAL        같은 스냅샷에서 대상 밖 행(실공고·분석 기록·DEMO 사업기회·결정 등)의 해시가 달라졌다
--   DDS_LOG_EXPOSED       기록 스키마·표에 public·anon·authenticated·service_role 권한이 남았다
--   DRY_RUN_ROLLBACK      v_dry_run = true(기본값). 모든 확인을 통과했고 아무것도 남기지 않았다
--
-- 실행: begin … commit 을 한 번에 보낸다(MCP execute_sql 한 번, 또는 psql -v ON_ERROR_STOP=1 -f).
--   ① 먼저 그대로(v_dry_run = true) 돌려 DRY_RUN_ROLLBACK 이 나오는지 본다. ② 아래 v_dry_run 한 줄만 false 로 바꿔 다시 돌린다.
--   psql 은 ON_ERROR_STOP 이 없어도 실패 뒤 문장이 모두 거절되고 commit 이 rollback 이 된다.
--   repeatable read: 트랜잭션 전체가 한 스냅샷을 본다. 공고·revision 표는 share row exclusive 로 잠가 수집 worker 의 쓰기가
--   이 트랜잭션(1초 안팎)이 끝날 때까지 기다린다. 읽기는 막지 않는다. 5초 안에 잠그지 못하면 lock_timeout 으로 멈춘다(다시 돌리면 된다).
-- 커밋 뒤 끝의 SELECT 가 옮긴 결과를 보인다. 03-verify.sql 로 확인하고, 되돌리기는 04-rollback.sql 이다.

begin isolation level repeatable read;
set local timezone to 'UTC';
set local lock_timeout to '5s';
set local statement_timeout to '120s';
lock table public.bid_notices, public.bid_revisions in share row exclusive mode;

do $shift$
declare
  v_dry_run constant boolean := true;  -- ← 실제 적용 때만 false 로 바꾼다
  v_shift constant interval := interval '15 days';
  v_iso constant text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
  v_bad text;
  v_n integer;
  v_before jsonb;
  v_after jsonb;
begin
  -- ── 0. 한 번만 ─────────────────────────────────────────────
  if to_regnamespace('demo_deadline_shift_20261027') is not null then
    raise exception 'DDS_ALREADY_APPLIED: 기록 스키마 demo_deadline_shift_20261027 가 이미 있다. 다시 옮기지 않는다(03 으로 확인, 되돌리기는 04)';
  end if;

  -- 0-1. 실행 역할 권한(표를 읽기 전에 본다). 없으면 아래 alter table·create schema 가 어차피 실패해 전체가 되돌아가지만, 이유를 먼저 밝힌다
  if not (pg_has_role(current_user, (select relowner from pg_class where oid = 'public.bid_notices'::regclass), 'USAGE')
          and has_table_privilege(current_user, 'public.bid_revisions', 'UPDATE')
          and has_database_privilege(current_user, current_database(), 'CREATE')) then
    raise exception 'DDS_PRIVILEGE: 실행 역할 % 이 bid_notices 주인(%)의 권한이 없거나 bid_revisions UPDATE·DB CREATE 권한이 없다',
      current_user, (select relowner::regrole::text from pg_class where oid = 'public.bid_notices'::regclass);
  end if;

  -- ── 1. 대상 확인 ───────────────────────────────────────────
  create temp table dds_expected (
    fx text not null, notice_id text primary key, bid_id uuid not null unique,
    old_deadline timestamptz, new_deadline timestamptz, old_text text, new_text text
  ) on commit drop;
  insert into dds_expected (fx, notice_id, bid_id, old_deadline) values
    ('FX-01', 'DEMO-2026-0001', 'b9f00c0b-96e2-5949-9fc7-ef7bb7aea163', '2026-11-10T09:00:00Z'),
    ('FX-02', 'DEMO-2026-0002', '687bd892-941f-56a9-9ea9-9754ea5e5f1a', '2026-10-30T09:00:00Z'),
    ('FX-03', 'DEMO-2026-0003', 'dcb0a308-6f3b-5457-8d0a-fbdf4be684b9', '2026-11-04T09:00:00Z'),
    ('FX-04', 'DEMO-2026-0004', '9036e273-d51b-5090-8c89-53161dbb6714', '2026-11-01T09:00:00Z'),
    ('FX-05', 'DEMO-2026-0005', '4f552925-ef52-591d-b31e-a33cf6465668', '2026-11-09T09:00:00Z'),
    ('FX-06', 'DEMO-2026-0006', 'b7df7a25-d4e7-566b-86f3-f8ceaf474e08', '2026-11-03T09:00:00Z'),
    ('FX-07', 'DEMO-2026-0007', 'cbc1beaa-65c3-5446-b0bb-b39577a24dc5', '2026-11-07T09:00:00Z'),
    ('FX-08', 'DEMO-2026-0008', '1aca5230-53d0-58c9-93a1-5dab49a0c338', '2026-11-05T09:00:00Z'),
    ('FX-09', 'DEMO-2026-0009', '009a7aa0-10c9-54f0-8be4-f124dbebcfb1', '2026-11-14T09:00:00Z'),
    ('FX-10', 'DEMO-2026-0010', '0f43b834-130f-53d1-a075-26ef321b162f', '2026-11-03T09:00:00Z'),
    ('FX-11', 'DEMO-2026-0011', 'd6a7d9d4-f567-5226-a467-9986cf50e5b8', null),
    ('FX-13', 'DEMO-2026-0013', 'b432b15d-96d1-5ef1-bf42-30547dbc066e', '2026-11-08T09:00:00Z'),
    ('FX-14', 'DEMO-2026-0014', '29dc6ded-e564-5d29-82ec-ea9806ad48b1', '2026-10-22T09:00:00Z'),
    ('FX-15', 'DEMO-2026-0015', 'f66379fe-96c4-5ffc-a1c3-f36bad5c1299', '2026-11-19T09:00:00Z'),
    ('FX-16', 'DEMO-2026-0016', '9f10f9dc-7a52-5616-8bfd-b65d74285a9d', '2026-11-09T09:00:00Z'),
    ('FX-17', 'DEMO-2026-0017', '8db93cc7-fae2-557e-a8bc-ca4e5352e10c', null),
    ('FX-18', 'DEMO-2026-0018', '5f28b611-29d8-59fa-92eb-a0c453b91cd0', '2026-10-27T09:00:00Z'),
    ('FX-19', 'DEMO-2026-0019', 'f1b8fdee-7493-542e-b800-3a60b6ee7032', '2026-10-27T09:00:00Z'),
    ('FX-20', 'DEMO-2026-0020', '1cfcc05b-daaf-5a55-950c-ce2422b996b5', null);
  update dds_expected set
    new_deadline = old_deadline + v_shift,
    old_text = to_char(old_deadline at time zone 'UTC', v_iso),
    new_text = to_char((old_deadline + v_shift) at time zone 'UTC', v_iso);

  -- 1-1. 조건에 맞는 공고 = 목록, 마감 = 기존 값
  select string_agg(coalesce(e.fx, n.notice_id) || ':' ||
           case when e.bid_id is null then '조건에 맞지만 목록 밖'
                when n.id is null then '목록에 있지만 조건 밖·없음'
                when n.notice_id <> e.notice_id then '공고번호 다름'
                else '마감 ' || coalesce(n.deadline_at::text, 'null') || ' ≠ 기존 ' || coalesce(e.old_deadline::text, 'null') end,
         ', ' order by coalesce(e.fx, n.notice_id))
    into v_bad
  from dds_expected e
  full join (select * from public.bid_notices where is_demo = true and source = 'fixture') n on n.id = e.bid_id
  where e.bid_id is null or n.id is null or n.notice_id <> e.notice_id or n.deadline_at is distinct from e.old_deadline;
  if v_bad is not null then
    raise exception 'DDS_TARGET_MISMATCH: %', v_bad;
  end if;
  if (select count(*) from dds_expected where old_deadline is not null) <> 16 then
    raise exception 'DDS_TARGET_MISMATCH: 마감 있는 대상이 16건이 아니다';
  end if;

  -- 1-2. revision: 공고마다 revision 1 하나(latest_revision 1), normalized.deadlineAt = 기존 마감의 글자
  select count(*) into v_n from public.bid_revisions r join dds_expected e on e.bid_id = r.bid_id;
  if v_n <> 19 then
    raise exception 'DDS_REVISION_MISMATCH: 대상 revision 이 19건이 아니다(%건)', v_n;
  end if;
  select string_agg(e.fx, ', ' order by e.fx) into v_bad
  from dds_expected e
  join public.bid_notices n on n.id = e.bid_id
  left join public.bid_revisions r on r.bid_id = e.bid_id and r.revision = 1
  where n.latest_revision <> 1 or r.id is null or not (r.normalized ? 'deadlineAt')
     or (r.normalized ->> 'deadlineAt') is distinct from e.old_text;
  if v_bad is not null then
    raise exception 'DDS_REVISION_MISMATCH: revision 1·latest_revision·normalized.deadlineAt 가 다른 대상: %', v_bad;
  end if;
  select string_agg(e.fx, ', ' order by e.fx) into v_bad
  from dds_expected e join public.bid_revisions r on r.bid_id = e.bid_id
  where r.normalized ? 'sourceMetadata' or (r.normalized ->> 'isDemo') is distinct from 'true'
     or (r.normalized ->> 'noticeId') is distinct from e.notice_id or (r.normalized ->> 'source') is distinct from 'fixture';
  if v_bad is not null then
    raise exception 'DDS_SHAPE: normalized 모양이 fixture v0.2 가 아닌 대상: %', v_bad;
  end if;

  -- 1-3. 사업기회: 대상 공고의 사업기회에 대상 밖 공고가 없어야 한다(같이 옮기지 않으면 source_conflict 가 생긴다)
  select string_agg(l.bid_id::text, ', ') into v_bad
  from public.opportunity_notice_links l
  where l.opportunity_id in (select x.opportunity_id from public.opportunity_notice_links x join dds_expected e on e.bid_id = x.bid_id)
    and l.bid_id not in (select bid_id from dds_expected);
  if v_bad is not null then
    raise exception 'DDS_LINK_FOREIGN: 대상 사업기회에 묶인 대상 밖 공고: %', v_bad;
  end if;

  -- 1-4. 입찰 프로젝트 마감 덮어쓰기
  if exists (select 1 from public.bid_projects p join dds_expected e on e.bid_id = p.bid_id where p.submission_due_override is not null) then
    raise exception 'DDS_OVERRIDE_PRESENT: 대상 입찰 프로젝트에 submission_due_override 가 있다. 같이 옮길지 사람이 정한다';
  end if;

  -- 1-5. 트리거가 켜져 있는지(끄고 켜는 것을 이 트랜잭션이 책임진다)
  if coalesce((select tgenabled from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), 'x') <> 'O' then
    raise exception 'DDS_TRIGGER: bid_notices_touch_updated_at 가 켜져 있지 않다(시작 전)';
  end if;

  -- ── 2. 기록 스키마(되돌리기·두 번 막기·03 확인의 근거) ────────
  create schema demo_deadline_shift_20261027;
  revoke all on schema demo_deadline_shift_20261027 from public, anon, authenticated, service_role;
  comment on schema demo_deadline_shift_20261027 is 'DEMO 공고 마감 +15일 이동 기록. docs/evidence/demo-deadline/20261027';

  create table demo_deadline_shift_20261027.meta (
    id smallint primary key check (id = 1),
    applied_at timestamptz not null,
    shift interval not null,
    rolled_back_at timestamptz,
    before_sets jsonb not null,
    after_sets jsonb,
    note text not null
  );
  create table demo_deadline_shift_20261027.notice_log (
    bid_id uuid primary key,
    fx text not null,
    notice_id text not null,
    old_deadline_at timestamptz,
    new_deadline_at timestamptz,
    updated_at timestamptz not null,
    old_row_sha256 text not null,
    new_row_sha256 text
  );
  create table demo_deadline_shift_20261027.revision_log (
    revision_id uuid primary key,
    bid_id uuid not null,
    fx text not null,
    old_deadline_text text,
    new_deadline_text text,
    old_row_sha256 text not null,
    new_row_sha256 text
  );
  -- 대상 밖 행의 적용 시점 해시. 03 이 "그대로·적용 뒤 수집이 바꿈·없어짐·새로 생김"으로 나눈다(수집 worker 가 계속 돈다).
  create table demo_deadline_shift_20261027.guard_rows (
    tbl text not null,
    row_id uuid not null,
    row_sha256 text not null,
    marker text,
    primary key (tbl, row_id)
  );

  -- 2-1. 대상 행 기록(옮기기 전 행 전체의 해시)
  insert into demo_deadline_shift_20261027.notice_log (bid_id, fx, notice_id, old_deadline_at, new_deadline_at, updated_at, old_row_sha256)
  select n.id, e.fx, n.notice_id, e.old_deadline, e.new_deadline, n.updated_at,
         encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex')
  from public.bid_notices n join dds_expected e on e.bid_id = n.id;
  insert into demo_deadline_shift_20261027.revision_log (revision_id, bid_id, fx, old_deadline_text, new_deadline_text, old_row_sha256)
  select r.id, r.bid_id, e.fx, e.old_text, e.new_text, encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')
  from public.bid_revisions r join dds_expected e on e.bid_id = r.bid_id;

  -- 2-2. 대상 밖 행(실공고·그 revision·모든 비대상 분석 기록과 추출)
  insert into demo_deadline_shift_20261027.guard_rows (tbl, row_id, row_sha256, marker)
  select 'bid_notices', n.id, encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex'), n.updated_at::text
  from public.bid_notices n where n.id not in (select bid_id from dds_expected);
  insert into demo_deadline_shift_20261027.guard_rows (tbl, row_id, row_sha256, marker)
  select 'bid_revisions', r.id, encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex'), null
  from public.bid_revisions r where r.bid_id not in (select bid_id from dds_expected);
  insert into demo_deadline_shift_20261027.guard_rows (tbl, row_id, row_sha256, marker)
  select 'score_runs', s.id, encode(sha256(convert_to(to_jsonb(s)::text, 'UTF8')), 'hex'), s.status
  from public.score_runs s where s.bid_id not in (select bid_id from dds_expected);
  insert into demo_deadline_shift_20261027.guard_rows (tbl, row_id, row_sha256, marker)
  select 'requirement_extractions', x.id, encode(sha256(convert_to(to_jsonb(x)::text, 'UTF8')), 'hex'), x.status
  from public.requirement_extractions x where x.bid_id not in (select bid_id from dds_expected);

  -- 2-3. 표 묶음 해시(01 Q2 B 절과 같은 식). 같은 스냅샷에서 옮긴 뒤 다시 재서 비교한다.
  --      dds_* 는 바뀌면 안 되는 묶음, target_* 는 옮기는 두 표(01 B 절·04 복구 확인과 같은 값).
  select jsonb_object_agg(item, jsonb_build_object('rows', cnt, 'sha256', encode(sha256(convert_to(txt, 'UTF8')), 'hex')))
    into v_before
  from (
    select 'target_bid_notices' as item, count(*) as cnt, coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text as txt
      from public.bid_notices x where x.id in (select bid_id from dds_expected)
    union all select 'target_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_revisions x where x.bid_id in (select bid_id from dds_expected)
    union all select 'other_bid_notices', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_notices x where x.id not in (select bid_id from dds_expected)
    union all select 'other_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_revisions x where x.bid_id not in (select bid_id from dds_expected)
    union all select 'all_bid_opportunities', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_opportunities x
    union all select 'all_opportunity_notice_links', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.opportunity_notice_links x
    union all select 'all_score_runs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.score_runs x
    union all select 'all_score_factors', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.score_factors x
    union all select 'all_requirement_extractions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.requirement_extractions x
    union all select 'all_bid_reviews', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_reviews x
    union all select 'all_bid_documents', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_documents x
    union all select 'all_bid_projects', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_projects x
    union all select 'all_outbox_events', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.outbox_events x
    union all select 'all_notifications', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.notifications x
    union all select 'all_audit_logs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.audit_logs x
  ) s;

  insert into demo_deadline_shift_20261027.meta (id, applied_at, shift, before_sets, note)
  values (1, now(), v_shift, v_before,
    'DEMO 공고(is_demo AND fixture) 16건 bid_notices.deadline_at·bid_revisions.normalized.deadlineAt +15일. 발표 2026-11-04 기준. 되돌리기 04-rollback.sql');

  -- ── 3. 옮기기 ──────────────────────────────────────────────
  alter table public.bid_notices disable trigger bid_notices_touch_updated_at;

  update public.bid_notices n
     set deadline_at = e.new_deadline
    from dds_expected e
   where n.id = e.bid_id and e.old_deadline is not null and n.deadline_at = e.old_deadline;
  get diagnostics v_n = row_count;
  if v_n <> 16 then
    raise exception 'DDS_UPDATE_COUNT: bid_notices % 건(기대 16)', v_n;
  end if;

  update public.bid_revisions r
     set normalized = jsonb_set(r.normalized, '{deadlineAt}', to_jsonb(e.new_text))
    from dds_expected e
   where r.bid_id = e.bid_id and r.revision = 1 and e.old_text is not null and r.normalized ->> 'deadlineAt' = e.old_text;
  get diagnostics v_n = row_count;
  if v_n <> 16 then
    raise exception 'DDS_UPDATE_COUNT: bid_revisions % 건(기대 16)', v_n;
  end if;

  alter table public.bid_notices enable trigger bid_notices_touch_updated_at;
  if coalesce((select tgenabled from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), 'x') <> 'O' then
    raise exception 'DDS_TRIGGER: bid_notices_touch_updated_at 가 다시 켜지지 않았다';
  end if;

  -- ── 4. 확인(같은 트랜잭션·같은 스냅샷) ──────────────────────
  -- 4-1. 새 값과 "옮긴 열만 기존 값으로 되돌린 행 해시 = 옮기기 전 해시"(다른 열이 하나도 안 바뀌었다)
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.notice_log l join public.bid_notices n on n.id = l.bid_id
  where n.deadline_at is distinct from l.new_deadline_at
     or n.updated_at <> l.updated_at
     or encode(sha256(convert_to((to_jsonb(n) || jsonb_build_object('deadline_at', l.old_deadline_at))::text, 'UTF8')), 'hex') <> l.old_row_sha256;
  if v_bad is not null then
    raise exception 'DDS_VERIFY: bid_notices 확인 실패: %', v_bad;
  end if;
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.revision_log l join public.bid_revisions r on r.id = l.revision_id
  where (r.normalized ->> 'deadlineAt') is distinct from l.new_deadline_text
     or encode(sha256(convert_to(
          (case when l.old_deadline_text is null then to_jsonb(r)
                else jsonb_set(to_jsonb(r), '{normalized,deadlineAt}', to_jsonb(l.old_deadline_text)) end)::text, 'UTF8')), 'hex') <> l.old_row_sha256;
  if v_bad is not null then
    raise exception 'DDS_VERIFY: bid_revisions 확인 실패: %', v_bad;
  end if;

  update demo_deadline_shift_20261027.notice_log l
     set new_row_sha256 = encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex')
    from public.bid_notices n where n.id = l.bid_id;
  update demo_deadline_shift_20261027.revision_log l
     set new_row_sha256 = encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')
    from public.bid_revisions r where r.id = l.revision_id;

  -- 4-2. 바뀌면 안 되는 묶음이 그대로인지
  select jsonb_object_agg(item, jsonb_build_object('rows', cnt, 'sha256', encode(sha256(convert_to(txt, 'UTF8')), 'hex')))
    into v_after
  from (
    select 'target_bid_notices' as item, count(*) as cnt, coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text as txt
      from public.bid_notices x where x.id in (select bid_id from dds_expected)
    union all select 'target_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_revisions x where x.bid_id in (select bid_id from dds_expected)
    union all select 'other_bid_notices', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_notices x where x.id not in (select bid_id from dds_expected)
    union all select 'other_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_revisions x where x.bid_id not in (select bid_id from dds_expected)
    union all select 'all_bid_opportunities', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_opportunities x
    union all select 'all_opportunity_notice_links', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.opportunity_notice_links x
    union all select 'all_score_runs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.score_runs x
    union all select 'all_score_factors', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.score_factors x
    union all select 'all_requirement_extractions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.requirement_extractions x
    union all select 'all_bid_reviews', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_reviews x
    union all select 'all_bid_documents', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_documents x
    union all select 'all_bid_projects', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_projects x
    union all select 'all_outbox_events', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.outbox_events x
    union all select 'all_notifications', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.notifications x
    union all select 'all_audit_logs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.audit_logs x
  ) s;
  select string_agg(k, ', ' order by k) into v_bad
  from jsonb_object_keys(v_before) k
  where k not like 'target_%' and v_before -> k is distinct from v_after -> k;
  if v_bad is not null then
    raise exception 'DDS_COLLATERAL: 대상 밖 묶음이 바뀌었다: %', v_bad;
  end if;
  if (v_before #>> '{target_bid_notices,rows}') <> '19' or (v_after #>> '{target_bid_notices,rows}') <> '19'
     or (v_before #>> '{target_bid_revisions,rows}') <> '19' or (v_after #>> '{target_bid_revisions,rows}') <> '19' then
    raise exception 'DDS_VERIFY: 대상 표 행 수가 19·19 가 아니다';
  end if;
  update demo_deadline_shift_20261027.meta set after_sets = v_after where id = 1;

  -- ── 5. 기록 스키마 잠그기 ──────────────────────────────────
  alter table demo_deadline_shift_20261027.meta enable row level security;
  alter table demo_deadline_shift_20261027.notice_log enable row level security;
  alter table demo_deadline_shift_20261027.revision_log enable row level security;
  alter table demo_deadline_shift_20261027.guard_rows enable row level security;
  revoke all on all tables in schema demo_deadline_shift_20261027 from public, anon, authenticated, service_role;
  if exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
    cross join (values ('meta'), ('notice_log'), ('revision_log'), ('guard_rows')) t(name)
    where has_schema_privilege(r, 'demo_deadline_shift_20261027', 'USAGE')
       or has_schema_privilege(r, 'demo_deadline_shift_20261027', 'CREATE')
       or has_table_privilege(r, 'demo_deadline_shift_20261027.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then
    raise exception 'DDS_LOG_EXPOSED: 기록 스키마·표에 public·anon·authenticated·service_role 권한이 남아 있다';
  end if;

  if v_dry_run then
    raise exception 'DRY_RUN_ROLLBACK: 모든 확인 통과(공고 16·revision 16 옮김 확인, 대상 밖 묶음 % 개 그대로). v_dry_run = false 로 다시 돌린다',
      (select count(*) from jsonb_object_keys(v_before) k where k not like 'target_%');
  end if;
  raise notice 'DDS_DONE: 공고 16·revision 16 마감 +15일. 대상 밖 묶음 그대로';
end
$shift$;

commit;

-- set local 은 커밋과 함께 풀린다. 아래 해시·시각 표시가 02·03 과 같은 시간대(UTC)로 계산되게 세션 값을 다시 둔다.
set timezone to 'UTC';

-- 커밋 뒤 결과(실패했으면 기록 스키마가 없어 이 SELECT 도 실패한다 — 그것이 "적용 안 됨"의 표시다)
select l.fx, l.notice_id, l.old_deadline_at, l.new_deadline_at, n.deadline_at as current_deadline_at,
  to_char(n.deadline_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as current_deadline_kst,
  r.normalized ->> 'deadlineAt' as current_rev_deadline,
  (n.deadline_at is not distinct from l.new_deadline_at and (r.normalized ->> 'deadlineAt') is not distinct from rl.new_deadline_text) as ok
from demo_deadline_shift_20261027.notice_log l
join public.bid_notices n on n.id = l.bid_id
join demo_deadline_shift_20261027.revision_log rl on rl.bid_id = l.bid_id
join public.bid_revisions r on r.id = rl.revision_id
order by l.fx;
