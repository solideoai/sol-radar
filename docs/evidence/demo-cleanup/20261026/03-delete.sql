-- 03-delete.sql — DEMO 공고 19건과 딸린 행을 한 트랜잭션으로 지운다. ⚠️ 운영 DB 를 바꾼다(v_dry_run := false 일 때).
--
-- 문장 하나(DO 블록)라 어느 클라이언트(MCP execute_sql·psql·SQL 편집기)에서 돌려도 한 트랜잭션이다. 어느 검사든 어긋나면
-- RAISE EXCEPTION 으로 전체가 되돌아간다. 실행 순서:
--   0. 실행 전에 아래 "채우는 값" 세 개를 정한다.
--      v_dry_run  : true 면 끝까지 실행한 뒤 'DRY_RUN_ROLLBACK' 오류로 전부 되돌린다(오류 detail 에 결과 요약). false 면 커밋.
--      v_expected : 02 결과의 표별 {"row_count":…, "sha256":…}. null 이면 02b 의 백업 표(demo_cleanup_20261026.backup)에서 읽는다.
--                   백업한 그 순간과 지금 행이 하나라도 다르면(그 사이 누가 관심 등록·분석 등) 중단한다 → 02 를 다시 받는다.
--      v_target   : 대상 공고 id 19개(01 Q1 과 같아야 한다).
--   1. 대상 확인: 목록 19건 = is_demo AND source='fixture' 공고 전체, 대상 공고 행 잠금(FOR UPDATE — 그 사이 새 자식 행이 못 붙는다).
--      이어서 범위 표 25개의 대상 행을 모두 FOR UPDATE 로 잠근다(score_runs·bid_documents 포함). 차단 검사보다 먼저 잠가서,
--      C50(진행 중 run)·C51(처리 중 첨부)을 본 뒤에 worker 가 그 행을 바꾸지 못하게 한다.
--   2. 차단 검사(01 Q2 C 절과 같은 번호 C41~C57).
--   3. 표별 행 수·sha256 = v_expected.
--   4. 보존 표 행 수를 적어 둔다.
--   5. 자식부터 명시적으로 지운다. FK CASCADE 에 맡기지 않는 이유: 표마다 지운 행 수를 기대값과 견주고, 기대하지 않은 연쇄 삭제가
--      없었음을 끝에서 보이려고. FK 는 그대로 살아 있어서(트리거·제약을 끄지 않는다) 순서가 틀리면 DB 가 거절한다.
--      예외 두 가지: ingest_run_items 는 지우지 않고 bid_id·revision_id 만 비운다(FK 의 SET NULL 과 같은 결과, 수집 이력 보존.
--      그 항목의 run 이 fixture 가 아니면 C57 이 먼저 막는다),
--      tasks(입찰 프로젝트 체크리스트)는 tasks_log_activity 트리거를 이 트랜잭션 안에서만 끄고 지운다(팀 활동 피드에 "작업 삭제"를
--      남기지 않는다. 끄기는 커밋·롤백과 함께 끝나고, 아래에서 다시 켠 것까지 확인한다).
--   6. Storage 원장(document_storage_objects) 중 지운 첨부가 가리키던 행의 lease_until 을 infinity 로 둔다. worker 의 정리 job
--      (10분마다 document_storage_candidates → 참조 없는 객체 삭제)이 원본·텍스트 객체를 지우지 못하게 막는 것이다. 객체와 원장 행은
--      남는다. 04 가 원래 값으로 되돌린다. 정리를 확정해 객체를 지울 때는 summary.md 의 "보호 풀기"를 따른다.
--   7. 사후 검사: 범위 안 행 0, 보존 표 행 수 그대로(tasks 는 지운 수만큼 감소), 트리거 다시 켜짐.
--      FK 가 없는 notifications·outbox_events 는 시작 때 굳힌 id 목록이 아니라 조건(payload.bidId·aggregate_id)으로 다시 센다.
--      실행 중 다른 세션이 대상 공고를 가리키는 알림·outbox 를 새로 커밋했으면 여기서 멈춘다(그 행은 고아로 남을 것이었다).
--
-- 지우지 않는 것: audit_logs(감사, append-only), activities, ingest_runs·ingest_errors·ingest_payloads(fixture run 포함),
-- 조직·계정·멤버십·회사 프로필·가상 직원 200명·명부, is_demo=false 공고 전부, Storage 객체.
-- 권한: public 표의 주인(postgres)으로 돈다(ALTER TABLE … DISABLE TRIGGER 에 주인 권한이 필요하다).

