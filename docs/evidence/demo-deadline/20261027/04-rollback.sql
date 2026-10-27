-- 04-rollback.sql — 02 로 옮긴 DEMO 공고 마감을 정확히 되돌린다. ⚠️ DB 에 쓴다(사용자 승인 뒤).
--
-- 근거: 02 가 남긴 기록 스키마 demo_deadline_shift_20261027(notice_log·revision_log 의 옮기기 전 값과 행 해시).
-- 되돌리는 것: bid_notices.deadline_at 16건, bid_revisions.normalized -> 'deadlineAt' 16건. updated_at 은 02 처럼 건드리지 않는다
--   (트리거를 이 트랜잭션 안에서만 끈다). 끝나면 38행 모두 옮기기 전 행 해시와 같고, 01 Q2 B 절의 bid_notices·bid_revisions
--   sha256 도 02 전 값으로 돌아온다.
--
-- 안전장치(하나라도 어긋나면 전체를 되돌린다):
--   DDR_NOT_APPLIED          기록 스키마가 없다(02 가 적용되지 않았다)
--   DDR_ALREADY_ROLLED_BACK  이미 되돌렸다(meta.rolled_back_at)
--   DDR_STATE_CHANGED        02 적용 직후와 지금 행이 다르다(누가 그 뒤 대상 공고·revision 을 바꿨다). 덮어쓰지 않고 멈춘다
--   DDR_TRIGGER              updated_at 트리거가 켜져 있지 않거나, 다시 켜지지 않았다
--   DDR_PRIVILEGE            실행 역할이 bid_notices 주인이 아니거나 bid_revisions UPDATE 권한이 없다(02 와 같은 역할로 돌린다)
--   DDR_UPDATE_COUNT         되돌린 행 수가 16·16 이 아니다
--   DDR_VERIFY               되돌린 행 해시가 옮기기 전 해시와 다르다, 또는 표 묶음 해시가 02 전 값(meta.before_sets)과 다르다
--   DRY_RUN_ROLLBACK         v_dry_run = true(기본값). 모든 확인을 통과했고 아무것도 남기지 않았다
--
-- 실행: begin … commit 을 한 번에 보낸다. ① 그대로 돌려 DRY_RUN_ROLLBACK 을 보고 ② v_dry_run 한 줄만 false 로 바꿔 다시 돌린다.
-- 기록 스키마는 지우지 않는다(meta.rolled_back_at 만 적는다). 02 를 다시 돌리면 DDS_ALREADY_APPLIED 로 막힌다.
--   다시 옮겨야 하면 사람이 확인한 뒤 `drop schema demo_deadline_shift_20261027 cascade;` 를 따로 돌리고 01 부터 다시 한다.
-- DEMO 정리(실운영 전환 A단계, demo-cleanup/20261026)는 이 04 로 되돌린 뒤에 한다. 02b 백업 표가 옮기기 전 행을 담고 있다.

begin isolation level repeatable read;
set local timezone to 'UTC';
set local lock_timeout to '5s';
set local statement_timeout to '120s';
lock table public.bid_notices, public.bid_revisions in share row exclusive mode;

do $rollback$
declare
  v_dry_run constant boolean := true;  -- ← 실제 되돌릴 때만 false 로 바꾼다
  v_bad text;
  v_n integer;
  v_sets jsonb;
