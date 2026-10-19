import "server-only";
import { z } from "zod";
import type { Json } from "@/lib/database.types";

// ── 인앱 알림 producer 의 순수 규칙: outbox 이벤트 → 알림 의도 → notifications 행, 실패 → 재시도 갱신 (docs/13-NOTIFICATIONS.md) ──
// 두 종(REVIEW_ASSIGNED·ANALYSIS_COMPLETE)만 알린다. 공고 이벤트(BID_*, org_id null)의 조직 팬아웃은 아직 하지 않는다.
// 수신자는 REVIEW_ASSIGNED 면 배정 대상, ANALYSIS_COMPLETE 면 분석 요청자다(docs/13 "이벤트와 전달" 표).
// 시각은 Date 로 받고 ISO 문자열로 돌려준다. 저장·시계·로그는 모른다.

/** 알림 단계가 고르는 이벤트 종류. */
export const NOTIFY_EVENT_TYPES = ["REVIEW_ASSIGNED", "ANALYSIS_COMPLETE"] as const;
export type NotifyEventType = (typeof NOTIFY_EVENT_TYPES)[number];

/** outbox_events 에서 읽는 열. findDue 가 PENDING 과 재시도 시각이 된 FAILED 만 고른다. */
export type OutboxEventRow = {
  id: string;
  org_id: string | null;
  event_type: string;
  payload: Json;
  status: "PENDING" | "FAILED";
  attempts: number;
};

// 트리거·함수가 쓰는 payload 가운데 알림에 쓰는 키만 본다. 다른 키(reviewerId·decision 등)는 그대로 둔다.
// 근거: 마이그레이션 20261019000007(log_bid_review_audit)·20261019000016(finish_score_run).
const reviewAssignedPayloadSchema = z.looseObject({
  reviewId: z.uuid(),
  bidId: z.uuid(),
  orgId: z.uuid(),
  assigneeUserId: z.uuid(),
});

const analysisCompletePayloadSchema = z.looseObject({
  scoreRunId: z.uuid(),
  bidId: z.uuid(),
  orgId: z.uuid(),
  requestedBy: z.uuid(),
  status: z.enum(["COMPLETED", "PARTIAL"]),
});

const MESSAGE_REVIEW_ASSIGNED = "결정 담당으로 지정되었습니다.";
const MESSAGE_ANALYSIS_COMPLETED = "분석이 끝났습니다.";
const MESSAGE_ANALYSIS_PARTIAL = "AI 없이 규칙만으로 분석했습니다. 결과를 확인해 주세요.";

export type SendIntent = {
  kind: "SEND";
  orgId: string;
  userId: string;
  bidId: string;
  type: NotifyEventType;
  message: string;
};
/** SEND 는 알릴 사람·공고·문구, INVALID 는 다시 해도 같은 결과인 이벤트(종류·조직·payload 가 틀렸다). */
export type NotificationIntent = SendIntent | { kind: "INVALID" };

/** payload 를 알림 의도로 읽는다. payload 의 조직(orgId)도 함께 돌려줘 행의 org_id 와 맞춰 보게 한다. */
function readPayload(
  eventType: string,
  payload: Json,
): { payloadOrgId: string; intent: Omit<SendIntent, "orgId"> } | null {
  if (eventType === "REVIEW_ASSIGNED") {
    const parsed = reviewAssignedPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      payloadOrgId: parsed.data.orgId,
      intent: {
        kind: "SEND",
        userId: parsed.data.assigneeUserId,
        bidId: parsed.data.bidId,
        type: "REVIEW_ASSIGNED",
        message: MESSAGE_REVIEW_ASSIGNED,
      },
    };
  }
  if (eventType === "ANALYSIS_COMPLETE") {
    const parsed = analysisCompletePayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      payloadOrgId: parsed.data.orgId,
      intent: {
        kind: "SEND",
        userId: parsed.data.requestedBy,
        bidId: parsed.data.bidId,
        type: "ANALYSIS_COMPLETE",
        message:
          parsed.data.status === "PARTIAL" ? MESSAGE_ANALYSIS_PARTIAL : MESSAGE_ANALYSIS_COMPLETED,
      },
    };
  }
  return null;
}

/**
 * outbox 이벤트 하나를 알림 의도로 바꾼다. 두 종이 아니거나, 조직에 속하지 않거나(org_id null),
 * payload 가 틀리거나, payload 의 조직이 행의 조직과 다르면(다른 조직 혼입) INVALID 다.
 * 자기 자신을 담당으로 지정해도 알린다.
 */
