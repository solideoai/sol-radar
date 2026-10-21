import { describe, expect, it, vi } from "vitest";
import { runDeadlineReminders, type DeadlineReminderStore } from "./deadline";

// 관심 공고 마감 알림 한 회차(N3, 설계 D7, docs/13-NOTIFICATIONS.md DEADLINE_APPROACHING).
// 대상·수신자·D-n·09:00 KST·멱등 키는 DB 함수(send_deadline_reminders)가 정한다 — 그 규칙의 시험은 scripts/database.test.mjs 에 있다.
// 여기서는 한 회차가 시각을 그대로 넘기고, 넣은 수를 돌려주고, 넣은 것이 있을 때만 로그 한 줄을 남기는지 본다.
// FX-14 "하루 1회"(docs/11-TESTING.md): 같은 날 다시 돌면 DB 가 키로 막아 0 을 돌려주고 로그도 없다.

const NOW = new Date("2026-10-22T00:05:00.000Z"); // KST 09:05

const fakeStore = (inserted: number[]): DeadlineReminderStore => {
  const queue = [...inserted];
  return { sendDue: vi.fn(async () => queue.shift() ?? 0) };
};

describe("runDeadlineReminders", () => {
  it("now() 시각을 그대로 저장에 넘기고 넣은 수를 돌려준다", async () => {
    const store = fakeStore([2]);
    const log = vi.fn();
    await expect(runDeadlineReminders({ store, now: () => NOW, log })).resolves.toBe(2);
    expect(store.sendDue).toHaveBeenCalledWith(NOW);
  });

  it("넣은 것이 있으면 JSON 한 줄 {event, inserted} 을 남긴다", async () => {
    const log = vi.fn();
    await runDeadlineReminders({ store: fakeStore([3]), now: () => NOW, log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "notify.deadline.sent",
      inserted: 3,
    });
  });

  it("같은 날 두 번째 회차(DB 가 키로 막아 0)는 0 을 돌려주고 로그를 남기지 않는다", async () => {
    const store = fakeStore([1, 0]);
    const log = vi.fn();
    await runDeadlineReminders({ store, now: () => NOW, log });
    await expect(runDeadlineReminders({ store, now: () => NOW, log })).resolves.toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("저장이 던지면 그대로 던진다(회차 오류 로그는 worker 타이머가 남긴다)", async () => {
    const failure = new Error("db down");
    const store: DeadlineReminderStore = { sendDue: vi.fn(async () => Promise.reject(failure)) };
    await expect(runDeadlineReminders({ store, now: () => NOW, log: vi.fn() })).rejects.toBe(
      failure,
    );
  });
});
