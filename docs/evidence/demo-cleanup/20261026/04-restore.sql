-- 04-restore.sql — 03 으로 지운 행을 백업(02 결과 JSON 또는 02b 백업 표)에서 그대로 되살린다. ⚠️ 운영 DB 를 바꾼다(v_dry_run := false 일 때).
--
-- 문장 하나(DO 블록) = 한 트랜잭션. 어느 검사든 어긋나면 전체가 되돌아간다. 순서:
--   (실행 전) notify worker(outbox dispatcher)를 멈추거나 카카오 발송이 mock 인지 확인한다(summary.md 실행 순서 8).
--      04 는 PENDING outbox 를 원래 상태 그대로 되살리므로 dispatcher 가 DEMO 알림을 다시 처리한다. outbox 상태는 바꾸지 않는다.
--   0. 채우는 값: v_source('schema' = demo_cleanup_20261026.backup, 'json' = 아래 v_json 에 02 결과 배열을 그대로), v_dry_run.
--   1. 백업 검사: 26행(meta + 25표), 표마다 sha256(rows_text) = sha256, 배열 길이 = row_count, meta 의 대상 id = v_target.
--   2. 지금 상태 검사: 대상 공고·지운 행이 하나도 없어야 한다(일부만 있으면 03 이 끝나지 않았거나 다른 일이 있었던 것 — 중단).
--      SET NULL·보호로 바꾼 두 표(ingest_run_items·document_storage_objects)는 행이 모두 있어야 한다. Storage 원장이 사라졌으면
--      (정리 job 이 객체를 지웠으면) 첨부 참조를 되살릴 수 없으므로 중단한다. Storage 원장은 행이 모두 03 의 보호 상태
--      (lease_until='infinity', status='STORED')여야 한다. 보호가 풀렸거나 다른 작업이 lease 를 잡았으면 중단한다(DR_STATE).
--   3. 넣는 표의 사용자 트리거를 이 트랜잭션 안에서만 끈다(ALTER TABLE … DISABLE TRIGGER USER). FK·check 제약은 그대로 검사한다.
--      끄는 이유: initialize_bid_opportunity(공고 insert → 새 사업기회·연결을 만들어 백업 행과 기본 키가 부딪힌다),
--      log_score_run_audit·log_bid_review_audit(감사 행 중복 — 원래 감사 행은 지우지 않았다), prepare_bid_review(권고 열 재계산),
--      populate_procurement_source(출처 열 재계산), guard_document_storage_reference(대신 아래에서 원장 STORED 를 직접 본다),
--      tasks_log_activity·tasks_set_timestamps(활동 행 추가·시각 덮어쓰기). 끝에서 다시 켜고 켜졌는지 확인한다.
--   4. 부모부터 jsonb_populate_recordset 으로 넣는다. 두 표는 UPDATE 로 백업 값(전체 열)을 되돌린다.
--   5. 검증: 표마다 백업 행의 기본 키로 지금 행을 모아 같은 식으로 sha256 → 백업 sha256 과 같아야 한다.
--   커밋한 뒤 01 을 다시 돌려 처음 결과(B 절 행 수·sha256, D 절 행 수)와 같은지 본다.
--
-- 되살리지 않는 것(지우지 않았으므로): audit_logs·activities·ingest_runs 등. Storage 객체는 03 이 지우지 않았고 원장 lease 만 되돌린다.
-- 시퀀스: 범위 표는 모두 uuid 기본 키라 맞출 시퀀스가 없다.

do $restore$
declare
  -- ▼▼▼ 채우는 값 ▼▼▼
  v_dry_run boolean := true;
  v_source text := 'schema';
  v_json jsonb := $sol_backup_20261026$[]$sol_backup_20261026$;
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
  -- 넣는 순서(부모 먼저). 같은 문장 안의 자기 참조(bid_opportunities.superseded_by)는 문장 끝에 FK 를 본다.
  v_order text[] := array[
    'bid_notices', 'bid_opportunities', 'opportunity_notice_links', 'bid_revisions', 'document_storage_objects', 'bid_documents',
    'bid_structured_requirements', 'requirement_extractions', 'score_runs', 'score_factors', 'qualification_checks',
    'requirement_assessments', 'bid_reviews', 'bid_projects', 'bid_project_events', 'tasks', 'assignments', 'bid_watches',
    'notifications', 'outbox_events', 'kakao_send_claims', 'notice_match_candidates', 'bid_notice_events',
    'bid_relevance_assessments', 'ingest_run_items'
  ];
  v_update_tables text[] := array['ingest_run_items', 'document_storage_objects'];
  v_trigger_tables text[] := array['bid_notices', 'bid_documents', 'score_runs', 'bid_reviews', 'tasks'];
  r record;
  v_tbl text;
  v_rows jsonb;
  v_expected_count bigint;
  v_pk text;
  v_cols text;
  v_n bigint;
  v_sha text;
  v_bad text[] := '{}';
  v_done jsonb := '{}'::jsonb;