export function toNotificationIntent(event: OutboxEventRow): NotificationIntent {
  const orgId = event.org_id;
  if (orgId === null) return { kind: "INVALID" };
  const read = readPayload(event.event_type, event.payload);
  if (read === null || read.payloadOrgId !== orgId) return { kind: "INVALID" };
  return { ...read.intent, orgId };
}

/** 알림 목록(docs/05-API-SPEC.md §4.6)이 받는 payload. 키는 정확히 넷이다. */
export type NotificationPayload = { bidId: string; title: string; message: string; link: string };

/** notifications 에 넣는 행. 행을 만들 때 이미 보낸 것으로 본다(인앱은 행 기록이 곧 발송이다). */
export type NotificationRow = {
  org_id: string;
  user_id: string;
  type: NotifyEventType;
  channel: "IN_APP";
  status: "SENT";
  sent_at: string;
  idempotency_key: string;
  payload: NotificationPayload;
};

/**
 * 의도를 인앱 알림 행으로 바꾼다. idempotency_key 는 outboxEventId + userId + channel 이다(docs/13 두 단계 멱등).
 * link 는 앱 안 경로만 쓴다(열린 리다이렉트 방지, docs/13). title 은 공고명이다.
 */
export function toNotificationRow(input: {
  intent: SendIntent;
  outboxEventId: string;
  title: string;
  now: Date;
}): NotificationRow {
  const { intent, outboxEventId, title, now } = input;
  return {
    org_id: intent.orgId,
    user_id: intent.userId,
    type: intent.type,
    channel: "IN_APP",
    status: "SENT",
    sent_at: now.toISOString(),
    idempotency_key: `${outboxEventId}:${intent.userId}:IN_APP`,
    payload: {
      bidId: intent.bidId,
      title,
      message: intent.message,
      link: `/bids/${intent.bidId}`,
    },
  };
}

/** 다섯 번째 실패에서 DEAD 로 닫는다. */
export const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 5_000;

export type RetryUpdate =
  | { status: "FAILED"; attempts: number; next_attempt_at: string }
  | { status: "DEAD"; attempts: number; next_attempt_at: null };

/** 저장 실패 뒤 갱신. 간격은 5초부터 두 배씩(5·10·20·40초)이고, 실패가 MAX_ATTEMPTS 번째면 DEAD 다. */
export function toRetryUpdate(attempts: number, now: Date): RetryUpdate {
  const next = attempts + 1;
  if (next >= MAX_ATTEMPTS) return { status: "DEAD", attempts: next, next_attempt_at: null };
  return {
    status: "FAILED",
    attempts: next,
    next_attempt_at: new Date(now.getTime() + RETRY_BASE_MS * 2 ** attempts).toISOString(),
  };
}

/** INVALID 이벤트는 다시 해도 같으므로 재시도 없이 바로 DEAD 로 닫는다. */
export function toDeadUpdate(attempts: number): RetryUpdate {
  return { status: "DEAD", attempts: attempts + 1, next_attempt_at: null };
}

export type ProcessedUpdate = { status: "PROCESSED"; processed_at: string };

export function toProcessedUpdate(now: Date): ProcessedUpdate {
  return { status: "PROCESSED", processed_at: now.toISOString() };
}

/**
 * 알림 outbox 저장 port. worker 가 service role 클라이언트로 만든 구현(outbox.repo)을 넘긴다.
 * markProcessed·markRetry 는 읽은 상태(id·status·attempts)가 그대로일 때만 바꾼다(compare-and-set).
 * 0행이면 다른 처리자가 먼저 처리한 것이라 오류가 아니다.
 */
export type NotificationOutboxStore = {
  /** now 는 Date.toISOString 모양이어야 한다(필터 값에 그대로 들어간다). */
  findDue(input: { now: string; limit: number }): Promise<OutboxEventRow[]>;
  /** 공고명. 공고가 없으면 null. */
  readBidTitle(bidId: string): Promise<string | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  /** 같은 idempotency_key 가 이미 있으면 아무것도 하지 않는다(on conflict do nothing). */
  insertNotification(row: NotificationRow): Promise<void>;
  markProcessed(event: OutboxEventRow, now: Date): Promise<void>;
  markRetry(event: OutboxEventRow, update: RetryUpdate): Promise<void>;
};
