-- 01-check.sql — DEMO 공고 마감 이동 전 조회(읽기 전용). DB 를 바꾸지 않는다.
--
-- 대상: bid_notices 중 is_demo = true AND source = 'fixture' 인 19건(아래 expected 목록과 같아야 한다)과 그 revision 19건.
--   id 는 scripts/demo/plan.mjs demoIdFor(uuid v5)라 어느 DB 에서나 같다. 기존 마감은 seed anchor 2026-10-20(KST) + fixture 상대일의 KST 18:00 이다.
--   new_deadline 은 기존 + 15일. 02-shift.sql·03-verify.sql·04-rollback.sql 의 목록과 같다.
--
-- 실행: 문장마다 따로 돌려도 된다(MCP execute_sql 한 번에 문장 하나). 첫 문장 set timezone 은 sha256 이 세션 시간대에 따라
--   달라지지 않게 한다. MCP 는 호출마다 연결이 달라질 수 있으니 따로 보낼 때는 Q 마다 앞에 `set timezone to 'UTC';` 를 붙여
--   한 번에 보낸다. Q2 의 tz 줄이 UTC 인지 본다. 02·04 와 같은 역할(운영 postgres)로 돌려야 Q2 의 권한 줄이 맞다.
--   Q1 대상 목록 — 19행. state 는 BEFORE(기존 마감)·SHIFTED(+15일)·NO_DEADLINE(마감 없음 3건) 중 하나여야 한다.
--   Q2 점검 보고 — section·item·actual·expected·ok. A 절 ok=false 가 하나라도 있으면 02 를 돌리지 않는다.
--   Q3 화면 기준 숫자 — 대시보드 카드·목록 기본 필터를 기준 시각별로 다시 센다(뷰 opportunity_list_items 의 규칙, 아래 주석).
--   Q4 화면 기준 D-day — DEMO 공고마다 리허설 첫날·발표일의 D-day 와 목록 노출 여부.
--   Q5 S4 장면 — FX-02 의 분석·결정 기록.
-- 02 적용 뒤·04 되돌린 뒤에도 그대로 다시 돌린다. 04 뒤 Q2 B 절 sha256 은 처음 값과 같아야 한다.

set timezone to 'UTC';

