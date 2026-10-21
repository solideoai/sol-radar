import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  NotificationStoreError,
  createKakaoOutboxStore,
  createNotificationOutboxStore,
  processOutboxBatch,
  toKakaoExpiredRow,
  toKakaoNotificationRow,
  type KakaoNotificationRow,
} from "@/server/notifications";
import {
  asAdminTask,
  asServiceRole,
  createMigratedDb,
  pgliteSupabase,
  type SqlDb,
} from "./outbox-db.test-support";
import { SITE_URL, USER_A, USER_B, USER_C, fakeSender } from "./kakao.test-support";
import {
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  LEAKY_ERROR_TEXT,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_BID_ID,
  OTHER_ORG_ID,
  RUN_ID,
  bodyRows,
  conflictColumns,
  eqValue,
  fakeSupabase,
  inValues,
  memoryTable,
  on,
  postgrestError,
  rejectionOf,
  routes,
  selectedColumns,
  type FakeRow,
  type PostgrestCall,
  type PostgrestRoute,
} from "./outbox.test-support";

// 카카오 알림 소비자 저장 port(KakaoOutboxStore)의 Supabase 구현(service role, 계획 Task 4).
// 1) 가짜 PostgREST: 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어 나가는 요청(표·select 열·필터·Prefer·본문)과
//    필터 흉내(memoryTable)로 골라지는 행을 본다. 오류는 NotificationStoreError 이고 message 에 값이 없다.
// 2) 실제 마이그레이션(PGlite): 열 이름·check·FK 가 맞는지, finish_score_run 이 쓴 BID_RECOMMENDED 를 한 회차가 끝까지 처리하는지 본다.
// 실제 카카오·Supabase·네트워크는 부르지 않는다. 발송 수단은 가짜다.

const storeWith = (route?: PostgrestRoute) => {
  const fake = fakeSupabase(route);
  return { store: createKakaoOutboxStore(fake.client), fake };
};

function only(calls: PostgrestCall[]): PostgrestCall {
  expect(calls).toHaveLength(1);
  return calls[0];
}

const ERROR_PATTERN = (table: string, code: string) =>
  new RegExp(`^notifications store 오류: ${table}\\.\\S+ ${code}$`);

/** 저장 오류가 NotificationStoreError 이고 표·code 만 싣는지. */
async function expectStoreError(promise: Promise<unknown>, table: string, code: string) {
  const error = await rejectionOf(promise);
  expect(error).toBeInstanceOf(NotificationStoreError);
  expect(error.name).toBe("NotificationStoreError");
  expect(error.message).toMatch(ERROR_PATTERN(table, code));
  expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
}

const kakaoRow = (userId = USER_A): KakaoNotificationRow =>
  toKakaoNotificationRow({
    outboxEventId: EVENT_ID,
    orgId: ORG_ID,
    userId,
    bidId: BID_ID,
    title: BID_TITLE,
    recommendation: "BID",
  });

// ── listRecipients ──

describe("listRecipients · 질의", () => {
  const links = memoryTable("kakao_notify_links", [
    { user_id: USER_A, enabled: true, status: "CONNECTED" },
  ]);
  const members = memoryTable("memberships", [{ org_id: ORG_ID, user_id: USER_A }]);
  const profiles = memoryTable("profiles", [{ id: USER_A, status: "active" }]);

  async function calls() {
    const { store, fake } = storeWith(routes(links.route, members.route, profiles.route));
    await store.listRecipients(ORG_ID);
    return fake;
  }

  it("연결 표 → 멤버십 → 프로필 순서로 GET 세 번이다(연결한 사람이 적으므로 연결 표부터 좁힌다)", async () => {
    expect((await calls()).sequence()).toEqual([
      "GET kakao_notify_links",
      "GET memberships",
      "GET profiles",
    ]);
  });

  it("연결 표는 enabled=true·status=CONNECTED 인 user_id 만 고른다(토큰 열은 읽지 않는다)", async () => {
    const call = only((await calls()).callsTo("kakao_notify_links"));
    expect([selectedColumns(call), eqValue(call, "enabled"), eqValue(call, "status")]).toEqual([
      ["user_id"],
      "true",
      "CONNECTED",
    ]);
  });

  it("멤버십은 그 조직과 연결한 사람들로 묻는다", async () => {
    const call = only((await calls()).callsTo("memberships"));
    expect([eqValue(call, "org_id"), inValues(call, "user_id"), selectedColumns(call)]).toEqual([
      ORG_ID,
      [USER_A],
      ["user_id"],
    ]);
  });

  it("프로필은 그 사람들 가운데 status=active 만 고른다", async () => {
    const call = only((await calls()).callsTo("profiles"));
    expect([inValues(call, "id"), eqValue(call, "status"), selectedColumns(call)]).toEqual([
      [USER_A],
      "active",
      ["id"],
    ]);
  });
});

