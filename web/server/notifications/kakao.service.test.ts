import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KakaoTokenKeyMismatchError,
  createMemoKakaoSender,
  toBidFeedTemplate,
  toTestFeedTemplate,
} from "@/server/kakao-notify";
import type { KakaoApi, KakaoSenderResult } from "@/server/kakao-notify";
import { processKakaoEvent, toBidFeedInput, type OutboxEventRow } from "@/server/notifications";
import {
  EXPIRED_IN_APP_MESSAGE,
  SITE_URL,
  USER_A,
  USER_B,
  USER_C,
  bidRecommendedEvent,
  createMemoryKakaoStore,
  createMemoryLinkStore,
  fakeSender,
  feedSource,
  kakaoTestEvent,
  sealedLink,
  type KakaoStoreCall,
  type MemoryKakaoRow,
} from "./kakao.test-support";
import {
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_BID_ID,
  OTHER_EVENT_ID,
  OTHER_ORG_ID,
  RUN_ID,
  rejectionOf,
  withPayload,
} from "./outbox.test-support";

// 카카오톡 추천 공고 알림 소비자 한 이벤트(계획 Task 4 Step 1, 설계 §5.2·§5.5, Review Focus 1~3).
//   BID_RECOMMENDED → 받는 사람을 보낼 때마다 다시 고르고(켬·CONNECTED·active·그 조직 멤버), 사람마다
//     이미 그 공고를 받았으면 건너뛴다 → KAKAO 행을 보장한다(두 단계 멱등) → 행이 SENT·DEAD 면 건너뛴다 → 보낸다.
//   결과: SENT → 행 SENT · RETRYABLE → 행 FAILED, 이벤트 재시도 · UNKNOWN_OUTCOME → 행 DEAD(TIMEOUT_UNKNOWN), 다시 보내지 않음 ·
//     REJECTED → 행 DEAD(code) · EXPIRED(changed) → 행 DEAD(KAKAO_EXPIRED) + 바뀐 순간이면 인앱 KAKAO_EXPIRED 1건.
//   KAKAO_TEST → 행 없이 시험 피드 한 통만 보내고 PROCESSED.
// 저장·발송 수단·시계는 가짜다(kakao.test-support). 실제 카카오·DB·네트워크는 부르지 않는다.

type StoreOptions = Parameters<typeof createMemoryKakaoStore>[0];
type Reply = Parameters<typeof fakeSender>[0];

function setup(storeOptions: StoreOptions = {}, reply?: Reply) {
  const memory = createMemoryKakaoStore(storeOptions);
  const fake = fakeSender(reply);
  const processOnce = (event: OutboxEventRow = bidRecommendedEvent()) =>
    processKakaoEvent(
      { store: memory.store, sender: fake.sender, siteUrl: SITE_URL, now: () => new Date(NOW) },
      event,
    );
  return { ...memory, ...fake, processOnce };
}

/** 받는 사람 셋(A·B·C). */
const THREE: StoreOptions = { recipients: { [ORG_ID]: [USER_A, USER_B, USER_C] } };

/** 그 사람에게만 정해 둔 결과(첫 발송)를 주고 나머지는 SENT. */
const replyFor =
  (target: string, result: KakaoSenderResult): Reply =>
  (userId, nth) =>
    userId === target && nth === 0 ? result : { kind: "SENT" };

/** 이벤트를 재시도 상태(FAILED·attempts)로. 다음 회차를 흉내 낸다. */
const retried = (event: OutboxEventRow, attempts: number): OutboxEventRow => ({
  ...event,
  status: "FAILED",
  attempts,
});

const methodsOf = (calls: readonly KakaoStoreCall[]) => calls.map((call) => call.method);

