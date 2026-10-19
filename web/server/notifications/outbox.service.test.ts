import { describe, expect, it } from "vitest";
import { processOutboxBatch } from "@/server/notifications";
import {
  ASSIGNEE_ID,
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_BID_ID,
  OTHER_EVENT_ID,
  OTHER_ORG_ID,
  REQUESTER_ID,
  REVIEWER_ID,
  REVIEW_ID,
  RUN_ID,
  analysisCompleteEvent,
  createMemoryStore,
  isoAfter,
  memoryRow,
  records,
  rejectionOf,
  reviewAssignedEvent,
  withPayload,
  type MemoryOutboxRow,
  type StoreCall,
} from "./outbox.test-support";

// 알림 outbox 한 회차(docs/13-NOTIFICATIONS.md). 처리할 이벤트를 찾아 하나씩 순서대로:
//   두 종이 아니거나 payload 가 틀리면 DEAD(재시도해도 같다), 수신자가 그 조직 멤버가 아니면 알림 없이 PROCESSED(혼입 방지),
//   공고가 없으면 알림 없이 PROCESSED, 그 밖에는 알림 1건(같은 키면 무시) 뒤 PROCESSED. 저장 실패는 지수 재시도, 다섯 번째에 DEAD.
// 저장은 메모리 흉내(notifications.idempotency_key UNIQUE·outbox compare-and-set)다. 시계·로그도 가짜다. DB·네트워크는 쓰지 않는다.

const LIMIT = 7;

type Options = Parameters<typeof createMemoryStore>[0];

async function run(options: Options = {}) {
  const memory = createMemoryStore(options);
  const lines: string[] = [];
  const summary = await processOutboxBatch({
    store: memory.store,
    now: () => new Date(NOW.getTime()),
    log: (line) => {
      lines.push(line);
    },
    limit: LIMIT,
  });
  return { ...memory, lines, summary };
}

/** message 에 값을 담은 오류. 로그로 새면 안 된다. */
const LEAK = "LEAK-공고원문-postgres://svc:pw@db";
function leakyError(name = "PostgrestError"): Error {
  const error = new Error(`${LEAK} 저장 실패`);
  error.name = name;
  return error;
}

/** 그 메서드 호출(이벤트 키가 맞으면)만 실패시킨다. */
const failOn =
  (method: StoreCall["method"], key?: string, error: Error = leakyError()) =>
  (call: StoreCall): Error | undefined =>
    call.method === method && (key === undefined || call.key === key) ? error : undefined;

const eventLines = (lines: readonly string[]) =>
  records(lines).filter((record) => record.event === "notify.outbox");
const summaryLines = (lines: readonly string[]) =>
  records(lines).filter((record) => record.event === "notify.outbox.summary");

describe("processOutboxBatch · 찾기", () => {
  it("findDue 를 한 번, now 의 ISO 값과 limit 으로 부른다", async () => {
    const s = await run();
    expect(s.findDueInputs).toEqual([{ now: NOW_ISO, limit: LIMIT }]);
  });

  it("처리할 이벤트가 없으면 요약은 모두 0 이다", async () => {
    const s = await run();
    expect(s.summary).toEqual({ checked: 0, sent: 0, skipped: 0, retried: 0, dead: 0 });
  });

  it("findDue 가 던지면 회차가 그 오류로 reject 하고 다른 저장 호출이 없다", async () => {
    const memory = createMemoryStore({
      events: [memoryRow(reviewAssignedEvent())],
      fail: failOn("findDue"),
    });
    const error = await rejectionOf(
      processOutboxBatch({ store: memory.store, now: () => NOW, log: () => undefined, limit: 1 }),
    );
    expect(error.name).toBe("PostgrestError");
    expect(memory.calls.map((call) => call.method)).toEqual(["findDue"]);
  });
});

