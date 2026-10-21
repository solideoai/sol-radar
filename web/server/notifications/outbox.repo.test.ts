import { describe, expect, it } from "vitest";
import {
  NOTIFY_EVENT_TYPES,
  NotificationStoreError,
  createNotificationOutboxStore,
  toNotificationIntent,
  toNotificationRow,
  toProcessedUpdate,
  toRetryUpdate,
  type OutboxEventRow,
} from "@/server/notifications";
import {
  ASSIGNEE_ID,
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  LEAKY_ERROR_TEXT,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_EVENT_ID,
  analysisCompleteEvent,
  bodyRows,
  conflictColumns,
  eqValue,
  fakeSupabase,
  inValues,
  memoryTable,
  on,
  postgrestError,
  rejectionOf,
  reviewAssignedEvent,
  routes,
  selectedColumns,
  type FakeRow,
  type PostgrestCall,
  type PostgrestRoute,
} from "./outbox.test-support";

// 알림 outbox 저장 port 의 Supabase 구현(service role). 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어 PostgREST 로 나가는
// 요청(표·방법·select 열·필터·Prefer·본문)을 본다. 필터 흉내(memoryTable)로 어떤 행이 골라지고 바뀌는지도 본다.
// 근거: docs/13-NOTIFICATIONS.md(worker 가 service role 로 발송·상태 전이, 두 단계 멱등, 상태 PENDING → PROCESSED·FAILED → DEAD).
// outbox 상태 갱신은 compare-and-set 이다(id·status·attempts 가 읽은 값과 같을 때만). 0행이면 다른 처리자가 먼저 처리했다.
// 저장이 던지는 오류는 모두 NotificationStoreError 다. 로그에는 오류 이름만 싣고 message 는 싣지 않으므로(docs/14-OBSERVABILITY.md)
// 이름이 "Error" 가 아니라 저장 오류임을 알려야 한다. message 모양("notifications store 오류: <표>.<동작> <code>")은 그대로다.

function only(calls: PostgrestCall[]): PostgrestCall {
  expect(calls).toHaveLength(1);
  return calls[0];
}

const storeWith = (route?: PostgrestRoute) => {
  const fake = fakeSupabase(route);
  return { store: createNotificationOutboxStore(fake.client), fake };
};

const ERROR_PATTERN = (table: string, code: string) =>
  new RegExp(`^notifications store 오류: ${table}\\.\\S+ ${code}$`);

const sendRow = () => {
  const intent = toNotificationIntent(reviewAssignedEvent());
  if (intent.kind !== "SEND") throw new Error("SEND 가 아니다");
  return toNotificationRow({ intent, outboxEventId: EVENT_ID, title: BID_TITLE, now: NOW });
};

// ── findDue ──

describe("findDue · 질의", () => {
  async function find(input = { now: NOW_ISO, limit: 7 }) {
    const { store, fake } = storeWith();
    await store.findDue(input);
    return only(fake.callsTo("outbox_events", "GET"));
  }

  it("outbox_events 를 GET 한 번으로 읽는다", async () => {
    const { store, fake } = storeWith();
    await store.findDue({ now: NOW_ISO, limit: 7 });
    expect(fake.sequence()).toEqual(["GET outbox_events"]);
  });

  it("id·org_id·event_type·payload·status·attempts 열만 고른다", async () => {
    expect(selectedColumns(await find())).toEqual(
      ["id", "org_id", "event_type", "payload", "status", "attempts"].toSorted(),
    );
  });

  it("event_type in (NOTIFY_EVENT_TYPES: 인앱 두 종·카카오 두 종) 조건을 건다", async () => {
    expect(inValues(await find(), "event_type")).toEqual([...NOTIFY_EVENT_TYPES].toSorted());
  });

  it("or 조건은 PENDING 이거나 FAILED 이면서 next_attempt_at 이 now 이하인 행이다", async () => {
    expect((await find()).params.get("or")).toBe(
      `(status.eq.PENDING,and(status.eq.FAILED,next_attempt_at.lte.${NOW_ISO}))`,
    );
  });

  it("or 조건에 받은 now 를 그대로 넣는다", async () => {
    const call = await find({ now: "2025-12-31T23:59:59.999Z", limit: 1 });
    expect(call.params.get("or")).toBe(
      "(status.eq.PENDING,and(status.eq.FAILED,next_attempt_at.lte.2025-12-31T23:59:59.999Z))",
    );
  });

  it("created_at·id 오름차순으로 정렬한다", async () => {
    expect((await find()).params.get("order")).toBe("created_at.asc,id.asc");
  });

  it("limit 건까지만 읽는다", async () => {
    expect((await find()).params.get("limit")).toBe("7");
  });

  it("org_id 조건을 걸지 않는다(모든 조직의 이벤트를 처리한다)", async () => {
    expect((await find()).params.has("org_id")).toBe(false);
  });

  it("읽기만 한다(GET 외 요청이 없다)", async () => {
    const { store, fake } = storeWith();
    await store.findDue({ now: NOW_ISO, limit: 7 });
    expect(fake.calls.every((call) => call.method === "GET")).toBe(true);
  });
});