describe("processKakaoEvent · 보내기", () => {
  it("켠 구성원 셋에게 각자 한 통씩 보내고 SENT·sent 3 이다", async () => {
    const s = setup(THREE);
    await expect(s.processOnce()).resolves.toEqual({ outcome: "SENT", sent: 3, failed: 0 });
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_C]);
  });

  it("받는 사람마다 KAKAO 행이 SENT·sent_at=now 로 남는다", async () => {
    const s = setup(THREE);
    await s.processOnce();
    expect(s.rows.map((row) => [row.user_id, row.status, row.sent_at, row.error])).toEqual([
      [USER_A, "SENT", NOW_ISO, null],
      [USER_B, "SENT", NOW_ISO, null],
      [USER_C, "SENT", NOW_ISO, null],
    ]);
  });

  it("행은 키 <outboxEventId>:<userId>:KAKAO·조직·공고명·'BID 권고' 문구·앱 안 링크다", async () => {
    const s = setup();
    await s.processOnce();
    expect(s.rows).toEqual<MemoryKakaoRow[]>([
      {
        id: "row-1",
        org_id: ORG_ID,
        user_id: USER_A,
        type: "BID_RECOMMENDED",
        channel: "KAKAO",
        status: "SENT",
        error: null,
        sent_at: NOW_ISO,
        idempotency_key: `${EVENT_ID}:${USER_A}:KAKAO`,
        payload: { bidId: BID_ID, title: BID_TITLE, message: "BID 권고", link: `/bids/${BID_ID}` },
      },
    ]);
  });

  it("보내는 피드는 피드 재료로 만든 toBidFeedTemplate 그대로다", async () => {
    const s = setup();
    await s.processOnce();
    expect(s.sends.map((sent) => sent.template)).toEqual([
      toBidFeedTemplate(toBidFeedInput(feedSource(), SITE_URL, NOW)),
    ]);
  });

  it("피드 제목은 공고명, 설명은 'BID 권고 · 필수 자격 충족', 첫 버튼은 SOL RADAR 상세다", async () => {
    const s = setup();
    await s.processOnce();
    const template = s.sends[0]?.template;
    expect([
      template?.content.title,
      template?.content.description,
      template?.buttons[0]?.link.web_url,
    ]).toEqual([BID_TITLE, "BID 권고 · 필수 자격 충족", `${SITE_URL}/bids/${BID_ID}`]);
  });

  it("run 이 PARTIAL·WATCH 면 설명 줄이 'WATCH 권고 · … · AI 없이 규칙만으로 분석' 이고 행 문구는 'WATCH 권고' 다", async () => {
    const s = setup({
      feeds: { [RUN_ID]: feedSource({ recommendation: "WATCH", status: "PARTIAL" }) },
    });
    await s.processOnce(bidRecommendedEvent("WATCH"));
    expect(s.sends[0]?.template.content.description).toBe(
      "WATCH 권고 · 필수 자격 충족 · AI 없이 규칙만으로 분석",
    );
    expect(s.rowOf(USER_A).payload.message).toBe("WATCH 권고");
  });

  it("사람마다 이미 받았는지 → 행 보장 → (보냄) → 행 갱신 순서이고, 받는 사람은 피드 재료보다 먼저 고른다", async () => {
    const s = setup();
    await s.processOnce();
    expect(methodsOf(s.calls)).toEqual([
      "listRecipients",
      "readFeedSource",
      "hasKakaoSentForBid",
      "ensureKakaoRow",
      "setKakaoRowStatus",
      "closeOpenKakaoRows",
    ]);
  });

  it("받는 사람은 이벤트의 조직으로, 피드 재료는 이벤트의 run 으로 묻는다", async () => {
    const s = setup();
    await s.processOnce();
    expect(
      s.calls
        .filter((call) => call.method === "listRecipients" || call.method === "readFeedSource")
        .map((call) => call.key),
    ).toEqual([ORG_ID, RUN_ID]);
  });
});