describe("processOutboxBatch · SEND", () => {
  it("REVIEW_ASSIGNED 면 배정 대상에게 알림 1건을 넣는다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())] });
    expect(s.notifications).toEqual([
      {
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
          message: "결정 담당으로 지정되었습니다.",
          link: `/bids/${BID_ID}`,
        },
      },
    ]);
  });

  it("알림을 넣은 뒤 outbox 를 PROCESSED·processed_at=now 로 닫는다(attempts 는 그대로)", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())] });
    expect(s.eventOf(EVENT_ID)).toMatchObject({
      status: "PROCESSED",
      processed_at: NOW_ISO,
      attempts: 0,
    });
  });

  it("ANALYSIS_COMPLETE(PARTIAL)면 분석 요청자에게 PARTIAL 문구의 알림 1건이다", async () => {
    const s = await run({ events: [memoryRow(analysisCompleteEvent("PARTIAL"))] });
    expect(s.notifications.map((row) => [row.user_id, row.type, row.payload])).toEqual([
      [
        REQUESTER_ID,
        "ANALYSIS_COMPLETE",
        {
          bidId: BID_ID,
          title: BID_TITLE,
          message: "AI 없이 규칙만으로 분석했습니다. 결과를 확인해 주세요.",
          link: `/bids/${BID_ID}`,
        },
      ],
    ]);
  });

  it("title 은 그 공고의 공고명이다(readBidTitle)", async () => {
    const event = withPayload(reviewAssignedEvent(), { bidId: OTHER_BID_ID });
    const s = await run({
      events: [memoryRow(event)],
      bids: { [BID_ID]: BID_TITLE, [OTHER_BID_ID]: "다른 공고 (가상)" },
    });
    expect(s.notifications.map((row) => row.payload)).toEqual([
      {
        bidId: OTHER_BID_ID,
        title: "다른 공고 (가상)",
        message: "결정 담당으로 지정되었습니다.",
        link: `/bids/${OTHER_BID_ID}`,
      },
    ]);
  });

  it("다시 처리하는 FAILED 이벤트도 성공하면 PROCESSED 로 닫고 알림 1건이다", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent({ status: "FAILED", attempts: 2 }), {
          next_attempt_at: "2026-10-20T08:59:00.000Z",
        }),
      ],
    });
    expect([s.notifications.length, s.eventOf(EVENT_ID).status]).toEqual([1, "PROCESSED"]);
  });

  it("요약은 checked 1·sent 1 이다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())] });
    expect(s.summary).toEqual({ checked: 1, sent: 1, skipped: 0, retried: 0, dead: 0 });
  });

  it("같은 키의 알림이 이미 있어도(무시된 upsert) sent 로 세고 PROCESSED 로 닫는다", async () => {
    const memory = createMemoryStore({ events: [memoryRow(reviewAssignedEvent())] });
    await memory.store.insertNotification({
      org_id: ORG_ID,
      user_id: ASSIGNEE_ID,
      type: "REVIEW_ASSIGNED",
      channel: "IN_APP",
      status: "SENT",
      sent_at: "2026-10-20T08:00:00.000Z",
      idempotency_key: `${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`,
      payload: { bidId: BID_ID, title: "먼저 넣은 알림", message: "먼저", link: `/bids/${BID_ID}` },
    });
    const summary = await processOutboxBatch({
      store: memory.store,
      now: () => NOW,
      log: () => undefined,
      limit: LIMIT,
    });
    expect(summary).toMatchObject({ checked: 1, sent: 1 });
    expect(memory.notifications).toHaveLength(1);
    expect(memory.notifications[0]?.payload).toMatchObject({ title: "먼저 넣은 알림" });
    expect(memory.eventOf(EVENT_ID).status).toBe("PROCESSED");
  });
});

describe("processOutboxBatch · 수신자가 그 조직 멤버가 아니다", () => {
  const members: readonly (readonly [string, string])[] = [[OTHER_ORG_ID, ASSIGNEE_ID]];

  it("알림을 넣지 않는다(다른 조직 혼입 방지)", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], members });
    expect(s.notifications).toEqual([]);
  });

  it("멤버십은 이벤트의 org_id 와 수신자로 묻는다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], members });
    expect(s.calls.filter((call) => call.method === "isMember")).toEqual([
      { method: "isMember", key: `${ORG_ID}:${ASSIGNEE_ID}` },
    ]);
  });

  it("outbox 는 알림 0건으로 PROCESSED 로 닫는다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], members });
    expect(s.eventOf(EVENT_ID)).toMatchObject({ status: "PROCESSED", processed_at: NOW_ISO });
  });

  it("insertNotification 을 부르지 않고 skipped 로 센다", async () => {
    const s = await run({ events: [memoryRow(analysisCompleteEvent())], members });
    expect(s.calls.some((call) => call.method === "insertNotification")).toBe(false);
    expect(s.summary).toEqual({ checked: 1, sent: 0, skipped: 1, retried: 0, dead: 0 });
  });
});

