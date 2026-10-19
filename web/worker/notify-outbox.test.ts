import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationOutboxStore, OutboxEventRow } from "@/server/notifications";
import { readNotifySettings, startNotifier } from "@/worker/notify-outbox";

// 인앱 알림 outbox 주기 처리(C7, docs/13-NOTIFICATIONS.md "pending polling"). 기동 때 한 번, 그 뒤 NOTIFY_POLL_INTERVAL_MS(기본 2000)마다
// processOutboxBatch 를 돈다. 앞 회차가 안 끝났으면 건너뛰고, 회차 오류는 삼켜 로그 한 줄만 남긴다(worker 를 죽이지 않는다).
// stop 은 타이머를 멈추고 진행 중 회차를 기다린다. 모양은 analysis-reconcile 의 startReconciler 와 같다.
// 저장·시계·로그는 가짜다. Redis·네트워크·Supabase 는 쓰지 않는다. 등록(WORKER_REGISTRATIONS)은 main.test.ts 가 본다.

type NotifierDeps = Parameters<typeof startNotifier>[0];
type NotifySettings = NotifierDeps["settings"];

const NOW_ISO = "2026-10-20T09:00:00.000Z";
const NOW = new Date(NOW_ISO);
const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const BID_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const ASSIGNEE_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const EVENT_ID = "7d6c5b4a-3928-4170-8e5d-4c3b2a190807";

const SETTINGS: NotifySettings = { intervalMs: 2_000, batchLimit: 9 };

const KEY = "NOTIFY_POLL_INTERVAL_MS";

/** message 에 접속 문자열을 담은 오류. 로그로 새면 안 된다. */
const LEAK = "LEAK-postgres://svc:pw-secret@db";
function leakyError(name: string): Error {
  const error = new Error(`${LEAK} ${name}`);
  error.name = name;
  return error;
}

// ── readNotifySettings ──