describe("processKakaoEvent · Review Focus 1 — 두 조직의 같은 공고는 한 사람에게 한 통", () => {
  // 둘째 조직의 run 은 같은 공고를 그 조직의 회사 프로필로 분석한 것이다.
  const OTHER_RUN_ID = "5d4c3b2a-1908-4f7e-a6d5-c4b3a2918070";
  const ORG2_EVENT = withPayload(
    bidRecommendedEvent("BID", { id: OTHER_EVENT_ID, org_id: OTHER_ORG_ID }),
    { orgId: OTHER_ORG_ID, scoreRunId: OTHER_RUN_ID },
  );
  const bothOrgs: StoreOptions = {
    recipients: { [ORG_ID]: [USER_A], [OTHER_ORG_ID]: [USER_A] },
    feeds: {
      [RUN_ID]: feedSource(),
      [OTHER_RUN_ID]: feedSource({ orgId: OTHER_ORG_ID }),
    },
  };

  it("첫 조직에서 보낸 뒤 둘째 조직 이벤트는 그 사람에게 보내지 않는다(발송 1회)", async () => {
    const s = setup(bothOrgs);
    await s.processOnce();
    await expect(s.processOnce(ORG2_EVENT)).resolves.toEqual({
      outcome: "SENT",
      sent: 0,
      failed: 0,
    });
    expect(s.recipientsSent()).toEqual([USER_A]);
  });

  it("둘째 조직 이벤트에는 그 사람의 KAKAO 행을 만들지 않는다", async () => {
    const s = setup(bothOrgs);
    await s.processOnce();
    await s.processOnce(ORG2_EVENT);
    expect(s.rows.map((row) => row.idempotency_key)).toEqual([`${EVENT_ID}:${USER_A}:KAKAO`]);
  });

  it("이미 받았는지는 그 사람과 이벤트의 공고로 묻는다", async () => {
    const s = setup(bothOrgs);
    await s.processOnce(ORG2_EVENT);
    expect(s.calls.find((call) => call.method === "hasKakaoSentForBid")?.key).toBe(
      `${USER_A}:${BID_ID}`,
    );
  });

  it("다른 조직에서 결과 불분명(DEAD·TIMEOUT_UNKNOWN)으로 닫힌 같은 공고도 다시 보내지 않는다(최대 한 번)", async () => {
    const s = setup({ rows: [otherOrgRow("DEAD", "TIMEOUT_UNKNOWN")] });
    await s.processOnce();
    expect(s.sends).toEqual([]);
  });

  it("다른 조직에서 분명히 못 보낸(DEAD·KAKAO_-2) 같은 공고는 이 조직에서 보낸다", async () => {
    const s = setup({ rows: [otherOrgRow("DEAD", "KAKAO_-2")] });
    await s.processOnce();
    expect(s.recipientsSent()).toEqual([USER_A]);
  });

  it("다른 공고를 받은 적이 있어도 이 공고는 보낸다", async () => {
    const s = setup({ rows: [otherOrgRow("SENT", null, OTHER_BID_ID)] });
    await s.processOnce();
    expect(s.recipientsSent()).toEqual([USER_A]);
  });
});

describe("processKakaoEvent · Review Focus 2 — 이벤트 뒤 보내기 전에 끄거나 연결을 해제했다", () => {
  it("보낼 때 받는 사람을 다시 골라, 끈 사람에게는 보내지 않고 행도 만들지 않는다", async () => {
    const s = setup(THREE);
    s.setRecipients(ORG_ID, [USER_B]);
    await expect(s.processOnce()).resolves.toEqual({ outcome: "SENT", sent: 1, failed: 0 });
    expect(s.recipientsSent()).toEqual([USER_B]);
    expect(s.rows.map((row) => row.user_id)).toEqual([USER_B]);
  });

  it("재시도 중에 끈 사람에게는 다음 회차에 보내지 않고, 그 사람의 FAILED 행은 DEAD 로 닫는다", async () => {
    const s = setup(THREE, replyFor(USER_B, { kind: "RETRYABLE", code: "HTTP_503" }));
    await s.processOnce();
    s.setRecipients(ORG_ID, [USER_A, USER_C]);
    await expect(s.processOnce(retried(bidRecommendedEvent(), 1))).resolves.toEqual({
      outcome: "SENT",
      sent: 0,
      failed: 0,
    });
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_C]);
    expect(s.rowOf(USER_B)).toMatchObject({ status: "DEAD", error: "HTTP_503" });
  });

  it("받는 사람이 모두 꺼졌으면 SKIPPED_NO_RECIPIENT 이고 아무에게도 보내지 않는다", async () => {
    const s = setup(THREE);
    s.setRecipients(ORG_ID, []);
    await expect(s.processOnce()).resolves.toEqual({
      outcome: "SKIPPED_NO_RECIPIENT",
      sent: 0,
      failed: 0,
    });
    expect([s.sends, s.rows]).toEqual([[], []]);
  });
});

