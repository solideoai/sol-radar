import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  type AnalysisJobData,
  type AnalysisRunTracker,
  type StaleRun,
  type StaleRunFinder,
} from "@/server/analysis";
import {
  readReconcileSettings,
  reconcileOnce,
  startReconciler,
  type ReconcileDeps,
  type ReconcileQueue,
  type ReconcileSettings,
  type ReconcileSummary,
} from "@/worker/analysis-reconcile";

// 멈춘 run 복구(C5-B). worker 가 죽었거나 enqueue 가 빠져 QUEUED·RUNNING 으로 남은 score_runs 를 찾아
// job 이 Redis 에 없으면 다시 넣고, 시도를 다 썼거나 끝난 job 이면 FAILED(STALE_RUN)로 닫는다(docs/02 "job 유실 없음").
// finder·tracker·queue·시계·로그는 가짜다. Redis·네트워크·Supabase 는 쓰지 않는다.

const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_ORG_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const RUN_A = "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
const RUN_B = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const RUN_C = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const RUN_D = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RUN_E = "1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f";

const NOW_ISO = "2026-10-16T09:00:00.000Z";
const NOW = new Date(NOW_ISO);

const SETTINGS: ReconcileSettings = {
  staleQueuedMs: 600_000,
  staleRunningMs: 1_200_000,
  intervalMs: 60_000,
  batchLimit: 7,
};

/** idempotencyKey(= `${orgId}:${requestId}`). requestId 는 로그에 새면 안 되는 값으로 본다. */
const requestIdFor = (scoreRunId: string) => `req-SECRETVALUE-${scoreRunId.slice(0, 8)}`;
const keyFor = (orgId: string, scoreRunId: string) => `${orgId}:${requestIdFor(scoreRunId)}`;
const jobIdFor = (orgId: string, scoreRunId: string) => `analysis_${orgId}_${scoreRunId}`;

function staleRun(scoreRunId: string, overrides: Partial<StaleRun> = {}): StaleRun {
  const orgId = overrides.orgId ?? ORG_ID;
  return {
    orgId,
    scoreRunId,
    idempotencyKey: keyFor(orgId, scoreRunId),
    status: "QUEUED",
    ...overrides,
  };
}

/** message 에 접속 문자열·값을 담은 오류. 로그로 새면 안 된다. */
const LEAK = "LEAK-redis://:pw-secret@10.0.0.5";
function leakyError(name: string): Error {
  const error = new Error(`${LEAK} ${name}`);
  error.name = name;
  return error;
}

// ── 가짜 ──

type FinderInput = Parameters<StaleRunFinder["findStaleRuns"]>[0];

/** 부를 때마다 next() 의 값을 돌려준다. */
function fakeFinder(next: (index: number) => Promise<StaleRun[]>) {
  const calls: FinderInput[] = [];
  const finder: StaleRunFinder = {
    findStaleRuns: (input) => {
      calls.push({ ...input });
      return next(calls.length - 1);
    },
  };
  return { finder, calls };
}

type MarkFailedInput = Parameters<AnalysisRunTracker["markFailed"]>[0];
type MarkRunningInput = Parameters<AnalysisRunTracker["markRunning"]>[0];

function fakeTracker(failFor: ReadonlyMap<string, Error> = new Map()) {
  const failed: MarkFailedInput[] = [];
  const running: MarkRunningInput[] = [];
  const tracker: AnalysisRunTracker = {
    markRunning: async (input) => {
      running.push(input);
    },
    markFailed: async (input) => {
      failed.push(input);
      const error = failFor.get(input.scoreRunId);
      if (error) throw error;
    },
  };
  return { tracker, failed, running };
}

type AddOptions = Parameters<ReconcileQueue["add"]>[2];
type AddCall = { name: string; data: AnalysisJobData; opts: AddOptions };

/** jobId 마다 정해 둔 상태를 돌려준다. 정하지 않은 jobId 는 "unknown"(Redis 에 없다)이다. */
function fakeQueue(
  options: {
    states?: Record<string, string>;
    stateErrors?: ReadonlyMap<string, Error>;
    addErrors?: ReadonlyMap<string, Error>;
  } = {},
) {
  const asked: string[] = [];
  const adds: AddCall[] = [];
  const queue: ReconcileQueue = {
    getJobState: async (jobId) => {
      asked.push(jobId);
      const error = options.stateErrors?.get(jobId);
      if (error) throw error;
      return options.states?.[jobId] ?? "unknown";
    },
    add: async (name, data, opts) => {
      adds.push({ name, data: { ...data }, opts: { ...opts } });
      const error = options.addErrors?.get(opts.jobId);
      if (error) throw error;
      return { id: opts.jobId };
    },
  };
  return { queue, asked, adds };
}

