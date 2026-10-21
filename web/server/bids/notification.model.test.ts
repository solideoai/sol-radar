import { describe, expect, it } from "vitest";
import type { Notification } from "./notification.model";
import { notificationSchema, safeNotificationLink } from "./notification.model";

const make = (link: string): Notification => ({
  id: "n1",
  type: "BID_CREATED",
  channel: "IN_APP",
  status: "SENT",
  payload: { bidId: "abc", title: "공고", message: "새 공고", link },
  readAt: null,
  createdAt: "2026-10-19T00:00:00Z",
});

describe("safeNotificationLink", () => {
  it("안쪽 경로는 그대로다", () => {
    expect(safeNotificationLink(make("/bids/abc"))).toBe("/bids/abc");
    expect(safeNotificationLink(make("/bids/abc?tab=analysis#top"))).toBe(
      "/bids/abc?tab=analysis#top",
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
    "/ok\n//evil.example",
    // 보안 L6: URL 로 풀면 `//evil.example` 이 되는 경로(safeNextPath 와 같은 규칙)
    "/.//evil.example",
    "/..//evil.example",
    "/%2F/evil.example",
    "/%2f/evil.example",
    "/%5C/evil.example",
    "/%E0%A4%A",
  ])("바깥 링크 %j 는 공고 상세로 바꾼다", (link) => {
    expect(safeNotificationLink(make(link))).toBe("/bids/abc");
  });

  it("점 경로는 풀린 안쪽 경로로 낸다", () => {
    expect(safeNotificationLink(make("/bids/./abc"))).toBe("/bids/abc");
    expect(safeNotificationLink(make("/x/../bids/abc"))).toBe("/bids/abc");
  });
});

// M5: 생산자(C7)가 05 에 없는 키를 더해도 알림이 사라지지 않는다. 필수 키는 그대로 검사한다.
describe("notificationSchema payload", () => {
  const row = make("/bids/abc");

  it("모르는 키는 버리고 통과한다", () => {
    const parsed = notificationSchema.parse({
      ...row,
      payload: { ...row.payload, producerVersion: 2 },
    });
    expect(parsed.payload).toEqual(row.payload);
  });

  it.each(["bidId", "title", "message", "link"] as const)(
    "필수 키 %s 가 없으면 거절한다",
    (key) => {
      const payload = Object.fromEntries(
        Object.entries(row.payload).filter(([name]) => name !== key),
      );
      expect(notificationSchema.safeParse({ ...row, payload }).success).toBe(false);
    },
  );
});

// 카카오 알림(계획 Task 7): 만료 안내는 인앱 행(KAKAO_EXPIRED)이다. 목록 스키마를 통과해야 벨에 보인다.
describe("notificationSchema 카카오 종류", () => {
  it("KAKAO_EXPIRED 인앱 행이 통과하고 링크는 설정 화면이다", () => {
    const expired = {
      ...make("/settings"),
      type: "KAKAO_EXPIRED",
      payload: {
        bidId: "abc",
        title: "공고",
        message:
          "카카오 연결이 만료되어 카카오톡 알림을 보내지 못하고 있습니다. 설정에서 다시 연결해 주세요.",
        link: "/settings",
      },
    };
    const parsed = notificationSchema.parse(expired);
    expect(parsed.type).toBe("KAKAO_EXPIRED");
    expect(safeNotificationLink(parsed)).toBe("/settings");
  });

  it("BID_RECOMMENDED 종류도 거절하지 않는다", () => {
    expect(
      notificationSchema.safeParse({ ...make("/bids/abc"), type: "BID_RECOMMENDED" }).success,
    ).toBe(true);
  });
});