describe("processKakaoEvent · Review Focus 3 — 사용자가 카카오에서 연결을 끊었다(만료)", () => {
  it("EXPIRED(changed=true) 면 행은 DEAD·KAKAO_EXPIRED 이고 인앱 KAKAO_EXPIRED 알림 1건이다", async () => {
    const s = setup({}, () => ({ kind: "EXPIRED", changed: true }));
    await expect(s.processOnce()).resolves.toEqual({ outcome: "SENT", sent: 0, failed: 1 });
    expect(s.rowOf(USER_A)).toMatchObject({ status: "DEAD", error: "KAKAO_EXPIRED" });
    expect(s.inApp).toEqual([
      {
        org_id: ORG_ID,
        user_id: USER_A,
        type: "KAKAO_EXPIRED",
        channel: "IN_APP",
        status: "SENT",
        sent_at: NOW_ISO,
        idempotency_key: `${EVENT_ID}:${USER_A}:KAKAO_EXPIRED:IN_APP`,
        payload: {
          bidId: BID_ID,
          title: BID_TITLE,
          message: EXPIRED_IN_APP_MESSAGE,
          link: "/settings",
        },
      },
    ]);
  });

  // 행 갱신이 실패해 이벤트를 다시 처리하면 연결은 이미 만료라 발송 수단이 changed=false 를 준다 — 알림을 다시 만들 기회가 없다.
  it("EXPIRED(changed=true) 뒤 행 갱신이 던져도 만료 인앱 알림은 이미 남아 있다(알림을 행 갱신보다 먼저 넣는다)", async () => {
    const storeFailure = new Error("저장 실패 흉내");
    const s = setup(
      { fail: (call) => (call.method === "setKakaoRowStatus" ? storeFailure : undefined) },
      () => ({ kind: "EXPIRED", changed: true }),
    );
    await expect(rejectionOf(s.processOnce())).resolves.toBe(storeFailure);
    expect(s.inApp).toHaveLength(1);
    expect(methodsOf(s.calls).slice(-2)).toEqual(["insertNotification", "setKakaoRowStatus"]);
  });

  it("EXPIRED(changed=false) 면 행은 DEAD 이고 인앱 알림은 없다(바뀐 순간에만 한 번)", async () => {
    const s = setup({}, () => ({ kind: "EXPIRED", changed: false }));
    await s.processOnce();
    expect(s.rowOf(USER_A).status).toBe("DEAD");
    expect(s.inApp).toEqual([]);
  });

  it("만료로 닫힌 사람은 이벤트를 다시 처리해도 다시 보내지 않고 인앱 알림도 1건 그대로다", async () => {
    const s = setup({ recipients: { [ORG_ID]: [USER_A, USER_B] } }, (userId) =>
      userId === USER_A
        ? { kind: "EXPIRED", changed: true }
        : { kind: "RETRYABLE", code: "NETWORK" },
    );
    await s.processOnce();
    await s.processOnce(retried(bidRecommendedEvent(), 1));
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_B]);
    expect(s.inApp).toHaveLength(1);
  });
});

describe("processKakaoEvent · 두 단계 멱등", () => {
  it("같은 이벤트를 두 번 처리해도 발송은 1회이고 행은 하나다", async () => {
    const s = setup();
    await s.processOnce();
    await s.processOnce();
    expect([s.sends.length, s.rows.length]).toEqual([1, 1]);
  });

  it("다시 처리한 회차는 SENT·sent 0 이다", async () => {
    const s = setup();
    await s.processOnce();
    await expect(s.processOnce()).resolves.toEqual({ outcome: "SENT", sent: 0, failed: 0 });
  });

  it("이미 있는 행이 SENT 면(앞 회차가 행만 갱신하고 끝났다) 보내지 않는다", async () => {
    const s = setup({ rows: [ownRow("SENT", null)] });
    await s.processOnce();
    expect(s.sends).toEqual([]);
  });

  it("이미 있는 행이 DEAD 면 보내지 않는다", async () => {
    const s = setup({ rows: [ownRow("DEAD", "KAKAO_-2")] });
    await s.processOnce();
    expect(s.sends).toEqual([]);
  });

  it("이미 있는 행이 PENDING 이면(앞 회차가 보내기 전에 멈췄다) 그 행으로 보낸다", async () => {
    const s = setup({ rows: [ownRow("PENDING", null)] });
    await s.processOnce();
    expect(s.recipientsSent()).toEqual([USER_A]);
    expect(s.rows).toHaveLength(1);
    expect(s.rowOf(USER_A).status).toBe("SENT");
  });
});