describe("processOutboxBatch · 공고가 없다", () => {
  it("알림을 넣지 않고 PROCESSED 로 닫고 skipped 로 센다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], bids: {} });
    expect(s.notifications).toEqual([]);
    expect(s.eventOf(EVENT_ID).status).toBe("PROCESSED");
    expect(s.summary).toEqual({ checked: 1, sent: 0, skipped: 1, retried: 0, dead: 0 });
  });
});

describe("processOutboxBatch · INVALID 는 바로 DEAD", () => {
  const invalidEvents = [
    ["org_id null", reviewAssignedEvent({ org_id: null })],
    ["payload 위반", withPayload(reviewAssignedEvent(), { assigneeUserId: "user-1" })],
    ["orgId 불일치", withPayload(analysisCompleteEvent(), { orgId: OTHER_ORG_ID })],
  ] as const;

  it.each(invalidEvents)(
    "%s 이면 DEAD·attempts+1·next_attempt_at null 이다",
    async (_label, event) => {
      const s = await run({ events: [memoryRow(event)] });
      expect(s.eventOf(EVENT_ID)).toMatchObject({
        status: "DEAD",
        attempts: 1,
        next_attempt_at: null,
      });
    },
  );

  it.each(invalidEvents)("%s 이면 멤버십·공고를 묻지 않고 알림도 없다", async (_label, event) => {
    const s = await run({ events: [memoryRow(event)] });
    expect(s.calls.map((call) => call.method)).toEqual(["findDue", "markRetry"]);
    expect(s.notifications).toEqual([]);
  });

  it("FAILED 로 재시도 중이던 이벤트가 INVALID 면 attempts 를 하나 올려 DEAD 로 닫는다", async () => {
    const event = reviewAssignedEvent({ org_id: null, status: "FAILED", attempts: 2 });
    const s = await run({
      events: [memoryRow(event, { next_attempt_at: "2026-10-20T08:00:00.000Z" })],
    });
    expect(s.eventOf(EVENT_ID)).toMatchObject({ status: "DEAD", attempts: 3 });
  });

  it("요약은 dead 1 이다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent({ org_id: null }))] });
    expect(s.summary).toEqual({ checked: 1, sent: 0, skipped: 0, retried: 0, dead: 1 });
  });
});

describe("processOutboxBatch · 저장 실패는 재시도", () => {
  it.each([
    ["isMember", `${ORG_ID}:${ASSIGNEE_ID}`],
    ["readBidTitle", BID_ID],
    ["insertNotification", `${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`],
  ] as const)(
    "%s 가 던지면 FAILED·attempts 1·next_attempt_at=now+5s 로 둔다",
    async (method, key) => {
      const s = await run({
        events: [memoryRow(reviewAssignedEvent())],
        fail: failOn(method, key),
      });
      expect(s.eventOf(EVENT_ID)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        next_attempt_at: isoAfter(NOW, 5_000),
        processed_at: null,
      });
    },
  );

  it("실패한 이벤트는 PROCESSED 로 닫지 않는다", async () => {
    const s = await run({
      events: [memoryRow(reviewAssignedEvent())],
      fail: failOn("insertNotification"),
    });
    expect(s.calls.some((call) => call.method === "markProcessed")).toBe(false);
  });

  it("재시도 간격은 이벤트의 attempts 로 정한다(attempts 2 → 3·now+20s)", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent({ status: "FAILED", attempts: 2 }), {
          next_attempt_at: "2026-10-20T08:59:00.000Z",
        }),
      ],
      fail: failOn("readBidTitle"),
    });
    expect(s.eventOf(EVENT_ID)).toMatchObject({
      status: "FAILED",
      attempts: 3,
      next_attempt_at: isoAfter(NOW, 20_000),
    });
  });

  it("요약은 retried 1 이다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], fail: failOn("isMember") });
    expect(s.summary).toEqual({ checked: 1, sent: 0, skipped: 0, retried: 1, dead: 0 });
  });

  it("다섯 번째 실패(attempts 4)면 DEAD·attempts 5·next_attempt_at null 이고 dead 로 센다", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent({ status: "FAILED", attempts: 4 }), {
          next_attempt_at: "2026-10-20T08:59:00.000Z",
        }),
      ],
      fail: failOn("insertNotification"),
    });
    expect(s.eventOf(EVENT_ID)).toMatchObject({
      status: "DEAD",
      attempts: 5,
      next_attempt_at: null,
    });
    expect(s.summary).toEqual({ checked: 1, sent: 0, skipped: 0, retried: 0, dead: 1 });
  });

  it("markRetry 도 던지면 회차를 멈추지 않고 다음 이벤트를 처리한다", async () => {
    const second = analysisCompleteEvent("COMPLETED", { id: OTHER_EVENT_ID });
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent(), { created_at: "2026-10-20T08:00:00.000Z" }),
        memoryRow(second, { created_at: "2026-10-20T08:00:01.000Z" }),
      ],
      fail: (call) =>
        failOn("insertNotification", `${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`)(call) ??
        failOn("markRetry", EVENT_ID)(call),
    });
    expect(s.notifications.map((row) => row.idempotency_key)).toEqual([
      `${OTHER_EVENT_ID}:${REQUESTER_ID}:IN_APP`,
    ]);
    expect(s.eventOf(OTHER_EVENT_ID).status).toBe("PROCESSED");
  });

  it("markRetry 가 던져도 processOutboxBatch 는 reject 하지 않는다", async () => {
    const memory = createMemoryStore({
      events: [memoryRow(reviewAssignedEvent())],
      fail: (call) => failOn("isMember")(call) ?? failOn("markRetry")(call),
    });
    await expect(
      processOutboxBatch({ store: memory.store, now: () => NOW, log: () => undefined, limit: 1 }),
    ).resolves.toMatchObject({ checked: 1, sent: 0 });
  });
});