describe("listRecipients · 고르는 사람(필터 흉내)", () => {
  const USER_D = "44444444-4d5e-4f60-8172-8d9e0f1a2b34";
  const USER_E = "55555555-5e6f-4071-9283-9e0f1a2b3c45";
  const LINKS: FakeRow[] = [
    { user_id: USER_C, enabled: true, status: "CONNECTED" },
    { user_id: USER_A, enabled: true, status: "CONNECTED" },
    { user_id: USER_B, enabled: false, status: "CONNECTED" },
    { user_id: USER_D, enabled: true, status: "EXPIRED" },
    { user_id: USER_E, enabled: true, status: "CONNECTED" },
  ];
  const MEMBERS: FakeRow[] = [
    { org_id: ORG_ID, user_id: USER_A },
    { org_id: ORG_ID, user_id: USER_B },
    { org_id: ORG_ID, user_id: USER_C },
    { org_id: ORG_ID, user_id: USER_D },
    { org_id: OTHER_ORG_ID, user_id: USER_E },
  ];
  const PROFILES: FakeRow[] = [
    { id: USER_A, status: "active" },
    { id: USER_B, status: "active" },
    { id: USER_C, status: "suspended" },
    { id: USER_D, status: "active" },
    { id: USER_E, status: "active" },
  ];

  const recipientsOf = (
    orgId: string,
    tables = { links: LINKS, members: MEMBERS, profiles: PROFILES },
  ) => {
    const { store, fake } = storeWith(
      routes(
        memoryTable("kakao_notify_links", tables.links).route,
        memoryTable("memberships", tables.members).route,
        memoryTable("profiles", tables.profiles).route,
      ),
    );
    return { result: store.listRecipients(orgId), fake };
  };

  it("켬·CONNECTED·active·그 조직 멤버인 사람만 고른다(끔·만료·정지·다른 조직 제외)", async () => {
    expect(await recipientsOf(ORG_ID).result).toEqual([USER_A]);
  });

  it("다른 조직이면 그 조직 멤버만 고른다", async () => {
    expect(await recipientsOf(OTHER_ORG_ID).result).toEqual([USER_E]);
  });

  it("여럿이면 user_id 순서로 돌려준다", async () => {
    const profiles = PROFILES.map((row) => ({ ...row, status: "active" }));
    expect(await recipientsOf(ORG_ID, { links: LINKS, members: MEMBERS, profiles }).result).toEqual(
      [USER_A, USER_C],
    );
  });

  it("켠 연결이 없으면 빈 목록이고 멤버십·프로필을 묻지 않는다", async () => {
    const { result, fake } = recipientsOf(ORG_ID, {
      links: [],
      members: MEMBERS,
      profiles: PROFILES,
    });
    expect(await result).toEqual([]);
    expect(fake.sequence()).toEqual(["GET kakao_notify_links"]);
  });

  it("연결한 사람이 그 조직 멤버가 아니면 빈 목록이고 프로필을 묻지 않는다", async () => {
    const { result, fake } = recipientsOf(ORG_ID, {
      links: [{ user_id: USER_E, enabled: true, status: "CONNECTED" }],
      members: MEMBERS,
      profiles: PROFILES,
    });
    expect(await result).toEqual([]);
    expect(fake.sequence()).toEqual(["GET kakao_notify_links", "GET memberships"]);
  });

  it.each(["kakao_notify_links", "memberships", "profiles"])(
    "%s 질의 오류는 그 표의 NotificationStoreError 로 던지고 message 를 싣지 않는다",
    async (table) => {
      const { store } = storeWith(
        routes(
          on("GET", table, postgrestError("42501")),
          memoryTable("kakao_notify_links", LINKS).route,
          memoryTable("memberships", MEMBERS).route,
        ),
      );
      await expectStoreError(store.listRecipients(ORG_ID), table, "42501");
    },
  );
});

// ── isActive ──

describe("isActive", () => {
  it("profiles 를 id 로 읽어 status 가 active 면 true, 아니거나 없으면 false 다", async () => {
    const table = memoryTable("profiles", [
      { id: USER_A, status: "active" },
      { id: USER_B, status: "suspended" },
    ]);
    const { store, fake } = storeWith(table.route);
    expect(
      await Promise.all([USER_A, USER_B, USER_C].map((userId) => store.isActive(userId))),
    ).toEqual([true, false, false]);
    expect(fake.calls.map((call) => [call.table, eqValue(call, "id")])).toEqual([
      ["profiles", USER_A],
      ["profiles", USER_B],
      ["profiles", USER_C],
    ]);
  });
});

// ── readFeedSource ──

const RUN_ROW: FakeRow = {
  id: RUN_ID,
  org_id: ORG_ID,
  bid_id: BID_ID,
  score: 78,
  recommendation: "BID",
  status: "COMPLETED",
  explanation: "AI 서술 — 카톡에 실으면 안 된다",
};
const BID_ROW: FakeRow = {
  id: BID_ID,
  title: BID_TITLE,
  agency: "가상시청",
  deadline_at: "2026-10-30T09:00:00.000Z",
  budget_krw: 1_240_000_000,
  source_url: "https://fixture.invalid/notice/0001",
};
const CHECK_ROWS: FakeRow[] = [
  { score_run_id: RUN_ID, mandatory: true, outcome: "SATISFIED", reason: "충족" },
  { score_run_id: RUN_ID, mandatory: false, outcome: "NEEDS_REVIEW", reason: "확인" },
  {
    score_run_id: "99999999-9999-4999-8999-999999999999",
    mandatory: true,
    outcome: "NOT_SATISFIED",
  },
];

