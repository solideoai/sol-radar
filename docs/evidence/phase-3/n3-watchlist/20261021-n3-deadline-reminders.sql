\echo '-- 관심 행'
select w.bid_id, b.title, (b.deadline_at at time zone 'UTC' + interval '9 hours')::date as deadline_kst, p.email
  from public.bid_watches w join public.bid_notices b on b.id = w.bid_id join auth.users p on p.id = w.user_id;
\echo '-- 08:59 KST(10-25) → 0 이어야 한다'
set role service_role;
select public.send_deadline_reminders('2026-10-24T23:59:00Z') as sent_before_9;
\echo '-- 10:00 KST(10-25) = 10-28 마감의 D-3'
select public.send_deadline_reminders('2026-10-25T01:00:00Z') as sent_first;
\echo '-- 같은 시각 다시 → 0(중복 키)'
select public.send_deadline_reminders('2026-10-25T01:05:00Z') as sent_again;
reset role;
\echo '-- 들어간 알림'
select n.idempotency_key, n.status, u.email, n.payload->>'message' as message, n.payload->>'link' as link
  from public.notifications n join auth.users u on u.id = n.user_id
 where n.type = 'DEADLINE_APPROACHING' order by n.created_at;
\echo '-- authenticated 는 실행 못 한다'
set role authenticated;
select public.send_deadline_reminders('2026-10-25T01:00:00Z');