describe("processOutboxBatch · 순서", () => {
  const A = reviewAssignedEvent();
  const B = analysisCompleteEvent("COMPLETED", { id: OTHER_EVENT_ID });
  const rows: MemoryOutboxRow[] = [
    memoryRow(B, { created_at: "2026-10-20T08:00:02.000Z" }),
    memoryRow(A, { created_at: "2026-10-20T08:00:01.000Z" }),
  ];

  it("찾은 순서대로 이벤트 하나를 끝낸 뒤 다음 이벤트를 처리한다", async () => {
    const s = await run({ events: rows });
    expect(s.calls.map((call) => `${call.method} ${call.key}`)).toEqual([
      `findDue ${NOW_ISO}`,
      `isMember ${ORG_ID}:${ASSIGNEE_ID}`,
      `readBidTitle ${BID_ID}`,
      `insertNotification ${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`,
      `markProcessed ${EVENT_ID}`,
      `isMember ${ORG_ID}:${REQUESTER_ID}`,
      `readBidTitle ${BID_ID}`,
      `insertNotification ${OTHER_EVENT_ID}:${REQUESTER_ID}:IN_APP`,
      `markProcessed ${OTHER_EVENT_ID}`,
    ]);
  });

  it("두 이벤트를 각자의 수신자에게 한 건씩 알린다", async () => {
    const s = await run({ events: rows });
    expect(s.notifications.map((row) => row.user_id)).toEqual([ASSIGNEE_ID, REQUESTER_ID]);
    expect(s.summary).toEqual({ checked: 2, sent: 2, skipped: 0, retried: 0, dead: 0 });
  });

  it("한 이벤트의 실패는 다른 이벤트를 막지 않는다", async () => {
    const s = await run({ events: rows, fail: failOn("isMember", `${ORG_ID}:${ASSIGNEE_ID}`) });
    expect([s.eventOf(EVENT_ID).status, s.eventOf(OTHER_EVENT_ID).status]).toEqual([
      "FAILED",
      "PROCESSED",
    ]);
    expect(s.summary).toEqual({ checked: 2, sent: 1, skipped: 0, retried: 1, dead: 0 });
  });

  it("limit 보다 많은 이벤트는 다음 회차가 처리한다(이번 회차는 limit 건)", async () => {
    const many = Array.from({ length: LIMIT + 2 }, (_, index) =>
      memoryRow(
        reviewAssignedEvent({
          id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
        }),
        { created_at: new Date(Date.UTC(2026, 9, 20, 8, 0, index)).toISOString() },
      ),
    );
    const s = await run({ events: many });
    expect(s.summary.checked).toBe(LIMIT);
    expect(s.events.filter((row) => row.status === "PENDING")).toHaveLength(2);
  });
});

