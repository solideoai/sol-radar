-- 20261022000110_deadline_reminders — N3 마감 알림: send_deadline_reminders(p_now) 가 D-3·D-1 인앱 알림을 바로 넣는다.
--
-- 근거: polaris/specs/in-progress/2026-10-21-n3-watchlist.md §6·§8 Q1 ①·§9, docs/plans/2026-10-21-n3-watchlist-plan.md Task 2,
-- 사이드바 정보 구조 설계 D7, docs/13(DEADLINE_APPROACHING — 담당자 ∪ 관심 등록자, 인앱).
-- worker 주기 작업(기본 5분)이 service role 로 부른다. outbox 를 거치지 않고 notifications 에 바로 넣는다 — 멱등은
-- notifications.idempotency_key(unique)가 맡는다(12 판단 Q1 ①). 채널은 IN_APP 만이다(카카오·메일 마감 알림은 범위 밖).
--
-- 이 파일에 든 것:
--   1. send_deadline_reminders(p_now timestamptz) returns integer — 넣은 알림 행 수. security definer, search_path = ''.
--      규칙(KST 는 고정 +9시간, 일광 절약 없음 — 'Asia/Seoul' 이름에 기대지 않는다):
--        kst_now = (p_now at time zone 'UTC') + 9시간. kst_now 가 09:00 전이면 0 을 돌려준다.
--        대상 공고: deadline_at 이 있고 p_now 보다 뒤이며 status 가 OPEN·AMENDED. n = (마감의 KST 날짜 − kst_now 의 날짜)가 3 또는 1.
--          그날(KST)이 D-n 이 아니면 보내지 않는다 — 놓친 D-3 을 D-2 에 늦게 보내지 않는다.
--        수신자(조직마다): 그 조직의 최신 bid_reviews(decided_at desc, id desc) 한 행의 assignee_id(null 이면 없음)
--          ∪ 그 조직에서 그 공고를 관심 등록한 user_id. (조직, 사용자)로 중복을 없앤다. 그 조직 구성원이고
--          profiles.status = 'active' 인 사람만.
--        넣는 행: type DEADLINE_APPROACHING·channel IN_APP·status SENT·sent_at p_now,
--          idempotency_key `<bidId>:<userId>:DEADLINE_APPROACHING:D-<n>`,
--          payload { bidId, title(공고명), message("마감 3일 전입니다."·"마감 하루 전입니다."), link `/bids/<bidId>` }.
--          on conflict (idempotency_key) do nothing — 같은 날 다시·동시에 돌아도 1건이다.
--      p_now 가 null 이면 22004 오류다(조용히 0 을 돌려주지 않는다).
--   2. 권한 — 화면 역할(anon·authenticated)과 PUBLIC 의 실행 권한을 거두고 service_role(worker)에만 준다.
--
-- 바꾸지 않는 것: notifications·bid_watches·bid_reviews 의 표·정책, outbox 흐름(notify-outbox).
--
-- 되돌리기(새 마이그레이션으로): drop function if exists public.send_deadline_reminders(timestamptz);
-- 이미 넣은 알림 행은 남는다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. send_deadline_reminders(p_now)
--
-- 시각은 인자로만 받는다(now() 를 읽지 않는다). 그래서 worker 의 시계로 돌고 시험이 경계 시각을 고정할 수 있다.
-- security definer 인 이유: 수신자 계산이 여러 조직의 결정·관심 행과 프로필 상태를 함께 읽고, 받은 사람의 org_id·user_id 로
-- 알림을 직접 넣는다. 화면 역할은 실행할 수 없어(2절) /rpc 로 불리지 않는다.
-- 키에 조직이 없으므로 같은 사람이 두 조직에서 같은 공고의 수신자이면 한 건만 들어간다(키가 정본 13 의 모양이다).
-- ────────────────────────────────────────────────────────────────
create or replace function public.send_deadline_reminders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kst_now timestamp;
  v_inserted integer;
begin
  if p_now is null then
    raise exception 'p_now 가 없습니다' using errcode = '22004';
  end if;

  v_kst_now := (p_now at time zone 'UTC') + interval '9 hours';
  if v_kst_now::time < time '09:00' then
    return 0;
  end if;

  with due as (
    select b.id as bid_id, b.title, d.days_left
    from public.bid_notices b
    cross join lateral (
      select ((b.deadline_at at time zone 'UTC') + interval '9 hours')::date - v_kst_now::date as days_left
    ) d
    where b.deadline_at is not null
      and b.deadline_at > p_now
      and b.status in ('OPEN', 'AMENDED')
      and d.days_left in (3, 1)
  ), latest_reviews as (
    select distinct on (r.org_id, r.bid_id) r.org_id, r.bid_id, r.assignee_id
    from public.bid_reviews r
    join due on due.bid_id = r.bid_id
    order by r.org_id, r.bid_id, r.decided_at desc, r.id desc
  ), recipients as (
    select lr.org_id, lr.bid_id, lr.assignee_id as user_id
    from latest_reviews lr
    where lr.assignee_id is not null
    union
    select w.org_id, w.bid_id, w.user_id
    from public.bid_watches w
    join due on due.bid_id = w.bid_id
  )
  insert into public.notifications (org_id, user_id, type, channel, status, sent_at, idempotency_key, payload)
  select
    rc.org_id,
    rc.user_id,
    'DEADLINE_APPROACHING',
    'IN_APP',
    'SENT',
    p_now,
    due.bid_id::text || ':' || rc.user_id::text || ':DEADLINE_APPROACHING:D-' || due.days_left::text,
    jsonb_build_object(
      'bidId', due.bid_id,
      'title', due.title,
      'message', case due.days_left when 3 then '마감 3일 전입니다.' else '마감 하루 전입니다.' end,
      'link', '/bids/' || due.bid_id::text
    )
  from recipients rc
  join due on due.bid_id = rc.bid_id
  join public.memberships m on m.org_id = rc.org_id and m.user_id = rc.user_id
  join public.profiles p on p.id = rc.user_id
  where p.status = 'active'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. 권한
--
-- Supabase 는 public 의 새 함수에 화면 역할 실행 권한을 따로 주므로 PUBLIC 만 거두면 /rpc 로 그대로 불린다(database 스킬).
-- 화면 역할에서 모두 거두고 worker 의 service_role 에만 준다. service_role 역할이 없는 DB(PGlite 정책 시험·타입 생성)에서는
-- grant 를 건너뛴다(20261019000009 와 같다).
-- ────────────────────────────────────────────────────────────────
revoke all on function public.send_deadline_reminders(timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.send_deadline_reminders(timestamptz) to service_role;
  end if;
end;
$$;