function feedStore(
  overrides: { run?: FakeRow | null; bid?: FakeRow | null; checks?: FakeRow[] } = {},
) {
  const run = overrides.run === undefined ? RUN_ROW : overrides.run;
  const bid = overrides.bid === undefined ? BID_ROW : overrides.bid;
  return storeWith(
    routes(
      memoryTable("score_runs", run === null ? [] : [run]).route,
      memoryTable("bid_notices", bid === null ? [] : [bid]).route,
      memoryTable("qualification_checks", overrides.checks ?? CHECK_ROWS).route,
    ),
  );
}

describe("readFeedSource · 질의", () => {
  it("score_runs → bid_notices → qualification_checks 순서로 GET 세 번이다", async () => {
    const { store, fake } = feedStore();
    await store.readFeedSource(RUN_ID);
    expect(fake.sequence()).toEqual([
      "GET score_runs",
      "GET bid_notices",
      "GET qualification_checks",
    ]);
  });

  it("score_runs 는 id 로 읽고 org_id·bid_id·score·recommendation·status 만 고른다(AI 서술 explanation 은 읽지 않는다)", async () => {
    const { store, fake } = feedStore();
    await store.readFeedSource(RUN_ID);
    const call = only(fake.callsTo("score_runs"));
    expect([eqValue(call, "id"), selectedColumns(call)]).toEqual([
      RUN_ID,
      ["bid_id", "org_id", "recommendation", "score", "status"],
    ]);
  });

  it("bid_notices 는 run 의 공고 id 로 읽고 공고명·수요기관·마감·추정금액·원문 주소만 고른다", async () => {
    const { store, fake } = feedStore();
    await store.readFeedSource(RUN_ID);
    const call = only(fake.callsTo("bid_notices"));
    expect([eqValue(call, "id"), selectedColumns(call)]).toEqual([
      BID_ID,
      ["agency", "budget_krw", "deadline_at", "source_url", "title"],
    ]);
  });

  it("qualification_checks 는 그 run 으로 읽고 mandatory·outcome 만 고른다", async () => {
    const { store, fake } = feedStore();
    await store.readFeedSource(RUN_ID);
    const call = only(fake.callsTo("qualification_checks"));
    expect([eqValue(call, "score_run_id"), selectedColumns(call)]).toEqual([
      RUN_ID,
      ["mandatory", "outcome"],
    ]);
  });
});

describe("readFeedSource · 결과", () => {
  it("세 표를 피드 재료로 옮긴다(마감은 Date, 그 run 의 판정만)", async () => {
    const { store } = feedStore();
    expect(await store.readFeedSource(RUN_ID)).toEqual({
      orgId: ORG_ID,
      bidId: BID_ID,
      recommendation: "BID",
      status: "COMPLETED",
      score: 78,
      title: BID_TITLE,
      agency: "가상시청",
      deadlineAt: new Date("2026-10-30T09:00:00.000Z"),
      budgetKrw: 1_240_000_000,
      sourceUrl: "https://fixture.invalid/notice/0001",
      checks: [
        { mandatory: true, outcome: "SATISFIED" },
        { mandatory: false, outcome: "NEEDS_REVIEW" },
      ],
    });
  });

  it("결과에 AI 서술이 없다", async () => {
    const { store } = feedStore();
    expect(JSON.stringify(await store.readFeedSource(RUN_ID))).not.toContain("AI 서술");
  });

  it("마감·수요기관·금액·점수가 없으면 null 로 둔다(피드가 미공개·미정으로 채운다)", async () => {
    const { store } = feedStore({
      run: { ...RUN_ROW, score: null },
      bid: { ...BID_ROW, agency: null, deadline_at: null, budget_krw: null },
    });
    expect(await store.readFeedSource(RUN_ID)).toMatchObject({
      score: null,
      agency: null,
      deadlineAt: null,
      budgetKrw: null,
    });
  });

  it("원문 주소가 빈 글자면 null 이다", async () => {
    const { store } = feedStore({ bid: { ...BID_ROW, source_url: "" } });
    expect((await store.readFeedSource(RUN_ID))?.sourceUrl).toBeNull();
  });

  it("run 이 없으면 null 이고 공고·판정을 읽지 않는다", async () => {
    const { store, fake } = feedStore({ run: null });
    expect(await store.readFeedSource(RUN_ID)).toBeNull();
    expect(fake.sequence()).toEqual(["GET score_runs"]);
  });

  it.each([
    ["권고 NO_BID", { recommendation: "NO_BID" }],
    ["권고 null", { recommendation: null }],
    ["FAILED", { status: "FAILED" }],
    ["RUNNING", { status: "RUNNING" }],
  ] as const)(
    "run 이 %s 이면 null 이다(BID·WATCH 로 마감한 run 만 보낸다)",
    async (_label, patch) => {
      const { store } = feedStore({ run: { ...RUN_ROW, ...patch } });
      expect(await store.readFeedSource(RUN_ID)).toBeNull();
    },
  );

  it("공고가 없으면 null 이다", async () => {
    const { store } = feedStore({ bid: null });
    expect(await store.readFeedSource(RUN_ID)).toBeNull();
  });

  it("판정 outcome 이 모르는 값이면 UNEXPECTED_OUTCOME 으로 던진다", async () => {
    const { store } = feedStore({
      checks: [{ score_run_id: RUN_ID, mandatory: true, outcome: "MAYBE" }],
    });
    await expectStoreError(
      store.readFeedSource(RUN_ID),
      "qualification_checks",
      "UNEXPECTED_OUTCOME",
    );
  });

  it.each(["score_runs", "bid_notices", "qualification_checks"])(
    "%s 질의 오류는 그 표의 NotificationStoreError 로 던지고 message 를 싣지 않는다",
    async (table) => {
      const { store } = storeWith(
        routes(
          on("GET", table, postgrestError("PGRST301")),
          memoryTable("score_runs", [RUN_ROW]).route,
          memoryTable("bid_notices", [BID_ROW]).route,
        ),
      );
      await expectStoreError(store.readFeedSource(RUN_ID), table, "PGRST301");
    },
  );
});

