import "server-only";
import {
  toBidFeedTemplate,
  toTestFeedTemplate,
  type KakaoFeedTemplate,
  type KakaoSender,
} from "@/server/kakao-notify";
import { errorNameOf } from "@/server/shared";
import {
  toBidFeedInput,
  toKakaoEvent,
  toKakaoExpiredRow,
  toKakaoNotificationRow,
  toKakaoRowUpdate,
  type KakaoChannelDeps,
  type KakaoEvent,
  type KakaoEventOutcome,
  type KakaoEventResult,
  type KakaoFeedSource,
  type KakaoRowUpdate,
} from "./kakao.model";
import { toRetryUpdate, type OutboxEventRow } from "./outbox.model";

// ── 카카오톡 추천 공고 알림 소비자: outbox 이벤트 하나(설계 §5.2·§5.5, 계획 Task 4) ──
// BID_RECOMMENDED:
//   1. 받는 사람을 보낼 때마다 다시 고른다(그 조직 멤버 ⋈ 켬·CONNECTED ⋈ 활동 계정). 이벤트 뒤에 끄거나 연결을 해제한 사람은 빠진다.
//      0명이면 SKIPPED_NO_RECIPIENT. 그다음 피드 재료를 읽는다 — 없거나 이벤트와 조직·공고가 다르면 SKIPPED_NO_BID.
//   2. 사람마다 순서대로: 그 공고를 이미 받았으면(다른 조직에서라도) 건너뛴다 → KAKAO 행을 보장한다(두 단계 멱등)
//      → 행이 SENT·DEAD 면 건너뛴다 → 보낸다 → (만료로 바뀌었으면 인앱 알림) → 행을 갱신한다.
//      발송 수단이 던지면(연결 저장 오류 등 — 보내기 전에만 던진다) 그 사람의 행만 FAILED 로 두고 다음 사람에게 계속 보낸다.
//   3. 이번 회차에 FAILED 가 하나라도 있으면 이벤트는 재시도(RETRY)다. 다음 회차는 SENT·DEAD 가 아닌 사람에게만 보낸다.
//      재시도를 다 썼으면(toRetryUpdate 가 DEAD) DEAD 이고, 이벤트를 닫을 때는 아직 열린 행(PENDING·FAILED)을 모두 DEAD 로 닫는다.
// KAKAO_TEST: 정지 계정이면 SKIPPED_INACTIVE. 아니면 notifications 행 없이 시험 피드 한 통만 보내고 결과와 상관없이 닫는다
//   (결과는 발송 수단이 연결 표의 last_result 에 적는다. 시험에서 만료를 알게 되면 인앱 알림을 만들지 않는다 — 설정 화면이 보여 준다).
// INVALID: 다시 해도 같으므로 저장·발송 없이 DEAD.
// 저장이 던지면 그대로 던진다(부르는 쪽이 이벤트를 재시도로 돌린다). 로그는 부르는 쪽(outbox.service)이 결과 수만 싣는다.
// 수신자·공고명·피드 본문은 결과에 싣지 않는다.

export type KakaoEventDeps = KakaoChannelDeps & { now: () => Date };

type RecommendedEvent = Extract<KakaoEvent, { kind: "RECOMMENDED" }>;
/** 받는 사람 하나의 결과. SKIPPED 는 이미 받았거나 행이 이미 닫혔다. */
type Delivery = "SKIPPED" | KakaoRowUpdate["status"];

const result = (outcome: KakaoEventOutcome, sent = 0, failed = 0): KakaoEventResult => ({
  outcome,
  sent,
  failed,
});

/** 발송 수단이 던지면 그 사람만 FAILED(오류 이름)로 본다. 발송 수단은 아무것도 보내지 않았을 때만 던진다(kakao-sender). */
async function sendToOne(
  sender: KakaoSender,
  userId: string,
  template: KakaoFeedTemplate,
): Promise<KakaoRowUpdate> {
  try {
    return toKakaoRowUpdate(await sender.send(userId, template));
  } catch (error) {
    return { status: "FAILED", error: errorNameOf(error), notifyExpired: false };
  }
}

