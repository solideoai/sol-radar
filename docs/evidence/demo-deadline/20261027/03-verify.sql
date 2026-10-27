-- 03-verify.sql — 02 적용 뒤 확인(읽기 전용). DB 를 바꾸지 않는다.
--
-- 02 가 남긴 기록 스키마 demo_deadline_shift_20261027(meta·notice_log·revision_log·guard_rows)와 지금 행을 견준다.
-- 실공고는 수집 worker 가 계속 바꾸므로 묶음 해시 하나로 견주지 않는다. 02 가 같은 스냅샷에서 남긴 행별 해시로 나눈다:
--   same            적용 때와 같다
--   changed_after   적용 뒤 바뀌었고 updated_at 이 적용 시각보다 뒤다(수집이 바꾼 것, 이 작업과 무관)
--   changed_other   바뀌었는데 위 설명이 안 된다 → ok=false(이 작업이 건드렸을 수 있다. 사람이 본다)
--   missing         적용 때 있었는데 없다 → ok=false
--   new             적용 뒤 새로 생겼다(보고만)
--
-- 실행: 문장마다 따로 돌려도 된다. 첫 문장 set timezone 은 해시가 02 와 같은 시간대로 계산되게 한다(02 는 UTC).
--   MCP 는 호출마다 연결이 달라질 수 있으니 따로 보낼 때는 Q 마다 앞에 `set timezone to 'UTC';` 를 붙여 한 번에 보낸다.
--   Q1 옮긴 행 — 19 + 19행. ok 가 모두 true 여야 한다.
--   Q2 점검 보고 — section·item·actual·expected·ok. ok=false 가 있으면 멈추고 사람이 본다.
--   화면 숫자·D-day 는 01-check.sql 의 Q3·Q4 를 다시 돌려 02 전 결과와 견준다(같은 쿼리를 두 번 쓰지 않는다).

set timezone to 'UTC';

-- ── Q1. 옮긴 행 ─────────────────────────────────────────────────
select 'bid_notices' as tbl, l.fx, l.notice_id as key,
  l.old_deadline_at::text as old_value, l.new_deadline_at::text as new_value, n.deadline_at::text as current_value,
  (n.deadline_at is not distinct from l.new_deadline_at) as value_ok,
  (l.old_deadline_at is null or n.deadline_at - l.old_deadline_at = interval '15 days') as shift_is_15d,
  -- 옮긴 열만 기존 값으로 되돌린 행의 해시 = 옮기기 전 해시(다른 열은 하나도 안 바뀌었다)
  encode(sha256(convert_to((to_jsonb(n) || jsonb_build_object('deadline_at', l.old_deadline_at))::text, 'UTF8')), 'hex') = l.old_row_sha256 as other_columns_ok,
  (n.updated_at = l.updated_at) as updated_at_kept,
  encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex') = l.new_row_sha256 as same_as_apply
