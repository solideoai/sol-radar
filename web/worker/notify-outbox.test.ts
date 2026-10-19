import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationOutboxStore, OutboxEventRow } from "@/server/notifications";
import { readNotifySettings, startNotifier } from "@/worker/notify-outbox";

// 인앱 알림 outbox 주기 처리(C7, docs/13-NOTIFICATIONS.md "pending polling"). 기동 때 한 번, 그 뒤 NOTIFY_POLL_INTERVAL_MS(기본 2000)마다
// processOutboxBatch 를 돈다. 앞 회차가 안 끝났으면 건너뛰고, 회차 오류는 삼켜 로그 한 줄만 남긴다(worker 를 죽이지 않는다).
// 회차가 실패하면 다음 회차를 min(intervalMs × 2^연속 실패 수, 60초) 뒤로 미룬다(DB 장애 동안 2초마다 두드리지 않게).
// 성공한 회차(빈 회차 포함)가 한 번 있으면 연속 실패 수를 0 으로 되돌린다. 빈 회차는 늦추지 않는다(docs/01-PRD.md 인앱 알림 지연 5초 이내).
// stop 은 타이머를 멈추고 진행 중 회차를 최대 STOP_WAIT_MS(5초)만 기다린다. 진행 중 회차는 다음 이벤트로 넘어가지 않는다(shouldStop).
// 5초 안에 끝나지 않으면 notify.outbox.stop_timeout 한 줄을 남기고 돌아온다 — Compose 의 stop 은 기본 10초 뒤 SIGKILL 이고
// main 이 notify 를 먼저 닫으므로(web/worker/main.ts closeAll) 늦어지면 다른 worker 의 종료가 밀린다.
// 모양은 analysis-reconcile 의 startReconciler 와 같다.
// 저장·시계·로그는 가짜다. Redis·네트워크·Supabase 는 쓰지 않는다. 등록(WORKER_REGISTRATIONS)은 main.test.ts 가 본다.

type NotifierDeps = Parameters<typeof startNotifier>[0];
type NotifySettings = NotifierDeps["settings"];

const NOW_ISO = "2026-10-20T09:00:00.000Z";
const NOW = new Date(NOW_ISO);
const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const BID_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const ASSIGNEE_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const EVENT_ID = "7d6c5b4a-3928-4170-8e5d-4c3b2a190807";
const SECOND_EVENT_ID = "4c3b2a19-0807-46f5-a4e3-d2c1b0a99887";
const THIRD_EVENT_ID = "6b5a4938-2716-4f05-b4d3-c2b1a0998877";

const SETTINGS: NotifySettings = { intervalMs: 2_000, batchLimit: 9 };
/** stop 이 진행 중 회차를 기다리는 최대 시간. */
const STOP_WAIT_MS = 5_000;
/** 실패 뒤 늦추기의 최대 간격. */
const MAX_BACKOFF_MS = 60_000;

/** NOW 에서 ms 지난 ISO 시각(가짜 시계 기준). */
const isoAt = (ms: number): string => new Date(NOW.getTime() + ms).toISOString();

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

type StoreOverrides = Partial<Pick<NotificationOutboxStore, "isMember">>;

/**
 * findDue 는 부를 때마다 next() 의 값을 돌려준다. 나머지 저장은 성공하고 기록만 남긴다.
 * 수신자는 늘 그 조직의 활동 계정이다(isMember·isActive true). overrides 로 isMember 를 바꿀 수 있다.
 */