begin
  if to_regnamespace('demo_deadline_shift_20261027') is null then
    raise exception 'DDR_NOT_APPLIED: 기록 스키마 demo_deadline_shift_20261027 가 없다';
  end if;
  if (select rolled_back_at from demo_deadline_shift_20261027.meta where id = 1) is not null then
    raise exception 'DDR_ALREADY_ROLLED_BACK: % 에 이미 되돌렸다', (select rolled_back_at from demo_deadline_shift_20261027.meta where id = 1);
  end if;
  if (select count(*) from demo_deadline_shift_20261027.notice_log) <> 19
     or (select count(*) from demo_deadline_shift_20261027.revision_log) <> 19 then
    raise exception 'DDR_STATE_CHANGED: 기록 행 수가 19·19 가 아니다';
  end if;

  -- 1. 지금 행 = 02 적용 직후 행(행 전체 해시)
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.notice_log l left join public.bid_notices n on n.id = l.bid_id
  where n.id is null or encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex') is distinct from l.new_row_sha256;
  if v_bad is not null then
    raise exception 'DDR_STATE_CHANGED: 02 적용 뒤 바뀐 bid_notices: %', v_bad;
  end if;
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.revision_log l left join public.bid_revisions r on r.id = l.revision_id
  where r.id is null or encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') is distinct from l.new_row_sha256;
  if v_bad is not null then
    raise exception 'DDR_STATE_CHANGED: 02 적용 뒤 바뀐 bid_revisions: %', v_bad;
  end if;
  if coalesce((select tgenabled from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), 'x') <> 'O' then
    raise exception 'DDR_TRIGGER: bid_notices_touch_updated_at 가 켜져 있지 않다(시작 전)';
  end if;
  if not (pg_has_role(current_user, (select relowner from pg_class where oid = 'public.bid_notices'::regclass), 'USAGE')
          and has_table_privilege(current_user, 'public.bid_revisions', 'UPDATE')) then
    raise exception 'DDR_PRIVILEGE: 실행 역할 % 이 bid_notices 주인의 권한이 없거나 bid_revisions UPDATE 권한이 없다', current_user;
  end if;

  -- 2. 되돌리기
  alter table public.bid_notices disable trigger bid_notices_touch_updated_at;

  update public.bid_notices n
     set deadline_at = l.old_deadline_at
    from demo_deadline_shift_20261027.notice_log l
   where n.id = l.bid_id and l.old_deadline_at is not null and n.deadline_at = l.new_deadline_at;
  get diagnostics v_n = row_count;
  if v_n <> 16 then
    raise exception 'DDR_UPDATE_COUNT: bid_notices % 건(기대 16)', v_n;
  end if;

  update public.bid_revisions r
     set normalized = jsonb_set(r.normalized, '{deadlineAt}', to_jsonb(l.old_deadline_text))
    from demo_deadline_shift_20261027.revision_log l
   where r.id = l.revision_id and l.old_deadline_text is not null and r.normalized ->> 'deadlineAt' = l.new_deadline_text;
  get diagnostics v_n = row_count;
  if v_n <> 16 then
    raise exception 'DDR_UPDATE_COUNT: bid_revisions % 건(기대 16)', v_n;
  end if;

  alter table public.bid_notices enable trigger bid_notices_touch_updated_at;
  if coalesce((select tgenabled from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), 'x') <> 'O' then
    raise exception 'DDR_TRIGGER: bid_notices_touch_updated_at 가 다시 켜지지 않았다';
  end if;

  -- 3. 확인: 행마다 옮기기 전 해시, 표 묶음은 02 전(meta.before_sets) 값
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.notice_log l join public.bid_notices n on n.id = l.bid_id
  where encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex') <> l.old_row_sha256;
  if v_bad is not null then
    raise exception 'DDR_VERIFY: bid_notices 가 옮기기 전과 다르다: %', v_bad;
  end if;
  select string_agg(l.fx, ', ' order by l.fx) into v_bad
  from demo_deadline_shift_20261027.revision_log l join public.bid_revisions r on r.id = l.revision_id
  where encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') <> l.old_row_sha256;
  if v_bad is not null then
    raise exception 'DDR_VERIFY: bid_revisions 가 옮기기 전과 다르다: %', v_bad;
  end if;

  select jsonb_object_agg(item, jsonb_build_object('rows', cnt, 'sha256', encode(sha256(convert_to(txt, 'UTF8')), 'hex')))
    into v_sets
  from (
    select 'target_bid_notices' as item, count(*) as cnt, coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text as txt
      from public.bid_notices x where x.id in (select bid_id from demo_deadline_shift_20261027.notice_log)
    union all select 'target_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
      from public.bid_revisions x where x.bid_id in (select bid_id from demo_deadline_shift_20261027.notice_log)
  ) s;
  if v_sets -> 'target_bid_notices' is distinct from (select before_sets -> 'target_bid_notices' from demo_deadline_shift_20261027.meta where id = 1)
     or v_sets -> 'target_bid_revisions' is distinct from (select before_sets -> 'target_bid_revisions' from demo_deadline_shift_20261027.meta where id = 1) then
    raise exception 'DDR_VERIFY: 표 묶음 해시가 02 전 값과 다르다';
  end if;

  update demo_deadline_shift_20261027.meta set rolled_back_at = now() where id = 1;

  if v_dry_run then
    raise exception 'DRY_RUN_ROLLBACK: 모든 확인 통과(공고 16·revision 16 되돌림, 38행 해시·표 묶음 해시가 02 전과 같음). v_dry_run = false 로 다시 돌린다';
  end if;
  raise notice 'DDR_DONE: 공고 16·revision 16 마감을 02 전 값으로 되돌렸다';
end
$rollback$;

commit;

-- set local 은 커밋과 함께 풀린다. 아래 해시·시각 표시가 02·03 과 같은 시간대(UTC)로 계산되게 세션 값을 다시 둔다.
set timezone to 'UTC';

-- 커밋 뒤 결과: 19 + 19행 모두 restored = true, 표 묶음 해시가 02 전(before_sets)과 같다.
select 'bid_notices' as tbl, l.fx, n.deadline_at::text as current_value, l.old_deadline_at::text as restored_to,
  encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex') = l.old_row_sha256 as restored
from demo_deadline_shift_20261027.notice_log l join public.bid_notices n on n.id = l.bid_id
union all
select 'bid_revisions', l.fx, r.normalized ->> 'deadlineAt', l.old_deadline_text,
  encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') = l.old_row_sha256
from demo_deadline_shift_20261027.revision_log l join public.bid_revisions r on r.id = l.revision_id
order by 1, 2;
