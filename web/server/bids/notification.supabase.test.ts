import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRow } from "./bid-row.mapper";
import { notificationRepo } from "./notification.supabase";
import { keysetFilter } from "./postgrest";
import { callsOf, fakeDb, type FakeQuery } from "./supabase-fake.test-data";

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const USER = "55555555-5555-4555-8555-555555555555";
const T0 = "2026-10-16T00:00:00+00:00";

function row(patch: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n-1",
    org_id: "org-1",
    user_id: USER,
    type: "BID_CHANGED",
    channel: "IN_APP",
    status: "SENT",
    payload: {
      bidId: "bid-1",
      title: "공고",
      message: "마감일이 바뀌었습니다",
      link: "/bids/bid-1",
    },
    read_at: null,
    created_at: T0,
    sent_at: T0,
    error: null,
    idempotency_key: "k-1",
    provider_message_id: null,
    ...patch,
  };
}

const only = (target: string): FakeQuery => {
  const found = fakeDb.queries(target);
  expect(found).toHaveLength(1);
  return found[0] as FakeQuery;
};

beforeEach(() => fakeDb.reset());
afterEach(() => vi.restoreAllMocks());

describe("list", () => {
  it("payload 가 빈 행은 빼고 console.error 를 한 번 남긴다(O11)", async () => {
    fakeDb.on(
      "notifications",
      fakeDb.rows([row({ id: "n-1" }), row({ id: "n-bad", payload: {} }), row({ id: "n-3" })]),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = await notificationRepo.list(USER, { unreadOnly: false, limit: 20 }, null);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((n) => n.id)).toEqual(["n-1", "n-3"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: "notification_row_invalid", id: "n-bad" });
  });

  it("본인 알림을 created_at 내림차순·id 오름차순으로 limit+1 읽는다", async () => {
    fakeDb.on("notifications", fakeDb.rows([]));
    await notificationRepo.list(USER, { unreadOnly: false, limit: 5 }, null);
    const q = only("notifications");
    // 카카오 발송 기록(channel KAKAO)은 인앱 목록에 보이지 않는다(계획 Task 7).
    expect(callsOf(q, "eq")).toEqual([
      ["user_id", USER],
      ["channel", "IN_APP"],
    ]);
    expect(callsOf(q, "is")).toEqual([]);
    expect(callsOf(q, "order")).toEqual([
      ["created_at", { ascending: false, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
    expect(callsOf(q, "limit")).toEqual([[6]]);
  });

  it("안 읽은 것만이면 read_at is null, 커서가 있으면 키셋 필터를 붙인다", async () => {
    fakeDb.on("notifications", fakeDb.rows([]));
    const after = { sortValue: T0, id: "n-9", queryFingerprint: "fp", issuedAt: 0 };
    await notificationRepo.list(USER, { unreadOnly: true, limit: 5 }, after);
    const q = only("notifications");
    expect(callsOf(q, "is")).toEqual([["read_at", null]]);
    expect(callsOf(q, "or")).toEqual([[keysetFilter("created_at", "desc", after)]]);
  });

  it("다음 쪽 키는 걸러 낸 행이 아니라 읽은 마지막 행에서 만든다", async () => {
    fakeDb.on(
      "notifications",
      fakeDb.rows([
        row({ id: "n-1", created_at: "2026-10-16T00:00:03+00:00" }),
        row({ id: "n-bad", created_at: "2026-10-16T00:00:02+00:00", payload: {} }),
        row({ id: "n-3", created_at: "2026-10-16T00:00:01+00:00" }),
      ]),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = await notificationRepo.list(USER, { unreadOnly: false, limit: 2 }, null);
    expect(page.items.map((n) => n.id)).toEqual(["n-1"]);
    expect(page.hasNext).toBe(true);
    expect(page.last).toEqual({ sortValue: "2026-10-16T00:00:02+00:00", id: "n-bad" });
  });
});

describe("markRead", () => {
  it("안 읽은 본인 알림만 read_at 을 쓴다", async () => {
    fakeDb.on("notifications", (q) =>
      callsOf(q, "update").length > 0 ? { data: [row({ read_at: T0 })] } : undefined,
    );
    const marked = await notificationRepo.markRead(USER, "n-1");
    expect(marked?.readAt).toBe(T0);
    const q = only("notifications");
    expect(Object.keys(callsOf(q, "update")[0]?.[0] as object)).toEqual(["read_at"]);
    expect(callsOf(q, "eq")).toEqual([
      ["id", "n-1"],
      ["user_id", USER],
      ["channel", "IN_APP"],
    ]);
    expect(callsOf(q, "is")).toEqual([["read_at", null]]);
  });

  it("이미 읽은 알림이면(0행) id 로 다시 읽어 그대로 돌려준다", async () => {
    const already = row({ read_at: "2026-10-15T00:00:00+00:00" });
    fakeDb.on("notifications", (q) =>
      callsOf(q, "update").length > 0 ? { data: [] } : fakeDb.rows([already])(q),
    );
    const marked = await notificationRepo.markRead(USER, "n-1");
    expect(marked?.readAt).toBe("2026-10-15T00:00:00+00:00");
    expect(fakeDb.queries("notifications")).toHaveLength(2);
    // 다시 읽기도 인앱 행으로만 좁힌다 — 카카오 행 id 로는 찾지 못한다(404).
    expect(callsOf(fakeDb.queries("notifications")[1] as FakeQuery, "eq")).toEqual([
      ["id", "n-1"],
      ["user_id", USER],
      ["channel", "IN_APP"],
    ]);
  });

  it("없으면 null", async () => {
    fakeDb.on("notifications", (q) =>
      callsOf(q, "update").length > 0 ? { data: [] } : { data: null },
    );
    expect(await notificationRepo.markRead(USER, "n-x")).toBeNull();
  });

  it("update 오류는 던진다", async () => {
    fakeDb.on("notifications", { error: new Error("db down") });
    await expect(notificationRepo.markRead(USER, "n-1")).rejects.toThrow("db down");
  });
});
