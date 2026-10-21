import { describe, expect, it } from "vitest";
import {
  KAKAO_EVENT_TYPES,
  isKakaoEventType,
  toBidFeedInput,
  toKakaoEvent,
  toKakaoExpiredRow,
  toKakaoNotificationRow,
  toKakaoRowUpdate,
} from "@/server/notifications";
import {
  EXPIRED_IN_APP_MESSAGE,
  SITE_URL,
  USER_A,
  bidRecommendedEvent,
  feedSource,
  kakaoTestEvent,
} from "./kakao.test-support";
import {
  BID_ID,
  BID_TITLE,
  EVENT_ID,
  NOW,
  NOW_ISO,
  ORG_ID,
  OTHER_ORG_ID,
  RUN_ID,
  analysisCompleteEvent,
  withPayload,
} from "./outbox.test-support";

// 카카오톡 추천 공고 알림 소비자의 순수 규칙(계획 Task 4 Interfaces, 설계 §5.2·§5.5).
// outbox 이벤트 → 카카오 이벤트, 받는 사람 → KAKAO 알림 행, 만료 → 인앱 알림 행, 발송 결과 → 행 갱신.

describe("isKakaoEventType", () => {
  it("BID_RECOMMENDED·KAKAO_TEST 만 카카오 이벤트다", () => {
    expect(KAKAO_EVENT_TYPES).toEqual(["BID_RECOMMENDED", "KAKAO_TEST"]);
    expect(
      ["BID_RECOMMENDED", "KAKAO_TEST", "REVIEW_ASSIGNED", "ANALYSIS_COMPLETE", "BID_CHANGED"].map(
        isKakaoEventType,
      ),
    ).toEqual([true, true, false, false, false]);
  });
});

describe("toKakaoEvent · BID_RECOMMENDED", () => {
  it("payload 를 RECOMMENDED 로 읽는다", () => {
    expect(toKakaoEvent(bidRecommendedEvent("WATCH"))).toEqual({
      kind: "RECOMMENDED",
      orgId: ORG_ID,
      bidId: BID_ID,
      scoreRunId: RUN_ID,
      recommendation: "WATCH",
      status: "COMPLETED",
    });
  });

  it("PARTIAL 마감도 RECOMMENDED 다", () => {
    const event = withPayload(bidRecommendedEvent(), { status: "PARTIAL" });
    expect(toKakaoEvent(event)).toMatchObject({ kind: "RECOMMENDED", status: "PARTIAL" });
  });

  it.each([
    ["org_id null", bidRecommendedEvent("BID", { org_id: null })],
    [
      "payload orgId 가 행의 org_id 와 다르다",
      withPayload(bidRecommendedEvent(), { orgId: OTHER_ORG_ID }),
    ],
    ["NO_BID 권고", withPayload(bidRecommendedEvent(), { recommendation: "NO_BID" })],
    ["FAILED 마감", withPayload(bidRecommendedEvent(), { status: "FAILED" })],
    ["scoreRunId 없음", withPayload(bidRecommendedEvent(), { scoreRunId: undefined })],
    ["bidId 가 uuid 가 아님", withPayload(bidRecommendedEvent(), { bidId: "bid-1" })],
    ["payload 가 배열", { ...bidRecommendedEvent(), payload: [] }],
  ])("%s 이면 INVALID 다", (_label, event) => {
    expect(toKakaoEvent(event)).toEqual({ kind: "INVALID" });
  });
});

describe("toKakaoEvent · KAKAO_TEST", () => {
  it("payload userId 를 TEST 로 읽는다", () => {
    expect(toKakaoEvent(kakaoTestEvent(USER_A))).toEqual({ kind: "TEST", userId: USER_A });
  });

  it.each([
    ["uuid 가 아님", kakaoTestEvent("user-1")],
    ["userId 없음", { ...kakaoTestEvent(), payload: {} }],
    ["payload null", { ...kakaoTestEvent(), payload: null }],
  ] as const)("userId 가 %s 이면 INVALID 다", (_label, event) => {
    expect(toKakaoEvent(event)).toEqual({ kind: "INVALID" });
  });
});

