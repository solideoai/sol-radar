import "server-only";
import { errorNameOf } from "@/server/shared";
import {
  toDeadUpdate,
  toNotificationIntent,
  toNotificationRow,
  toRetryUpdate,
  type NotificationOutboxStore,
  type OutboxEventRow,
  type RetryUpdate,
  type SendIntent,
} from "./outbox.model";

// ── 알림 outbox 한 회차(docs/13-NOTIFICATIONS.md "pending polling"). 찾은 이벤트를 순서대로 하나씩 끝낸다 ──
//   INVALID(종류·조직·payload 가 틀렸다) → 다시 해도 같으므로 바로 DEAD.
//   수신자가 그 조직 멤버가 아니다 → 알림 없이 PROCESSED(다른 조직 혼입 방지).
//   공고가 없다 → 알림 없이 PROCESSED.
//   그 밖 → 알림 1건(같은 키면 무시) 뒤 PROCESSED. 같은 이벤트를 다시 처리해도 알림은 하나다(두 단계 멱등).
//   저장 실패 → 지수 재시도(FAILED), 다섯 번째 실패면 DEAD.
// 로그는 이벤트마다 JSON 한 줄이고 식별자·종류·결과·시도 수·오류 이름만 싣는다.
// 수신자·조직·공고·공고명·문구·오류 message 는 싣지 않는다(docs/14-OBSERVABILITY.md). 이벤트는 outboxEventId 로 추적한다.

export type OutboxBatchDeps = {
  store: NotificationOutboxStore;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
  limit: number;
};

export type OutboxBatchSummary = {
  checked: number;
  sent: number;
  skipped: number;
  retried: number;
  dead: number;
};

type Outcome = "SENT" | "SKIPPED_NOT_MEMBER" | "SKIPPED_NO_BID" | "RETRY" | "DEAD";
type EventResult = { outcome: Outcome; attempts?: number; errorName?: string };

/** 알림을 넣거나 건너뛰고 PROCESSED 로 닫는다. 저장이 던지면 그대로 던진다(부르는 쪽이 재시도로 돌린다). */
async function deliver(
  store: NotificationOutboxStore,
  event: OutboxEventRow,
  intent: SendIntent,
  now: Date,
): Promise<Outcome> {
  if (!(await store.isMember(intent.orgId, intent.userId))) {
    await store.markProcessed(event, now);
    return "SKIPPED_NOT_MEMBER";
  }
  const title = await store.readBidTitle(intent.bidId);
  if (title === null) {
    await store.markProcessed(event, now);
    return "SKIPPED_NO_BID";
  }
  await store.insertNotification(
    toNotificationRow({ intent, outboxEventId: event.id, title, now }),
  );
  await store.markProcessed(event, now);
  return "SENT";
}

/**
 * 재시도(또는 DEAD) 갱신을 쓴다. 이 쓰기도 실패하면 행이 그대로 남아 다음 회차가 다시 고르므로 RETRY 로 센다.
 * 그때 errorName 은 상태를 못 바꾼 원인(markRetry 의 오류)이다.
 */
async function closeForRetry(
  store: NotificationOutboxStore,
  event: OutboxEventRow,
  update: RetryUpdate,
  errorName: string | undefined,
): Promise<EventResult> {
  try {
    await store.markRetry(event, update);
  } catch (error) {
    return { outcome: "RETRY", errorName: errorNameOf(error) };
  }
  return {
    outcome: update.status === "DEAD" ? "DEAD" : "RETRY",
    attempts: update.attempts,
    ...(errorName === undefined ? {} : { errorName }),
  };
}

async function processEvent(deps: OutboxBatchDeps, event: OutboxEventRow): Promise<EventResult> {
  const intent = toNotificationIntent(event);
  if (intent.kind === "INVALID") {
    return closeForRetry(deps.store, event, toDeadUpdate(event.attempts), undefined);
  }
  const now = deps.now();
  try {
    return { outcome: await deliver(deps.store, event, intent, now) };
  } catch (error) {
    return closeForRetry(deps.store, event, toRetryUpdate(event.attempts, now), errorNameOf(error));
  }
}

/**
 * 한 회차. limit 건까지 찾아 순서대로 하나씩 처리한다(같은 회차 안에서 DB 에 몰아 보내지 않는다).
 * 이벤트 하나의 실패는 그 이벤트만 재시도로 돌리고 나머지를 계속한다. findDue 실패는 던진다.
 * 요약 줄은 처리한 이벤트가 있을 때만 남긴다(빈 회차가 2초마다 줄을 쌓지 않게).
 */
export async function processOutboxBatch(deps: OutboxBatchDeps): Promise<OutboxBatchSummary> {
  const events = await deps.store.findDue({
    now: deps.now().toISOString(),
    limit: deps.limit,
  });

  const outcomes: Outcome[] = [];
  for (const event of events) {
    const result = await processEvent(deps, event);
    deps.log(
      JSON.stringify({
        event: "notify.outbox",
        outboxEventId: event.id,
        eventType: event.event_type,
        ...result,
      }),
    );
    outcomes.push(result.outcome);
  }

  const count = (...matches: Outcome[]) =>
    outcomes.filter((outcome) => matches.includes(outcome)).length;
  const summary: OutboxBatchSummary = {
    checked: outcomes.length,
    sent: count("SENT"),
    skipped: count("SKIPPED_NOT_MEMBER", "SKIPPED_NO_BID"),
    retried: count("RETRY"),
    dead: count("DEAD"),
  };
  if (summary.checked > 0) {
    deps.log(JSON.stringify({ event: "notify.outbox.summary", ...summary }));
  }
  return summary;
}