type Setup = {
  runs?: StaleRun[];
  finder?: (index: number) => Promise<StaleRun[]>;
  states?: Record<string, string>;
  stateErrors?: ReadonlyMap<string, Error>;
  addErrors?: ReadonlyMap<string, Error>;
  markFailedErrors?: ReadonlyMap<string, Error>;
  settings?: ReconcileSettings;
};

function setup(options: Setup = {}) {
  const runs = options.runs ?? [];
  const finder = fakeFinder(options.finder ?? (async () => runs.map((run) => ({ ...run }))));
  const tracker = fakeTracker(options.markFailedErrors);
  const queue = fakeQueue({
    states: options.states,
    stateErrors: options.stateErrors,
    addErrors: options.addErrors,
  });
  const lines: string[] = [];
  const deps: ReconcileDeps = {
    finder: finder.finder,
    tracker: tracker.tracker,
    queue: queue.queue,
    now: () => new Date(NOW.getTime()),
    settings: options.settings ?? SETTINGS,
    log: (line) => {
      lines.push(line);
    },
  };
  return { deps, finder, tracker, queue, lines };
}

/** 로그 줄을 JSON 으로 읽는다. JSON 이 아니면 시험이 여기서 실패한다. */
const records = (lines: string[]): unknown[] => lines.map((line): unknown => JSON.parse(line));

/** 로그 한 줄의 event. 객체가 아니거나 event 가 없으면 undefined. */
const eventOf = (record: unknown): unknown =>
  typeof record === "object" && record !== null && "event" in record ? record.event : undefined;

/** 판정 결과: 다시 넣은 job 과 FAILED 로 닫은 run. */
const decision = (s: ReturnType<typeof setup>) => ({
  adds: s.queue.adds,
  failed: s.tracker.failed,
});

const staleFailure = (orgId: string, scoreRunId: string): MarkFailedInput => ({
  orgId,
  scoreRunId,
  errorCode: "STALE_RUN",
  finishedAt: NOW_ISO,
});

// ── readReconcileSettings ──

const KEYS: [string, keyof ReconcileSettings][] = [
  ["ANALYSIS_STALE_QUEUED_MS", "staleQueuedMs"],
  ["ANALYSIS_STALE_RUNNING_MS", "staleRunningMs"],
  ["ANALYSIS_RECONCILE_INTERVAL_MS", "intervalMs"],
];

const DEFAULTS: ReconcileSettings = {
  staleQueuedMs: 600_000,
  staleRunningMs: 600_000,
  intervalMs: 60_000,
  batchLimit: 50,
};

