import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  NOTIFY_EVENT_TYPES,
  toNotificationIntent,
  toNotificationRow,
  toProcessedUpdate,
  toRetryUpdate,
  type OutboxEventRow,
} from "./outbox.model";
import {
  ASSIGNEE_ID,
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_ORG_ID,
  REQUESTER_ID,
  REVIEWER_ID,
  RUN_ID,
  analysisCompleteEvent,
  isoAfter,
  reviewAssignedEvent,
  withPayload,
} from "./outbox.test-support";

// C7 인앱 알림 producer 의 순수 규칙(docs/13-NOTIFICATIONS.md). outbox 이벤트 하나를 알림 의도(SEND·INVALID)로 바꾸고,
// 의도를 notifications 행으로, 실패를 재시도 갱신으로 바꾼다. 두 종(REVIEW_ASSIGNED·ANALYSIS_COMPLETE)만 알린다.
// 공고 이벤트(BID_*)의 팬아웃은 이번 범위가 아니다. 수신자는 REVIEW_ASSIGNED 면 배정 대상, ANALYSIS_COMPLETE 면 분석 요청자다.

// C6 알림 목록 계약과 같은 모양의 strict 스키마. C6 의 web/server/bids/notification.model.ts(브랜치 c6/screens, 미병합)의
// notificationSchema·notificationSchema.payload 와 같다. C6 는 이 스키마를 통과하지 못한 알림을 목록에서 뺀다(docs/05-API-SPEC.md §4.6).
// C6 가 병합되면 이 사본 대신 그 스키마를 불러 쓴다.
const c6PayloadSchema = z.strictObject({
  bidId: z.string().min(1),
  title: z.string(),
  message: z.string(),
  link: z.string(),
  changedFields: z.array(z.string()).optional(),
});
const c6NotificationSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum([
    "BID_CREATED",
    "BID_CHANGED",
    "DEADLINE_APPROACHING",
    "ANALYSIS_COMPLETE",
    "REVIEW_ASSIGNED",
  ]),
  channel: z.enum(["IN_APP", "KAKAO"]),
  status: z.enum(["PENDING", "SENT", "FAILED", "DEAD"]),
  payload: c6PayloadSchema,
  readAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

const MESSAGE_REVIEW_ASSIGNED = "결정 담당으로 지정되었습니다.";
const MESSAGE_ANALYSIS_COMPLETED = "분석이 끝났습니다.";
const MESSAGE_ANALYSIS_PARTIAL = "AI 없이 규칙만으로 분석했습니다. 결과를 확인해 주세요.";

/** SEND 의도. INVALID 면 시험이 실패한다. */
function sendIntentOf(event: OutboxEventRow) {
  const intent = toNotificationIntent(event);
  if (intent.kind !== "SEND") throw new Error(`SEND 가 아니다: ${intent.kind}`);
  return intent;
}

const rowOf = (event: OutboxEventRow, title = BID_TITLE) =>
  toNotificationRow({ intent: sendIntentOf(event), outboxEventId: event.id, title, now: NOW });

describe("NOTIFY_EVENT_TYPES", () => {
  it("알리는 이벤트는 REVIEW_ASSIGNED·ANALYSIS_COMPLETE 두 종이다", () => {
    expect(NOTIFY_EVENT_TYPES).toEqual(["REVIEW_ASSIGNED", "ANALYSIS_COMPLETE"]);
  });
});

describe("toNotificationIntent · REVIEW_ASSIGNED", () => {
  it("배정 대상(assigneeUserId)에게 그 조직·공고의 SEND 의도를 만든다", () => {
    expect(toNotificationIntent(reviewAssignedEvent())).toEqual({
      kind: "SEND",
      orgId: ORG_ID,
      userId: ASSIGNEE_ID,
      bidId: BID_ID,
      type: "REVIEW_ASSIGNED",
      message: MESSAGE_REVIEW_ASSIGNED,
    });
  });

  it("트리거가 함께 쓰는 reviewerId·decision 같은 다른 키가 있어도 SEND 다", () => {
    const event = withPayload(reviewAssignedEvent(), { decision: "WATCH", extra: "무시" });
    expect(toNotificationIntent(event).kind).toBe("SEND");
  });

  it("검토자가 없는(reviewerId null) 관리 작업 배정도 SEND 다", () => {
    const event = withPayload(reviewAssignedEvent(), { reviewerId: null });
    expect(toNotificationIntent(event).kind).toBe("SEND");
  });

  it("자기 자신을 담당으로 지정해도(reviewerId = assigneeUserId) 알린다", () => {
    const event = withPayload(reviewAssignedEvent(), { reviewerId: ASSIGNEE_ID });
    expect(sendIntentOf(event).userId).toBe(ASSIGNEE_ID);
  });

  it("수신자는 검토자가 아니라 배정 대상이다", () => {
    expect(sendIntentOf(reviewAssignedEvent()).userId).not.toBe(REVIEWER_ID);
  });
});

