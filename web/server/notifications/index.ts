import "server-only";

// ── notifications 도메인 배럴. 바깥(worker)은 이 파일만 부른다 ──
// 알림 producer(docs/13-NOTIFICATIONS.md): outbox 이벤트를 notifications 행으로 바꾸는 규칙·저장·한 회차.
// 인앱 두 종과 카카오톡 추천 공고 알림(카카오 두 종)을 함께 처리한다.
export {
  MAX_ATTEMPTS,
  NOTIFY_EVENT_TYPES,
  toNotificationIntent,
  toNotificationRow,
  toProcessedUpdate,
  toRetryUpdate,
} from "./outbox.model";
export type {
  InAppEventType,
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

// 한 회차. 주기 실행(타이머)은 worker 의 몫이다. 카카오 두 종(BID_RECOMMENDED·KAKAO_TEST)도 이 회차가 카카오 소비자로 넘긴다.
export { processOutboxBatch } from "./outbox.service";
export type { OutboxBatchDeps, OutboxBatchSummary } from "./outbox.service";

// 카카오톡 추천 공고 알림 소비자(설계 docs/plans/2026-10-20-kakao-memo-notify-design.md §5.2·§5.5): 규칙·저장·이벤트 하나.
export {
  KAKAO_EVENT_TYPES,
  TIMEOUT_UNKNOWN,
  isKakaoEventType,
  toBidFeedInput,
  toKakaoEvent,
  toKakaoExpiredRow,
  toKakaoNotificationRow,
  toKakaoRowUpdate,
} from "./kakao.model";
export type {
  KakaoChannelDeps,
  KakaoEvent,
  KakaoEventOutcome,
  KakaoEventResult,
  KakaoEventType,
  KakaoFeedSource,
  KakaoNotificationRow,
  KakaoOutboxStore,
  KakaoRowStatus,
  KakaoRowUpdate,
} from "./kakao.model";
// 카카오 소비자 저장 port 의 Supabase 구현. worker 가 service role 클라이언트를 넘긴다. 던지는 오류는 NotificationStoreError 다.
export { createKakaoOutboxStore } from "./kakao.repo";
export { processKakaoEvent } from "./kakao.service";
export type { KakaoEventDeps } from "./kakao.service";
