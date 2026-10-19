import { describe, expect, it } from "vitest";
import type { NotificationRepo } from "./bids.repo";
import type { Notification } from "./notification.model";
import { listNotifications, markNotificationRead } from "./notification.service";

const make = (id: string, link: string): Notification => ({
  id,
  type: "BID_CHANGED",
  channel: "IN_APP",
  status: "SENT",
  payload: { bidId: `bid-${id}`, title: "공고", message: "변경", link },
  readAt: null,
  createdAt: "2026-10-19T00:00:00Z",
});

const repoOf = (items: Notification[], hasNext = false): NotificationRepo => ({
  list: async () => ({
    items,
    hasNext,
    last:
      items.length > 0 ? { sortValue: "2026-10-19T00:00:00Z", id: items.at(-1)?.id ?? "" } : null,
  }),
  markRead: async (_user, id) => items.find((item) => item.id === id) ?? null,
});

const query = { unreadOnly: false, cursor: null, limit: 20 };

describe("listNotifications", () => {
  it("바깥 링크가 든 항목은 서비스 출력에서 공고 상세가 된다", async () => {
    const repo = repoOf([
      make("1", "https://evil.example"),
      make("2", "/bids/abc"),
      make("3", "//e.example"),
    ]);
    const result = await listNotifications("u1", query, "secret", { repo });
    expect(result.ok && result.data.items.map((item) => item.payload.link)).toEqual([
      "/bids/bid-1",
      "/bids/abc",
      "/bids/bid-3",
    ]);
  });

  it("다음 쪽이 있으면 서명한 커서를 낸다", async () => {
    const result = await listNotifications("u1", query, "secret", {
      repo: repoOf([make("1", "/bids/a")], true),
    });
    expect(result.ok && result.data.pageInfo.hasNext).toBe(true);
    expect(result.ok && result.data.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it("변조된 커서는 400 INVALID_CURSOR 다", async () => {
    const result = await listNotifications("u1", { ...query, cursor: "x.y" }, "secret", {
      repo: repoOf([]),
    });
    expect(result).toMatchObject({ ok: false, status: 400, code: "INVALID_CURSOR" });
  });

  it("unreadOnly 가 바뀐 커서는 거절한다", async () => {
    const first = await listNotifications("u1", query, "secret", {
      repo: repoOf([make("1", "/bids/a")], true),
    });
    const cursor = first.ok ? first.data.pageInfo.nextCursor : null;
    const result = await listNotifications(
      "u1",
      { unreadOnly: true, cursor, limit: 20 },
      "secret",
      {
        repo: repoOf([]),
      },
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_CURSOR" });
  });
});

describe("listNotifications 커서 범위", () => {
  it("unreadOnly true 로 발급한 커서를 false 로 검증하면 INVALID_CURSOR 다", async () => {
    const first = await listNotifications("u1", { ...query, unreadOnly: true }, "secret", {
      repo: repoOf([make("1", "/bids/a")], true),
    });
    const cursor = first.ok ? first.data.pageInfo.nextCursor : null;
    expect(cursor).not.toBeNull();
    const result = await listNotifications(
      "u1",
      { ...query, unreadOnly: false, cursor },
      "secret",
      {
        repo: repoOf([]),
      },
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_CURSOR" });
  });
});

describe("listNotifications 커서 비밀", () => {
  it("비밀이 null 이면 503 cursor 다", async () => {
    const result = await listNotifications("u1", query, null, { repo: repoOf([]) });
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "cursor" },
    });
  });
});

describe("markNotificationRead", () => {
  it("남의 알림은 404 다", async () => {
    const result = await markNotificationRead("u1", "none", { repo: repoOf([]) });
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });

  it("읽음 처리한 알림도 링크를 안전하게 바꿔 낸다", async () => {
    const result = await markNotificationRead("u1", "1", {
      repo: repoOf([make("1", "https://evil.example")]),
    });
    expect(result.ok && result.data.payload.link).toBe("/bids/bid-1");
  });
});