// ── hasKakaoSentForBid ──

/** notifications 한 행(필터 흉내용). */
const notificationRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "n-1",
  org_id: OTHER_ORG_ID,
  user_id: USER_A,
  type: "BID_RECOMMENDED",
  channel: "KAKAO",
  status: "SENT",
  error: null,
  sent_at: NOW_ISO,
  idempotency_key: `x:${USER_A}:KAKAO`,
  payload: { bidId: BID_ID, title: BID_TITLE, message: "BID 권고", link: `/bids/${BID_ID}` },
  ...overrides,
});

describe("hasKakaoSentForBid", () => {
  it("notifications 를 사람·KAKAO·BID_RECOMMENDED·payload 의 공고로 묻고 한 행만 읽는다", async () => {
    const { store, fake } = storeWith();
    await store.hasKakaoSentForBid(USER_A, BID_ID);
    const call = only(fake.callsTo("notifications", "GET"));
    expect([
      eqValue(call, "user_id"),
      eqValue(call, "channel"),
      eqValue(call, "type"),
      eqValue(call, "payload->>bidId"),
      call.params.get("or"),
      call.params.get("limit"),
      selectedColumns(call),
    ]).toEqual([
      USER_A,
      "KAKAO",
      "BID_RECOMMENDED",
      BID_ID,
      "(status.eq.SENT,and(status.eq.DEAD,error.eq.TIMEOUT_UNKNOWN))",
      "1",
      ["id"],
    ]);
  });

  it.each([
    ["다른 조직에서 SENT", {}, true],
    [
      "다른 조직에서 DEAD·TIMEOUT_UNKNOWN(갔을 수 있다)",
      { status: "DEAD", error: "TIMEOUT_UNKNOWN" },
      true,
    ],
    ["DEAD·KAKAO_-2(분명히 못 갔다)", { status: "DEAD", error: "KAKAO_-2" }, false],
    ["FAILED", { status: "FAILED", error: "HTTP_503" }, false],
    ["PENDING", { status: "PENDING", sent_at: null }, false],
    ["다른 공고", { payload: { bidId: OTHER_BID_ID, title: "t", message: "m", link: "/" } }, false],
    ["다른 사람", { user_id: USER_B }, false],
    ["인앱 행", { channel: "IN_APP" }, false],
    ["만료 인앱 종류", { type: "KAKAO_EXPIRED" }, false],
  ] as const)("%s 이면 %s 다", async (_label, overrides, expected) => {
    const table = memoryTable("notifications", [notificationRow(overrides)]);
    const { store } = storeWith(table.route);
    expect(await store.hasKakaoSentForBid(USER_A, BID_ID)).toBe(expected);
  });

  it("질의 오류는 notifications 의 NotificationStoreError 로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("GET", "notifications", postgrestError("57014")));
    await expectStoreError(store.hasKakaoSentForBid(USER_A, BID_ID), "notifications", "57014");
  });
});

// ── ensureKakaoRow ──