async function deliverTo(
  deps: KakaoEventDeps,
  outboxEventId: string,
  source: KakaoFeedSource,
  template: KakaoFeedTemplate,
  userId: string,
): Promise<Delivery> {
  if (await deps.store.hasKakaoSentForBid(userId, source.bidId)) return "SKIPPED";
  const row = await deps.store.ensureKakaoRow(
    toKakaoNotificationRow({
      outboxEventId,
      orgId: source.orgId,
      userId,
      bidId: source.bidId,
      title: source.title,
      recommendation: source.recommendation,
    }),
  );
  if (row.status === "SENT" || row.status === "DEAD") return "SKIPPED";
  const update = await sendToOne(deps.sender, userId, template);
  // 인앱 알림을 행 갱신보다 먼저 넣는다. 행 갱신이 실패해 다시 보내면 발송 수단이 changed=false 를 돌려줘 이 알림을 다시 만들 수 없다.
  if (update.notifyExpired) {
    await deps.store.insertNotification(
      toKakaoExpiredRow({
        outboxEventId,
        orgId: source.orgId,
        userId,
        bidId: source.bidId,
        title: source.title,
        now: deps.now(),
      }),
    );
  }
  await deps.store.setKakaoRowStatus(row.id, update.status, update.error, deps.now());
  return update.status;
}

/** 이벤트를 닫는다(재시도가 아니다). 이전 회차에 남은 열린 행(끈 사람의 FAILED 등)도 함께 닫는다. */
async function close(
  deps: KakaoEventDeps,
  event: RecommendedEvent,
  closed: KakaoEventResult,
): Promise<KakaoEventResult> {
  await deps.store.closeOpenKakaoRows(event.orgId, event.bidId);
  return closed;
}

async function processRecommended(
  deps: KakaoEventDeps,
  event: OutboxEventRow,
  recommended: RecommendedEvent,
): Promise<KakaoEventResult> {
  const recipients = await deps.store.listRecipients(recommended.orgId);
  if (recipients.length === 0) return close(deps, recommended, result("SKIPPED_NO_RECIPIENT"));
  const source = await deps.store.readFeedSource(recommended.scoreRunId);
  const isSameBid =
    source !== null && source.orgId === recommended.orgId && source.bidId === recommended.bidId;
  if (source === null || !isSameBid) return close(deps, recommended, result("SKIPPED_NO_BID"));

  const template = toBidFeedTemplate(toBidFeedInput(source, deps.siteUrl, deps.now()));
  // 한 사람씩 순서대로 보낸다. 같은 사용자 1초 1통은 발송 수단이 지킨다.
  const deliveries: Delivery[] = [];
  for (const userId of recipients) {
    deliveries.push(await deliverTo(deps, event.id, source, template, userId));
  }
  const sent = deliveries.filter((delivery) => delivery === "SENT").length;
  const failed = deliveries.filter(
    (delivery) => delivery === "FAILED" || delivery === "DEAD",
  ).length;
  if (!deliveries.includes("FAILED")) return close(deps, recommended, result("SENT", sent, failed));
  if (toRetryUpdate(event.attempts, deps.now()).status === "FAILED") {
    return result("RETRY", sent, failed);
  }
  return close(deps, recommended, result("DEAD", sent, failed));
}

async function processTest(deps: KakaoEventDeps, userId: string): Promise<KakaoEventResult> {
  if (!(await deps.store.isActive(userId))) return result("SKIPPED_INACTIVE");
  const sendResult = await deps.sender.send(userId, toTestFeedTemplate(deps.siteUrl));
  return sendResult.kind === "SENT" ? result("SENT", 1, 0) : result("SENT", 0, 1);
}

/**
 * 카카오 이벤트 하나(BID_RECOMMENDED·KAKAO_TEST)를 처리하고 이벤트를 어떻게 닫을지 돌려준다. outbox 상태는 바꾸지 않는다 —
 * 부르는 쪽(processOutboxBatch)이 결과로 PROCESSED·재시도·DEAD 를 쓴다.
 */
export async function processKakaoEvent(
  deps: KakaoEventDeps,
  event: OutboxEventRow,
): Promise<KakaoEventResult> {
  const kakaoEvent = toKakaoEvent(event);
  if (kakaoEvent.kind === "INVALID") return result("DEAD");
  if (kakaoEvent.kind === "TEST") return processTest(deps, kakaoEvent.userId);
  return processRecommended(deps, event, kakaoEvent);
}