describe("toNotificationIntent · ANALYSIS_COMPLETE", () => {
  it("분석 요청자(requestedBy)에게 그 조직·공고의 SEND 의도를 만든다(COMPLETED 문구)", () => {
    expect(toNotificationIntent(analysisCompleteEvent("COMPLETED"))).toEqual({
      kind: "SEND",
      orgId: ORG_ID,
      userId: REQUESTER_ID,
      bidId: BID_ID,
      type: "ANALYSIS_COMPLETE",
      message: MESSAGE_ANALYSIS_COMPLETED,
    });
  });

  it("PARTIAL 이면 규칙만으로 분석했다는 문구다", () => {
    expect(sendIntentOf(analysisCompleteEvent("PARTIAL")).message).toBe(MESSAGE_ANALYSIS_PARTIAL);
  });

  it("COMPLETED 와 PARTIAL 의 문구는 다르다", () => {
    expect(sendIntentOf(analysisCompleteEvent("COMPLETED")).message).not.toBe(
      sendIntentOf(analysisCompleteEvent("PARTIAL")).message,
    );
  });
});

describe("toNotificationIntent · INVALID", () => {
  const INVALID = { kind: "INVALID" };

  it.each([["BID_CREATED"], ["BID_CHANGED"], ["DEADLINE_APPROACHING"], ["UNKNOWN_EVENT"]])(
    "두 종이 아닌 이벤트(%s)는 INVALID 다",
    (eventType) => {
      expect(toNotificationIntent(reviewAssignedEvent({ event_type: eventType }))).toEqual(INVALID);
    },
  );

  it("org_id 가 null 이면(조직에 속하지 않은 이벤트) INVALID 다", () => {
    expect(toNotificationIntent(reviewAssignedEvent({ org_id: null }))).toEqual(INVALID);
    expect(toNotificationIntent(analysisCompleteEvent("COMPLETED", { org_id: null }))).toEqual(
      INVALID,
    );
  });

  it.each([
    ["assigneeUserId 없음", { assigneeUserId: undefined }],
    ["assigneeUserId null", { assigneeUserId: null }],
    ["assigneeUserId 가 uuid 아님", { assigneeUserId: "user-1" }],
    ["bidId 없음", { bidId: undefined }],
    ["bidId 가 uuid 아님", { bidId: "DEMO-2026-0006" }],
    ["reviewId 없음", { reviewId: undefined }],
    ["orgId 없음", { orgId: undefined }],
  ])("REVIEW_ASSIGNED payload 위반(%s)은 INVALID 다", (_label, patch) => {
    expect(toNotificationIntent(withPayload(reviewAssignedEvent(), patch))).toEqual(INVALID);
  });

  it.each([
    ["requestedBy null", { requestedBy: null }],
    ["requestedBy 없음", { requestedBy: undefined }],
    ["scoreRunId 없음", { scoreRunId: undefined }],
    ["status FAILED", { status: "FAILED" }],
    ["status 없음", { status: undefined }],
    ["bidId 가 uuid 아님", { bidId: "bid-1" }],
  ])("ANALYSIS_COMPLETE payload 위반(%s)은 INVALID 다", (_label, patch) => {
    expect(toNotificationIntent(withPayload(analysisCompleteEvent(), patch))).toEqual(INVALID);
  });

  it.each([
    ["배열", [BID_ID]],
    ["null", null],
    ["문자열", "payload"],
  ])("payload 가 객체가 아니면(%s) INVALID 다", (_label, payload) => {
    expect(toNotificationIntent(reviewAssignedEvent({ payload }))).toEqual(INVALID);
  });

  it("REVIEW_ASSIGNED payload.orgId 가 행의 org_id 와 다르면 INVALID 다(다른 조직 혼입 방지)", () => {
    const event = withPayload(reviewAssignedEvent(), { orgId: OTHER_ORG_ID });
    expect(toNotificationIntent(event)).toEqual(INVALID);
  });

  it("ANALYSIS_COMPLETE payload.orgId 가 행의 org_id 와 다르면 INVALID 다", () => {
    const event = analysisCompleteEvent("COMPLETED", { org_id: OTHER_ORG_ID });
    expect(toNotificationIntent(event)).toEqual(INVALID);
  });
});