describe("processKakaoEvent · 셋 중 둘째가 RETRYABLE", () => {
  const reply = replyFor(USER_B, { kind: "RETRYABLE", code: "HTTP_503" });

  it("첫 회차는 RETRY·sent 2·failed 1 이고 첫째·셋째는 SENT, 둘째는 FAILED(code) 다", async () => {
    const s = setup(THREE, reply);
    await expect(s.processOnce()).resolves.toEqual({ outcome: "RETRY", sent: 2, failed: 1 });
    expect(s.rows.map((row) => [row.user_id, row.status, row.error])).toEqual([
      [USER_A, "SENT", null],
      [USER_B, "FAILED", "HTTP_503"],
      [USER_C, "SENT", null],
    ]);
  });

  it("다음 회차에는 둘째에게만 보내고 SENT 로 닫는다", async () => {
    const s = setup(THREE, reply);
    await s.processOnce();
    await expect(s.processOnce(retried(bidRecommendedEvent(), 1))).resolves.toEqual({
      outcome: "SENT",
      sent: 1,
      failed: 0,
    });
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_C, USER_B]);
    expect(s.rowOf(USER_B)).toMatchObject({ status: "SENT", sent_at: NOW_ISO });
  });

  it("다섯 번째 실패(attempts 4)면 DEAD 이고 남은 FAILED 행도 DEAD 로 닫는다(SENT 행은 그대로)", async () => {
    const s = setup(THREE, reply);
    await expect(s.processOnce(retried(bidRecommendedEvent(), 4))).resolves.toEqual({
      outcome: "DEAD",
      sent: 2,
      failed: 1,
    });
    expect(s.rows.map((row) => [row.user_id, row.status])).toEqual([
      [USER_A, "SENT"],
      [USER_B, "DEAD"],
      [USER_C, "SENT"],
    ]);
  });

  it("넷째 실패(attempts 3)까지는 RETRY 이고 FAILED 행을 닫지 않는다", async () => {
    const s = setup(THREE, reply);
    await expect(s.processOnce(retried(bidRecommendedEvent(), 3))).resolves.toMatchObject({
      outcome: "RETRY",
    });
    expect(s.rowOf(USER_B).status).toBe("FAILED");
    expect(methodsOf(s.calls)).not.toContain("closeOpenKakaoRows");
  });
});

describe("processKakaoEvent · 결과가 불분명하거나 거절된 발송은 다시 보내지 않는다", () => {
  it("UNKNOWN_OUTCOME 이면 행은 DEAD·TIMEOUT_UNKNOWN 이고 이벤트는 재시도하지 않는다", async () => {
    const s = setup({}, () => ({ kind: "UNKNOWN_OUTCOME" }));
    await expect(s.processOnce()).resolves.toEqual({ outcome: "SENT", sent: 0, failed: 1 });
    expect(s.rowOf(USER_A)).toMatchObject({ status: "DEAD", error: "TIMEOUT_UNKNOWN" });
  });

  it("UNKNOWN_OUTCOME 인 사람은 다른 사람 때문에 이벤트를 다시 처리해도 다시 보내지 않는다", async () => {
    const s = setup({ recipients: { [ORG_ID]: [USER_A, USER_B] } }, (userId, nth) => {
      if (userId === USER_A) return { kind: "UNKNOWN_OUTCOME" };
      return nth === 0 ? { kind: "RETRYABLE", code: "HTTP_429" } : { kind: "SENT" };
    });
    await expect(s.processOnce()).resolves.toMatchObject({ outcome: "RETRY" });
    await s.processOnce(retried(bidRecommendedEvent(), 1));
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_B]);
  });

  it("REJECTED 면 행은 DEAD·그 code 이고 다시 보내지 않는다", async () => {
    const s = setup({}, () => ({ kind: "REJECTED", code: "KAKAO_-2" }));
    await s.processOnce();
    await s.processOnce();
    expect(s.rowOf(USER_A)).toMatchObject({ status: "DEAD", error: "KAKAO_-2" });
    expect(s.sends).toHaveLength(1);
  });
});