from demo_deadline_shift_20261027.notice_log l
left join public.bid_notices n on n.id = l.bid_id
union all
select 'bid_revisions', l.fx, l.revision_id::text,
  l.old_deadline_text, l.new_deadline_text, r.normalized ->> 'deadlineAt',
  ((r.normalized ->> 'deadlineAt') is not distinct from l.new_deadline_text),
  (l.old_deadline_text is null or ((r.normalized ->> 'deadlineAt')::timestamptz - l.old_deadline_text::timestamptz) = interval '15 days'),
  encode(sha256(convert_to(
    (case when l.old_deadline_text is null then to_jsonb(r)
          else jsonb_set(to_jsonb(r), '{normalized,deadlineAt}', to_jsonb(l.old_deadline_text)) end)::text, 'UTF8')), 'hex') = l.old_row_sha256,
  -- 공고 마감과 같은 순간인지
  ((r.normalized ->> 'deadlineAt') is not distinct from to_char(n.deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') = l.new_row_sha256
from demo_deadline_shift_20261027.revision_log l
left join public.bid_revisions r on r.id = l.revision_id
left join public.bid_notices n on n.id = l.bid_id
order by 1, 2;
-- bid_revisions 행의 updated_at_kept 칸은 "normalized.deadlineAt = 공고 마감"이다(revision 에는 updated_at 이 없다).
-- same_as_apply 가 false 면 적용 뒤 누가 그 행을 다시 바꿨다. 04 는 그 상태에서 되돌리지 않는다(DDR_STATE_CHANGED).

-- ── Q2. 점검 보고 ───────────────────────────────────────────────
with meta as (select * from demo_deadline_shift_20261027.meta where id = 1),
nl as (select l.*, n.id as present, n.deadline_at as cur_deadline, n.updated_at as cur_updated_at,
         encode(sha256(convert_to((to_jsonb(n) || jsonb_build_object('deadline_at', l.old_deadline_at))::text, 'UTF8')), 'hex') = l.old_row_sha256 as other_ok
       from demo_deadline_shift_20261027.notice_log l left join public.bid_notices n on n.id = l.bid_id),
rl as (select l.*, r.id as present, r.normalized ->> 'deadlineAt' as cur_text,
         encode(sha256(convert_to((case when l.old_deadline_text is null then to_jsonb(r)
           else jsonb_set(to_jsonb(r), '{normalized,deadlineAt}', to_jsonb(l.old_deadline_text)) end)::text, 'UTF8')), 'hex') = l.old_row_sha256 as other_ok
       from demo_deadline_shift_20261027.revision_log l left join public.bid_revisions r on r.id = l.revision_id),
cur(tbl, row_id, row_sha256, updated_at, status) as (
  select 'bid_notices', n.id, encode(sha256(convert_to(to_jsonb(n)::text, 'UTF8')), 'hex'), n.updated_at, null::text
    from public.bid_notices n where n.id not in (select bid_id from demo_deadline_shift_20261027.notice_log)
  union all select 'bid_revisions', r.id, encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex'), null, null
    from public.bid_revisions r where r.bid_id not in (select bid_id from demo_deadline_shift_20261027.notice_log)
  union all select 'score_runs', s.id, encode(sha256(convert_to(to_jsonb(s)::text, 'UTF8')), 'hex'), null, s.status
    from public.score_runs s where s.bid_id not in (select bid_id from demo_deadline_shift_20261027.notice_log)
  union all select 'requirement_extractions', x.id, encode(sha256(convert_to(to_jsonb(x)::text, 'UTF8')), 'hex'), null, x.status
    from public.requirement_extractions x where x.bid_id not in (select bid_id from demo_deadline_shift_20261027.notice_log)
),
cmp as (
  select coalesce(g.tbl, c.tbl) as tbl,
    case
      when c.row_id is null then 'missing'
      when g.row_id is null then 'new'
      when g.row_sha256 = c.row_sha256 then 'same'
      -- 공고: 수집이 고치면 updated_at 트리거가 적용 시각보다 뒤의 시각을 남긴다
      when g.tbl = 'bid_notices' and c.updated_at > (select applied_at from meta) then 'changed_after'
      -- 분석 기록·추출: 적용 때 아직 끝나지 않은 행(QUEUED·RUNNING·PENDING)은 그 뒤 상태가 바뀌는 것이 정상이다
      when g.tbl in ('score_runs', 'requirement_extractions') and g.marker in ('QUEUED', 'RUNNING', 'PENDING') then 'changed_after'
      else 'changed_other'
    end as verdict
  from demo_deadline_shift_20261027.guard_rows g
  full join cur c on c.tbl = g.tbl and c.row_id = g.row_id
),
sets_now(item, cnt, txt) as (
  select 'target_bid_notices', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
    from public.bid_notices x where x.id in (select bid_id from demo_deadline_shift_20261027.notice_log)
  union all select 'target_bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text
    from public.bid_revisions x where x.bid_id in (select bid_id from demo_deadline_shift_20261027.notice_log)
)
select * from (
  select 1 as ord, 'A' as section, 'tz' as item, current_setting('TimeZone') as actual, 'UTC' as expected, current_setting('TimeZone') = 'UTC' as ok
  union all select 2, 'A', '적용 시각 / 되돌린 시각', (select applied_at::text || ' / ' || coalesce(rolled_back_at::text, '없음') from meta), '적용됨 / 없음',
    (select rolled_back_at is null from meta)
  union all select 3, 'A', '공고 기록 행(마감 있음)', (select count(*)::text || '(' || count(old_deadline_at)::text || ')' from nl), '19(16)',
    (select count(*) = 19 and count(old_deadline_at) = 16 from nl)
  union all select 4, 'A', 'revision 기록 행(마감 있음)', (select count(*)::text || '(' || count(old_deadline_text)::text || ')' from rl), '19(16)',
    (select count(*) = 19 and count(old_deadline_text) = 16 from rl)
  -- B: 옮긴 값
  union all select 10, 'B', 'bid_notices.deadline_at = 기존 + 15일', (select count(*) from nl where present is not null and cur_deadline is not distinct from new_deadline_at)::text, '19',
    (select count(*) from nl where present is not null and cur_deadline is not distinct from new_deadline_at) = 19
  union all select 11, 'B', 'bid_notices 다른 열 그대로(옮긴 열만 되돌린 해시 = 옮기기 전)', (select count(*) from nl where other_ok)::text, '19', (select count(*) from nl where other_ok) = 19
  union all select 12, 'B', 'bid_notices.updated_at 그대로', (select count(*) from nl where cur_updated_at = updated_at)::text, '19', (select count(*) from nl where cur_updated_at = updated_at) = 19
  union all select 13, 'B', 'normalized.deadlineAt = 새 글자', (select count(*) from rl where present is not null and cur_text is not distinct from new_deadline_text)::text, '19',
    (select count(*) from rl where present is not null and cur_text is not distinct from new_deadline_text) = 19
  union all select 14, 'B', 'bid_revisions 다른 내용 그대로', (select count(*) from rl where other_ok)::text, '19', (select count(*) from rl where other_ok) = 19
  union all select 15, 'B', '마감 가장 이른 대상(KST)', (select to_char(min(cur_deadline) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') from nl), '2026-11-06 18:00(FX-14)',
    (select min(cur_deadline) from nl) = '2026-11-06T09:00:00Z'::timestamptz
  union all select 16, 'B', 'FX-02 마감(KST)', (select to_char(cur_deadline at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') from nl where fx = 'FX-02'), '2026-11-14 18:00',
    (select cur_deadline from nl where fx = 'FX-02') = '2026-11-14T09:00:00Z'::timestamptz
  -- C: 옮기기 전과 같아야 하는 대상 묶음(적용 시각의 after_sets 와 지금이 같으면 그 뒤 아무도 안 바꿨다)
  union all select 20 + row_number() over (order by item), 'C', item || ' 지금 = 적용 직후', encode(sha256(convert_to(txt, 'UTF8')), 'hex'),
    (select after_sets #>> array[item, 'sha256'] from meta), encode(sha256(convert_to(txt, 'UTF8')), 'hex') = (select after_sets #>> array[item, 'sha256'] from meta)
  from sets_now
  -- D: 대상 밖(실공고·그 revision·분석 기록·추출) 행별 비교
  union all select 40 + row_number() over (order by tbl), 'D', tbl || ' same/changed_after/new',
    count(*) filter (where verdict = 'same')::text || ' / ' || count(*) filter (where verdict = 'changed_after')::text || ' / ' || count(*) filter (where verdict = 'new')::text,
    'changed_other 0 · missing 0',
    true
  from cmp group by tbl
  union all select 50 + row_number() over (order by tbl), 'D', tbl || ' changed_other / missing',
    count(*) filter (where verdict = 'changed_other')::text || ' / ' || count(*) filter (where verdict = 'missing')::text, '0 / 0',
    count(*) filter (where verdict in ('changed_other', 'missing')) = 0
  from cmp group by tbl
  union all select 60, 'D', '실공고 지금(is_demo=false AND source<>fixture)', (select count(*) from public.bid_notices where not is_demo and source <> 'fixture')::text, '보고(적용 때 이상)', true
  union all select 61, 'D', '적용 때 같은 스냅샷에서 대상 밖 묶음 그대로(02 의 DDS_COLLATERAL 검사)',
    (select count(*) from jsonb_object_keys((select before_sets from meta)) k where k not like 'target_%'
       and (select before_sets -> k from meta) = (select after_sets -> k from meta))::text,
    (select count(*) from jsonb_object_keys((select before_sets from meta)) k where k not like 'target_%')::text,
    (select bool_and((select before_sets -> k from meta) = (select after_sets -> k from meta))
       from jsonb_object_keys((select before_sets from meta)) k where k not like 'target_%')
  -- E: 장치
  union all select 70, 'E', 'updated_at 트리거 켜짐', coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), '(없음)'), 'O',
    coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), '') = 'O'
  union all select 71, 'E', '기록 스키마 노출(네 역할의 스키마·표 권한)',
    (select count(*) from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
       cross join (values ('meta'), ('notice_log'), ('revision_log'), ('guard_rows')) t(name)
       where has_schema_privilege(r, 'demo_deadline_shift_20261027', 'USAGE')
          or has_table_privilege(r, 'demo_deadline_shift_20261027.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::text, '0',
    (select count(*) from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
       cross join (values ('meta'), ('notice_log'), ('revision_log'), ('guard_rows')) t(name)
       where has_schema_privilege(r, 'demo_deadline_shift_20261027', 'USAGE')
          or has_table_privilege(r, 'demo_deadline_shift_20261027.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) = 0
  union all select 72, 'E', '대상 사업기회에 대상 밖 공고', (select count(*) from public.opportunity_notice_links l
      where l.opportunity_id in (select x.opportunity_id from public.opportunity_notice_links x where x.bid_id in (select bid_id from demo_deadline_shift_20261027.notice_log))
        and l.bid_id not in (select bid_id from demo_deadline_shift_20261027.notice_log))::text, '0',
    (select count(*) from public.opportunity_notice_links l
      where l.opportunity_id in (select x.opportunity_id from public.opportunity_notice_links x where x.bid_id in (select bid_id from demo_deadline_shift_20261027.notice_log))
        and l.bid_id not in (select bid_id from demo_deadline_shift_20261027.notice_log)) = 0
) q
order by ord;