describe("findDue · 잘못된 now 는 필터에 넣지 않는다", () => {
  it.each([
    ["오프셋 시각", "2026-10-20T18:00:00.000+09:00"],
    ["밀리초 없음", "2026-10-20T09:00:00Z"],
    ["날짜만", "2026-10-20"],
    ["빈 값", ""],
    ["필터 주입", `${NOW_ISO}),status.eq.DEAD,and(id.eq.x`],
    ["없는 날짜", "2026-02-30T00:00:00.000Z"],
  ])(
    "now 가 Date.toISOString 모양이 아니면(%s) 요청 없이 notifications store 오류로 던진다",
    async (_label, now) => {
      const { store, fake } = storeWith();
      const error = await rejectionOf(store.findDue({ now, limit: 7 }));
      expect(error.message).toMatch(/^notifications store 오류: outbox_events\.\S+ \S+$/);
      expect(fake.calls).toEqual([]);
    },
  );

  it("거절 message 에 받은 값을 싣지 않는다", async () => {
    const { store } = storeWith();
    const error = await rejectionOf(store.findDue({ now: "SECRETVALUE-now", limit: 7 }));
    expect(error.message).not.toContain("SECRETVALUE");
  });
});

describe("findDue · 고르는 행(필터 흉내)", () => {
  const PAST = "2026-10-20T08:59:59.999Z";
  const FUTURE = "2026-10-20T09:00:00.001Z";
  const row = (
    id: string,
    event_type: string,
    status: string,
    extra: Partial<FakeRow> = {},
  ): FakeRow => ({
    id,
    org_id: ORG_ID,
    event_type,
    payload: {},
    status,
    attempts: status === "PENDING" ? 0 : 2,
    next_attempt_at: null,
    processed_at: null,
    created_at: "2026-10-20T08:00:00.000Z",
    ...extra,
  });
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const ROWS: FakeRow[] = [
    row(id(1), "REVIEW_ASSIGNED", "PENDING", { created_at: "2026-10-20T08:00:03.000Z" }),
    row(id(2), "ANALYSIS_COMPLETE", "FAILED", {
      next_attempt_at: PAST,
      created_at: "2026-10-20T08:00:01.000Z",
    }),
    row(id(3), "ANALYSIS_COMPLETE", "FAILED", { next_attempt_at: NOW_ISO }),
    row(id(4), "REVIEW_ASSIGNED", "FAILED", { next_attempt_at: FUTURE }),
    row(id(5), "REVIEW_ASSIGNED", "PROCESSED", { processed_at: PAST }),
    row(id(6), "ANALYSIS_COMPLETE", "DEAD", { attempts: 5 }),
    row(id(7), "BID_CHANGED", "PENDING", { org_id: null }),
    row(id(8), "BID_CREATED", "PENDING", { org_id: null }),
    row(id(9), "DEADLINE_APPROACHING", "PENDING"),
  ];

  async function dueIds(limit = 50) {
    const table = memoryTable("outbox_events", ROWS);
    const { store } = storeWith(table.route);
    return (await store.findDue({ now: NOW_ISO, limit })).map((event) => event.id);
  }

  it("PENDING 과 재시도 시각이 된 FAILED 만 created_at 순으로 고른다", async () => {
    expect(await dueIds()).toEqual([id(3), id(2), id(1)]);
  });

  it("재시도 시각이 now 와 같은 FAILED 도 고른다(lte)", async () => {
    expect(await dueIds()).toContain(id(3));
  });

  it("재시도 시각이 아직 오지 않은 FAILED 는 고르지 않는다", async () => {
    expect(await dueIds()).not.toContain(id(4));
  });

  it("PROCESSED·DEAD 는 고르지 않는다", async () => {
    const ids = await dueIds();
    expect([ids.includes(id(5)), ids.includes(id(6))]).toEqual([false, false]);
  });

  it("공고 이벤트(BID_CHANGED·BID_CREATED)와 DEADLINE_APPROACHING 은 PENDING 이어도 고르지 않는다", async () => {
    const ids = await dueIds();
    expect(ids.filter((value) => [id(7), id(8), id(9)].includes(value))).toEqual([]);
  });

  it("limit 건까지만 돌려준다", async () => {
    expect(await dueIds(2)).toEqual([id(3), id(2)]);
  });
});