describe("ensureKakaoRow", () => {
  /** notifications 메모리 표. 넣은 행에 DB 처럼 id 를 붙인다(new-row-<n>). */
  const table = (initial: FakeRow[] = []) => {
    const notifications = memoryTable("notifications", initial, { unique: ["idempotency_key"] });
    const route: PostgrestRoute = (call) => {
      const reply = notifications.route(call);
      notifications.rows.forEach((row, index) => {
        if (!Object.hasOwn(row, "id")) row.id = `new-row-${index + 1}`;
      });
      return reply;
    };
    return { rows: notifications.rows, route };
  };

  it("idempotency_key 충돌 시 아무것도 하지 않는 upsert 뒤 그 키로 id·status 를 다시 읽는다", async () => {
    const notifications = table();
    const { store, fake } = storeWith(notifications.route);
    await store.ensureKakaoRow(kakaoRow());
    const [insert, read] = fake.calls;
    expect([
      fake.sequence(),
      conflictColumns(insert),
      insert.prefer.includes("resolution=ignore-duplicates"),
      insert.prefer.includes("resolution=merge-duplicates"),
      eqValue(read, "idempotency_key"),
      selectedColumns(read),
    ]).toEqual([
      ["POST notifications", "GET notifications"],
      ["idempotency_key"],
      true,
      false,
      `${EVENT_ID}:${USER_A}:KAKAO`,
      ["id", "status"],
    ]);
  });

  it("넣는 본문은 받은 KAKAO 행 그대로다", async () => {
    const notifications = table();
    const { store, fake } = storeWith(notifications.route);
    await store.ensureKakaoRow(kakaoRow());
    expect(bodyRows(only(fake.callsTo("notifications", "POST")))).toEqual([kakaoRow()]);
  });

  it("새 행이면 그 행의 id 와 PENDING 이다", async () => {
    const { store } = storeWith(table().route);
    expect(await store.ensureKakaoRow(kakaoRow())).toEqual({ id: "new-row-1", status: "PENDING" });
  });

  it("같은 키의 행이 이미 있으면 덮지 않고 그 행의 id·status 를 돌려준다", async () => {
    const existing = { ...kakaoRow(), id: "old-row", status: "SENT", sent_at: NOW_ISO };
    const notifications = table([existing]);
    const { store } = storeWith(notifications.route);
    expect(await store.ensureKakaoRow(kakaoRow())).toEqual({ id: "old-row", status: "SENT" });
    expect(notifications.rows).toEqual([existing]);
  });

  it("넣은 뒤 다시 읽어 행이 없으면 NOT_FOUND 로 던진다", async () => {
    const { store } = storeWith(on("POST", "notifications", { status: 201 }));
    await expectStoreError(store.ensureKakaoRow(kakaoRow()), "notifications", "NOT_FOUND");
  });

  it("행의 status 가 모르는 값이면 UNEXPECTED_STATUS 로 던진다", async () => {
    const { store } = storeWith(table([{ ...kakaoRow(), id: "r", status: "WAT" }]).route);
    await expectStoreError(store.ensureKakaoRow(kakaoRow()), "notifications", "UNEXPECTED_STATUS");
  });

  it.each(["POST", "GET"])(
    "%s 오류는 notifications 의 NotificationStoreError 로 던지고 message 를 싣지 않는다",
    async (method) => {
      const { store } = storeWith(on(method, "notifications", postgrestError("23503")));
      await expectStoreError(store.ensureKakaoRow(kakaoRow()), "notifications", "23503");
    },
  );
});

// ── setKakaoRowStatus ──

describe("setKakaoRowStatus", () => {
  it("SENT 면 그 id 의 KAKAO 행을 status·error·sent_at 으로 바꾼다", async () => {
    const { store, fake } = storeWith();
    await store.setKakaoRowStatus("row-1", "SENT", null, NOW);
    const call = only(fake.callsTo("notifications", "PATCH"));
    expect([eqValue(call, "id"), eqValue(call, "channel"), bodyRows(call)]).toEqual([
      "row-1",
      "KAKAO",
      [{ status: "SENT", error: null, sent_at: NOW_ISO }],
    ]);
  });

  it.each(["FAILED", "DEAD"] as const)("%s 면 sent_at 을 바꾸지 않는다", async (status) => {
    const { store, fake } = storeWith();
    await store.setKakaoRowStatus("row-1", status, "HTTP_503", NOW);
    expect(bodyRows(only(fake.callsTo("notifications", "PATCH")))).toEqual([
      { status, error: "HTTP_503" },
    ]);
  });

  it("갱신 오류는 notifications 의 NotificationStoreError 로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("PATCH", "notifications", postgrestError("40001")));
    await expectStoreError(
      store.setKakaoRowStatus("row-1", "SENT", null, NOW),
      "notifications",
      "40001",
    );
  });
});

// ── closeOpenKakaoRows ──

describe("closeOpenKakaoRows", () => {
  it("그 조직·공고의 KAKAO·BID_RECOMMENDED 행 가운데 PENDING·FAILED 만 DEAD 로 바꾼다(error 는 그대로)", async () => {
    const rows: FakeRow[] = [
      notificationRow({ id: "open-failed", org_id: ORG_ID, status: "FAILED", error: "HTTP_503" }),
      notificationRow({ id: "open-pending", org_id: ORG_ID, status: "PENDING", user_id: USER_B }),
      notificationRow({ id: "sent", org_id: ORG_ID, status: "SENT", user_id: USER_C }),
      notificationRow({ id: "other-org", org_id: OTHER_ORG_ID, status: "FAILED" }),
      notificationRow({
        id: "other-bid",
        org_id: ORG_ID,
        status: "FAILED",
        payload: { bidId: OTHER_BID_ID, title: "t", message: "m", link: "/" },
      }),
      notificationRow({ id: "in-app", org_id: ORG_ID, status: "PENDING", channel: "IN_APP" }),
    ];
    const table = memoryTable("notifications", rows);
    const { store, fake } = storeWith(table.route);
    await store.closeOpenKakaoRows(ORG_ID, BID_ID);
    expect(table.rows.map((row) => [row.id, row.status, row.error])).toEqual([
      ["open-failed", "DEAD", "HTTP_503"],
      ["open-pending", "DEAD", null],
      ["sent", "SENT", null],
      ["other-org", "FAILED", null],
      ["other-bid", "FAILED", null],
      ["in-app", "PENDING", null],
    ]);
    const call = only(fake.callsTo("notifications", "PATCH"));
    expect([inValues(call, "status"), bodyRows(call)]).toEqual([
      ["FAILED", "PENDING"],
      [{ status: "DEAD" }],
    ]);
  });

  it("갱신 오류는 notifications 의 NotificationStoreError 로 던지고 message 를 싣지 않는다", async () => {
    const { store } = storeWith(on("PATCH", "notifications", postgrestError("40001")));
    await expectStoreError(store.closeOpenKakaoRows(ORG_ID, BID_ID), "notifications", "40001");
  });
});