/** 오류 message. 던지지 않으면 시험을 실패시킨다. */
function settingsErrorOf(env: Record<string, string | undefined>): string {
  try {
    readReconcileSettings(env);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

describe("readReconcileSettings · 기본값", () => {
  it("env 에 키가 없으면 600000·600000·60000 과 batchLimit 50 이다", () => {
    expect(readReconcileSettings({})).toEqual(DEFAULTS);
  });
});

describe("readReconcileSettings · 읽기", () => {
  it.each(KEYS)("%s 값은 %s 에만 쓴다", (key, field) => {
    expect(readReconcileSettings({ [key]: "120000" })).toEqual({ ...DEFAULTS, [field]: 120_000 });
  });

  it.each(KEYS)("%s 의 앞뒤 공백을 지운다", (key, field) => {
    expect(readReconcileSettings({ [key]: "  45000 \n" })[field]).toBe(45_000);
  });

  it.each(KEYS)("%s 의 하한 1 을 받는다", (key, field) => {
    expect(readReconcileSettings({ [key]: "1" })[field]).toBe(1);
  });

  it.each(KEYS)("%s 의 상한 3600000 을 받는다", (key, field) => {
    expect(readReconcileSettings({ [key]: "3600000" })[field]).toBe(3_600_000);
  });

  it("세 키를 함께 주면 각자의 설정에 쓴다", () => {
    expect(
      readReconcileSettings({
        ANALYSIS_STALE_QUEUED_MS: "1000",
        ANALYSIS_STALE_RUNNING_MS: "2000",
        ANALYSIS_RECONCILE_INTERVAL_MS: "3000",
      }),
    ).toEqual({ staleQueuedMs: 1000, staleRunningMs: 2000, intervalMs: 3000, batchLimit: 50 });
  });
});

describe("readReconcileSettings · 틀린 값", () => {
  const BAD_VALUES = ["0", "3600001", "-1", "1.5", "1e3", "0x10", "abc", "60s", "1_000"];
  const cases = KEYS.flatMap(([key]) => BAD_VALUES.map((value): [string, string] => [key, value]));

  it.each(cases)("%s=%s 이면 'worker env 오류: <키 이름>' 으로 던진다", (key, value) => {
    expect(settingsErrorOf({ [key]: value })).toBe(`worker env 오류: ${key}`);
  });

  it.each(KEYS)("%s 오류 message 에 값을 싣지 않는다", (key) => {
    expect(settingsErrorOf({ [key]: "SECRETVALUE-5150" })).not.toContain("SECRETVALUE");
  });

  it.each(KEYS)("%s 의 범위 밖 숫자도 message 에 싣지 않는다", (key) => {
    expect(settingsErrorOf({ [key]: "98765432" })).not.toContain("98765432");
  });

  it("여러 키가 틀려도 던지고 message 는 'worker env 오류: ' 뒤에 키 이름만 싣는다", () => {
    const message = settingsErrorOf({
      ANALYSIS_STALE_QUEUED_MS: "SECRETVALUE-1",
      ANALYSIS_RECONCILE_INTERVAL_MS: "98765432",
    });
    expect(message).toMatch(/^worker env 오류: ANALYSIS_[A-Z_]+(, ANALYSIS_[A-Z_]+)*$/);
  });
});

// ── reconcileOnce · 찾기 ──

describe("reconcileOnce · 멈춘 run 찾기", () => {
  it("queuedBefore 는 now − staleQueuedMs 의 ISO 값이다", async () => {
    const s = setup();
    await reconcileOnce(s.deps);
    expect(s.finder.calls[0]?.queuedBefore).toBe("2026-10-16T08:50:00.000Z");
  });

  it("runningBefore 는 now − staleRunningMs 의 ISO 값이다", async () => {
    const s = setup();
    await reconcileOnce(s.deps);
    expect(s.finder.calls[0]?.runningBefore).toBe("2026-10-16T08:40:00.000Z");
  });

  it("기준 시각은 Date.toISOString 모양(밀리초·Z)이다", async () => {
    const s = setup({ settings: { ...SETTINGS, staleQueuedMs: 1, staleRunningMs: 3_600_000 } });
    await reconcileOnce(s.deps);
    expect(s.finder.calls[0]).toMatchObject({
      queuedBefore: "2026-10-16T08:59:59.999Z",
      runningBefore: "2026-10-16T08:00:00.000Z",
    });
  });

  it("limit 은 settings.batchLimit 이다", async () => {
    const s = setup();
    await reconcileOnce(s.deps);
    expect(s.finder.calls[0]?.limit).toBe(7);
  });

  it("한 번에 finder 를 한 번 부른다", async () => {
    const s = setup({ runs: [staleRun(RUN_A), staleRun(RUN_B)] });
    await reconcileOnce(s.deps);
    expect(s.finder.calls).toHaveLength(1);
  });
});

describe("reconcileOnce · jobId", () => {
  it("getJobState 를 analysis_<orgId>_<scoreRunId> 로 묻는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { orgId: OTHER_ORG_ID })] });
    await reconcileOnce(s.deps);
    expect(s.queue.asked).toEqual([jobIdFor(OTHER_ORG_ID, RUN_A)]);
  });
});

// ── reconcileOnce · 상태별 판정 ──

describe("reconcileOnce · job 이 Redis 에 없으면(unknown) 다시 넣는다", () => {
  async function requeued() {
    const s = setup({ runs: [staleRun(RUN_A)] });
    await reconcileOnce(s.deps);
    expect(s.queue.adds).toHaveLength(1);
    return s.queue.adds[0];
  }

  it("job 이름은 ANALYSIS_JOB 이다", async () => {
    expect((await requeued()).name).toBe(ANALYSIS_JOB);
  });

  it("job 데이터는 { orgId, scoreRunId, idempotencyKey } 뿐이다", async () => {
    expect((await requeued()).data).toEqual({
      orgId: ORG_ID,
      scoreRunId: RUN_A,
      idempotencyKey: keyFor(ORG_ID, RUN_A),
    });
  });

  it("옵션은 ANALYSIS_JOB_OPTIONS 에 jobId 를 더한 것이다", async () => {
    expect((await requeued()).opts).toEqual({
      ...ANALYSIS_JOB_OPTIONS,
      jobId: jobIdFor(ORG_ID, RUN_A),
    });
  });

  it("FAILED 로 닫지 않는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A)] });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed).toEqual([]);
  });

  it("RUNNING 으로 멈춘 run 도 job 이 없으면 다시 넣는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "RUNNING" })] });
    await reconcileOnce(s.deps);
    expect(s.queue.adds.map((add) => add.opts.jobId)).toEqual([jobIdFor(ORG_ID, RUN_A)]);
  });

  it("조직이 다른 run 은 각 행의 orgId 로 넣는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A), staleRun(RUN_B, { orgId: OTHER_ORG_ID })] });
    await reconcileOnce(s.deps);
    expect(s.queue.adds.map((add) => [add.data.orgId, add.opts.jobId])).toEqual([
      [ORG_ID, jobIdFor(ORG_ID, RUN_A)],
      [OTHER_ORG_ID, jobIdFor(OTHER_ORG_ID, RUN_B)],
    ]);
  });
});