describe("processKakaoEvent · 받는 사람 0명·공고 없음", () => {
  it("받는 사람이 0명이면 SKIPPED_NO_RECIPIENT 이고 피드 재료를 읽지 않는다", async () => {
    const s = setup({ recipients: {} });
    await expect(s.processOnce()).resolves.toEqual({
      outcome: "SKIPPED_NO_RECIPIENT",
      sent: 0,
      failed: 0,
    });
    expect(methodsOf(s.calls)).not.toContain("readFeedSource");
    expect(s.sends).toEqual([]);
  });

  it("공고·run 이 없으면 SKIPPED_NO_BID 이고 보내지 않는다", async () => {
    const s = setup({ feeds: {} });
    await expect(s.processOnce()).resolves.toEqual({
      outcome: "SKIPPED_NO_BID",
      sent: 0,
      failed: 0,
    });
    expect([s.sends, s.rows]).toEqual([[], []]);
  });

  it.each([
    ["공고", { bidId: OTHER_BID_ID }],
    ["조직", { orgId: OTHER_ORG_ID }],
  ] as const)(
    "run 의 %s 이 이벤트와 다르면 SKIPPED_NO_BID 다(다른 조직·공고 혼입 방지)",
    async (_label, patch) => {
      const s = setup({ feeds: { [RUN_ID]: feedSource(patch) } });
      await expect(s.processOnce()).resolves.toMatchObject({ outcome: "SKIPPED_NO_BID" });
      expect(s.sends).toEqual([]);
    },
  );
});

describe("processKakaoEvent · INVALID", () => {
  it.each([
    ["org_id null", bidRecommendedEvent("BID", { org_id: null })],
    ["NO_BID", withPayload(bidRecommendedEvent(), { recommendation: "NO_BID" })],
    ["KAKAO_TEST userId 가 uuid 가 아님", kakaoTestEvent("user-1")],
  ] as const)("%s 이면 DEAD 이고 저장·발송을 부르지 않는다", async (_label, event) => {
    const s = setup();
    await expect(s.processOnce(event)).resolves.toEqual({ outcome: "DEAD", sent: 0, failed: 0 });
    expect([s.calls, s.sends]).toEqual([[], []]);
  });
});

describe("processKakaoEvent · KAKAO_TEST", () => {
  it("payload 의 사용자에게 시험 피드 한 통을 보내고 SENT·sent 1 이다", async () => {
    const s = setup();
    await expect(s.processOnce(kakaoTestEvent(USER_B))).resolves.toEqual({
      outcome: "SENT",
      sent: 1,
      failed: 0,
    });
    expect(s.sends).toEqual([{ userId: USER_B, template: toTestFeedTemplate(SITE_URL) }]);
  });

  it("notifications 행을 만들지 않고, 저장은 활동 계정인지만 묻는다(결과 기록은 발송 수단의 몫)", async () => {
    const s = setup();
    await s.processOnce(kakaoTestEvent(USER_A));
    expect([s.rows, s.inApp, s.calls]).toEqual([[], [], [{ method: "isActive", key: USER_A }]]);
  });

  it("정지 계정이면 보내지 않고 SKIPPED_INACTIVE(PROCESSED)다", async () => {
    const s = setup({ inactive: [USER_A] });
    await expect(s.processOnce(kakaoTestEvent(USER_A))).resolves.toEqual({
      outcome: "SKIPPED_INACTIVE",
      sent: 0,
      failed: 0,
    });
    expect([s.sends, s.rows, s.inApp]).toEqual([[], [], []]);
  });

  it("활동 계정인지 묻다 저장이 던지면 그 오류로 reject 하고 보내지 않는다", async () => {
    const failure = new Error("저장 실패 흉내");
    const s = setup({ fail: (call) => (call.method === "isActive" ? failure : undefined) });
    await expect(rejectionOf(s.processOnce(kakaoTestEvent(USER_A)))).resolves.toBe(failure);
    expect(s.sends).toEqual([]);
  });

  it.each([
    [{ kind: "RETRYABLE", code: "HTTP_503" }],
    [{ kind: "UNKNOWN_OUTCOME" }],
    [{ kind: "EXPIRED", changed: true }],
  ] as const)(
    "발송이 %o 여도 재시도하지 않고 SENT(PROCESSED)·failed 1 이며 인앱 알림도 없다",
    async (result) => {
      const s = setup({}, () => result);
      await expect(s.processOnce(kakaoTestEvent(USER_A))).resolves.toEqual({
        outcome: "SENT",
        sent: 0,
        failed: 1,
      });
      expect(s.inApp).toEqual([]);
    },
  );
});

describe("processKakaoEvent · 저장·발송 수단이 던지면", () => {
  it("받는 사람 고르기가 던지면 그 오류로 reject 하고 보내지 않는다(부르는 쪽이 재시도로 돌린다)", async () => {
    const failure = new Error("저장 실패 흉내");
    const s = setup({
      fail: (call) => (call.method === "listRecipients" ? failure : undefined),
    });
    await expect(rejectionOf(s.processOnce())).resolves.toBe(failure);
    expect(s.sends).toEqual([]);
  });
});

