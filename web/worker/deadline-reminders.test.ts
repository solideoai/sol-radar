import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadlineReminderStore } from "@/server/notifications";
import { readDeadlineSettings, startDeadlineReminders } from "@/worker/deadline-reminders";

// 관심 공고 마감 알림 주기 작업(N3). 기동 때 한 번, 그 뒤 DEADLINE_REMINDER_INTERVAL_MS(기본 5분)마다 한 회차를 돈다.
// 앞 회차가 안 끝났으면 건너뛰고, 회차 오류는 삼켜 로그 한 줄(오류 이름만)을 남긴다. stop 은 진행 중 회차를 최대 5초 기다린다.
// 모양은 notify-outbox 의 startNotifier 와 같다. 저장·시계·로그는 가짜다. 등록(WORKER_REGISTRATIONS)은 main.test.ts 가 본다.

const NOW = new Date("2026-10-22T00:05:00.000Z");
const KEY = "DEADLINE_REMINDER_INTERVAL_MS";
const INTERVAL_MS = 300_000;
const STOP_WAIT_MS = 5_000;
const LEAK = "LEAK-postgres://svc:pw-secret@db";

function settingsErrorOf(env: Record<string, string | undefined>): string {
  try {
    readDeadlineSettings(env);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

describe("readDeadlineSettings", () => {
  it("키가 없거나 비었으면 5분(300000ms)이다", () => {
    expect(readDeadlineSettings({})).toEqual({ intervalMs: INTERVAL_MS });
    expect(readDeadlineSettings({ [KEY]: "  " })).toEqual({ intervalMs: INTERVAL_MS });
  });

  it("60000 이상 3600000 이하 10진 정수만 받는다", () => {
    expect(readDeadlineSettings({ [KEY]: "60000" })).toEqual({ intervalMs: 60_000 });
    expect(readDeadlineSettings({ [KEY]: "3600000" })).toEqual({ intervalMs: 3_600_000 });
  });

  it.each(["59999", "3600001", "1e5", "-60000", "60000.5", "abc", "0x10000"])(
    "%s 는 키 이름만 실은 오류다(값은 싣지 않는다)",
    (value) => {
      const message = settingsErrorOf({ [KEY]: value });
      expect(message).toBe(`worker env 오류: ${KEY}`);
      expect(message).not.toContain(value);
    },
  );
});

describe("startDeadlineReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (store: DeadlineReminderStore, log = vi.fn()) => ({
    log,
    reminders: startDeadlineReminders({
      store,
      now: () => new Date(),
      log,
      settings: { intervalMs: INTERVAL_MS },
    }),
  });

  it("기동 때 한 번, interval 마다 한 번 돈다", async () => {
    const store: DeadlineReminderStore = { sendDue: vi.fn(async () => 0) };
    const { reminders } = start(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.sendDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.sendDue).toHaveBeenCalledTimes(2);
    await reminders.stop();
  });

  it("앞 회차가 안 끝났으면 다음 틱은 건너뛴다(겹치지 않는다)", async () => {
    let release: (value: number) => void = () => undefined;
    const store: DeadlineReminderStore = {
      sendDue: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const { reminders } = start(store);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(store.sendDue).toHaveBeenCalledTimes(1);
    release(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.sendDue).toHaveBeenCalledTimes(2);
    release(0);
    await reminders.stop();
  });

  it("회차 오류는 삼키고 오류 이름만 실은 로그 한 줄을 남기며, 다음 회차는 돈다", async () => {
    const error = new Error(`${LEAK} boom`);
    error.name = "DeadlineReminderStoreError";
    const store: DeadlineReminderStore = {
      sendDue: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(0),
    };
    const { reminders, log } = start(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0];
    expect(JSON.parse(line)).toEqual({
      event: "notify.deadline.failed",
      errorName: "DeadlineReminderStoreError",
    });
    expect(line).not.toContain("LEAK");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.sendDue).toHaveBeenCalledTimes(2);
    await reminders.stop();
  });

  it("stop 뒤에는 더 돌지 않는다", async () => {
    const store: DeadlineReminderStore = { sendDue: vi.fn(async () => 0) };
    const { reminders } = start(store);
    await vi.advanceTimersByTimeAsync(0);
    await reminders.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(store.sendDue).toHaveBeenCalledTimes(1);
  });

  it("stop 은 진행 중 회차를 기다리고, 5초가 넘으면 stop_timeout 한 줄을 남기고 돌아온다", async () => {
    const store: DeadlineReminderStore = {
      sendDue: vi.fn(() => new Promise<number>(() => undefined)),
    };
    const { reminders, log } = start(store);
    await vi.advanceTimersByTimeAsync(0);
    const stopping = reminders.stop();
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS);
    await stopping;
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      { event: "notify.deadline.stop_timeout" },
    ]);
  });
});