describe("reconcileOnce · 시도를 다 썼거나(failed) 처리가 끝난(completed) job", () => {
  it.each(["failed", "completed"])(
    "%s 이면 다시 넣지 않고 FAILED(STALE_RUN, finishedAt=now)로 닫는다",
    async (state) => {
      const s = setup({
        runs: [staleRun(RUN_A, { status: "RUNNING" })],
        states: { [jobIdFor(ORG_ID, RUN_A)]: state },
      });
      await reconcileOnce(s.deps);
      expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, RUN_A)] });
    },
  );

  it("다른 조직의 run 은 그 행의 orgId 로 닫는다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A, { orgId: OTHER_ORG_ID })],
      states: { [jobIdFor(OTHER_ORG_ID, RUN_A)]: "failed" },
    });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed).toEqual([staleFailure(OTHER_ORG_ID, RUN_A)]);
  });
});

describe("reconcileOnce · 진행 중인 job 은 그대로 둔다", () => {
  it.each(["waiting", "active", "delayed", "prioritized", "waiting-children"])(
    "%s 이면 다시 넣지도 닫지도 않는다",
    async (state) => {
      const s = setup({
        runs: [staleRun(RUN_A)],
        states: { [jobIdFor(ORG_ID, RUN_A)]: state },
      });
      await reconcileOnce(s.deps);
      expect(decision(s)).toEqual({ adds: [], failed: [] });
    },
  );

  it("모르는 상태 이름이면 다시 넣지도 닫지도 않는다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A)],
      states: { [jobIdFor(ORG_ID, RUN_A)]: "paused" },
    });
    await reconcileOnce(s.deps);
    expect(decision(s)).toEqual({ adds: [], failed: [] });
  });
});

describe("reconcileOnce · 다시 넣을 job 데이터를 만들 수 없는 run", () => {
  it("idempotencyKey 가 null 이면 다시 넣지 않고 FAILED(STALE_RUN)로 닫는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { idempotencyKey: null })] });
    await reconcileOnce(s.deps);
    expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, RUN_A)] });
  });

  it.each<[string, Partial<StaleRun>]>([
    ["idempotencyKey 가 다른 조직 접두어", { idempotencyKey: `${OTHER_ORG_ID}:req-1` }],
    ["idempotencyKey 의 requestId 가 빈 값", { idempotencyKey: `${ORG_ID}:` }],
    ["idempotencyKey 에 조직 접두어가 없다", { idempotencyKey: "req-1" }],
    ["idempotencyKey 가 300자를 넘는다", { idempotencyKey: `${ORG_ID}:${"r".repeat(300)}` }],
  ])(
    "%s 이면 job 데이터 검증에 실패해 다시 넣지 않고 FAILED(STALE_RUN)로 닫는다",
    async (_label, overrides) => {
      const s = setup({ runs: [staleRun(RUN_A, overrides)] });
      await reconcileOnce(s.deps);
      expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, RUN_A)] });
    },
  );

  it("scoreRunId 가 uuid 가 아니면 job 데이터 검증에 실패해 FAILED(STALE_RUN)로 닫는다", async () => {
    const s = setup({ runs: [staleRun("run-not-uuid")] });
    await reconcileOnce(s.deps);
    expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, "run-not-uuid")] });
  });
});