describe("processKakaoEvent · 발송 수단이 던지면 그 사람만 FAILED", () => {
  // 발송 수단은 아무것도 보내지 않았을 때만 던진다(연결 저장 오류·키 형식 오류 등, kakao-sender 주석). 그래서 그 사람의 행은
  // FAILED 로 두고 같은 회차의 다른 사람에게는 계속 보낸다. 이벤트는 RETRYABLE 과 같이 toRetryUpdate 로 재시도한다.
  const failure = Object.assign(new Error("연결 저장 실패 흉내 — postgres://svc:pw@db"), {
    name: "KakaoLinkStoreError",
  });
  const throwsFor =
    (target: string, times = 1): Reply =>
    (userId, nth) => {
      if (userId === target && nth < times) throw failure;
      return { kind: "SENT" };
    };

  it("둘째에게 보내다 던지면 RETRY·sent 2·failed 1 이고 셋째에게도 같은 회차에 보낸다", async () => {
    const s = setup(THREE, throwsFor(USER_B));
    await expect(s.processOnce()).resolves.toEqual({ outcome: "RETRY", sent: 2, failed: 1 });
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_C]);
  });

  it("던진 사람의 행은 FAILED·오류 이름이고 오류 message 는 행에 싣지 않는다", async () => {
    const s = setup(THREE, throwsFor(USER_B));
    await s.processOnce();
    expect(s.rowOf(USER_B)).toMatchObject({ status: "FAILED", error: "KakaoLinkStoreError" });
    expect(JSON.stringify(s.rows)).not.toContain("pw@db");
  });

  it("다음 회차에는 던졌던 사람에게만 다시 보낸다", async () => {
    const s = setup(THREE, throwsFor(USER_B));
    await s.processOnce();
    await expect(s.processOnce(retried(bidRecommendedEvent(), 1))).resolves.toEqual({
      outcome: "SENT",
      sent: 1,
      failed: 0,
    });
    expect(s.recipientsSent()).toEqual([USER_A, USER_B, USER_C, USER_B]);
  });

  it("계속 던지면 다섯 번째 회차(attempts 4)에서 DEAD 이고 그 사람의 행도 DEAD 로 닫는다", async () => {
    const s = setup(THREE, throwsFor(USER_B, Number.POSITIVE_INFINITY));
    const outcomes: string[] = [];
    for (const attempts of [0, 1, 2, 3, 4]) {
      const event =
        attempts === 0 ? bidRecommendedEvent() : retried(bidRecommendedEvent(), attempts);
      outcomes.push((await s.processOnce(event)).outcome);
    }
    expect(outcomes).toEqual(["RETRY", "RETRY", "RETRY", "RETRY", "DEAD"]);
    expect(s.rowOf(USER_B)).toMatchObject({ status: "DEAD", error: "KakaoLinkStoreError" });
    expect(s.recipientsSent().filter((userId) => userId === USER_B)).toHaveLength(5);
  });

  it("행 갱신이 던지면(저장 장애) 그 오류로 reject 한다(부르는 쪽이 재시도로 돌린다)", async () => {
    const storeFailure = new Error("저장 실패 흉내");
    const s = setup({
      fail: (call) => (call.method === "setKakaoRowStatus" ? storeFailure : undefined),
    });
    await expect(rejectionOf(s.processOnce())).resolves.toBe(storeFailure);
  });
});