describe("toKakaoEvent · 다른 종류", () => {
  it("인앱 종류(ANALYSIS_COMPLETE)는 INVALID 다(카카오 소비자가 받지 않는다)", () => {
    expect(toKakaoEvent(analysisCompleteEvent())).toEqual({ kind: "INVALID" });
  });
});

describe("toKakaoNotificationRow", () => {
  const row = (recommendation: "BID" | "WATCH") =>
    toKakaoNotificationRow({
      outboxEventId: EVENT_ID,
      orgId: ORG_ID,
      userId: USER_A,
      bidId: BID_ID,
      title: BID_TITLE,
      recommendation,
    });

  it("KAKAO·BID_RECOMMENDED·PENDING 행이고 키는 <outboxEventId>:<userId>:KAKAO 다", () => {
    expect(row("BID")).toEqual({
      org_id: ORG_ID,
      user_id: USER_A,
      type: "BID_RECOMMENDED",
      channel: "KAKAO",
      status: "PENDING",
      idempotency_key: `${EVENT_ID}:${USER_A}:KAKAO`,
      payload: {
        bidId: BID_ID,
        title: BID_TITLE,
        message: "BID 권고",
        link: `/bids/${BID_ID}`,
      },
    });
  });

  it("WATCH 면 문구가 'WATCH 권고' 다", () => {
    expect(row("WATCH").payload.message).toBe("WATCH 권고");
  });
});

describe("toKakaoExpiredRow", () => {
  it("인앱 KAKAO_EXPIRED·SENT 행이고 링크는 /settings, 문구는 만료 인앱 문구 그대로다", () => {
    expect(
      toKakaoExpiredRow({
        outboxEventId: EVENT_ID,
        orgId: ORG_ID,
        userId: USER_A,
        bidId: BID_ID,
        title: BID_TITLE,
        now: NOW,
      }),
    ).toEqual({
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
    });
  });
});

describe("toKakaoRowUpdate", () => {
  it.each([
    [{ kind: "SENT" }, { status: "SENT", error: null, notifyExpired: false }],
    [
      { kind: "RETRYABLE", code: "HTTP_503" },
      { status: "FAILED", error: "HTTP_503", notifyExpired: false },
    ],
    [
      { kind: "UNKNOWN_OUTCOME" },
      { status: "DEAD", error: "TIMEOUT_UNKNOWN", notifyExpired: false },
    ],
    [
      { kind: "REJECTED", code: "KAKAO_-2" },
      { status: "DEAD", error: "KAKAO_-2", notifyExpired: false },
    ],
    [{ kind: "TOKEN_INVALID" }, { status: "DEAD", error: "TOKEN_INVALID", notifyExpired: false }],
    [
      { kind: "EXPIRED", changed: true },
      { status: "DEAD", error: "KAKAO_EXPIRED", notifyExpired: true },
    ],
    [
      { kind: "EXPIRED", changed: false },
      { status: "DEAD", error: "KAKAO_EXPIRED", notifyExpired: false },
    ],
  ] as const)("%o → %o", (result, expected) => {
    expect(toKakaoRowUpdate(result)).toEqual(expected);
  });
});

describe("toBidFeedInput", () => {
  it("피드 재료·사이트 주소·now 를 피드 입력으로 옮기고 사유 줄은 필수 자격 판정에서만 만든다", () => {
    expect(toBidFeedInput(feedSource(), SITE_URL, NOW)).toEqual({
      bidId: BID_ID,
      title: BID_TITLE,
      agency: "가상시청",
      deadlineAt: new Date("2026-10-30T09:00:00.000Z"),
      budgetKrw: 1_240_000_000,
      score: 78,
      recommendation: "BID",
      status: "COMPLETED",
      reason: "필수 자격 충족",
      sourceUrl: "https://fixture.invalid/notice/0001",
      siteUrl: SITE_URL,
      now: NOW,
    });
  });

  it("필수 항목에 확인 필요가 있으면 사유 줄은 '확인 필요 n건' 이다", () => {
    const source = feedSource({
      checks: [
        { mandatory: true, outcome: "NEEDS_REVIEW" },
        { mandatory: true, outcome: "NEEDS_REVIEW" },
        { mandatory: true, outcome: "SATISFIED" },
      ],
    });
    expect(toBidFeedInput(source, SITE_URL, NOW).reason).toBe("확인 필요 2건");
  });
});