begin
  perform set_config('TimeZone', 'UTC', true);
  perform set_config('lock_timeout', '10s', true);

  -- ── 1. 백업 검사 ────────────────────────────────────────────
  create temp table _dc_b (ord int, table_name text, action text, row_count bigint, sha256 text, rows_text text) on commit drop;
  if v_source = 'json' then
    insert into pg_temp._dc_b
      select * from jsonb_to_recordset(v_json) as x(ord int, table_name text, action text, row_count bigint, sha256 text, rows_text text);
  elsif v_source = 'schema' then
    if to_regclass('demo_cleanup_20261026.backup') is null then
      raise exception 'DR_NO_BACKUP: demo_cleanup_20261026.backup 이 없다(02b 를 돌리지 않았다면 v_source := ''json'')';
    end if;
    execute 'insert into pg_temp._dc_b select ord, table_name, action, row_count, sha256, rows_text from demo_cleanup_20261026.backup';
  else
    raise exception 'DR_SOURCE: v_source 는 schema 또는 json';
  end if;

  if (select count(*) from pg_temp._dc_b) <> 26
     or (select count(distinct table_name) from pg_temp._dc_b) <> 26
     or not exists (select 1 from pg_temp._dc_b where table_name = 'meta')
     or exists (select 1 from unnest(v_order) t where t not in (select table_name from pg_temp._dc_b)) then
    raise exception 'DR_BACKUP_SHAPE: 백업은 meta + 25표 = 26행이어야 한다(지금 %행)', (select count(*) from pg_temp._dc_b);
  end if;
  for r in select * from pg_temp._dc_b order by ord loop
    if encode(sha256(convert_to(r.rows_text, 'UTF8')), 'hex') is distinct from r.sha256 then
      v_bad := v_bad || (r.table_name || ' sha256 불일치');
    elsif r.table_name <> 'meta' and jsonb_array_length(r.rows_text::jsonb) <> r.row_count then
      v_bad := v_bad || (r.table_name || ' 행 수 불일치');
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'DR_BACKUP_CORRUPT: %', array_to_string(v_bad, ', ');
  end if;
  if (select (select jsonb_agg(x order by x) from jsonb_array_elements_text(rows_text::jsonb -> 'targetIds') x) from pg_temp._dc_b where table_name = 'meta')
     is distinct from (select jsonb_agg(x::text order by x::text) from unnest(v_target) x) then
    raise exception 'DR_TARGET_MISMATCH: 백업 meta 의 대상 id 와 v_target 이 다르다';
  end if;

  -- ── 2. 지금 상태 검사 ───────────────────────────────────────
  if exists (select 1 from public.bid_notices where id = any(v_target)) then
    raise exception 'DR_ALREADY_PRESENT: 대상 공고가 이미 % 건 있다(03 이 커밋되지 않았거나 이미 복구했다)',
      (select count(*) from public.bid_notices where id = any(v_target));
  end if;
  for r in select b.*, pk.cols from pg_temp._dc_b b
    cross join lateral (
      select string_agg(quote_ident(a.attname), ', ' order by k.ord) as cols
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = ('public.' || b.table_name)::regclass and i.indisprimary
    ) pk
    where b.table_name <> 'meta' and b.row_count > 0
  loop
    execute format('select count(*) from public.%I x where (%s) in (select %s from jsonb_populate_recordset(null::public.%I, $1) b)',
      r.table_name, (select string_agg('x.' || c, ', ') from unnest(string_to_array(r.cols, ', ')) c), r.cols, r.table_name)
      into v_n using r.rows_text::jsonb;
    if r.table_name = any(v_update_tables) then
      if v_n <> r.row_count then v_bad := v_bad || (r.table_name || ' 바꿀 행 ' || v_n || '/' || r.row_count); end if;
      -- Storage 원장은 03 이 걸어 둔 보호(lease_until='infinity', STORED) 그대로일 때만 되돌린다. 보호가 풀렸거나 다른 작업이
      -- lease 를 잡았으면(재업로드·정리 job 의 DELETE_PENDING 등) 백업 값으로 덮어쓰면 그 작업의 상태를 지우게 된다.
      if r.table_name = 'document_storage_objects' then
        select count(*) into v_n from public.document_storage_objects x
        where x.id in (select b.id from jsonb_populate_recordset(null::public.document_storage_objects, r.rows_text::jsonb) b)
          and x.lease_until = 'infinity' and x.status = 'STORED';
        if v_n <> r.row_count then
          v_bad := v_bad || ('document_storage_objects 보호(lease_until=infinity·STORED) ' || v_n || '/' || r.row_count);
        end if;
      end if;
    elsif v_n <> 0 then
      v_bad := v_bad || (r.table_name || ' 이미 있는 행 ' || v_n);
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'DR_STATE: 되살릴 수 없는 상태 — % (document_storage_objects 가 모자라면 Storage 정리 job 이 원장·객체를 지운 것)',
      array_to_string(v_bad, ', ');
  end if;

  -- ── 3. 사용자 트리거 끄기(이 트랜잭션 안에서만) ────────────
  foreach v_tbl in array v_trigger_tables loop
    execute format('alter table public.%I disable trigger user', v_tbl);
  end loop;

  -- ── 4. 넣기·되돌리기 ────────────────────────────────────────
  foreach v_tbl in array v_order loop
    select b.rows_text::jsonb, b.row_count into v_rows, v_expected_count from pg_temp._dc_b b where b.table_name = v_tbl;
    if v_expected_count = 0 then
      v_done := v_done || jsonb_build_object(v_tbl, 0);
      continue;
    end if;
    if v_tbl = any(v_update_tables) then
      -- 백업 값으로 기본 키 밖의 모든 열을 되돌린다.
      select string_agg(format('%I = b.%I', a.attname, a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
      where a.attrelid = ('public.' || v_tbl)::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'id';
      execute format('update public.%I x set %s from jsonb_populate_recordset(null::public.%I, $1) b where x.id = b.id', v_tbl, v_cols, v_tbl)
        using v_rows;
    else
      execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', v_tbl, v_tbl) using v_rows;
    end if;
    get diagnostics v_n = row_count;
    v_done := v_done || jsonb_build_object(v_tbl, v_n);
    if v_n <> v_expected_count then
      raise exception 'DR_ROWCOUNT: % 처리 % 행, 백업 % 행', v_tbl, v_n, v_expected_count;
    end if;
    -- 끈 guard 트리거 대신: 되살린 첨부가 가리키는 원장은 STORED 여야 한다.
    if v_tbl = 'bid_documents' and exists (
      select 1 from jsonb_populate_recordset(null::public.bid_documents, v_rows) d
      join public.document_storage_objects o on o.id in (d.raw_storage_id, d.parsed_storage_id)
      where o.status <> 'STORED'
    ) then
      raise exception 'DR_STORAGE_NOT_STORED: 되살린 첨부의 Storage 원장이 STORED 가 아니다';
    end if;
  end loop;

  -- ── 트리거 다시 켜기 ────────────────────────────────────────
  foreach v_tbl in array v_trigger_tables loop
    execute format('alter table public.%I enable trigger user', v_tbl);
  end loop;
  if exists (
    select 1 from pg_trigger g
    where g.tgrelid = any(array(select ('public.' || t)::regclass from unnest(v_trigger_tables) t))
      and not g.tgisinternal and g.tgenabled <> 'O'
  ) then
    raise exception 'DR_TRIGGER: 다시 켜지지 않은 트리거가 있다';
  end if;

  -- ── 5. 검증: 기본 키로 모은 지금 행의 sha256 = 백업 ──────────
  for r in select b.*, pk.cols from pg_temp._dc_b b
    cross join lateral (
      select string_agg(quote_ident(a.attname), ', ' order by k.ord) as cols
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = ('public.' || b.table_name)::regclass and i.indisprimary
    ) pk
    where b.table_name <> 'meta'
  loop
    execute format(
      'select count(*), encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb)::text, ''UTF8'')), ''hex'') '
      'from public.%I x where (%s) in (select %s from jsonb_populate_recordset(null::public.%I, $1) b)',
      r.table_name, (select string_agg('x.' || c, ', ') from unnest(string_to_array(r.cols, ', ')) c), r.cols, r.table_name)
      into v_n, v_sha using r.rows_text::jsonb;
    if v_n <> r.row_count or v_sha <> r.sha256 then
      v_bad := v_bad || (r.table_name || ' 지금 ' || v_n || '행 ' || left(v_sha, 12) || ' / 백업 ' || r.row_count || '행 ' || left(r.sha256, 12));
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'DR_VERIFY: 되살린 행이 백업과 다르다 — %', array_to_string(v_bad, '; ');
  end if;

  if v_dry_run then
    raise exception 'DRY_RUN_ROLLBACK' using detail = jsonb_build_object('dryRun', true, 'restored', v_done)::text,
      hint = '백업 검사·복구·검증이 모두 통과했고 전부 되돌렸다. v_dry_run := false 로 다시 돌리면 커밋한다.';
  end if;
  raise notice 'DR_DONE %', jsonb_build_object('restored', v_done, 'at', now())::text;
end
$restore$;