describe("processKakaoEvent · 웹과 worker 의 토큰 암호화 키가 다르면(설정 오류)", () => {
  // 보안 검토 1: 키가 다르면 실제 memo 발송 수단이 KakaoTokenKeyMismatchError 로 던진다(변조가 아니다). 소비자는 그 사람만 FAILED 로
  // 두고 이벤트를 재시도한다. 연결된 전원을 만료로 바꾸고 전원에게 만료 인앱 알림을 보내던 길을 막는다.
  // 카카오 API 는 부르면 기록만 하고 시험이 알 수 있게 하는 가짜다(네트워크 없음).
  const RECIPIENTS = [USER_A, USER_B, USER_C];

  function mismatchSetup() {
    const webKey = randomBytes(32).toString("base64");
    const workerKey = randomBytes(32).toString("base64");
    const links = createMemoryLinkStore(
      Object.fromEntries(RECIPIENTS.map((userId) => [userId, sealedLink(userId, webKey, NOW)])),
    );
    const kakaoCalls: string[] = [];
    const api: KakaoApi = {
      authorizeUrl: () => {
        throw new Error("소비자가 authorizeUrl 을 불렀다");
      },
      exchangeCode: async () => {
        throw new Error("소비자가 exchangeCode 를 불렀다");
      },
      refresh: async () => {
        kakaoCalls.push("refresh");
        throw new Error("키가 다르면 갱신하지 않는다");
      },
      sendMemo: async () => {
        kakaoCalls.push("send");
        return { kind: "SENT" };
      },
    };
    const sender = createMemoKakaoSender({
      api,
      links: links.store,
      encKey: workerKey,
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });
    const memory = createMemoryKakaoStore(THREE);
    const processOnce = (event: OutboxEventRow) =>
      processKakaoEvent(
        { store: memory.store, sender, siteUrl: SITE_URL, now: () => new Date(NOW) },
        event,
      );
    return { ...memory, links, kakaoCalls, processOnce };
  }

  it("아무도 EXPIRED 가 되지 않고 만료 인앱도 없다 — 사람마다 FAILED(KakaoTokenKeyMismatchError)이고 이벤트는 재시도하다 다섯 번째에 DEAD", async () => {
    const s = mismatchSetup();
    const outcomes: string[] = [];
    for (const attempts of [0, 1, 2, 3, 4]) {
      const event =
        attempts === 0 ? bidRecommendedEvent() : retried(bidRecommendedEvent(), attempts);
      const result = await s.processOnce(event);
      outcomes.push(result.outcome);
      if (attempts === 0) {
        expect(result).toEqual({ outcome: "RETRY", sent: 0, failed: 3 });
        for (const userId of RECIPIENTS) {
          expect(s.rowOf(userId)).toMatchObject({
            status: "FAILED",
            error: "KakaoTokenKeyMismatchError",
          });
        }
      }
    }
    expect(outcomes).toEqual(["RETRY", "RETRY", "RETRY", "RETRY", "DEAD"]);
    for (const userId of RECIPIENTS) {
      expect(s.rowOf(userId)).toMatchObject({
        status: "DEAD",
        error: "KakaoTokenKeyMismatchError",
      });
      expect(s.links.rows[userId].status).toBe("CONNECTED");
    }
    expect(s.links.callsOf("markExpired")).toEqual([]);
    expect(s.inApp).toEqual([]);
    expect(s.kakaoCalls).toEqual([]);
  });

  it("KAKAO_TEST 도 그 오류로 reject 하고(부르는 쪽이 재시도로 돌린다) 연결을 만료로 바꾸지 않는다", async () => {
    const s = mismatchSetup();
    await expect(rejectionOf(s.processOnce(kakaoTestEvent(USER_A)))).resolves.toBeInstanceOf(
      KakaoTokenKeyMismatchError,
    );
    expect(s.links.rows[USER_A].status).toBe("CONNECTED");
    expect(s.links.callsOf("markExpired")).toEqual([]);
    expect(s.kakaoCalls).toEqual([]);
  });
});

// ── 도우미 ──

/** 다른 조직(OTHER_ORG_ID)에서 같은 사람(USER_A)에게 간 KAKAO 행. */
function otherOrgRow(
  status: MemoryKakaoRow["status"],
  error: string | null,
  bidId: string = BID_ID,
): MemoryKakaoRow {
  return {
    id: "row-other",
    org_id: OTHER_ORG_ID,
    user_id: USER_A,
    type: "BID_RECOMMENDED",
    channel: "KAKAO",
    status,
    error,
    sent_at: status === "SENT" ? NOW_ISO : null,
    idempotency_key: `${OTHER_EVENT_ID}:${USER_A}:KAKAO`,
    payload: { bidId, title: BID_TITLE, message: "BID 권고", link: `/bids/${bidId}` },
  };
}

/** 이 이벤트에서 USER_A 에게 이미 만든 KAKAO 행. */
function ownRow(status: MemoryKakaoRow["status"], error: string | null): MemoryKakaoRow {
  return {
    ...otherOrgRow(status, error),
    id: "row-own",
    org_id: ORG_ID,
    idempotency_key: `${EVENT_ID}:${USER_A}:KAKAO`,
  };
}