describe("reconcileOnce · 요약", () => {
  const MIXED = () =>
    setup({
      runs: [
        staleRun(RUN_A),
        staleRun(RUN_B, { status: "RUNNING" }),
        staleRun(RUN_C),
        staleRun(RUN_D, { idempotencyKey: null }),
        staleRun(RUN_E, { status: "RUNNING" }),
      ],
      states: {
        [jobIdFor(ORG_ID, RUN_B)]: "failed",
        [jobIdFor(ORG_ID, RUN_C)]: "active",
        [jobIdFor(ORG_ID, RUN_E)]: "paused",
      },
    });

  it("섞인 묶음이면 checked·requeued·failed·inFlight 를 센다", async () => {
    const summary: ReconcileSummary = await reconcileOnce(MIXED().deps);
    expect(summary).toEqual({ checked: 5, requeued: 1, failed: 2, inFlight: 2 });
  });

  it("멈춘 run 이 없으면 모두 0 이다", async () => {
    expect(await reconcileOnce(setup().deps)).toEqual({
      checked: 0,
      requeued: 0,
      failed: 0,
      inFlight: 0,
    });
  });

  it("markRunning 은 부르지 않는다", async () => {
    const s = MIXED();
    await reconcileOnce(s.deps);
    expect(s.tracker.running).toEqual([]);
  });
});

// ── reconcileOnce · 실패 ──

describe("reconcileOnce · run 하나의 실패는 다른 run 을 막지 않는다", () => {
  const failing = leakyError("ReplyError");

  /** RUN_A 는 그 단계에서 던지고, RUN_B 는 job 이 없어 다시 넣어야 한다. */
  const failAt: Record<string, () => ReturnType<typeof setup>> = {
    getJobState: () =>
      setup({
        runs: [staleRun(RUN_A), staleRun(RUN_B)],
        stateErrors: new Map([[jobIdFor(ORG_ID, RUN_A), failing]]),
      }),
    add: () =>
      setup({
        runs: [staleRun(RUN_A), staleRun(RUN_B)],
        addErrors: new Map([[jobIdFor(ORG_ID, RUN_A), failing]]),
      }),
    markFailed: () =>
      setup({
        runs: [staleRun(RUN_A, { status: "RUNNING" }), staleRun(RUN_B)],
        states: { [jobIdFor(ORG_ID, RUN_A)]: "failed" },
        markFailedErrors: new Map([[RUN_A, failing]]),
      }),
  };
  const stages = Object.keys(failAt);

  it.each(stages)("%s 가 던져도 다음 run 을 다시 넣는다", async (stage) => {
    const s = failAt[stage]();
    await reconcileOnce(s.deps).catch(() => undefined);
    expect(s.queue.adds.filter((add) => add.data.scoreRunId === RUN_B)).toHaveLength(1);
  });

  it.each(stages)("%s 가 던져도 reconcileOnce 는 resolve 한다", async (stage) => {
    await expect(reconcileOnce(failAt[stage]().deps)).resolves.toBeDefined();
  });

  it.each(stages)("%s 가 던진 run 은 errorName 을 담은 로그 줄을 남긴다", async (stage) => {
    const s = failAt[stage]();
    await reconcileOnce(s.deps).catch(() => undefined);
    expect(records(s.lines)).toContainEqual(
      expect.objectContaining({ scoreRunId: RUN_A, errorName: "ReplyError" }),
    );
  });

  it.each(stages)("%s 오류의 message 는 로그에 싣지 않는다", async (stage) => {
    const s = failAt[stage]();
    await reconcileOnce(s.deps).catch(() => undefined);
    expect(s.lines.join("\n")).not.toContain("LEAK");
  });

  it("add 가 던진 run 은 requeued 로 세지 않는다", async () => {
    const summary = await reconcileOnce(failAt.add().deps);
    expect(summary.requeued).toBe(1);
  });

  it("markFailed 가 던진 run 은 failed 로 세지 않는다", async () => {
    const summary = await reconcileOnce(failAt.markFailed().deps);
    expect(summary.failed).toBe(0);
  });
});

