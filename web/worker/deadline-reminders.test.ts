import { afterEach, expect, it, vi } from "vitest";
import { startDeadlineReminders } from "./deadline-reminders";

afterEach(() => vi.useRealTimers());

it("마감 알림은 기동 때 실행하고 겹친 회차를 건너뛰며 stop 뒤에는 실행하지 않는다", async () => {
  vi.useFakeTimers();
  let inserted = 0;
  let finish: () => void = () => undefined;
  const worker = startDeadlineReminders({
    store: {
      sendDue: () =>
        new Promise<number>((resolve) => {
          inserted += 1;
          finish = () => resolve(0);
        }),
    },
    now: () => new Date(),
    log: () => undefined,
    settings: { intervalMs: 300000 },
  });
  expect(inserted).toBe(1);
  await vi.advanceTimersByTimeAsync(600000);
  expect(inserted).toBe(1);
  finish();
  await vi.advanceTimersByTimeAsync(300000);
  expect(inserted).toBe(2);
  finish();
  await worker.stop();
  await vi.advanceTimersByTimeAsync(300000);
  expect(inserted).toBe(2);
});