describe("findDue · 결과", () => {
  it("행을 OutboxEventRow 그대로 받은 순서대로 돌려준다", async () => {
    const rows: OutboxEventRow[] = [
      reviewAssignedEvent(),
      analysisCompleteEvent("PARTIAL", { id: OTHER_EVENT_ID, status: "FAILED", attempts: 3 }),
    ];
    const { store } = storeWith(on("GET", "outbox_events", { status: 200, body: rows }));
    await expect(store.findDue({ now: NOW_ISO, limit: 50 })).resolves.toEqual(rows);
  });

  it("행이 없으면 빈 목록이다", async () => {
    const { store } = storeWith(on("GET", "outbox_events", { status: 200, body: [] }));
    await expect(store.findDue({ now: NOW_ISO, limit: 50 })).resolves.toEqual([]);
  });

  it("질의 오류는 'notifications store 오류: outbox_events.<동작> <code>' 로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("GET", "outbox_events", postgrestError("42501")));
    const error = await rejectionOf(store.findDue({ now: NOW_ISO, limit: 50 }));
    expect(error.message).toMatch(ERROR_PATTERN("outbox_events", "42501"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── readBidTitle ──

describe("readBidTitle", () => {
  const NOTICES: FakeRow[] = [
    { id: BID_ID, title: BID_TITLE, source: "fixture" },
    { id: "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968", title: "다른 공고 (가상)", source: "fixture" },
  ];

  it("bid_notices 를 id 로 읽고 title 열만 고른다", async () => {
    const { store, fake } = storeWith(memoryTable("bid_notices", NOTICES).route);
    await store.readBidTitle(BID_ID);
    const call = only(fake.callsTo("bid_notices", "GET"));
    expect(eqValue(call, "id")).toBe(BID_ID);
    expect(selectedColumns(call)).toEqual(["title"]);
  });

  it("공고가 있으면 그 title 을 돌려준다", async () => {
    const { store } = storeWith(memoryTable("bid_notices", NOTICES).route);
    await expect(store.readBidTitle(BID_ID)).resolves.toBe(BID_TITLE);
  });

  it("공고가 없으면 null 이다", async () => {
    const { store } = storeWith(memoryTable("bid_notices", []).route);
    await expect(store.readBidTitle(BID_ID)).resolves.toBeNull();
  });

  it("질의 오류는 bid_notices 의 notifications store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("GET", "bid_notices", postgrestError("42501")));
    const error = await rejectionOf(store.readBidTitle(BID_ID));
    expect(error.message).toMatch(ERROR_PATTERN("bid_notices", "42501"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── isMember ──

describe("isMember", () => {
  const MEMBERS: FakeRow[] = [{ org_id: ORG_ID, user_id: ASSIGNEE_ID, sol_role: "VIEWER" }];

  it("memberships 를 org_id·user_id 로 읽고 user_id 열만 고른다", async () => {
    const { store, fake } = storeWith(memoryTable("memberships", MEMBERS).route);
    await store.isMember(ORG_ID, ASSIGNEE_ID);
    const call = only(fake.callsTo("memberships", "GET"));
    expect([eqValue(call, "org_id"), eqValue(call, "user_id")]).toEqual([ORG_ID, ASSIGNEE_ID]);
    expect(selectedColumns(call)).toEqual(["user_id"]);
  });

  it("그 조직의 멤버면 true 다", async () => {
    const { store } = storeWith(memoryTable("memberships", MEMBERS).route);
    await expect(store.isMember(ORG_ID, ASSIGNEE_ID)).resolves.toBe(true);
  });

  it("다른 조직의 멤버이거나 멤버가 아니면 false 다", async () => {
    const { store } = storeWith(memoryTable("memberships", MEMBERS).route);
    await expect(store.isMember("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", ASSIGNEE_ID)).resolves.toBe(
      false,
    );
  });

  it("질의 오류는 memberships 의 notifications store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("GET", "memberships", postgrestError("42501")));
    const error = await rejectionOf(store.isMember(ORG_ID, ASSIGNEE_ID));
    expect(error.message).toMatch(ERROR_PATTERN("memberships", "42501"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── isActive ──
// 정지 계정에게는 알리지 않는다(docs/09-SECURITY.md "정지" — profiles.status = 'suspended' 면 조직 데이터가 닫힌다).
// profiles.status 를 id 로 읽는다. 'active' 만 true 이고 'suspended' 이거나 행이 없으면 false 다.

describe("isActive", () => {
  const OTHER_USER_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
  const PROFILES: FakeRow[] = [
    { id: ASSIGNEE_ID, status: "active", email: "assignee@example.invalid" },
    { id: OTHER_USER_ID, status: "suspended", email: "suspended@example.invalid" },
  ];

  it("profiles 를 GET 한 번으로 id 로 읽고 status 열만 고른다", async () => {
    const { store, fake } = storeWith(memoryTable("profiles", PROFILES).route);
    await store.isActive(ASSIGNEE_ID);
    expect(fake.sequence()).toEqual(["GET profiles"]);
    const call = only(fake.callsTo("profiles", "GET"));
    expect(eqValue(call, "id")).toBe(ASSIGNEE_ID);
    expect(selectedColumns(call)).toEqual(["status"]);
  });

  it("status 가 active 면 true 다", async () => {
    const { store } = storeWith(memoryTable("profiles", PROFILES).route);
    await expect(store.isActive(ASSIGNEE_ID)).resolves.toBe(true);
  });

  it("status 가 suspended 면 false 다", async () => {
    const { store } = storeWith(memoryTable("profiles", PROFILES).route);
    await expect(store.isActive(OTHER_USER_ID)).resolves.toBe(false);
  });

  it("행이 없으면(지운 계정) false 다", async () => {
    const { store } = storeWith(memoryTable("profiles", []).route);
    await expect(store.isActive(ASSIGNEE_ID)).resolves.toBe(false);
  });

  it("질의 오류는 'notifications store 오류: profiles.select <code>' 의 NotificationStoreError 로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("GET", "profiles", postgrestError("42501")));
    const error = await rejectionOf(store.isActive(ASSIGNEE_ID));
    expect([error.name, error.message]).toEqual([
      "NotificationStoreError",
      "notifications store 오류: profiles.select 42501",
    ]);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── insertNotification ──

describe("insertNotification", () => {
  it("notifications 에 idempotency_key 충돌 시 아무것도 하지 않는 upsert(resolution=ignore-duplicates)를 보낸다", async () => {
    const { store, fake } = storeWith();
    await store.insertNotification(sendRow());
    const call = only(fake.callsTo("notifications", "POST"));
    expect(conflictColumns(call)).toEqual(["idempotency_key"]);
    expect(call.prefer).toContain("resolution=ignore-duplicates");
  });

  it("병합 upsert 가 아니다(resolution=merge-duplicates 가 없다)", async () => {
    const { store, fake } = storeWith();
    await store.insertNotification(sendRow());
    expect(only(fake.callsTo("notifications", "POST")).prefer).not.toContain(
      "resolution=merge-duplicates",
    );
  });

  it("본문은 받은 행 그대로다", async () => {
    const { store, fake } = storeWith();
    await store.insertNotification(sendRow());
    expect(bodyRows(only(fake.callsTo("notifications", "POST")))).toEqual([sendRow()]);
  });

  it("같은 idempotency_key 의 알림이 이미 있으면 오류 없이 그 행을 그대로 둔다", async () => {
    const existing: FakeRow = { ...sendRow(), payload: { marker: "먼저 넣은 알림" } };
    const table = memoryTable("notifications", [existing], { unique: ["idempotency_key"] });
    const { store } = storeWith(table.route);
    await store.insertNotification(sendRow());
    expect(table.rows).toEqual([existing]);
  });

  it("넣기 오류는 notifications 의 notifications store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("POST", "notifications", postgrestError("23503")));
    const error = await rejectionOf(store.insertNotification(sendRow()));
    expect(error.message).toMatch(ERROR_PATTERN("notifications", "23503"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── markProcessed·markRetry ──

describe("markProcessed", () => {
  const event = reviewAssignedEvent({ status: "FAILED", attempts: 2 });

  it("id·status·attempts 가 읽은 값과 같을 때만 갱신한다(compare-and-set)", async () => {
    const { store, fake } = storeWith();
    await store.markProcessed(event, NOW);
    const call = only(fake.callsTo("outbox_events", "PATCH"));
    expect([eqValue(call, "id"), eqValue(call, "status"), eqValue(call, "attempts")]).toEqual([
      EVENT_ID,
      "FAILED",
      "2",
    ]);
  });

  it("본문은 toProcessedUpdate(now) 다", async () => {
    const { store, fake } = storeWith();
    await store.markProcessed(event, NOW);
    const call = only(fake.callsTo("outbox_events", "PATCH"));
    expect(call.body).toEqual(toProcessedUpdate(NOW));
    expect(call.body).toEqual({ status: "PROCESSED", processed_at: NOW_ISO });
  });

  it("0행이 바뀌어도(다른 처리자가 먼저 처리했다) 던지지 않고 다시 갱신하지 않는다", async () => {
    const { store, fake } = storeWith(on("PATCH", "outbox_events", { status: 200, body: [] }));
    await store.markProcessed(event, NOW);
    expect(fake.callsTo("outbox_events", "PATCH")).toHaveLength(1);
  });

  it("갱신 오류는 outbox_events 의 notifications store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("PATCH", "outbox_events", postgrestError("40001")));
    const error = await rejectionOf(store.markProcessed(event, NOW));
    expect(error.message).toMatch(ERROR_PATTERN("outbox_events", "40001"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

describe("markRetry", () => {
  const event = analysisCompleteEvent("COMPLETED", { status: "PENDING", attempts: 0 });
  const update = toRetryUpdate(0, NOW);

  it("id·status·attempts 가 읽은 값과 같을 때만 갱신한다(compare-and-set)", async () => {
    const { store, fake } = storeWith();
    await store.markRetry(event, update);
    const call = only(fake.callsTo("outbox_events", "PATCH"));
    expect([eqValue(call, "id"), eqValue(call, "status"), eqValue(call, "attempts")]).toEqual([
      EVENT_ID,
      "PENDING",
      "0",
    ]);
  });

  it("본문은 받은 갱신 그대로다", async () => {
    const { store, fake } = storeWith();
    await store.markRetry(event, update);
    expect(only(fake.callsTo("outbox_events", "PATCH")).body).toEqual(update);
  });

  it("DEAD 갱신도 그대로 보낸다", async () => {
    const { store, fake } = storeWith();
    const dead = toRetryUpdate(4, NOW);
    await store.markRetry({ ...event, status: "FAILED", attempts: 4 }, dead);
    expect(only(fake.callsTo("outbox_events", "PATCH")).body).toEqual({
      status: "DEAD",
      attempts: 5,
      next_attempt_at: null,
    });
  });

  it("0행이 바뀌어도 던지지 않고 다시 갱신하지 않는다", async () => {
    const { store, fake } = storeWith(on("PATCH", "outbox_events", { status: 200, body: [] }));
    await store.markRetry(event, update);
    expect(fake.callsTo("outbox_events", "PATCH")).toHaveLength(1);
  });

  it("갱신 오류는 outbox_events 의 notifications store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("PATCH", "outbox_events", postgrestError("40001")));
    const error = await rejectionOf(store.markRetry(event, update));
    expect(error.message).toMatch(ERROR_PATTERN("outbox_events", "40001"));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// 메모리 outbox 한 행에 요청의 필터를 그대로 적용해(memoryTable) 어느 처리자의 갱신이 들어가는지 본다.
describe("compare-and-set · 메모리 행", () => {
  const stored = (patch: Partial<FakeRow> = {}): FakeRow => ({
    ...reviewAssignedEvent(),
    next_attempt_at: null,
    processed_at: null,
    created_at: "2026-10-20T08:00:00.000Z",
    ...patch,
  });

  it("읽은 상태 그대로면 PROCESSED 로 바뀐다", async () => {
    const table = memoryTable("outbox_events", [stored()]);
    const { store } = storeWith(table.route);
    await store.markProcessed(reviewAssignedEvent(), NOW);
    expect(table.rows[0]).toMatchObject({ status: "PROCESSED", processed_at: NOW_ISO });
  });

  it("다른 처리자가 먼저 PROCESSED 로 바꾼 행은 바꾸지 않는다", async () => {
    const done = stored({ status: "PROCESSED", processed_at: "2026-10-20T08:59:00.000Z" });
    const table = memoryTable("outbox_events", [done]);
    const { store } = storeWith(table.route);
    await store.markRetry(reviewAssignedEvent(), toRetryUpdate(0, NOW));
    expect(table.rows).toEqual([done]);
  });

  it("다른 처리자가 재시도로 attempts 를 올린 행은 바꾸지 않는다", async () => {
    const retried = stored({ status: "FAILED", attempts: 1, next_attempt_at: NOW_ISO });
    const table = memoryTable("outbox_events", [retried]);
    const { store } = storeWith(table.route);
    await store.markProcessed(reviewAssignedEvent({ status: "FAILED", attempts: 0 }), NOW);
    expect(table.rows).toEqual([retried]);
  });

  it("같은 이벤트를 두 처리자가 순서대로 닫으면 첫 갱신만 들어간다", async () => {
    const table = memoryTable("outbox_events", [stored()]);
    const { store } = storeWith(table.route);
    await store.markProcessed(reviewAssignedEvent(), NOW);
    await store.markRetry(reviewAssignedEvent(), toRetryUpdate(0, NOW));
    expect(table.rows[0]).toMatchObject({ status: "PROCESSED", attempts: 0 });
  });
});

describe("service role 경계", () => {
  // 정지 계정 확인(isActive)이 profiles 를 읽으므로 네 표에서 다섯 표가 됐다(docs/09-SECURITY.md "정지").
  it("모든 요청은 outbox_events·bid_notices·memberships·profiles·notifications 다섯 표에만 간다", async () => {
    const { store, fake } = storeWith(
      routes(
        memoryTable("bid_notices", [{ id: BID_ID, title: BID_TITLE }]).route,
        memoryTable("memberships", [{ org_id: ORG_ID, user_id: ASSIGNEE_ID }]).route,
        memoryTable("profiles", [{ id: ASSIGNEE_ID, status: "active" }]).route,
      ),
    );
    await store.findDue({ now: NOW_ISO, limit: 1 });
    await store.readBidTitle(BID_ID);
    await store.isMember(ORG_ID, ASSIGNEE_ID);
    await store.isActive(ASSIGNEE_ID);
    await store.insertNotification(sendRow());
    await store.markProcessed(reviewAssignedEvent(), NOW);
    await store.markRetry(reviewAssignedEvent(), toRetryUpdate(0, NOW));
    expect([...new Set(fake.calls.map((call) => call.table))].toSorted()).toEqual([
      "bid_notices",
      "memberships",
      "notifications",
      "outbox_events",
      "profiles",
    ]);
  });
});

// ── NotificationStoreError ──
// 저장의 모든 throw(PostgREST 오류·INVALID_INPUT·UNEXPECTED_STATUS)가 같은 이름의 오류다. message 모양은 그대로다.

describe("NotificationStoreError — 저장 오류의 이름", () => {
  const event = reviewAssignedEvent();
  /** [이름표, 던지게 하는 호출, 그대로여야 하는 message] */
  const CASES: readonly (readonly [string, () => Promise<unknown>, string])[] = [
    [
      "findDue 질의 오류",
      () =>
        storeWith(on("GET", "outbox_events", postgrestError("42501"))).store.findDue({
          now: NOW_ISO,
          limit: 1,
        }),
      "notifications store 오류: outbox_events.select 42501",
    ],
    [
      "findDue 질의 오류에 code 가 없다",
      () =>
        storeWith(on("GET", "outbox_events", postgrestError(null))).store.findDue({
          now: NOW_ISO,
          limit: 1,
        }),
      "notifications store 오류: outbox_events.select UNKNOWN",
    ],
    [
      "findDue 의 now 가 ISO 모양이 아니다(INVALID_INPUT)",
      () => storeWith().store.findDue({ now: "2026-10-20", limit: 1 }),
      "notifications store 오류: outbox_events.select INVALID_INPUT",
    ],
    [
      "findDue 의 limit 이 0 이다(INVALID_INPUT)",
      () => storeWith().store.findDue({ now: NOW_ISO, limit: 0 }),
      "notifications store 오류: outbox_events.select INVALID_INPUT",
    ],
    [
      "findDue 가 PENDING·FAILED 가 아닌 행을 받았다(UNEXPECTED_STATUS)",
      () =>
        storeWith(
          on("GET", "outbox_events", { status: 200, body: [{ ...event, status: "PROCESSED" }] }),
        ).store.findDue({ now: NOW_ISO, limit: 1 }),
      "notifications store 오류: outbox_events.select UNEXPECTED_STATUS",
    ],
    [
      "readBidTitle 질의 오류",
      () => storeWith(on("GET", "bid_notices", postgrestError("42501"))).store.readBidTitle(BID_ID),
      "notifications store 오류: bid_notices.select 42501",
    ],
    [
      "isMember 질의 오류",
      () =>
        storeWith(on("GET", "memberships", postgrestError("42501"))).store.isMember(
          ORG_ID,
          ASSIGNEE_ID,
        ),
      "notifications store 오류: memberships.select 42501",
    ],
    [
      "insertNotification 넣기 오류",
      () =>
        storeWith(on("POST", "notifications", postgrestError("23503"))).store.insertNotification(
          sendRow(),
        ),
      "notifications store 오류: notifications.insert 23503",
    ],
    [
      "markProcessed 갱신 오류",
      () =>
        storeWith(on("PATCH", "outbox_events", postgrestError("40001"))).store.markProcessed(
          event,
          NOW,
        ),
      "notifications store 오류: outbox_events.update 40001",
    ],
    [
      "markRetry 갱신 오류",
      () =>
        storeWith(on("PATCH", "outbox_events", postgrestError("40001"))).store.markRetry(
          event,
          toRetryUpdate(0, NOW),
        ),
      "notifications store 오류: outbox_events.update 40001",
    ],
  ];

  it.each(CASES)(
    "%s — name 은 NotificationStoreError 이고 message 는 그대로다",
    async (_label, act, message) => {
      const error = await rejectionOf(act());
      expect([error.name, error.message]).toEqual(["NotificationStoreError", message]);
    },
  );

  it.each(CASES)(
    "%s — NotificationStoreError 의 인스턴스다(배럴에서 내보낸 클래스)",
    async (_label, act) => {
      const error = await rejectionOf(act());
      expect(typeof NotificationStoreError).toBe("function");
      expect(error).toBeInstanceOf(NotificationStoreError);
    },
  );
});