function fakeStore(
  next: (index: number) => Promise<OutboxEventRow[]> = async () => [],
  overrides: StoreOverrides = {},
) {
  const findDue: FindDueInput[] = [];
  const inserted: string[] = [];
  const processed: string[] = [];
  const store: NotificationOutboxStore = {
    findDue: async (input) => {
      findDue.push({ ...input });
      return next(findDue.length - 1);
    },
    readBidTitle: async () => "주기 처리 시험 공고 (가상)",
    isMember: overrides.isMember ?? (async () => true),
    isActive: async () => true,
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

function setup(
  next?: (index: number) => Promise<OutboxEventRow[]>,
  overrides: StoreOverrides = {},
) {
  const fake = fakeStore(next, overrides);
  const lines: string[] = [];
  const deps: NotifierDeps = {
    store: fake.store,
    // 가짜 시계(vi.useFakeTimers({ now: NOW }))를 따른다. 실패 뒤 늦추기의 기준 시각이 deps.now() 라서
    // 고정 시각이면 늦추기가 끝나지 않는다. 시작 시각은 NOW 그대로다.
    now: () => new Date(Date.now()),
    log: (line) => {
      lines.push(line);
    },
    settings: SETTINGS,
  };
  return { ...fake, deps, lines };
}

const records = (lines: readonly string[]): unknown[] =>
  lines.map((line): unknown => JSON.parse(line));

/** notify.outbox.failed 줄만. */
const failedRecords = (lines: readonly string[]): Record<string, unknown>[] =>
  lines
    .map((line): Record<string, unknown> => JSON.parse(line))
    .filter((record) => record.event === "notify.outbox.failed");

/** 늘 실패하는 회차(findDue 실패). */
const alwaysFail = async (): Promise<OutboxEventRow[]> =>
  Promise.reject(leakyError("PostgrestError"));

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

  /**
   * 넷 다 vi.useFakeTimers 가 바꾼 가짜다. stop 의 대기 타이머(STOP_WAIT_MS)를 위해 setTimeout·clearTimeout 을 더 넘긴다
   * (주입 모양이 setInterval·clearInterval 둘에서 넷으로 바뀌었다).
   */
  const fakeTimers = () => ({ setInterval, clearInterval, setTimeout, clearTimeout });

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

  // 예전 기대는 "stop 뒤에 findDue 가 돌아온 이벤트도 처리하고 요약까지 남긴다"였다. stop 이 회차 전체를 기다리지 않게
  // 회차는 이벤트마다 처리 전에 shouldStop 을 보므로, stop 뒤에 찾은 이벤트는 건드리지 않고 PENDING 으로 남긴다(다음 기동이 처리한다).
  it("stop 이 findDue 도중에 오면 찾은 이벤트를 처리하지 않고 로그도 남기지 않는다(shouldStop)", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    pending.rounds[0]?.resolve([reviewAssigned()]);
    await stopping;
    expect([s.inserted, s.processed, s.lines]).toEqual([[], [], []]);
  });

  /**
   * 세 이벤트를 찾은 회차의 첫 이벤트 멤버 확인에서 멈춰 둔 채 stop 을 부르고, 그 확인을 풀어 stop 이 끝날 때까지 기다린다.
   * asked 는 isMember 를 부른 수다(이벤트 수만큼 늘어난다).
   */
  async function stopDuringFirstEvent() {
    const gate = Promise.withResolvers<boolean>();
    const ids = [EVENT_ID, SECOND_EVENT_ID, THIRD_EVENT_ID];
    const counter = { asked: 0 };
    const s = setup(async () => ids.map((id) => ({ ...reviewAssigned(), id })), {
      isMember: async () => {
        counter.asked += 1;
        return counter.asked === 1 ? gate.promise : true;
      },
    });
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    gate.resolve(true);
    await stopping;
    return { ...s, asked: counter.asked };
  }

  it("stop 이 이벤트 처리 도중에 오면 그 이벤트는 끝내고 다음 이벤트로 넘어가지 않는다(shouldStop)", async () => {
    const s = await stopDuringFirstEvent();
    expect([s.processed, s.asked]).toEqual([[EVENT_ID], 1]);
  });

  it("stop 이 이벤트 처리 도중에 오면 로그는 그 이벤트 줄과 checked 1 요약 줄이다", async () => {
    const s = await stopDuringFirstEvent();
    expect(records(s.lines)).toEqual([
      {
        event: "notify.outbox",
        outboxEventId: EVENT_ID,
        eventType: "REVIEW_ASSIGNED",
        outcome: "SENT",
      },
      { event: "notify.outbox.summary", checked: 1, sent: 1, skipped: 0, retried: 0, dead: 0 },
    ]);
  });

  it("stop 은 진행 중 회차를 대기 타이머 하나로 기다리고, 회차가 STOP_WAIT_MS 안에 끝나면 그 타이머를 지운다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
    const waiting = { stopped, timers: vi.getTimerCount() };
    pending.rounds[0]?.resolve([]);
    await stopping;
    expect([waiting, vi.getTimerCount()]).toEqual([{ stopped: false, timers: 1 }, 0]);
  });

  it("진행 중 회차가 STOP_WAIT_MS(5초) 안에 끝나지 않으면 stop 은 5초 뒤 resolve 하고 타이머를 남기지 않는다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    void handle.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
    const before = stopped;
    await vi.advanceTimersByTimeAsync(1);
    expect([before, stopped, vi.getTimerCount()]).toEqual([false, true, 0]);
  });

  it("시간이 다 되면 notify.outbox.stop_timeout 한 줄만 남긴다", async () => {
    const pending = pendingRounds();
    const s = setup(pending.next);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    void handle.stop();
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS);
    expect(records(s.lines)).toEqual([{ event: "notify.outbox.stop_timeout" }]);
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

  // 예전 기대는 { event, errorName } 두 키였다. 실패 뒤 늦추기가 생겨 연속 실패 수와 다음 회차까지의 간격을 함께 싣는다.
  // 값·message 는 여전히 싣지 않는다(docs/14-OBSERVABILITY.md).
  it("회차 오류(findDue 실패)는 삼키고 notify.outbox.failed·errorName·consecutiveFailures·nextDelayMs 한 줄을 남긴다", async () => {
    const s = setup(alwaysFail);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(records(s.lines)).toEqual([
      {
        event: "notify.outbox.failed",
        errorName: "PostgrestError",
        consecutiveFailures: 1,
        nextDelayMs: SETTINGS.intervalMs * 2,
      },
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
    expect(records(s.lines)).toEqual([
      {
        event: "notify.outbox.failed",
        errorName: expected,
        consecutiveFailures: 1,
        nextDelayMs: SETTINGS.intervalMs * 2,
      },
    ]);
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

  // 예전 기대는 "실패해도 바로 다음 주기(2초)에 다시 돈다"였다. 실패 뒤에는 다음 틱을 건너뛰고 intervalMs × 2(4초) 뒤에 돈다.
  it("회차가 실패하면 다음 틱(2초)은 건너뛰고 4초 뒤에 다시 돈다", async () => {
    const s = setup(async (index) =>
      index === 0 ? Promise.reject(leakyError("PostgrestError")) : [],
    );
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 2 - 1);
    const before = s.findDue.length;
    await vi.advanceTimersByTimeAsync(1);
    expect([before, s.findDue.map((input) => input.now)]).toEqual([1, [isoAt(0), isoAt(4_000)]]);
    await handle.stop();
  });

  it("연속 실패면 다음 회차까지 4·8·16·32·60·60초다(MAX_BACKOFF_MS 60000 에서 멈춘다)", async () => {
    const s = setup(alwaysFail);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(180_000);
    expect(s.findDue.map((input) => input.now)).toEqual(
      [0, 4_000, 12_000, 28_000, 60_000, 120_000, 180_000].map(isoAt),
    );
    await handle.stop();
  });

  it("연속 실패의 notify.outbox.failed 는 consecutiveFailures 1~6 과 nextDelayMs 4000·8000·16000·32000·60000·60000 이다", async () => {
    const s = setup(alwaysFail);
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(
      failedRecords(s.lines).map((record) => [record.consecutiveFailures, record.nextDelayMs]),
    ).toEqual([
      [1, 4_000],
      [2, 8_000],
      [3, 16_000],
      [4, 32_000],
      [5, MAX_BACKOFF_MS],
      [6, MAX_BACKOFF_MS],
    ]);
    await handle.stop();
  });

  it("실패 뒤 성공한 회차가 한 번 있으면 다시 intervalMs(2초)마다 돈다", async () => {
    const s = setup(async (index) =>
      index < 2
        ? Promise.reject(leakyError("PostgrestError"))
        : index === 2
          ? [reviewAssigned()]
          : [],
    );
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(16_000);
    expect(s.findDue.map((input) => input.now)).toEqual(
      [0, 4_000, 12_000, 14_000, 16_000].map(isoAt),
    );
    await handle.stop();
  });

  it("성공 뒤 다시 실패하면 consecutiveFailures 는 1 부터 다시 세고 nextDelayMs 는 4000 이다", async () => {
    const s = setup(async (index) =>
      index === 1 ? [reviewAssigned()] : Promise.reject(leakyError("PostgrestError")),
    );
    const handle = startNotifier(s.deps, fakeTimers());
    // 0초 실패 → 4초 성공 → 6초 실패
    await vi.advanceTimersByTimeAsync(6_000);
    expect(failedRecords(s.lines)).toEqual([
      {
        event: "notify.outbox.failed",
        errorName: "PostgrestError",
        consecutiveFailures: 1,
        nextDelayMs: 4_000,
      },
      {
        event: "notify.outbox.failed",
        errorName: "PostgrestError",
        consecutiveFailures: 1,
        nextDelayMs: 4_000,
      },
    ]);
    await handle.stop();
  });

  it("실패 뒤 빈 회차(0건)도 성공이라 그다음부터는 늦추지 않고 intervalMs 마다 돈다", async () => {
    const s = setup(async (index) =>
      index === 0 ? Promise.reject(leakyError("PostgrestError")) : [],
    );
    const handle = startNotifier(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.findDue.map((input) => input.now)).toEqual(
      [0, 4_000, 6_000, 8_000, 10_000].map(isoAt),
    );
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