-- ── Q1. 대상 목록 ───────────────────────────────────────────────
with expected(fx, notice_id, bid_id, old_deadline) as (values
  ('FX-01', 'DEMO-2026-0001', 'b9f00c0b-96e2-5949-9fc7-ef7bb7aea163'::uuid, '2026-11-10T09:00:00Z'::timestamptz),
  ('FX-02', 'DEMO-2026-0002', '687bd892-941f-56a9-9ea9-9754ea5e5f1a'::uuid, '2026-10-30T09:00:00Z'::timestamptz),
  ('FX-03', 'DEMO-2026-0003', 'dcb0a308-6f3b-5457-8d0a-fbdf4be684b9'::uuid, '2026-11-04T09:00:00Z'::timestamptz),
  ('FX-04', 'DEMO-2026-0004', '9036e273-d51b-5090-8c89-53161dbb6714'::uuid, '2026-11-01T09:00:00Z'::timestamptz),
  ('FX-05', 'DEMO-2026-0005', '4f552925-ef52-591d-b31e-a33cf6465668'::uuid, '2026-11-09T09:00:00Z'::timestamptz),
  ('FX-06', 'DEMO-2026-0006', 'b7df7a25-d4e7-566b-86f3-f8ceaf474e08'::uuid, '2026-11-03T09:00:00Z'::timestamptz),
  ('FX-07', 'DEMO-2026-0007', 'cbc1beaa-65c3-5446-b0bb-b39577a24dc5'::uuid, '2026-11-07T09:00:00Z'::timestamptz),
  ('FX-08', 'DEMO-2026-0008', '1aca5230-53d0-58c9-93a1-5dab49a0c338'::uuid, '2026-11-05T09:00:00Z'::timestamptz),
  ('FX-09', 'DEMO-2026-0009', '009a7aa0-10c9-54f0-8be4-f124dbebcfb1'::uuid, '2026-11-14T09:00:00Z'::timestamptz),
  ('FX-10', 'DEMO-2026-0010', '0f43b834-130f-53d1-a075-26ef321b162f'::uuid, '2026-11-03T09:00:00Z'::timestamptz),
  ('FX-11', 'DEMO-2026-0011', 'd6a7d9d4-f567-5226-a467-9986cf50e5b8'::uuid, null::timestamptz),
  ('FX-13', 'DEMO-2026-0013', 'b432b15d-96d1-5ef1-bf42-30547dbc066e'::uuid, '2026-11-08T09:00:00Z'::timestamptz),
  ('FX-14', 'DEMO-2026-0014', '29dc6ded-e564-5d29-82ec-ea9806ad48b1'::uuid, '2026-10-22T09:00:00Z'::timestamptz),
  ('FX-15', 'DEMO-2026-0015', 'f66379fe-96c4-5ffc-a1c3-f36bad5c1299'::uuid, '2026-11-19T09:00:00Z'::timestamptz),
  ('FX-16', 'DEMO-2026-0016', '9f10f9dc-7a52-5616-8bfd-b65d74285a9d'::uuid, '2026-11-09T09:00:00Z'::timestamptz),
  ('FX-17', 'DEMO-2026-0017', '8db93cc7-fae2-557e-a8bc-ca4e5352e10c'::uuid, null::timestamptz),
  ('FX-18', 'DEMO-2026-0018', '5f28b611-29d8-59fa-92eb-a0c453b91cd0'::uuid, '2026-10-27T09:00:00Z'::timestamptz),
  ('FX-19', 'DEMO-2026-0019', 'f1b8fdee-7493-542e-b800-3a60b6ee7032'::uuid, '2026-10-27T09:00:00Z'::timestamptz),
  ('FX-20', 'DEMO-2026-0020', '1cfcc05b-daaf-5a55-950c-ce2422b996b5'::uuid, null::timestamptz)
),
e as (select x.*, x.old_deadline + interval '15 days' as new_deadline from expected x),
cond as (select n.id from public.bid_notices n where n.is_demo = true and n.source = 'fixture')
select coalesce(e.fx, '(목록 밖)') as fx, n.notice_id, coalesce(e.bid_id, c.id) as bid_id, n.title, n.stage, n.status,
  n.deadline_at, to_char(n.deadline_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as deadline_kst,
  e.old_deadline, e.new_deadline,
  r.normalized ->> 'deadlineAt' as rev_deadline_text,
  case
    when e.bid_id is null or c.id is null then 'NOT_TARGET'
    when e.old_deadline is null and n.deadline_at is null then 'NO_DEADLINE'
    when n.deadline_at is not distinct from e.old_deadline then 'BEFORE'
    when n.deadline_at is not distinct from e.new_deadline then 'SHIFTED'
    else 'OTHER'
  end as state,
  -- revision 의 normalized.deadlineAt 이 공고 마감과 같은 순간(같은 글자 모양 YYYY-MM-DDTHH:MI:SS.MSZ)인지
  (r.normalized ->> 'deadlineAt') is not distinct from
    to_char(n.deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as rev_matches_notice,
  (e.bid_id is not null) as in_list, (c.id is not null) as matches_condition
from e
full join cond c on c.id = e.bid_id
left join public.bid_notices n on n.id = coalesce(e.bid_id, c.id)
left join public.bid_revisions r on r.bid_id = n.id and r.revision = n.latest_revision
order by e.fx nulls first, 3;

-- ── Q2. 점검 보고 ───────────────────────────────────────────────
-- A 02 를 돌려도 되는지(ok=false 면 멈춘다) · B 대상 표 sha256(04 뒤 같아야 한다) · C 실공고·비대상(보고만) · D 날짜 모양 · E 알림·S4 참고
with expected(fx, notice_id, bid_id, old_deadline) as (values
  ('FX-01', 'DEMO-2026-0001', 'b9f00c0b-96e2-5949-9fc7-ef7bb7aea163'::uuid, '2026-11-10T09:00:00Z'::timestamptz),
  ('FX-02', 'DEMO-2026-0002', '687bd892-941f-56a9-9ea9-9754ea5e5f1a'::uuid, '2026-10-30T09:00:00Z'::timestamptz),
  ('FX-03', 'DEMO-2026-0003', 'dcb0a308-6f3b-5457-8d0a-fbdf4be684b9'::uuid, '2026-11-04T09:00:00Z'::timestamptz),
  ('FX-04', 'DEMO-2026-0004', '9036e273-d51b-5090-8c89-53161dbb6714'::uuid, '2026-11-01T09:00:00Z'::timestamptz),
  ('FX-05', 'DEMO-2026-0005', '4f552925-ef52-591d-b31e-a33cf6465668'::uuid, '2026-11-09T09:00:00Z'::timestamptz),
  ('FX-06', 'DEMO-2026-0006', 'b7df7a25-d4e7-566b-86f3-f8ceaf474e08'::uuid, '2026-11-03T09:00:00Z'::timestamptz),
  ('FX-07', 'DEMO-2026-0007', 'cbc1beaa-65c3-5446-b0bb-b39577a24dc5'::uuid, '2026-11-07T09:00:00Z'::timestamptz),
  ('FX-08', 'DEMO-2026-0008', '1aca5230-53d0-58c9-93a1-5dab49a0c338'::uuid, '2026-11-05T09:00:00Z'::timestamptz),
  ('FX-09', 'DEMO-2026-0009', '009a7aa0-10c9-54f0-8be4-f124dbebcfb1'::uuid, '2026-11-14T09:00:00Z'::timestamptz),
  ('FX-10', 'DEMO-2026-0010', '0f43b834-130f-53d1-a075-26ef321b162f'::uuid, '2026-11-03T09:00:00Z'::timestamptz),
  ('FX-11', 'DEMO-2026-0011', 'd6a7d9d4-f567-5226-a467-9986cf50e5b8'::uuid, null::timestamptz),
  ('FX-13', 'DEMO-2026-0013', 'b432b15d-96d1-5ef1-bf42-30547dbc066e'::uuid, '2026-11-08T09:00:00Z'::timestamptz),
  ('FX-14', 'DEMO-2026-0014', '29dc6ded-e564-5d29-82ec-ea9806ad48b1'::uuid, '2026-10-22T09:00:00Z'::timestamptz),
  ('FX-15', 'DEMO-2026-0015', 'f66379fe-96c4-5ffc-a1c3-f36bad5c1299'::uuid, '2026-11-19T09:00:00Z'::timestamptz),
  ('FX-16', 'DEMO-2026-0016', '9f10f9dc-7a52-5616-8bfd-b65d74285a9d'::uuid, '2026-11-09T09:00:00Z'::timestamptz),
  ('FX-17', 'DEMO-2026-0017', '8db93cc7-fae2-557e-a8bc-ca4e5352e10c'::uuid, null::timestamptz),
  ('FX-18', 'DEMO-2026-0018', '5f28b611-29d8-59fa-92eb-a0c453b91cd0'::uuid, '2026-10-27T09:00:00Z'::timestamptz),
  ('FX-19', 'DEMO-2026-0019', 'f1b8fdee-7493-542e-b800-3a60b6ee7032'::uuid, '2026-10-27T09:00:00Z'::timestamptz),
  ('FX-20', 'DEMO-2026-0020', '1cfcc05b-daaf-5a55-950c-ce2422b996b5'::uuid, null::timestamptz)
),
t as (
  select n.* from public.bid_notices n join expected x on x.bid_id = n.id
  where n.is_demo = true and n.source = 'fixture'
),
rev as (select r.* from public.bid_revisions r where r.bid_id in (select id from t)),
state as (
  select
    count(*) filter (where n.deadline_at is not distinct from x.old_deadline) as before_rows,
    count(*) filter (where n.deadline_at is not distinct from x.old_deadline + interval '15 days') as shifted_rows
  from expected x join t n on n.id = x.bid_id
),
opp as (select l.opportunity_id from public.opportunity_notice_links l where l.bid_id in (select id from t)),
-- normalized·raw_payload 안에서 ISO 날짜처럼 보이는 문자열의 경로(배열 칸은 [])
walk(src, path, val) as (
  select 'normalized', '', r.normalized from rev r
  union all
  select 'raw_payload', '', r.raw_payload from rev r
),
paths as (
  with recursive w(src, path, val) as (
    select * from walk
    union all
    select w.src, w.path || k.key, k.value
    from w cross join lateral (
      select '.' || e.key as key, e.value from jsonb_each(case when jsonb_typeof(w.val) = 'object' then w.val end) e
      union all
      select '[]', a.value from jsonb_array_elements(case when jsonb_typeof(w.val) = 'array' then w.val end) a
    ) k
  )
  select src, path, count(*) as n from w
  where jsonb_typeof(val) = 'string' and (val #>> '{}') ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)'
  group by src, path
),
-- 마감 알림(send_deadline_reminders) 수신 후보: 최신 결정의 담당자 ∪ 관심 등록자
reminder as (
  select n.id, n.deadline_at from t n
  where n.deadline_at is not null and (
    exists (select 1 from public.bid_watches w where w.bid_id = n.id)
    or exists (select 1 from public.bid_reviews v where v.bid_id = n.id and v.assignee_id is not null)
  )
),
priv as (
  select pg_has_role(current_user, (select relowner from pg_class where oid = 'public.bid_notices'::regclass), 'USAGE')
     and has_table_privilege(current_user, 'public.bid_revisions', 'UPDATE')
     and has_database_privilege(current_user, current_database(), 'CREATE') as ok
),
rows_sha(item, cnt, txt) as (
  select 'bid_notices', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_notices x where x.id in (select id from t)
  union all select 'bid_revisions', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_revisions x where x.id in (select id from rev)
  union all select 'bid_opportunities', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_opportunities x where x.id in (select opportunity_id from opp)
  union all select 'opportunity_notice_links', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.opportunity_notice_links x where x.opportunity_id in (select opportunity_id from opp)
  union all select 'score_runs', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.score_runs x where x.bid_id in (select id from t)
  union all select 'bid_reviews', count(*), coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb)::text from public.bid_reviews x where x.bid_id in (select id from t)
)
select * from (
  select 1 as ord, 'A' as section, 'tz' as item, current_setting('TimeZone') as actual, 'UTC' as expected, current_setting('TimeZone') = 'UTC' as ok
  union all select 2, 'A', '조건(is_demo AND fixture) 공고 수', (select count(*) from public.bid_notices where is_demo and source = 'fixture')::text, '19', (select count(*) from public.bid_notices where is_demo and source = 'fixture') = 19
  union all select 3, 'A', '목록 ∩ 조건', (select count(*) from t)::text, '19', (select count(*) from t) = 19
  union all select 4, 'A', '마감 있는 대상', (select count(*) from t where deadline_at is not null)::text, '16', (select count(*) from t where deadline_at is not null) = 16
  union all select 5, 'A', '대상 상태(BEFORE=기존, SHIFTED=+15일)',
    (select case when before_rows = 19 then 'BEFORE' when shifted_rows = 19 then 'SHIFTED' else 'MIXED ' || before_rows || '/' || shifted_rows end from state),
    'BEFORE(02 전) 또는 SHIFTED(02 뒤)', (select before_rows = 19 or shifted_rows = 19 from state)
  union all select 6, 'A', 'revision 행 수(모두 revision 1, latest_revision 1)',
    (select count(*) from rev)::text || ' / rev1 ' || (select count(*) from rev where revision = 1)::text || ' / latest1 ' || (select count(*) from t where latest_revision = 1)::text,
    '19 / rev1 19 / latest1 19', (select count(*) from rev) = 19 and (select count(*) from rev where revision = 1) = 19 and (select count(*) from t where latest_revision = 1) = 19
  union all select 7, 'A', 'normalized.deadlineAt 이 공고 마감과 같은 글자',
    (select count(*) from t n join rev r on r.bid_id = n.id where (r.normalized ->> 'deadlineAt') is not distinct from to_char(n.deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and r.normalized ? 'deadlineAt')::text,
    '19', (select count(*) from t n join rev r on r.bid_id = n.id where (r.normalized ->> 'deadlineAt') is not distinct from to_char(n.deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and r.normalized ? 'deadlineAt') = 19
  union all select 8, 'A', 'normalized 에 sourceMetadata(외부 날짜 묶음) 있는 대상', (select count(*) from rev where normalized ? 'sourceMetadata')::text, '0', (select count(*) from rev where normalized ? 'sourceMetadata') = 0
  union all select 9, 'A', '대상 사업기회에 대상 밖 공고가 묶임', (select count(*) from public.opportunity_notice_links l where l.opportunity_id in (select opportunity_id from opp) and l.bid_id not in (select id from t))::text, '0',
    (select count(*) from public.opportunity_notice_links l where l.opportunity_id in (select opportunity_id from opp) and l.bid_id not in (select id from t)) = 0
  union all select 10, 'A', '대상 입찰 프로젝트의 마감 덮어쓰기(submission_due_override)', (select count(*) from public.bid_projects p where p.bid_id in (select id from t) and p.submission_due_override is not null)::text, '0',
    (select count(*) from public.bid_projects p where p.bid_id in (select id from t) and p.submission_due_override is not null) = 0
  union all select 11, 'A', 'updated_at 트리거 bid_notices_touch_updated_at 켜짐', coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), '(없음)'), 'O',
    coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.bid_notices'::regclass and tgname = 'bid_notices_touch_updated_at'), '') = 'O'
  -- 트리거 끄기는 표 주인만 할 수 있다(Supabase 의 postgres 역할은 superuser 가 아니다). 기록 스키마는 DB CREATE 권한이 있어야 만든다.
  union all select 12, 'A', '실행 역할 권한(bid_notices 주인 · bid_revisions UPDATE · DB CREATE)',
    'bid_notices 주인 ' || (select relowner::regrole::text from pg_class where oid = 'public.bid_notices'::regclass) || ' / 실행 ' || current_user || ' / '
      || (select ok from priv)::text,
    'true', (select ok from priv)
  union all select 13, 'A', '이동 기록 스키마 demo_deadline_shift_20261027', case when to_regnamespace('demo_deadline_shift_20261027') is null then '없음' else '있음' end,
    '없음(02 전) · 있음(02 뒤)', true
  union all select 14, 'A', '02 를 돌려도 되는가(상태 BEFORE + 기록 스키마 없음 + 실행 역할 권한 + 위 검사 통과)',
    case when (select before_rows = 19 from state) and to_regnamespace('demo_deadline_shift_20261027') is null and (select ok from priv) then '예' else '아니오' end, '예(02 전에만)',
    true
  -- B: 대상 표 sha256. 10-26 정리 전 조회(prod-01-before)의 bid_notices 714b6fbd…·bid_revisions 43353944… 와 같으면 그 뒤 DEMO 행이 그대로다.
  union all select 20 + row_number() over (order by item), 'B', item || ' (행 ' || cnt || ')', encode(sha256(convert_to(txt, 'UTF8')), 'hex'),
    case item when 'bid_notices' then '714b6fbd49ea735b44cc408593bc51f2fd8869314de3f8a290f8cc9b3a57852b(10-26 운영, 참고)'
              when 'bid_revisions' then '433539442aea9e765ad2325305559a3c46b84c7f88137f2aa3fd07a4602774aa(10-26 운영, 참고)'
              else '(04 뒤 이 값과 같아야 한다)' end,
    true
  from rows_sha
  -- C: 비대상(보고만). 실공고는 수집 worker 가 계속 바꾸므로 기대값을 두지 않는다. 03 은 02 가 남긴 행별 해시로 비교한다.
  union all select 40, 'C', '비대상 공고(전체 − 대상)', (select count(*) from public.bid_notices where id not in (select id from t))::text, '보고', true
  union all select 41, 'C', '실공고(is_demo=false AND source<>fixture)', (select count(*) from public.bid_notices where not is_demo and source <> 'fixture')::text, '보고(10-27 기준 592 안팎)', true
  union all select 42, 'C', '비대상 revision', (select count(*) from public.bid_revisions where bid_id not in (select id from t))::text, '보고', true
  union all select 43, 'C', '비대상 score_runs', (select count(*) from public.score_runs where bid_id not in (select id from t))::text, '보고', true
  -- D: 날짜처럼 보이는 JSON 문자열 경로. 02 가 옮기는 것은 normalized.deadlineAt 하나다. 다른 경로가 보이면 02 전에 사람이 판단한다.
  union all select 50 + row_number() over (order by src, path), 'D', src || path || ' (행 ' || n || ')',
    case when src = 'normalized' and path = '.deadlineAt' then '옮김' else '두기' end,
    'normalized .deadlineAt(옮김)·.noticeDate·.fetchedAt(두기)만', (src = 'normalized' and path in ('.deadlineAt', '.noticeDate', '.fetchedAt'))
  from paths
  -- E: 참고
  union all select 70, 'E', '마감 알림 수신 후보가 있는 대상(담당자·관심 등록)', (select count(*) from reminder)::text, '보고(있으면 D-3·D-1 IN_APP 알림이 생길 수 있다)', true
  union all select 71, 'E', '대상 score_runs / 결정 / 관심 / 프로젝트',
    (select count(*) from public.score_runs where bid_id in (select id from t))::text || ' / ' || (select count(*) from public.bid_reviews where bid_id in (select id from t))::text
      || ' / ' || (select count(*) from public.bid_watches where bid_id in (select id from t))::text || ' / ' || (select count(*) from public.bid_projects where bid_id in (select id from t))::text,
    '보고(옮기지 않는다)', true
) q
order by ord;

-- ── Q3. 화면 기준 숫자(기준 시각별) ─────────────────────────────
-- 대시보드 procurement_summary(20261025000200 :65-90)와 목록 기본 필터(web/server/opportunities/repo.ts:100-115)의 규칙을
-- 기준 시각 t 로 다시 센다. 뷰 opportunity_list_items 의 status 는 now() 로 계산되므로(20261023000200 :7) 여기서는
-- 저장 status 와 t 로 같은 식을 다시 쓴다: OPEN·AMENDED 이고 deadline_at < t 면 CLOSED.
--   list_default   목록 기본: origin=demo, 단계 NOTICE, 상태 OPEN·AMENDED, first_seen_at <= t
--   closing_soon   카드 "마감 임박(7일)": NOTICE, 충돌 없음, OPEN·AMENDED, deadline_at between t and t+7일
--   bid_recommended 카드 "BID 권고": NOTICE, 권고 BID, 분석 COMPLETED·PARTIAL, OPEN·AMENDED, 충돌 없음
--   active_watch   "진행 중 WATCH"(procurement_live_metrics)
--   newly          카드 "신규 발견": first_seen_at > t − 24시간(날짜 이동과 무관)
--   pending        카드 "분석 대기": 분석 없음·QUEUED·RUNNING·FAILED(날짜 이동과 무관)
--   early          사전 단계(PLAN·PROCUREMENT_REQUEST·PRE_SPEC) 수
with asof(label, t) as (values
  ('지금', now()),
  ('리허설 10-28 10:00 KST', '2026-10-28T10:00:00+09:00'::timestamptz),
  ('리허설 11-03 10:00 KST', '2026-11-03T10:00:00+09:00'::timestamptz),
  ('발표 11-04 14:00 KST', '2026-11-04T14:00:00+09:00'::timestamptz)
),
org as (select id from public.organizations where slug = 'org-01'),
v as (
  select v.bid_id, v.stage, v.first_seen_at, v.deadline_at, v.source_conflict, v.recommendation, v.analysis_status, b.status as stored_status, b.notice_id
  from public.opportunity_list_items v join public.bid_notices b on b.id = v.bid_id
  where v.org_id = (select id from org) and v.is_demo
),
s as (
  select a.label, a.t, v.*,
    case when v.stored_status in ('OPEN', 'AMENDED') and v.deadline_at < a.t then 'CLOSED' else v.stored_status end as status_at
  from asof a cross join v where v.first_seen_at <= a.t
)
select label, t,
  count(*) filter (where stage = 'NOTICE' and status_at in ('OPEN', 'AMENDED')) as list_default,
  count(*) filter (where stage = 'NOTICE' and not source_conflict and status_at in ('OPEN', 'AMENDED') and deadline_at between t and t + interval '7 days') as closing_soon,
  string_agg(notice_id, ',' order by notice_id) filter (where stage = 'NOTICE' and not source_conflict and status_at in ('OPEN', 'AMENDED') and deadline_at between t and t + interval '7 days') as closing_soon_ids,
  count(*) filter (where stage = 'NOTICE' and recommendation = 'BID' and analysis_status in ('COMPLETED', 'PARTIAL') and status_at in ('OPEN', 'AMENDED') and not source_conflict) as bid_recommended,
  count(*) filter (where stage = 'NOTICE' and recommendation = 'WATCH' and analysis_status in ('COMPLETED', 'PARTIAL') and status_at in ('OPEN', 'AMENDED') and not source_conflict) as active_watch,
  count(*) filter (where stage = 'NOTICE' and first_seen_at > t - interval '24 hours') as newly,
  count(*) filter (where stage = 'NOTICE' and (analysis_status is null or analysis_status in ('QUEUED', 'RUNNING', 'FAILED'))) as pending,
  count(*) filter (where stage in ('PLAN', 'PROCUREMENT_REQUEST', 'PRE_SPEC')) as early,
  count(*) filter (where stage = 'NOTICE' and status_at = 'CLOSED') as notice_closed
from s group by label, t order by t;

-- ── Q4. 화면 기준 D-day(DEMO 공고마다) ──────────────────────────
-- web/components/bids/format.ts:52-64 와 같은 규칙: 마감 < 기준 시각이면 '마감', KST 날짜가 같으면 'D-Day', 아니면 'D-n'(KST 날짜 차).
-- in_list_* 는 목록 기본 필터(NOTICE·진행 중)에 보이는지.
with asof(label, t) as (values
  ('10-28', '2026-10-28T10:00:00+09:00'::timestamptz),
  ('11-04', '2026-11-04T14:00:00+09:00'::timestamptz)
),
d as (
  select b.notice_id, b.title, b.stage, b.deadline_at, a.label, a.t,
    case
      when b.deadline_at is null then '—'
      when b.deadline_at < a.t then '마감'
      when (b.deadline_at at time zone 'Asia/Seoul')::date = (a.t at time zone 'Asia/Seoul')::date then 'D-Day'
      else 'D-' || ((b.deadline_at at time zone 'Asia/Seoul')::date - (a.t at time zone 'Asia/Seoul')::date)
    end as dday,
    (b.stage = 'NOTICE' and b.status in ('OPEN', 'AMENDED') and (b.deadline_at is null or b.deadline_at >= a.t)) as in_list
  from public.bid_notices b cross join asof a
  where b.is_demo and b.source = 'fixture'
)
select notice_id, title, stage, to_char(deadline_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as deadline_kst,
  max(dday) filter (where label = '10-28') as dday_1028, bool_or(in_list) filter (where label = '10-28') as in_list_1028,
  max(dday) filter (where label = '11-04') as dday_1104, bool_or(in_list) filter (where label = '11-04') as in_list_1104
from d group by notice_id, title, stage, deadline_at order by deadline_at nulls last, notice_id;

-- ── Q5. S4 장면(FX-02) ──────────────────────────────────────────
-- 운영 FX-02 에는 10-24 점검 분석·결정이 있다. 화면은 최신 run(created_at 순)을 보인다(opportunity_list_items :20-25).
select 'score_run' as kind, s.id, s.status, s.run_mode, s.ai_provider, s.score::text as score, s.recommendation as value,
  s.input_snapshot #>> '{config,today}' as snapshot_today, s.input_snapshot #>> '{bid,deadlineAt}' as snapshot_deadline, s.created_at
from public.score_runs s where s.bid_id = '687bd892-941f-56a9-9ea9-9754ea5e5f1a'
union all
select 'bid_review', r.id, null, null, null, null, r.decision, null, null, r.decided_at
from public.bid_reviews r where r.bid_id = '687bd892-941f-56a9-9ea9-9754ea5e5f1a'
order by created_at;