// ── insertNotification ──

describe("insertNotification", () => {
  it("만료 인앱 행을 idempotency_key 충돌 시 아무것도 하지 않는 upsert 로 넣는다", async () => {
    const { store, fake } = storeWith();
    const row = toKakaoExpiredRow({
      outboxEventId: EVENT_ID,
      orgId: ORG_ID,
      userId: USER_A,
      bidId: BID_ID,
      title: BID_TITLE,
      now: NOW,
    });
    await store.insertNotification(row);
    const call = only(fake.callsTo("notifications", "POST"));
    expect([
      conflictColumns(call),
      call.prefer.includes("resolution=ignore-duplicates"),
      bodyRows(call),
    ]).toEqual([["idempotency_key"], true, [row]]);
  });
});

// ── 실제 마이그레이션(PGlite) ──

describe("kakao 저장 — 실제 마이그레이션 위(PGlite)", () => {
  // 조직 둘: ORG1 에 A(켬)·B(끔)·C(켬, 정지), ORG2 에 A. 공고 하나·revision 하나·두 조직의 회사 프로필.
  const ORG1 = "0f000000-0000-4000-8000-000000000801";
  const ORG2 = "0f000000-0000-4000-8000-000000000802";
  const A = "00000000-0000-4000-8000-000000000811";
  const B = "00000000-0000-4000-8000-000000000812";
  const C = "00000000-0000-4000-8000-000000000813";
  const BID = "b1d00000-0000-4000-8000-000000000801";
  const REV = "be500000-0000-4000-8000-000000000801";
  const PROFILE1 = "c0000000-0000-4000-8000-000000000801";
  const PROFILE2 = "c0000000-0000-4000-8000-000000000802";
  const RUN1 = "a0000000-0000-4000-8000-000000000801";
  const RUN2 = "a0000000-0000-4000-8000-000000000802";
  const TITLE = "카카오 알림 시험 공고 (가상)";
  const ATTEMPT = "2026-10-20T08:00:00.000Z";
  const EXPLANATION = "AI 서술 — 카톡에 실으면 안 된다";

  let db: SqlDb;

  beforeAll(async () => {
    db = await createMigratedDb();
    await asAdminTask(db);
    for (const [id, email] of [
      [A, "a@kakao.invalid"],
      [B, "b@kakao.invalid"],
      [C, "c@kakao.invalid"],
    ]) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    }
    await db.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'org-kakao-1', '카카오 조직', true), ($2, 'org-kakao-2', '카카오 둘째 조직', true)",
      [ORG1, ORG2],
    );
    await db.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'owner', 'ADMIN'), ($1, $3, 'member', 'VIEWER'), ($1, $4, 'member', 'VIEWER'), ($5, $2, 'owner', 'ADMIN')",
      [ORG1, A, B, C, ORG2],
    );
    await db.query("update public.profiles set status = 'suspended' where id = $1", [C]);
    await db.query(
      "insert into public.kakao_notify_links (user_id, enabled, status, access_token_enc) values ($1, true, 'CONNECTED', 'v1.x'), ($2, false, 'CONNECTED', 'v1.x'), ($3, true, 'CONNECTED', 'v1.x')",
      [A, B, C],
    );
    await db.query(
      "insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, deadline_at, source_url, content_hash, is_demo) values ($1, 'fixture', 'DEMO-2026-0801', $2, '가상시청', 'NOTICE', 'OPEN', 1240000000, '2026-10-30T09:00:00Z', 'https://fixture.invalid/0801', 'hash-0801', true)",
      [BID, TITLE],
    );
    await db.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $2, 1, '{}', '{}', 'sum-0801')",
      [REV, BID],
    );
    await db.query(
      "insert into public.company_profiles (id, org_id, revision, name) values ($1, $2, 1, '카카오 조직'), ($3, $4, 1, '카카오 둘째 조직')",
      [PROFILE1, ORG1, PROFILE2, ORG2],
    );
  }, 120_000);

  afterEach(async () => {
    await asAdminTask(db);
    await db.exec(`
      delete from public.notifications;
      delete from public.outbox_events;
      delete from public.score_runs;
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const kakaoStore = () => createKakaoOutboxStore(pgliteSupabase(db).client);

  /** A 가 요청한 RUNNING run 을 worker 처럼 finish_score_run 으로 BID 마감한다(같은 트랜잭션에 BID_RECOMMENDED outbox). */
  async function finishRun(input: { run: string; org: string; profile: string }) {
    await asAdminTask(db);
    await db.query(
      `insert into public.score_runs (id, org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
         run_mode, ai_provider, status, started_at, idempotency_key, requested_by)
       values ($1, $2, $3, $4, $5, 1, 'sol-v0.1.0-kakao', 'MOCK', 'MOCK', 'RUNNING', $6, $7, $8)`,
      [input.run, input.org, BID, REV, input.profile, ATTEMPT, `${input.org}:req-kakao`, A],
    );
    await asServiceRole(db);
    await db.query("select public.finish_score_run($1::jsonb)", [
      JSON.stringify({
        score_run_id: input.run,
        org_id: input.org,
        attempt_started_at: ATTEMPT,
        run: {
          status: "COMPLETED",
          score: 78,
          recommendation: "BID",
          recommendation_basis: "RULES_ONLY",
          error_code: null,
          explanation: EXPLANATION,
          review_flags: [],
          missing_factors: [],
          input_snapshot: { schemaVersion: "analysis-input/v0.1" },
          input_snapshot_hash: "snap-kakao",
          finished_at: "2026-10-20T08:00:05.000Z",
        },
        factors: [],
        assessments: [],
        checks: [
          {
            requirement_code: "SW_BUSINESS",
            requirement_name: "소프트웨어사업자",
            mandatory: true,
            outcome: "SATISFIED",
            reason: "충족",
            basis: "API_FIELD",
            evidence: [],
            company_evidence: [],
          },
          {
            requirement_name: "유사 실적",
            mandatory: false,
            outcome: "NEEDS_REVIEW",
            reason_code: "COMPANY_EVIDENCE_MISSING",
            reason: "확인 필요",
            basis: "EXTRACTION",
            evidence: [],
            company_evidence: [],
          },
        ],
      }),
    ]);
  }

  type KakaoDbRow = {
    org_id: string;
    user_id: string;
    type: string;
    channel: string;
    status: string;
    error: string | null;
    idempotency_key: string;
  };
  async function kakaoRows(): Promise<KakaoDbRow[]> {
    await asAdminTask(db);
    const { rows } = await db.query<KakaoDbRow>(
      "select org_id, user_id, type, channel, status, error, idempotency_key from public.notifications order by created_at, idempotency_key",
    );
    return rows;
  }
  async function outboxOf(eventType: string) {
    await asAdminTask(db);
    const { rows } = await db.query<{ id: string; status: string; org_id: string }>(
      "select id, status, org_id from public.outbox_events where event_type = $1 order by created_at, id",
      [eventType],
    );
    return rows;
  }

  const runBatch = (sender: ReturnType<typeof fakeSender>["sender"]) =>
    processOutboxBatch({
      store: createNotificationOutboxStore(pgliteSupabase(db).client),
      kakao: { store: kakaoStore(), sender, siteUrl: SITE_URL },
      now: () => NOW,
      log: () => undefined,
      limit: 50,
    });

  it("listRecipients 는 켬·CONNECTED·active·그 조직 멤버만 고른다(B 끔·C 정지 제외)", async () => {
    expect([
      await kakaoStore().listRecipients(ORG1),
      await kakaoStore().listRecipients(ORG2),
    ]).toEqual([[A], [A]]);
  });

  it("readFeedSource 는 실제 열에서 피드 재료를 읽는다(AI 서술 없이)", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const source = await kakaoStore().readFeedSource(RUN1);
    expect(source).toEqual({
      orgId: ORG1,
      bidId: BID,
      recommendation: "BID",
      status: "COMPLETED",
      score: 78,
      title: TITLE,
      agency: "가상시청",
      deadlineAt: new Date("2026-10-30T09:00:00.000Z"),
      budgetKrw: 1_240_000_000,
      sourceUrl: "https://fixture.invalid/0801",
      checks: expect.arrayContaining([
        { mandatory: true, outcome: "SATISFIED" },
        { mandatory: false, outcome: "NEEDS_REVIEW" },
      ]),
    });
    expect(JSON.stringify(source)).not.toContain("AI 서술");
  });

  it("finish_score_run 이 쓴 BID_RECOMMENDED 를 한 회차가 처리하면 A 에게 KAKAO 행 1건이 SENT 이고 outbox 는 PROCESSED 다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const [event] = await outboxOf("BID_RECOMMENDED");
    const fake = fakeSender();
    await runBatch(fake.sender);
    expect(fake.recipientsSent()).toEqual([A]);
    expect((await kakaoRows()).filter((row) => row.channel === "KAKAO")).toEqual([
      {
        org_id: ORG1,
        user_id: A,
        type: "BID_RECOMMENDED",
        channel: "KAKAO",
        status: "SENT",
        error: null,
        idempotency_key: `${event?.id}:${A}:KAKAO`,
      },
    ]);
    expect((await outboxOf("BID_RECOMMENDED")).map((row) => row.status)).toEqual(["PROCESSED"]);
  });

  it("보낸 피드에 AI 서술이 없다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const fake = fakeSender();
    await runBatch(fake.sender);
    expect(fake.sends[0]?.template.content.description).toBe("BID 권고 · 필수 자격 충족");
    expect(JSON.stringify(fake.sends)).not.toContain("AI 서술");
  });

  it("이벤트를 PENDING 으로 되돌려 다시 처리해도 발송은 1회이고 KAKAO 행도 1건이다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const fake = fakeSender();
    await runBatch(fake.sender);
    await asAdminTask(db);
    await db.query(
      "update public.outbox_events set status = 'PENDING', processed_at = null where event_type = 'BID_RECOMMENDED'",
    );
    await runBatch(fake.sender);
    expect(fake.sends).toHaveLength(1);
    expect((await kakaoRows()).filter((row) => row.channel === "KAKAO")).toHaveLength(1);
  });

  it("두 조직에서 같은 공고가 BID 로 나와도 A 에게는 한 통이고, 둘째 조직 이벤트는 KAKAO 행 없이 PROCESSED 다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    await finishRun({ run: RUN2, org: ORG2, profile: PROFILE2 });
    const fake = fakeSender();
    await runBatch(fake.sender);
    expect(fake.recipientsSent()).toEqual([A]);
    expect((await kakaoRows()).filter((row) => row.channel === "KAKAO")).toHaveLength(1);
    expect((await outboxOf("BID_RECOMMENDED")).map((row) => row.status)).toEqual([
      "PROCESSED",
      "PROCESSED",
    ]);
  });

  it("만료(changed=true)면 KAKAO 행은 DEAD·KAKAO_EXPIRED 이고 인앱 KAKAO_EXPIRED 1건이 들어간다(check·FK 통과)", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const [event] = await outboxOf("BID_RECOMMENDED");
    await runBatch(fakeSender(() => ({ kind: "EXPIRED", changed: true })).sender);
    expect(
      (await kakaoRows())
        .filter((row) => row.type !== "ANALYSIS_COMPLETE")
        .map((row) => [row.type, row.channel, row.status, row.error, row.idempotency_key]),
    ).toEqual([
      ["BID_RECOMMENDED", "KAKAO", "DEAD", "KAKAO_EXPIRED", `${event?.id}:${A}:KAKAO`],
      ["KAKAO_EXPIRED", "IN_APP", "SENT", null, `${event?.id}:${A}:KAKAO_EXPIRED:IN_APP`],
    ]);
  });

  it("RETRYABLE 이면 행은 FAILED, outbox 는 FAILED·attempts 1 이고 다섯 번째에 행·outbox 모두 DEAD 다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const failing = fakeSender(() => ({ kind: "RETRYABLE", code: "HTTP_503" }));
    await runBatch(failing.sender);
    expect((await kakaoRows()).find((row) => row.channel === "KAKAO")?.status).toBe("FAILED");
    await asAdminTask(db);
    await db.query(
      "update public.outbox_events set attempts = 4, next_attempt_at = $1 where event_type = 'BID_RECOMMENDED'",
      ["2026-10-20T08:59:00.000Z"],
    );
    await runBatch(failing.sender);
    expect((await kakaoRows()).find((row) => row.channel === "KAKAO")).toMatchObject({
      status: "DEAD",
      error: "HTTP_503",
    });
    expect((await outboxOf("BID_RECOMMENDED")).map((row) => row.status)).toEqual(["DEAD"]);
  });

  it("KAKAO_TEST 는 notifications 행 없이 그 사람에게 시험 피드를 보내고 PROCESSED 다", async () => {
    await asAdminTask(db);
    await db.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key) values (null, 'kakao_notify_link', $1::uuid, 'KAKAO_TEST', jsonb_build_object('userId', $2::text), $3)",
      [A, A, `${A}:2026-10-20T09:00:KAKAO_TEST`],
    );
    const fake = fakeSender();
    await runBatch(fake.sender);
    expect(fake.recipientsSent()).toEqual([A]);
    expect(await kakaoRows()).toEqual([]);
    expect((await outboxOf("KAKAO_TEST")).map((row) => row.status)).toEqual(["PROCESSED"]);
  });

  it("정지 계정의 KAKAO_TEST 는 보내지 않고 PROCESSED 다", async () => {
    await asAdminTask(db);
    await db.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key) values (null, 'kakao_notify_link', $1::uuid, 'KAKAO_TEST', jsonb_build_object('userId', $2::text), $3)",
      [C, C, `${C}:2026-10-20T09:00:KAKAO_TEST`],
    );
    const fake = fakeSender();
    await runBatch(fake.sender);
    expect(fake.sends).toEqual([]);
    expect((await outboxOf("KAKAO_TEST")).map((row) => row.status)).toEqual(["PROCESSED"]);
  });

  it("closeOpenKakaoRows 의 payload->>bidId 필터가 실제 jsonb 행에 맞는다", async () => {
    await finishRun({ run: RUN1, org: ORG1, profile: PROFILE1 });
    const [event] = await outboxOf("BID_RECOMMENDED");
    const store = kakaoStore();
    const row = await store.ensureKakaoRow(
      toKakaoNotificationRow({
        outboxEventId: event?.id ?? "",
        orgId: ORG1,
        userId: A,
        bidId: BID,
        title: TITLE,
        recommendation: "BID",
      }),
    );
    await store.setKakaoRowStatus(row.id, "FAILED", "HTTP_503", NOW);
    await store.closeOpenKakaoRows(ORG1, BID);
    expect((await kakaoRows()).find((candidate) => candidate.channel === "KAKAO")?.status).toBe(
      "DEAD",
    );
    expect(await store.hasKakaoSentForBid(A, BID)).toBe(false);
  });
});