/** 오류 message. 던지지 않으면 시험을 실패시킨다. */
function settingsErrorOf(env: Record<string, string | undefined>): string {
  try {
    readNotifySettings(env);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

describe("readNotifySettings", () => {
  it("env 에 키가 없으면 intervalMs 2000·batchLimit 50 이다", () => {
    expect(readNotifySettings({})).toEqual({ intervalMs: 2_000, batchLimit: 50 });
  });

  it("빈 값이면 기본값 2000 이다", () => {
    expect(readNotifySettings({ [KEY]: "" }).intervalMs).toBe(2_000);
  });

  it.each([
    ["500", 500],
    ["2000", 2_000],
    ["60000", 60_000],
  ])("%s 이면 intervalMs %i 이다(500~60000)", (raw, expected) => {
    expect(readNotifySettings({ [KEY]: raw }).intervalMs).toBe(expected);
  });

  it("batchLimit 은 env 와 상관없이 50 이다", () => {
    expect(readNotifySettings({ [KEY]: "1000" }).batchLimit).toBe(50);
  });

  it.each([["499"], ["60001"], ["0"], ["-1"], ["1.5"], ["abc"], ["2000ms"]])(
    "%s 이면 'worker env 오류: NOTIFY_POLL_INTERVAL_MS' 로 던진다",
    (raw) => {
      expect(settingsErrorOf({ [KEY]: raw })).toBe("worker env 오류: NOTIFY_POLL_INTERVAL_MS");
    },
  );

  it("틀린 값을 message 에 싣지 않는다", () => {
    expect(settingsErrorOf({ [KEY]: "SECRETVALUE-9999" })).not.toContain("SECRETVALUE");
  });
});

// ── startNotifier ──

const reviewAssigned = (): OutboxEventRow => ({
  id: EVENT_ID,
  org_id: ORG_ID,
  event_type: "REVIEW_ASSIGNED",
  payload: {
    reviewId: "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
    bidId: BID_ID,
    orgId: ORG_ID,
    assigneeUserId: ASSIGNEE_ID,
  },
  status: "PENDING",
  attempts: 0,
});

type FindDueInput = Parameters<NotificationOutboxStore["findDue"]>[0];

/** findDue 는 부를 때마다 next() 의 값을 돌려준다. 나머지 저장은 성공하고 기록만 남긴다. */
function fakeStore(next: (index: number) => Promise<OutboxEventRow[]> = async () => []) {
  const findDue: FindDueInput[] = [];
  const inserted: string[] = [];
  const processed: string[] = [];
  const store: NotificationOutboxStore = {
    findDue: async (input) => {
      findDue.push({ ...input });
      return next(findDue.length - 1);
    },
    readBidTitle: async () => "주기 처리 시험 공고 (가상)",
    isMember: async () => true,
    insertNotification: async (row) => {
      inserted.push(row.idempotency_key);
    },
    markProcessed: async (event) => {
      processed.push(event.id);
    },
    markRetry: async () => undefined,
  };
  return { store, findDue, inserted, processed };
}

function setup(next?: (index: number) => Promise<OutboxEventRow[]>) {
  const fake = fakeStore(next);
  const lines: string[] = [];
  const deps: NotifierDeps = {
    store: fake.store,
    now: () => new Date(NOW.getTime()),
    log: (line) => {
      lines.push(line);
    },
    settings: SETTINGS,
  };
  return { ...fake, deps, lines };
}

const records = (lines: readonly string[]): unknown[] =>
  lines.map((line): unknown => JSON.parse(line));

/** 끝나지 않는 회차를 만들 때 쓴다. */
function pendingRounds() {
  const rounds: PromiseWithResolvers<OutboxEventRow[]>[] = [];
  const next = () => {
    const round = Promise.withResolvers<OutboxEventRow[]>();
    rounds.push(round);
    return round.promise;
  };
  return { rounds, next };
}

describe("startNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** setInterval·clearInterval 은 vi.useFakeTimers 가 바꾼 가짜다. */
  const fakeTimers = () => ({ setInterval, clearInterval });

  it("시작하자마자 한 번 돈다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.findDue).toHaveLength(1);
    await handle.stop();
  });

  it("회차마다 findDue 를 now 의 ISO 값과 settings.batchLimit 으로 부른다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.findDue).toEqual([{ now: NOW_ISO, limit: SETTINGS.batchLimit }]);
    await handle.stop();
  });

  it("intervalMs 가 지나기 전에는 다시 돌지 않는다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs - 1);
    expect(s.findDue).toHaveLength(1);
    await handle.stop();
  });

  it("intervalMs 마다 한 번씩 돈다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 3);
    expect(s.findDue).toHaveLength(4);
    await handle.stop();
  });

  it("회차마다 찾은 이벤트를 처리한다(알림을 넣고 PROCESSED 로 닫는다)", async () => {
    const s = setup(async (index) => (index === 0 ? [reviewAssigned()] : []));
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect([s.inserted, s.processed]).toEqual([[`${EVENT_ID}:${ASSIGNEE_ID}:IN_APP`], [EVENT_ID]]);
    await handle.stop();
  });

  it("앞 회차가 진행 중이면 이번 회차는 건너뛴다(겹치지 않는다)", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 2);
    expect(s.findDue).toHaveLength(1);
    pending.rounds[0]?.resolve([]);
    await handle.stop();
  });

  it("건너뛴 회차를 끝난 뒤에 몰아 돌지 않고 다음 주기에 돈다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    pending.rounds[0]?.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    const afterFinish = s.findDue.length;
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    expect([afterFinish, s.findDue.length]).toEqual([1, 2]);
    pending.rounds[1]?.resolve([]);
    await handle.stop();
  });

  it("stop 뒤에는 시간이 지나도 다시 돌지 않는다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await handle.stop();
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 5);
    expect(s.findDue).toHaveLength(1);
  });

  it("stop 은 주기 타이머를 지운다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await handle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop 은 진행 중인 회차가 끝날 때까지 resolve 하지 않는다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    pending.rounds[0]?.resolve([]);
    await stopping;
  });

  it("stop 이 resolve 할 때는 진행 중이던 회차가 이벤트 처리와 요약까지 마쳤다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    pending.rounds[0]?.resolve([reviewAssigned()]);
    await stopping;
    expect(s.processed).toEqual([EVENT_ID]);
    expect(records(s.lines)).toContainEqual({
      event: "notify.outbox.summary",
      checked: 1,
      sent: 1,
      skipped: 0,
      retried: 0,
      dead: 0,
    });
  });

  it("진행 중인 회차가 실패해도 stop 은 resolve 한다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    pending.rounds[0]?.reject(leakyError("PostgrestError"));
    await expect(stopping).resolves.toBeUndefined();
  });

  it("진행 중인 회차가 없으면 stop 은 바로 resolve 한다", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it("회차 오류(findDue 실패)는 삼키고 notify.outbox.failed 와 errorName 한 줄을 남긴다", async () => {
    const s = setup(async () => Promise.reject(leakyError("PostgrestError")));
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(records(s.lines)).toEqual([
      { event: "notify.outbox.failed", errorName: "PostgrestError" },
    ]);
    await handle.stop();
  });

  it.each([
    ["Error 가 아닌 값", "NonError", "forged-string"],
    [
      "이름에 줄바꿈·값이 섞인 오류",
      "Error",
      Object.assign(new Error("x"), { name: "Bad\nforged" }),
    ],
  ])("%s 이면 notify.outbox.failed 의 errorName 은 %s 다", async (_label, expected, thrown) => {
    const s = setup(async () => Promise.reject(thrown));
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(records(s.lines)).toEqual([{ event: "notify.outbox.failed", errorName: expected }]);
    expect(s.lines.join("\n")).not.toContain("forged");
    await handle.stop();
  });

  it("회차 오류의 message 는 로그에 싣지 않는다", async () => {
    const s = setup(async () => Promise.reject(leakyError("PostgrestError")));
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.lines.join("\n")).not.toContain("LEAK");
    expect(s.lines.join("\n")).not.toContain("pw-secret");
    await handle.stop();
  });

  it("회차가 실패해도 다음 주기에 다시 돈다", async () => {
    const s = setup(async (index) =>
      index === 0 ? Promise.reject(leakyError("PostgrestError")) : [],
    );
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    expect(s.findDue).toHaveLength(2);
    await handle.stop();
  });

  it("빈 회차는 로그를 남기지 않는다(2초마다 빈 줄이 쌓이지 않는다)", async () => {
    const s = setup();
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 3);
    expect(s.lines).toEqual([]);
    await handle.stop();
  });
});