describe("processOutboxBatch · 로그", () => {
  const ALLOWED_KEYS = ["event", "outboxEventId", "eventType", "outcome", "attempts", "errorName"];

  it("이벤트마다 notify.outbox 한 줄을 남긴다(SENT)", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())] });
    expect(eventLines(s.lines)).toEqual([
      expect.objectContaining({
        event: "notify.outbox",
        outboxEventId: EVENT_ID,
        eventType: "REVIEW_ASSIGNED",
        outcome: "SENT",
      }),
    ]);
  });

  it.each([
    ["멤버 아님", { members: [] }, "SKIPPED_NOT_MEMBER"],
    ["공고 없음", { bids: {} }, "SKIPPED_NO_BID"],
    ["저장 실패", { fail: failOn("isMember") }, "RETRY"],
  ] as const)("%s 이면 outcome 은 %s 다", async (_label, extra, outcome) => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], ...extra });
    expect(eventLines(s.lines).map((line) => line.outcome)).toEqual([outcome]);
  });

  it("INVALID·다섯 번째 실패의 outcome 은 DEAD 다", async () => {
    const invalid = await run({ events: [memoryRow(reviewAssignedEvent({ org_id: null }))] });
    const fifth = await run({
      events: [
        memoryRow(reviewAssignedEvent({ status: "FAILED", attempts: 4 }), {
          next_attempt_at: "2026-10-20T08:59:00.000Z",
        }),
      ],
      fail: failOn("insertNotification"),
    });
    expect(
      [...eventLines(invalid.lines), ...eventLines(fifth.lines)].map((line) => line.outcome),
    ).toEqual(["DEAD", "DEAD"]);
  });

  it("저장 실패 줄의 errorName 은 오류 이름이고 오류 message 는 싣지 않는다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())], fail: failOn("isMember") });
    expect(eventLines(s.lines)[0]).toMatchObject({ outcome: "RETRY", errorName: "PostgrestError" });
    expect(s.lines.join("\n")).not.toContain("LEAK");
    expect(s.lines.join("\n")).not.toContain("pw@db");
  });

  it("이벤트 줄에는 event·outboxEventId·eventType·outcome·attempts·errorName 말고 다른 키가 없다", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent(), { created_at: "2026-10-20T08:00:00.000Z" }),
        memoryRow(analysisCompleteEvent("COMPLETED", { id: OTHER_EVENT_ID }), {
          created_at: "2026-10-20T08:00:01.000Z",
        }),
      ],
      fail: failOn("insertNotification", `${OTHER_EVENT_ID}:${REQUESTER_ID}:IN_APP`),
    });
    for (const line of eventLines(s.lines)) {
      expect(Object.keys(line).filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([]);
    }
  });

  it("로그에 payload 값·수신자·조직·공고명·문구를 싣지 않는다", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent(), { created_at: "2026-10-20T08:00:00.000Z" }),
        memoryRow(analysisCompleteEvent("PARTIAL", { id: OTHER_EVENT_ID }), {
          created_at: "2026-10-20T08:00:01.000Z",
        }),
      ],
    });
    const text = s.lines.join("\n");
    for (const value of [
      ASSIGNEE_ID,
      REQUESTER_ID,
      REVIEWER_ID,
      REVIEW_ID,
      RUN_ID,
      BID_ID,
      ORG_ID,
      BID_TITLE,
      "결정 담당으로 지정되었습니다.",
      "AI 없이 규칙만으로 분석했습니다.",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it("처리한 이벤트가 있으면 마지막 줄은 notify.outbox.summary 와 다섯 숫자다", async () => {
    const s = await run({ events: [memoryRow(reviewAssignedEvent())] });
    expect(records(s.lines).at(-1)).toEqual({
      event: "notify.outbox.summary",
      checked: 1,
      sent: 1,
      skipped: 0,
      retried: 0,
      dead: 0,
    });
  });

  it("처리한 이벤트가 없으면 요약 줄도 남기지 않는다(빈 회차는 조용하다)", async () => {
    const s = await run();
    expect(s.lines).toEqual([]);
  });

  it("요약 줄은 회차에 한 번이다", async () => {
    const s = await run({
      events: [
        memoryRow(reviewAssignedEvent(), { created_at: "2026-10-20T08:00:00.000Z" }),
        memoryRow(analysisCompleteEvent("COMPLETED", { id: OTHER_EVENT_ID }), {
          created_at: "2026-10-20T08:00:01.000Z",
        }),
      ],
    });
    expect(summaryLines(s.lines)).toHaveLength(1);
  });

  it("모든 줄은 줄바꿈 없는 JSON 한 줄이다", async () => {
    const s = await run({
      events: [memoryRow(reviewAssignedEvent())],
      fail: failOn("isMember"),
    });
    expect(s.lines.length).toBeGreaterThan(0);
    for (const line of s.lines) {
      expect(line).not.toContain("\n");
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
