-- 20261019000017_outbox_notify_due_index — 인앱 알림 처리(worker)가 보낼 outbox 이벤트를 찾는 부분 인덱스.
--
-- 근거: docs/13-NOTIFICATIONS.md(pending polling), docs/04-DATABASE.md outbox_events. C7 보안 검토 후속(3e 검토, e8 번호 배정
-- 2026-10-20). worker 는 2초마다 두 종(REVIEW_ASSIGNED·ANALYSIS_COMPLETE)의 PENDING 과 재시도 시각이 된 FAILED 를
-- (created_at, id) 순으로 limit 건 읽는다(web/server/notifications/outbox.repo.ts findDue). 공고 이벤트(BID_*)는 아직 소비자가 없어
-- PENDING 으로 쌓인다. 20261019000006 의 (status, next_attempt_at) 인덱스로는 그 행들까지 훑게 되므로, 알림 처리가 고르는 행만 담은
-- 인덱스를 둔다.
--
-- 이 파일에 든 것: outbox_events_notify_due_idx — (created_at, id), 조건 status in (PENDING, FAILED) and event_type in
-- (REVIEW_ASSIGNED, ANALYSIS_COMPLETE). 조건 목록은 findDue 의 필터와 같아야 한다(바꾸면 함께 바꾼다).
-- 바꾸지 않는 것: 표·열·권한·정책. 20261019000016 은 고치지 않는다.
--
-- 되돌리기(새 마이그레이션으로): drop index if exists public.outbox_events_notify_due_idx;
-- 이 파일은 고치지 않는다(append-only).

create index if not exists outbox_events_notify_due_idx
  on public.outbox_events (created_at, id)
  where status in ('PENDING', 'FAILED')
    and event_type in ('REVIEW_ASSIGNED', 'ANALYSIS_COMPLETE');
