-- 20261019000009_ingest_save_revision — 수집 저장 함수 ingest_save_revision(p jsonb).
--
-- 근거: docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 한 트랜잭션에), §3.3 bid_notices·bid_revisions·bid_documents,
-- §3.6 outbox_events. docs/07-INGESTION.md(revision·변경 감지·이벤트 멱등키 source+noticeId+revision+eventType).
-- C3 Stage 6-1 계약(e8 판정 2026-10-19).
--
-- worker 가 정규화·변경 감지를 끝낸 공고 revision 하나를 함수 한 번으로 저장한다. 공고 행(만들기·갱신), revision 행,
-- 첨부 행, outbox 이벤트가 한 트랜잭션이라 어느 단계에서 실패해도 네 표가 함께 되돌아간다. 판정(무엇이 바뀌었나,
-- 어떤 이벤트인가)은 worker 가 하고, 이 함수는 받은 값을 그대로 적으면서 저장된 상태와 어긋나는 요청만 거절한다.
--
-- 이 파일에 든 것:
--   1. ingest_save_revision(p) — security invoker. 부른 역할의 권한으로 쓴다(service_role 은 RLS 를 무시하고 표 권한이 있다).
--      p = { bid_id?, revision_id?, notice: {...}, revision: {...}, documents: [{name, original_url}], event: {...} }
--      revision 1 이면 공고를 만들고, 2 이상이면 (source, notice_id) 의 공고를 찾아 갱신한다. 돌려주는 것은 (bid_id, revision_id).
--      거절(raise exception, 메시지가 곧 코드):
--        INGEST_BID_EXISTS        revision 1 인데 같은 (source, notice_id) 공고가 이미 있다(덮어쓰지 않는다)
--        INGEST_BID_NOT_FOUND     revision 2 이상인데 그 공고가 없다
--        INGEST_BID_ID_MISMATCH   bid_id 를 줬는데 저장된 공고 id 와 다르다
--        INGEST_REVISION_CONFLICT 저장된 latest_revision 이 revision − 1 이 아니다(건너뛰기·다시 저장)
--      검사 순서는 위 표의 아래 셋 순서다(NOT_FOUND → BID_ID_MISMATCH → REVISION_CONFLICT).
--      같은 idempotency_key 의 outbox 이벤트는 on conflict do nothing 으로 흡수하고, revision 은 그대로 저장한다.
--   2. 권한 — 화면 역할(anon·authenticated)과 PUBLIC 의 실행 권한을 거두고 service_role(worker)에만 준다.
--
-- 되돌리기(새 마이그레이션으로): drop function if exists public.ingest_save_revision(jsonb); 표는 건드리지 않는다.
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. ingest_save_revision(p)
--
-- 출력 열 이름(bid_id·revision_id)이 표 열과 같아 plpgsql 이 SQL 안의 이름을 변수로 볼지 열로 볼지 모호해진다.
-- #variable_conflict use_column 으로 SQL 안에서는 열로 읽고, 값은 v_ 접두사 지역 변수에만 담는다.
--
-- 값은 받은 그대로 적는다. 선택 필드(plan_ref·agency·budget_krw 등)가 null 이면 revision 2 이상에서도 null 로 덮어쓴다
-- — 그 revision 의 정규화 값이 정본이다. 필수 열(title·fetched_at·raw_payload·첨부 name 등)이 빠지면 NOT NULL 제약이 거절한다.
-- revision 2 이상의 공고 행은 for update 로 잠가, 같은 공고의 다음 revision 을 동시에 둘 저장하지 못하게 한다.
-- revision 1 의 동시 저장은 (source, notice_id) 유일 제약의 on conflict 가 하나만 넣고 나머지는 INGEST_BID_EXISTS 로 거절한다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.ingest_save_revision(p jsonb)
returns table (bid_id uuid, revision_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_notice jsonb := p -> 'notice';
  v_revision jsonb := p -> 'revision';
  v_event jsonb := p -> 'event';
  v_revision_no integer := (p -> 'revision' ->> 'revision')::integer;
  v_given_bid_id uuid := (p ->> 'bid_id')::uuid;
  v_bid_id uuid;
  v_latest_revision integer;
  v_revision_id uuid := coalesce((p ->> 'revision_id')::uuid, gen_random_uuid());
begin
  if v_revision_no = 1 then
    insert into public.bid_notices as bn (
      id, source, notice_id, plan_ref, pre_spec_ref, title, agency, stage, status, budget_krw,
      published_at, deadline_at, source_url, is_demo, latest_revision, content_hash, last_synced_at
    )
    values (
      coalesce(v_given_bid_id, gen_random_uuid()),
      v_notice ->> 'source',
      v_notice ->> 'notice_id',
      v_notice ->> 'plan_ref',
      v_notice ->> 'pre_spec_ref',
      v_notice ->> 'title',
      v_notice ->> 'agency',
      v_notice ->> 'stage',
      v_notice ->> 'status',
      (v_notice ->> 'budget_krw')::numeric,
      (v_notice ->> 'published_at')::timestamptz,
      (v_notice ->> 'deadline_at')::timestamptz,
      v_notice ->> 'source_url',
      (v_notice ->> 'is_demo')::boolean,
      1,
      v_revision ->> 'checksum',
      (v_revision ->> 'fetched_at')::timestamptz
    )
    on conflict (source, notice_id) do nothing
    returning bn.id into v_bid_id;

    if v_bid_id is null then
      raise exception 'INGEST_BID_EXISTS';
    end if;
  else
    select bn.id, bn.latest_revision
      into v_bid_id, v_latest_revision
    from public.bid_notices bn
    where bn.source = v_notice ->> 'source'
      and bn.notice_id = v_notice ->> 'notice_id'
    for update;

    if v_bid_id is null then
      raise exception 'INGEST_BID_NOT_FOUND';
    end if;
    if v_given_bid_id is not null and v_given_bid_id <> v_bid_id then
      raise exception 'INGEST_BID_ID_MISMATCH';
    end if;
    -- revision 이 비었거나 1 미만이어도 "다음 차수"가 아니므로 같은 거절이다.
    if v_latest_revision is distinct from v_revision_no - 1 then
      raise exception 'INGEST_REVISION_CONFLICT';
    end if;

    update public.bid_notices as bn
    set plan_ref = v_notice ->> 'plan_ref',
        pre_spec_ref = v_notice ->> 'pre_spec_ref',
        title = v_notice ->> 'title',
        agency = v_notice ->> 'agency',
        stage = v_notice ->> 'stage',
        status = v_notice ->> 'status',
        budget_krw = (v_notice ->> 'budget_krw')::numeric,
        published_at = (v_notice ->> 'published_at')::timestamptz,
        deadline_at = (v_notice ->> 'deadline_at')::timestamptz,
        source_url = v_notice ->> 'source_url',
        is_demo = (v_notice ->> 'is_demo')::boolean,
        latest_revision = v_revision_no,
        content_hash = v_revision ->> 'checksum',
        last_synced_at = (v_revision ->> 'fetched_at')::timestamptz
    where bn.id = v_bid_id;
  end if;

  insert into public.bid_revisions (
    id, bid_id, revision, amendment_no, raw_payload, normalized, checksum, changed_fields, fetched_at
  )
  values (
    v_revision_id,
    v_bid_id,
    v_revision_no,
    v_revision ->> 'amendment_no',
    v_revision -> 'raw_payload',
    v_revision -> 'normalized',
    v_revision ->> 'checksum',
    array(select f.field from jsonb_array_elements_text(v_revision -> 'changed_fields') as f(field)),
    (v_revision ->> 'fetched_at')::timestamptz
  );

  -- download_status 는 기본값 PENDING. 다운로드·파싱 열은 documents job 이 채운다.
  insert into public.bid_documents (bid_id, revision_id, name, original_url)
  select v_bid_id, v_revision_id, d.doc ->> 'name', d.doc ->> 'original_url'
  from jsonb_array_elements(coalesce(p -> 'documents', '[]'::jsonb)) as d(doc);

  -- 공고 이벤트는 조직에 속하지 않는다(org_id null). 팬아웃은 outbox worker 가 한다.
  insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (
    null,
    'bid_notice',
    v_bid_id,
    v_event ->> 'event_type',
    v_event -> 'payload',
    v_event ->> 'idempotency_key'
  )
  on conflict (idempotency_key) do nothing;

  return query select v_bid_id, v_revision_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. 권한
--
-- Supabase 는 public 의 새 함수에 화면 역할 실행 권한을 따로 주므로 PUBLIC 만 거두면 /rpc 로 그대로 불린다(database 스킬).
-- 화면 역할에서 모두 거두고 worker 의 service_role 에만 준다. service_role 역할이 없는 DB(PGlite 정책 시험·타입 생성)에서는
-- grant 를 건너뛴다.
-- ────────────────────────────────────────────────────────────────
revoke all on function public.ingest_save_revision(jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ingest_save_revision(jsonb) to service_role;
  end if;
end;
$$;