do $cleanup$
declare
  -- ▼▼▼ 채우는 값 ▼▼▼
  v_dry_run boolean := true;
  v_expected jsonb := null;
  v_target uuid[] := array[
    'b9f00c0b-96e2-5949-9fc7-ef7bb7aea163', '687bd892-941f-56a9-9ea9-9754ea5e5f1a', 'dcb0a308-6f3b-5457-8d0a-fbdf4be684b9',
    '9036e273-d51b-5090-8c89-53161dbb6714', '4f552925-ef52-591d-b31e-a33cf6465668', 'b7df7a25-d4e7-566b-86f3-f8ceaf474e08',
    'cbc1beaa-65c3-5446-b0bb-b39577a24dc5', '1aca5230-53d0-58c9-93a1-5dab49a0c338', '009a7aa0-10c9-54f0-8be4-f124dbebcfb1',
    '0f43b834-130f-53d1-a075-26ef321b162f', 'd6a7d9d4-f567-5226-a467-9986cf50e5b8', 'b432b15d-96d1-5ef1-bf42-30547dbc066e',
    '29dc6ded-e564-5d29-82ec-ea9806ad48b1', 'f66379fe-96c4-5ffc-a1c3-f36bad5c1299', '9f10f9dc-7a52-5616-8bfd-b65d74285a9d',
    '8db93cc7-fae2-557e-a8bc-ca4e5352e10c', '5f28b611-29d8-59fa-92eb-a0c453b91cd0', 'f1b8fdee-7493-542e-b800-3a60b6ee7032',
    '1cfcc05b-daaf-5a55-950c-ce2422b996b5'
  ]::uuid[];
  -- ▲▲▲
  r record;
  v_count bigint;
  v_sha text;
  v_n bigint;
  v_bad text[] := '{}';
  v_actual jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_tasks bigint;
  v_summary jsonb;
