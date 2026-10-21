-- 카카오톡 알림 시험 메시지 하루 상한을 세는 부분 인덱스(ADR-038, 보안 검토 하).
--
-- request_kakao_notify_test()(20261021000003)는 부를 때마다 그 사람의 최근 24시간 KAKAO_TEST 를 센다.
-- 상한을 넘은 뒤에도 로그인한 사람은 이 RPC 를 계속 부를 수 있다. 기존 인덱스는 어느 것도 이 조건에 맞지 않는다:
-- (status, next_attempt_at), org_id, 그리고 PENDING·FAILED 만 덮는 notify_due 다.
-- 그래서 셀 때마다 outbox_events 전체를 읽었다. 이 인덱스는 KAKAO_TEST 행만 (사람, 시각) 순으로 덮는다.
-- 다른 이벤트 종류의 쓰기에는 비용이 없다(부분 인덱스).

create index if not exists outbox_events_kakao_test_idx
  on public.outbox_events (aggregate_id, created_at)
  where event_type = 'KAKAO_TEST';
