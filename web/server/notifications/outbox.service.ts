import "server-only";
import { errorNameOf } from "@/server/shared";
import { isKakaoEventType, type KakaoChannelDeps, type KakaoEventResult } from "./kakao.model";
import { processKakaoEvent } from "./kakao.service";
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
//   수신자가 정지 계정이다 → 알림 없이 PROCESSED(docs/09-SECURITY.md "정지" — my_org_ids 처럼 활동 계정만 본다).
//   공고가 없다 → 알림 없이 PROCESSED.
//   그 밖 → 알림 1건(같은 키면 무시) 뒤 PROCESSED. 같은 이벤트를 다시 처리해도 알림은 하나다(두 단계 멱등).
//   저장 실패 → 지수 재시도(FAILED), 다섯 번째 실패면 DEAD.
// 카카오 두 종(BID_RECOMMENDED·KAKAO_TEST)은 위 인앱 규칙(toNotificationIntent) 전에 카카오 소비자(processKakaoEvent)로 넘긴다.
//   그 결과로 닫는다: SENT·SKIPPED_* → PROCESSED · RETRY → 지수 재시도 · DEAD → DEAD. 소비자의 저장이 던지면 위와 같이 지수 재시도.
// shouldStop(종료 신호)이 true 면 남은 이벤트는 건드리지 않고(PENDING·FAILED 그대로) 회차를 끝낸다. 다음 기동의 회차가 다시 고른다.
// 로그는 이벤트마다 JSON 한 줄이고 식별자·종류·결과·시도 수·오류 이름만 싣는다. 카카오 이벤트는 결과 수(sent·failed)도 싣는다.
// 수신자·조직·공고·공고명·문구·피드 본문·오류 message 는 싣지 않는다(docs/14-OBSERVABILITY.md). 이벤트는 outboxEventId 로 추적한다.

export type OutboxBatchDeps = {
  store: NotificationOutboxStore;
  /** 기존 인앱 호출은 그대로 받는다. 카카오 의존성 누락은 재시도로 남겨 이벤트를 버리지 않는다. */
  kakao?: KakaoChannelDeps;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
  limit: number;
  /** 이벤트마다 처리 전에 묻는다. true 면 남은 이벤트를 두고 회차를 끝낸다(worker stop 이 회차 전체를 기다리지 않게). */
  shouldStop?: () => boolean;
};

export type OutboxBatchSummary = {
  checked: number;
  sent: number;
  skipped: number;
  retried: number;
  dead: number;
};

type Outcome =
  | "SENT"
  | "SKIPPED_NOT_MEMBER"
  | "SKIPPED_INACTIVE"
  | "SKIPPED_NO_BID"
  | "SKIPPED_NO_RECIPIENT"
  | "RETRY"
  | "DEAD";
type EventResult = {
  outcome: Outcome;
  attempts?: number;
  errorName?: string;
  /** 카카오 이벤트만: 이번 회차에 보낸 수·못 보낸 수. */
  sent?: number;
  failed?: number;
};

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
  if (!(await store.isActive(intent.userId))) {
    await store.markProcessed(event, now);
    return "SKIPPED_INACTIVE";
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

/** 카카오 소비자의 결과로 이벤트를 닫는다. RETRY·DEAD 의 갱신이 실패해도 closeForRetry 가 RETRY 로 센다. */
async function closeKakao(
  store: NotificationOutboxStore,
  event: OutboxEventRow,
  kakao: KakaoEventResult,
  now: Date,
): Promise<EventResult> {
  const counts = { sent: kakao.sent, failed: kakao.failed };
  if (kakao.outcome === "RETRY") {
    return {
      ...(await closeForRetry(store, event, toRetryUpdate(event.attempts, now), undefined)),
      ...counts,
    };
  }
  if (kakao.outcome === "DEAD") {
    return {
      ...(await closeForRetry(store, event, toDeadUpdate(event.attempts), undefined)),
      ...counts,
    };
  }
  await store.markProcessed(event, now);
  return { outcome: kakao.outcome, ...counts };
}

/** 카카오 두 종. 소비자·markProcessed 가 던지면(저장 실패) 인앱과 같이 지수 재시도다. */
async function processKakao(deps: OutboxBatchDeps, event: OutboxEventRow): Promise<EventResult> {
  const now = deps.now();
  try {
    if (deps.kakao === undefined) throw new Error("KAKAO_CHANNEL_NOT_CONFIGURED");
    const kakao = await processKakaoEvent({ ...deps.kakao, now: deps.now }, event);
    return await closeKakao(deps.store, event, kakao, now);
  } catch (error) {
    return closeForRetry(deps.store, event, toRetryUpdate(event.attempts, now), errorNameOf(error));
  }
}

async function processEvent(deps: OutboxBatchDeps, event: OutboxEventRow): Promise<EventResult> {
  if (isKakaoEventType(event.event_type)) return processKakao(deps, event);
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
 * shouldStop 이 true 면 그 이벤트부터는 저장 호출·로그 없이 멈춘다. 요약은 처리한 이벤트만 센다.
 * 요약 줄은 처리한 이벤트가 있을 때만 남긴다(빈 회차가 2초마다 줄을 쌓지 않게).
 */
export async function processOutboxBatch(deps: OutboxBatchDeps): Promise<OutboxBatchSummary> {
  const events = await deps.store.findDue({
    now: deps.now().toISOString(),
    limit: deps.limit,
  });

  const outcomes: Outcome[] = [];
  for (const event of events) {
    if (deps.shouldStop?.() === true) break;
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
    skipped: count(
      "SKIPPED_NOT_MEMBER",
      "SKIPPED_INACTIVE",
      "SKIPPED_NO_BID",
      "SKIPPED_NO_RECIPIENT",
    ),
    retried: count("RETRY"),
    dead: count("DEAD"),
  };
  if (summary.checked > 0) {
    deps.log(JSON.stringify({ event: "notify.outbox.summary", ...summary }));
  }
  return summary;
}
