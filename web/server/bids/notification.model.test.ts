import { describe, expect, it } from "vitest";
import type { Notification } from "./notification.model";
import { safeNotificationLink } from "./notification.model";

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
  ])("바깥 링크 %j 는 공고 상세로 바꾼다", (link) => {
    expect(safeNotificationLink(make(link))).toBe("/bids/abc");
  });
});