describe("reconcileOnce · finder 실패", () => {
  const failing = leakyError("PostgrestError");

  it("finder 가 던지면 reconcileOnce 도 던진다", async () => {
    const s = setup({ finder: async () => Promise.reject(failing) });
    await expect(reconcileOnce(s.deps)).rejects.toThrow();
  });

  it("finder 가 던지면 queue·tracker 를 부르지 않는다", async () => {
    const s = setup({ finder: async () => Promise.reject(failing) });
    await reconcileOnce(s.deps).catch(() => undefined);
    expect({ asked: s.queue.asked, adds: s.queue.adds, failed: s.tracker.failed }).toEqual({
      asked: [],
      adds: [],
      failed: [],
    });
  });
});

// ── reconcileOnce · 로그 ──

describe("reconcileOnce · 로그", () => {
  it.each([
    ["unknown", "REQUEUE"],
    ["failed", "FAIL"],
    ["completed", "FAIL"],
    ["active", "KEEP"],
    ["waiting", "KEEP"],
    ["paused", "KEEP"],
  ])("job 상태 %s 인 run 은 action %s 한 줄을 남긴다", async (state, action) => {
    const s = setup({
      runs: [staleRun(RUN_A, { orgId: OTHER_ORG_ID })],
      states: { [jobIdFor(OTHER_ORG_ID, RUN_A)]: state },
    });
    await reconcileOnce(s.deps);
    expect(records(s.lines)).toContainEqual({
      event: "analysis.reconcile",
      orgId: OTHER_ORG_ID,
      scoreRunId: RUN_A,
      jobState: state,
      action,
    });
  });

  it("run 마다 analysis.reconcile 한 줄을 남긴다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A), staleRun(RUN_B)],
      states: { [jobIdFor(ORG_ID, RUN_B)]: "active" },
    });
    await reconcileOnce(s.deps);
    expect(records(s.lines).filter((line) => eventOf(line) === "analysis.reconcile")).toHaveLength(
      2,
    );
  });

  it("마지막 줄은 analysis.reconcile.summary 와 네 숫자다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A), staleRun(RUN_B)],
      states: { [jobIdFor(ORG_ID, RUN_B)]: "completed" },
    });
    await reconcileOnce(s.deps);
    expect(records(s.lines).at(-1)).toEqual({
      event: "analysis.reconcile.summary",
      checked: 2,
      requeued: 1,
      failed: 1,
      inFlight: 0,
    });
  });

  it("멈춘 run 이 없어도 요약 한 줄을 남긴다", async () => {
    const s = setup();
    await reconcileOnce(s.deps);
    expect(records(s.lines)).toEqual([
      { event: "analysis.reconcile.summary", checked: 0, requeued: 0, failed: 0, inFlight: 0 },
    ]);
  });

  it("모든 줄은 줄바꿈 없는 JSON 한 줄이다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A), staleRun(RUN_B, { idempotencyKey: null })],
      addErrors: new Map([[jobIdFor(ORG_ID, RUN_A), leakyError("ReplyError")]]),
    });
    await reconcileOnce(s.deps);
    expect(s.lines.length).toBeGreaterThan(0);
    for (const line of s.lines) {
      expect(line).not.toContain("\n");
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("idempotencyKey(requestId) 값을 싣지 않는다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A), staleRun(RUN_B)],
      states: { [jobIdFor(ORG_ID, RUN_B)]: "failed" },
    });
    await reconcileOnce(s.deps);
    expect(s.lines.join("\n")).not.toContain("SECRETVALUE");
  });
});

// ── startReconciler ──