describe("toNotificationRow", () => {
  it("REVIEW_ASSIGNED 의도를 그 조직·배정 대상의 IN_APP·SENT 알림 행으로 바꾼다", () => {
    expect(rowOf(reviewAssignedEvent())).toEqual({
      org_id: ORG_ID,
      user_id: ASSIGNEE_ID,
      type: "REVIEW_ASSIGNED",
      channel: "IN_APP",
      status: "SENT",
      sent_at: NOW_ISO,
      idempotency_key: `${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`,
      payload: {
        bidId: BID_ID,
        title: BID_TITLE,
        message: MESSAGE_REVIEW_ASSIGNED,
        link: `/bids/${BID_ID}`,
      },
    });
  });

  it("ANALYSIS_COMPLETE 의도는 분석 요청자의 행이고 문구는 의도의 문구다", () => {
    const row = rowOf(analysisCompleteEvent("PARTIAL"));
    expect([row.user_id, row.type, row.payload.message]).toEqual([
      REQUESTER_ID,
      "ANALYSIS_COMPLETE",
      MESSAGE_ANALYSIS_PARTIAL,
    ]);
  });

  it("idempotency_key 는 <outboxEventId>:<userId>:IN_APP 이다(docs/13 두 단계 멱등)", () => {
    expect(rowOf(analysisCompleteEvent()).idempotency_key).toBe(
      `${EVENT_ID}:${REQUESTER_ID}:IN_APP`,
    );
  });

  it("sent_at 은 받은 now 의 ISO 값이다", () => {
    const later = new Date("2026-10-21T00:00:01.234Z");
    const row = toNotificationRow({
      intent: sendIntentOf(reviewAssignedEvent()),
      outboxEventId: EVENT_ID,
      title: BID_TITLE,
      now: later,
    });
    expect(row.sent_at).toBe("2026-10-21T00:00:01.234Z");
  });

  it("payload 키는 정확히 bidId·title·message·link 넷이다(changedFields 없음)", () => {
    expect(Object.keys(rowOf(reviewAssignedEvent()).payload).toSorted()).toEqual([
      "bidId",
      "link",
      "message",
      "title",
    ]);
  });

  it("title 은 받은 공고명 그대로다", () => {
    expect(rowOf(reviewAssignedEvent(), "다른 공고명 (가상)").payload.title).toBe(
      "다른 공고명 (가상)",
    );
  });

  it("link 는 앱 안 경로 /bids/<bidId> 다(바깥 주소·// 로 시작하지 않는다)", () => {
    const { link } = rowOf(analysisCompleteEvent()).payload;
    expect(link).toBe(`/bids/${BID_ID}`);
    expect(link.startsWith("//")).toBe(false);
  });

  it("payload 는 C6 알림 목록의 strictObject payload 스키마를 통과한다", () => {
    for (const event of [reviewAssignedEvent(), analysisCompleteEvent("COMPLETED")]) {
      expect(c6PayloadSchema.safeParse(rowOf(event).payload).success).toBe(true);
    }
  });

  it("DB 행을 C6 Notification 으로 옮긴 값은 C6 notificationSchema 사본을 통과한다(type·channel·status 값 포함)", () => {
    const row = rowOf(reviewAssignedEvent());
    const notification = {
      id: "6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d",
      type: row.type,
      channel: row.channel,
      status: row.status,
      payload: row.payload,
      readAt: null,
      createdAt: NOW_ISO,
    };
    expect(c6NotificationSchema.safeParse(notification).success).toBe(true);
  });

  it("행에 outbox payload 의 다른 값(reviewId·scoreRunId·requestedBy)을 싣지 않는다", () => {
    const text = JSON.stringify([rowOf(reviewAssignedEvent()), rowOf(analysisCompleteEvent())]);
    expect(text).not.toContain(RUN_ID);
    expect(text).not.toContain(REVIEWER_ID);
  });
});

describe("toRetryUpdate", () => {
  it.each([
    [0, 1, 5_000],
    [1, 2, 10_000],
    [2, 3, 20_000],
    [3, 4, 40_000],
  ])(
    "attempts %i 에서 실패하면 FAILED·attempts %i·next_attempt_at 은 now + %ims 다",
    (attempts, next, delayMs) => {
      expect(toRetryUpdate(attempts, NOW)).toEqual({
        status: "FAILED",
        attempts: next,
        next_attempt_at: isoAfter(NOW, delayMs),
      });
    },
  );

  it("attempts 4 에서 실패하면(다섯 번째 실패) DEAD·attempts 5·next_attempt_at null 이다", () => {
    expect(toRetryUpdate(4, NOW)).toEqual({ status: "DEAD", attempts: 5, next_attempt_at: null });
  });

  it("attempts 가 이미 5 이상이면 DEAD 이고 attempts 를 하나 올린다", () => {
    expect(toRetryUpdate(5, NOW)).toEqual({ status: "DEAD", attempts: 6, next_attempt_at: null });
  });

  it("재시도 시각은 받은 now 기준이다", () => {
    const later = new Date("2026-10-21T00:00:00.000Z");
    expect(toRetryUpdate(0, later).next_attempt_at).toBe("2026-10-21T00:00:05.000Z");
  });
});

describe("toProcessedUpdate", () => {
  it("PROCESSED 와 processed_at(now 의 ISO 값)이다", () => {
    expect(toProcessedUpdate(NOW)).toEqual({ status: "PROCESSED", processed_at: NOW_ISO });
  });
});
