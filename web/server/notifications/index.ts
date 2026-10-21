import "server-only";

// ── notifications 도메인 배럴. 바깥(worker)은 이 파일만 부른다 ──
// 인앱 알림 producer(docs/13-NOTIFICATIONS.md): outbox 이벤트를 notifications 행으로 바꾸는 규칙·저장·한 회차.
export {
  MAX_ATTEMPTS,
  NOTIFY_EVENT_TYPES,
  toNotificationIntent,
  toNotificationRow,
  toProcessedUpdate,
  toRetryUpdate,
} from "./outbox.model";
export type {
  NotificationIntent,
  NotificationOutboxStore,
  NotificationPayload,
  NotificationRow,
  NotifyEventType,
  OutboxEventRow,
  ProcessedUpdate,
  RetryUpdate,
  SendIntent,
} from "./outbox.model";

// 알림 outbox port 의 Supabase 구현. worker 가 service role 클라이언트를 넘긴다. 저장이 던지는 오류는 모두 NotificationStoreError 다.
export { NotificationStoreError, createNotificationOutboxStore } from "./outbox.repo";

// 한 회차. 주기 실행(타이머)은 worker 의 몫이다.
export { processOutboxBatch } from "./outbox.service";
export type { OutboxBatchDeps, OutboxBatchSummary } from "./outbox.service";

// 관심 공고 마감 알림(N3). DB 함수가 대상·수신자·멱등 키를 정하고 notifications 에 바로 넣는다(outbox 를 거치지 않는다).
export {
  DeadlineReminderStoreError,
  createDeadlineReminderStore,
  runDeadlineReminders,
} from "./deadline";
export type { DeadlineReminderDeps, DeadlineReminderStore } from "./deadline";