describe("startReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** setInterval·clearInterval 은 vi.useFakeTimers 가 바꾼 가짜다. */
  const fakeTimers = () => ({ setInterval, clearInterval });

  /** 끝나지 않는 회차를 만들 때 쓴다. */
  function pendingRounds() {
    const rounds: PromiseWithResolvers<StaleRun[]>[] = [];
    const next = () => {
      const round = Promise.withResolvers<StaleRun[]>();
      rounds.push(round);
      return round.promise;
    };
    return { rounds, next };
  }

  it("시작하자마자 한 번 돈다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finder.calls).toHaveLength(1);
    await handle.stop();
  });

  it("intervalMs 가 지나기 전에는 다시 돌지 않는다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs - 1);
    expect(s.finder.calls).toHaveLength(1);
    await handle.stop();
  });

  it("intervalMs 마다 한 번씩 돈다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 3);
    expect(s.finder.calls).toHaveLength(4);
    await handle.stop();
  });

  it("회차마다 멈춘 run 을 처리한다(job 이 없으면 다시 넣는다)", async () => {
    const s = setup({ runs: [staleRun(RUN_A)] });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.queue.adds.map((add) => add.opts.jobId)).toEqual([jobIdFor(ORG_ID, RUN_A)]);
    await handle.stop();
  });

  it("앞 회차가 진행 중이면 이번 회차는 건너뛴다", async () => {
    const pending = pendingRounds();
    const s = setup({ finder: pending.next });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 2);
    expect(s.finder.calls).toHaveLength(1);
    pending.rounds[0]?.resolve([]);
    await handle.stop();
  });

  it("건너뛴 회차를 끝난 뒤에 몰아 돌지 않고 다음 주기에 돈다", async () => {
    const pending = pendingRounds();
    const s = setup({ finder: pending.next });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    pending.rounds[0]?.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    const afterFinish = s.finder.calls.length;
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    expect([afterFinish, s.finder.calls.length]).toEqual([1, 2]);
    pending.rounds[1]?.resolve([]);
    await handle.stop();
  });

  it("stop 뒤에는 시간이 지나도 다시 돌지 않는다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await handle.stop();
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs * 5);
    expect(s.finder.calls).toHaveLength(1);
  });

  it("stop 은 주기 타이머를 지운다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await handle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop 은 진행 중인 회차가 끝날 때까지 resolve 하지 않는다", async () => {
    const pending = pendingRounds();
    const s = setup({ finder: pending.next });
    const handle = startReconciler(s.deps, fakeTimers());
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

  it("stop 이 resolve 할 때는 진행 중이던 회차가 요약까지 마쳤다", async () => {
    const pending = pendingRounds();
    const s = setup({ finder: pending.next });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    pending.rounds[0]?.resolve([staleRun(RUN_A)]);
    await stopping;
    expect(records(s.lines)).toContainEqual({
      event: "analysis.reconcile.summary",
      checked: 1,
      requeued: 1,
      failed: 0,
      inFlight: 0,
    });
  });

  it("진행 중인 회차가 실패해도 stop 은 resolve 한다", async () => {
    const pending = pendingRounds();
    const s = setup({ finder: pending.next });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    const stopping = handle.stop();
    pending.rounds[0]?.reject(leakyError("PostgrestError"));
    await expect(stopping).resolves.toBeUndefined();
  });

  it("진행 중인 회차가 없으면 stop 은 바로 resolve 한다", async () => {
    const s = setup();
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it("회차 오류(finder 실패)는 삼키고 analysis.reconcile.failed 와 errorName 한 줄을 남긴다", async () => {
    const s = setup({ finder: async () => Promise.reject(leakyError("PostgrestError")) });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(records(s.lines)).toContainEqual({
      event: "analysis.reconcile.failed",
      errorName: "PostgrestError",
    });
    await handle.stop();
  });

  it("회차 오류의 message 는 로그에 싣지 않는다", async () => {
    const s = setup({ finder: async () => Promise.reject(leakyError("PostgrestError")) });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.lines.join("\n")).not.toContain("LEAK");
    await handle.stop();
  });

  it("회차가 실패해도 다음 주기에 다시 돈다", async () => {
    const s = setup({
      finder: async (index) => (index === 0 ? Promise.reject(leakyError("PostgrestError")) : []),
    });
    const handle = startReconciler(s.deps, fakeTimers());
    await vi.advanceTimersByTimeAsync(SETTINGS.intervalMs);
    expect(s.finder.calls).toHaveLength(2);
    await handle.stop();
  });
});