begin
  perform set_config('TimeZone', 'UTC', true);
  perform set_config('lock_timeout', '10s', true);

  -- ── 0. 기대값 ────────────────────────────────────────────────
  if v_expected is null then
    if to_regclass('demo_cleanup_20261026.backup') is null then
      raise exception 'DC_NO_EXPECTED: v_expected 가 비었고 백업 표 demo_cleanup_20261026.backup 도 없다(02 결과를 넣거나 02b 를 먼저 돌린다)';
    end if;
    execute $q$select jsonb_object_agg(table_name, jsonb_build_object('row_count', row_count, 'sha256', sha256))
      from demo_cleanup_20261026.backup where table_name <> 'meta'$q$ into v_expected;
    execute $q$select (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(rows_text::jsonb -> 'targetIds') x)
      from demo_cleanup_20261026.backup where table_name = 'meta'$q$ into v_actual;
    if v_actual is distinct from (select jsonb_agg(x::text order by x::text) from unnest(v_target) x) then
      raise exception 'DC_BACKUP_TARGET_MISMATCH: 백업 표의 대상 id 와 v_target 이 다르다';
    end if;
    v_actual := '{}'::jsonb;
  end if;

  -- ── 1. 대상 확인·잠금 ───────────────────────────────────────
  if cardinality(v_target) <> 19 or (select count(distinct x) from unnest(v_target) x) <> 19 then
    raise exception 'DC_TARGET_LIST: 대상 id 는 서로 다른 19개여야 한다(지금 %)', cardinality(v_target);
  end if;
  create temp table _dc_t on commit drop as
    select n.id from public.bid_notices n where n.id = any(v_target) and n.is_demo = true and n.source = 'fixture';
  if (select count(*) from pg_temp._dc_t) <> 19 then
    raise exception 'DC_TARGET_COUNT: 목록 중 is_demo AND fixture 공고가 % 건이다(기대 19)', (select count(*) from pg_temp._dc_t);
  end if;
  if exists (select 1 from public.bid_notices n where n.is_demo = true and n.source = 'fixture' and n.id <> all(v_target)) then
    raise exception 'DC_TARGET_EXTRA: 목록 밖의 is_demo AND fixture 공고가 있다(01 Q1 로 목록을 다시 정한다)';
  end if;
  perform 1 from public.bid_notices n where n.id in (select id from pg_temp._dc_t) order by n.id for update;

  -- 범위 집합(지우기 전에 한 번 굳힌다). 정의는 01 Q2 의 CTE 와 같다.
  create temp table _dc_rev on commit drop as select rv.id from public.bid_revisions rv where rv.bid_id in (select id from pg_temp._dc_t);
  create temp table _dc_run on commit drop as select s.id from public.score_runs s where s.bid_id in (select id from pg_temp._dc_t);
  create temp table _dc_ext on commit drop as select e.id from public.requirement_extractions e where e.bid_id in (select id from pg_temp._dc_t);
  create temp table _dc_rvw on commit drop as select rw.id from public.bid_reviews rw where rw.bid_id in (select id from pg_temp._dc_t);
  create temp table _dc_prj on commit drop as select p.id from public.bid_projects p where p.bid_id in (select id from pg_temp._dc_t);
  create temp table _dc_opp on commit drop as select o.id from public.bid_opportunities o where o.canonical_notice_id in (select id from pg_temp._dc_t);
  create temp table _dc_ntf on commit drop as
    select n.id from public.notifications n where n.payload ->> 'bidId' in (select id::text from pg_temp._dc_t);
  create temp table _dc_obx on commit drop as
    select e.id from public.outbox_events e
    where e.aggregate_id in (select id from pg_temp._dc_t union all select id from pg_temp._dc_run
                             union all select id from pg_temp._dc_rvw union all select id from pg_temp._dc_prj)
       or e.payload ->> 'bidId' in (select id::text from pg_temp._dc_t);
  create temp table _dc_dso on commit drop as
    select d.raw_storage_id as id from public.bid_documents d where d.bid_id in (select id from pg_temp._dc_t) and d.raw_storage_id is not null
    union
    select d.parsed_storage_id from public.bid_documents d where d.bid_id in (select id from pg_temp._dc_t) and d.parsed_storage_id is not null;

  -- 표·조건·지우는 순서. sha 순서(ord)는 01 B 절과 같고, del 은 FK 를 따른 처리 순서다.
  -- post 는 7 사후 검사에서 pred 대신 쓰는 조건이다(null 이면 pred). FK 가 없는 두 표만 굳힌 id 목록이 아니라 조건으로 센다.
  create temp table _dc_scope (ord int, tbl text, action text, pred text, del int, post text) on commit drop;
  insert into pg_temp._dc_scope values
    (1, 'bid_notices', 'DELETE', 'x.id in (select id from pg_temp._dc_t)', 24, null),
    (2, 'bid_revisions', 'DELETE', 'x.id in (select id from pg_temp._dc_rev)', 23, null),
    (3, 'bid_documents', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 16, null),
    (4, 'bid_structured_requirements', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 15, null),
    (5, 'requirement_extractions', 'DELETE', 'x.id in (select id from pg_temp._dc_ext)', 12, null),
    (6, 'score_runs', 'DELETE', 'x.id in (select id from pg_temp._dc_run)', 11, null),
    (7, 'score_factors', 'DELETE', 'x.score_run_id in (select id from pg_temp._dc_run)', 8, null),
    (8, 'qualification_checks', 'DELETE', 'x.score_run_id in (select id from pg_temp._dc_run) or x.bid_id in (select id from pg_temp._dc_t)', 10, null),
    (9, 'requirement_assessments', 'DELETE', 'x.score_run_id in (select id from pg_temp._dc_run)', 9, null),
    (10, 'bid_reviews', 'DELETE', 'x.id in (select id from pg_temp._dc_rvw)', 7, null),
    (11, 'bid_projects', 'DELETE', 'x.id in (select id from pg_temp._dc_prj)', 6, null),
    (12, 'bid_project_events', 'DELETE', 'x.bid_project_id in (select id from pg_temp._dc_prj)', 5, null),
    (13, 'tasks', 'DELETE', 'x.bid_project_id in (select id from pg_temp._dc_prj)', 4, null),
    (14, 'assignments', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 13, null),
    (15, 'bid_watches', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 14, null),
    (16, 'kakao_send_claims', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 1, null),
    (17, 'notifications', 'DELETE', 'x.id in (select id from pg_temp._dc_ntf)', 2,
      'x.payload ->> ''bidId'' in (select id::text from pg_temp._dc_t)'),
    (18, 'outbox_events', 'DELETE', 'x.id in (select id from pg_temp._dc_obx)', 3,
      'x.aggregate_id in (select id from pg_temp._dc_t union all select id from pg_temp._dc_run union all select id from pg_temp._dc_rvw '
      'union all select id from pg_temp._dc_prj) or x.payload ->> ''bidId'' in (select id::text from pg_temp._dc_t)'),
    (19, 'bid_opportunities', 'DELETE', 'x.id in (select id from pg_temp._dc_opp)', 21, null),
    (20, 'opportunity_notice_links', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t) or x.opportunity_id in (select id from pg_temp._dc_opp)', 20, null),
    (21, 'notice_match_candidates', 'DELETE', 'x.left_bid_id in (select id from pg_temp._dc_t) or x.right_bid_id in (select id from pg_temp._dc_t)', 19, null),
    (22, 'bid_notice_events', 'DELETE', 'x.bid_id in (select id from pg_temp._dc_t)', 18, null),
    (23, 'bid_relevance_assessments', 'DELETE', 'x.revision_id in (select id from pg_temp._dc_rev)', 17, null),
    (24, 'ingest_run_items', 'UPDATE_SET_NULL', 'x.bid_id in (select id from pg_temp._dc_t) or x.revision_id in (select id from pg_temp._dc_rev)', 22, null),
    (25, 'document_storage_objects', 'UPDATE_FENCE', 'x.id in (select id from pg_temp._dc_dso)', 25, null);

  -- 범위 행을 차단 검사보다 먼저 잠근다(score_runs·bid_documents 포함). 그래야 C50·C51 이 본 상태와 지우는 순간의 상태가 같고,
  -- 확인한 행과 지우는 행이 같다(그 사이 worker 가 run 상태·첨부 lease·outbox 상태를 바꾸는 등의 변경을 막는다).
  for r in select * from pg_temp._dc_scope order by ord loop
    execute format('select count(*) from (select 1 from public.%I x where %s for update) s', r.tbl, r.pred) into v_n;
  end loop;

  -- ── 2. 차단 검사(01 Q2 C 절) ────────────────────────────────
  for r in select * from (values
    ('C41 bid_notice_events.related_bid_id', 'select count(*) from public.bid_notice_events e where e.related_bid_id in (select id from pg_temp._dc_t) and e.bid_id not in (select id from pg_temp._dc_t)'),
    ('C42 bid_opportunities.superseded_by', 'select count(*) from public.bid_opportunities o where o.superseded_by in (select id from pg_temp._dc_opp) and o.id not in (select id from pg_temp._dc_opp)'),
    ('C43 bid_projects.opened_by_review', 'select count(*) from public.bid_projects p where p.opened_by_review_id in (select id from pg_temp._dc_rvw) and p.id not in (select id from pg_temp._dc_prj)'),
    ('C44 보존 공고→대상 기회 연결', 'select count(*) from public.opportunity_notice_links k where k.opportunity_id in (select id from pg_temp._dc_opp) and k.bid_id not in (select id from pg_temp._dc_t)'),
    ('C45 대상 공고→보존 기회 연결', 'select count(*) from public.opportunity_notice_links k where k.bid_id in (select id from pg_temp._dc_t) and k.opportunity_id not in (select id from pg_temp._dc_opp)'),
    ('C46 대상-보존 중복 후보', 'select count(*) from public.notice_match_candidates m where (m.left_bid_id in (select id from pg_temp._dc_t)) <> (m.right_bid_id in (select id from pg_temp._dc_t))'),
    ('C47 보존 결정→대상 run', 'select count(*) from public.bid_reviews r where r.score_run_id in (select id from pg_temp._dc_run) and r.id not in (select id from pg_temp._dc_rvw)'),
    ('C48 보존 run→대상 추출', 'select count(*) from public.score_runs s where s.extraction_id in (select id from pg_temp._dc_ext) and s.id not in (select id from pg_temp._dc_run)'),
    ('C49 보존 claim→지울 알림·outbox', 'select count(*) from public.kakao_send_claims k where (k.bid_id is null or k.bid_id not in (select id from pg_temp._dc_t)) and (k.notification_id in (select id from pg_temp._dc_ntf) or k.outbox_event_id in (select id from pg_temp._dc_obx))'),
    ('C50 진행 중 run', 'select count(*) from public.score_runs s where s.id in (select id from pg_temp._dc_run) and s.status in (''QUEUED'', ''RUNNING'')'),
    ('C51 처리 중 첨부', 'select count(*) from public.bid_documents d where d.bid_id in (select id from pg_temp._dc_t) and d.processing_lease_until > now()'),
    ('C52 NOT VALID 검사 위반 run', 'select count(*) from public.score_runs s where s.id in (select id from pg_temp._dc_run) and not (s.idempotency_key is null or starts_with(s.idempotency_key, s.org_id::text || '':''))'),
    ('C53 Storage 원장 공유', 'select count(*) from public.bid_documents d where d.bid_id not in (select id from pg_temp._dc_t) and (d.raw_storage_id in (select id from pg_temp._dc_dso) or d.parsed_storage_id in (select id from pg_temp._dc_dso))'),
    ('C54 Storage 원장 STORED 아님', 'select count(*) from public.document_storage_objects o where o.id in (select id from pg_temp._dc_dso) and o.status <> ''STORED'''),
    ('C55 모르는 FK', $q$select count(*) from pg_constraint c join pg_class p on p.oid = c.confrelid join pg_class ch on ch.oid = c.conrelid
       where c.contype = 'f' and p.relnamespace = 'public'::regnamespace and p.relname::text in (select tbl from pg_temp._dc_scope)
         and (ch.relname::text || '.' || c.conname::text) <> all(array[
           'bid_documents.bid_documents_revision_fkey', 'score_factors.score_factors_score_run_fkey', 'bid_revisions.bid_revisions_bid_id_fkey',
           'bid_documents.bid_documents_bid_id_fkey', 'bid_structured_requirements.bid_structured_requirements_bid_id_fkey',
           'bid_structured_requirements.bid_structured_requirements_revision_fkey', 'requirement_extractions.requirement_extractions_bid_id_fkey',
           'requirement_extractions.requirement_extractions_revision_fkey', 'score_runs.score_runs_bid_id_fkey', 'score_runs.score_runs_extraction_id_fkey',
           'score_runs.score_runs_revision_fkey', 'qualification_checks.qualification_checks_bid_id_fkey',
           'qualification_checks.qualification_checks_score_run_fkey', 'qualification_checks.qualification_checks_revision_fkey',
           'requirement_assessments.requirement_assessments_score_run_fkey', 'assignments.assignments_bid_id_fkey', 'bid_reviews.bid_reviews_bid_id_fkey',
           'bid_reviews.bid_reviews_revision_fkey', 'bid_reviews.bid_reviews_score_run_fkey', 'bid_documents.bid_documents_raw_storage_fk',
           'bid_documents.bid_documents_parsed_storage_fk', 'bid_watches.bid_watches_bid_id_fkey', 'bid_projects.bid_projects_bid_id_fkey',
           'bid_projects.bid_projects_opened_by_review_fkey', 'bid_project_events.bid_project_events_project_fkey', 'tasks.tasks_bid_project_fkey',
           'bid_opportunities.bid_opportunities_canonical_notice_id_fkey', 'bid_opportunities.bid_opportunities_superseded_by_fkey',
           'opportunity_notice_links.opportunity_notice_links_bid_id_fkey', 'opportunity_notice_links.opportunity_notice_links_opportunity_id_fkey',
           'notice_match_candidates.notice_match_candidates_left_bid_id_fkey', 'notice_match_candidates.notice_match_candidates_right_bid_id_fkey',
           'bid_notice_events.bid_notice_events_bid_id_fkey', 'bid_notice_events.bid_notice_events_revision_id_fkey',
           'bid_notice_events.bid_notice_events_related_bid_id_fkey', 'bid_notice_events.bid_notice_events_revision_id_bid_id_fkey',
           'bid_relevance_assessments.bid_relevance_assessments_revision_id_fkey', 'ingest_run_items.ingest_run_items_bid_id_fkey',
           'ingest_run_items.ingest_run_items_revision_id_fkey', 'kakao_send_claims.kakao_send_claims_bid_id_fkey',
           'kakao_send_claims.kakao_send_claims_outbox_event_id_fkey', 'kakao_send_claims.kakao_send_claims_notification_id_fkey'])$q$),
    ('C56 DELETE 사용자 트리거', $q$select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
       where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname::text in (select tbl from pg_temp._dc_scope)
         and (g.tgtype & 8) = 8 and g.tgname <> 'tasks_log_activity'$q$),
    ('C57 비fixture run 의 수집 항목', $q$select count(*) from public.ingest_run_items i join public.ingest_runs r on r.id = i.run_id
       where (i.bid_id in (select id from pg_temp._dc_t) or i.revision_id in (select id from pg_temp._dc_rev)) and r.source <> 'fixture'$q$)
  ) v(name, q) loop
    execute r.q into v_n;
    if v_n <> 0 then v_bad := v_bad || (r.name || '=' || v_n); end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'DC_BLOCKED: 차단 검사 실패 — %', array_to_string(v_bad, ', ');
  end if;

  -- ── 3. 표별 행 수·sha256 = 백업 ──────────────────────────────
  -- 범위 행은 1 끝에서 이미 잠갔다.
  for r in select * from pg_temp._dc_scope order by ord loop
    execute format(
      'select count(*), encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb)::text, ''UTF8'')), ''hex'') from public.%I x where %s',
      r.tbl, r.pred) into v_count, v_sha;
    v_actual := v_actual || jsonb_build_object(r.tbl, jsonb_build_object('row_count', v_count, 'sha256', v_sha));
    if v_expected -> r.tbl is null
       or (v_expected -> r.tbl ->> 'row_count')::bigint is distinct from v_count
       or (v_expected -> r.tbl ->> 'sha256') is distinct from v_sha then
      v_bad := v_bad || (r.tbl || ' 지금 ' || v_count || '행 ' || left(v_sha, 12) || ' / 백업 ' ||
                         coalesce(v_expected -> r.tbl ->> 'row_count', '?') || '행 ' || left(coalesce(v_expected -> r.tbl ->> 'sha256', '?'), 12));
    end if;
  end loop;
  if (v_actual -> 'bid_notices' ->> 'row_count')::bigint <> 19 then v_bad := v_bad || 'bid_notices 19건 아님'::text; end if;
  if (v_actual -> 'score_runs' ->> 'row_count')::bigint <> 19 then v_bad := v_bad || 'score_runs 19건 아님'::text; end if;
  if cardinality(v_bad) > 0 then
    raise exception 'DC_EXPECTED_MISMATCH: 백업 뒤 행이 바뀌었거나 기대값이 틀리다 — %', array_to_string(v_bad, '; ');
  end if;

  -- ── 4. 보존 표 행 수(전) ─────────────────────────────────────
  create temp table _dc_keep (name text, q text) on commit drop;
  insert into pg_temp._dc_keep values
    ('bid_notices 대상 밖', 'select count(*) from public.bid_notices where id not in (select id from pg_temp._dc_t)'),
    ('bid_notices is_demo=false', 'select count(*) from public.bid_notices where is_demo = false'),
    ('bid_revisions 대상 밖', 'select count(*) from public.bid_revisions where id not in (select id from pg_temp._dc_rev)'),
    ('bid_documents 대상 밖', 'select count(*) from public.bid_documents where bid_id not in (select id from pg_temp._dc_t)'),
    ('requirement_extractions 대상 밖', 'select count(*) from public.requirement_extractions where id not in (select id from pg_temp._dc_ext)'),
    ('score_runs 대상 밖', 'select count(*) from public.score_runs where id not in (select id from pg_temp._dc_run)'),
    ('score_factors 대상 밖', 'select count(*) from public.score_factors where score_run_id not in (select id from pg_temp._dc_run)'),
    ('bid_reviews 대상 밖', 'select count(*) from public.bid_reviews where id not in (select id from pg_temp._dc_rvw)'),
    ('bid_projects 대상 밖', 'select count(*) from public.bid_projects where id not in (select id from pg_temp._dc_prj)'),
    ('bid_project_events 대상 밖', 'select count(*) from public.bid_project_events where bid_project_id not in (select id from pg_temp._dc_prj)'),
    ('tasks 대상 밖', 'select count(*) from public.tasks where bid_project_id is null or bid_project_id not in (select id from pg_temp._dc_prj)'),
    ('assignments 대상 밖', 'select count(*) from public.assignments where bid_id not in (select id from pg_temp._dc_t)'),
    ('bid_watches 대상 밖', 'select count(*) from public.bid_watches where bid_id not in (select id from pg_temp._dc_t)'),
    ('notifications 대상 밖', 'select count(*) from public.notifications where id not in (select id from pg_temp._dc_ntf)'),
    ('outbox_events 대상 밖', 'select count(*) from public.outbox_events where id not in (select id from pg_temp._dc_obx)'),
    ('kakao_send_claims 대상 밖', 'select count(*) from public.kakao_send_claims where bid_id is null or bid_id not in (select id from pg_temp._dc_t)'),
    ('bid_opportunities 대상 밖', 'select count(*) from public.bid_opportunities where id not in (select id from pg_temp._dc_opp)'),
    ('opportunity_notice_links 대상 밖', 'select count(*) from public.opportunity_notice_links where bid_id not in (select id from pg_temp._dc_t)'),
    ('notice_match_candidates 대상 밖', 'select count(*) from public.notice_match_candidates where left_bid_id not in (select id from pg_temp._dc_t) and right_bid_id not in (select id from pg_temp._dc_t)'),
    ('bid_notice_events 대상 밖', 'select count(*) from public.bid_notice_events where bid_id not in (select id from pg_temp._dc_t)'),
    ('bid_relevance_assessments 대상 밖', 'select count(*) from public.bid_relevance_assessments where revision_id not in (select id from pg_temp._dc_rev)'),
    ('ingest_run_items 전체', 'select count(*) from public.ingest_run_items'),
    ('ingest_runs 전체', 'select count(*) from public.ingest_runs'),
    ('ingest_errors 전체', 'select count(*) from public.ingest_errors'),
    ('ingest_payloads 전체', 'select count(*) from public.ingest_payloads'),
    ('audit_logs 전체', 'select count(*) from public.audit_logs'),
    ('activities 전체', 'select count(*) from public.activities'),
    ('organizations', 'select count(*) from public.organizations'),
    ('profiles', 'select count(*) from public.profiles'),
    ('auth.users', 'select count(*) from auth.users'),
    ('memberships', 'select count(*) from public.memberships'),
    ('team_members', 'select count(*) from public.team_members'),
    ('company_profiles', 'select count(*) from public.company_profiles'),
    ('document_storage_objects 전체', 'select count(*) from public.document_storage_objects'),
    ('procurement_agencies', 'select count(*) from public.procurement_agencies'),
    ('eval_runs', 'select count(*) from public.eval_runs');
  for r in select * from pg_temp._dc_keep loop
    execute r.q into v_n;
    v_before := v_before || jsonb_build_object(r.name, v_n);
  end loop;

  -- ── 5·6. 지우기·바꾸기(FK 순서) ──────────────────────────────
  v_tasks := (v_actual -> 'tasks' ->> 'row_count')::bigint;
  if v_tasks > 0 then
    alter table public.tasks disable trigger tasks_log_activity;
  end if;
  for r in select * from pg_temp._dc_scope order by del loop
    if r.action = 'DELETE' then
      execute format('delete from public.%I x where %s', r.tbl, r.pred);
    elsif r.action = 'UPDATE_SET_NULL' then
      execute format(
        'update public.%I x set bid_id = case when x.bid_id in (select id from pg_temp._dc_t) then null else x.bid_id end, '
        'revision_id = case when x.revision_id in (select id from pg_temp._dc_rev) then null else x.revision_id end where %s',
        r.tbl, r.pred);
    else
      execute format('update public.%I x set lease_until = ''infinity'' where %s', r.tbl, r.pred);
    end if;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object(r.tbl, v_n);
    if v_n <> (v_actual -> r.tbl ->> 'row_count')::bigint then
      raise exception 'DC_ROWCOUNT: % 처리 % 행, 기대 %', r.tbl, v_n, v_actual -> r.tbl ->> 'row_count';
    end if;
  end loop;
  if v_tasks > 0 then
    alter table public.tasks enable trigger tasks_log_activity;
  end if;
  if (select g.tgenabled from pg_trigger g where g.tgrelid = 'public.tasks'::regclass and g.tgname = 'tasks_log_activity') <> 'O' then
    raise exception 'DC_TRIGGER: tasks_log_activity 가 다시 켜지지 않았다';
  end if;

  -- ── 7. 사후 검사 ────────────────────────────────────────────
  -- notifications·outbox_events 는 post 조건(대상 공고 id·run·결정·프로젝트 id 를 직접 비교)으로 센다. 이 문장은 새 스냅샷을 보므로
  -- 실행 중 다른 세션이 커밋한 대상 알림·outbox 도 여기 잡힌다.
  for r in select * from pg_temp._dc_scope where action <> 'UPDATE_FENCE' order by ord loop
    execute format('select count(*) from public.%I x where %s', r.tbl, coalesce(r.post, r.pred)) into v_n;
    if v_n <> 0 then v_bad := v_bad || (r.tbl || ' 남음 ' || v_n); end if;
  end loop;
  select count(*) into v_n from public.document_storage_objects o
    where o.id in (select id from pg_temp._dc_dso) and o.lease_until = 'infinity' and o.status = 'STORED';
  if v_n <> (select count(*) from pg_temp._dc_dso) then v_bad := v_bad || ('Storage 원장 보호 ' || v_n)::text; end if;
  for r in select * from pg_temp._dc_keep loop
    execute r.q into v_n;
    v_after := v_after || jsonb_build_object(r.name, v_n);
    if v_n <> (v_before ->> r.name)::bigint then
      v_bad := v_bad || (r.name || ' 전 ' || (v_before ->> r.name) || ' 후 ' || v_n);
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'DC_POSTCHECK: %', array_to_string(v_bad, '; ');
  end if;

  v_summary := jsonb_build_object('dryRun', v_dry_run, 'processed', v_deleted, 'keptCounts', v_after, 'at', now());
  if v_dry_run then
    raise exception 'DRY_RUN_ROLLBACK' using detail = v_summary::text, hint = '검사·삭제가 모두 통과했고 전부 되돌렸다. v_dry_run := false 로 다시 돌리면 커밋한다.';
  end if;
  raise notice 'DC_DONE %', v_summary::text;
end
$cleanup$;
