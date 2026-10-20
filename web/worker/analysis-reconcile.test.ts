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

/**
 * StaleRun 은 markFailed 의 쓰기 조건으로 started_at 원문(startedAt)을 갖는다. RUNNING run 의 기본값이다(QUEUED 는 null).
 * 예전에는 keyset 커서에 쓰는 queuedAt(ISO)을 가졌다. 커서가 id 하나로 바뀌어 없어졌다.
 */
const RUNNING_STARTED_AT_RAW = "2026-10-16T08:10:00.123456+00:00";

/**
 * 기본은 RUNNING 이다. C5-B 보안 후속 1: job 이 Redis 에 없을 때(unknown) 다시 넣는 것은 RUNNING run 뿐이고(RUNNING 은 worker 만 쓴다),
 * QUEUED run 은 닫는다. 예전 기본값(QUEUED)으로는 "다시 넣는다"를 보던 시험들이 이 결정으로 뜻을 잃어 기본값을 RUNNING 으로 바꿨다.
 * QUEUED 판정은 아래 "QUEUED run 의 job 이 Redis 에 없으면" 묶음이 status 를 밝혀 본다.
 */
function staleRun(scoreRunId: string, overrides: Partial<StaleRun> = {}): StaleRun {
  const orgId = overrides.orgId ?? ORG_ID;
  const status = overrides.status ?? "RUNNING";
  return {
    orgId,
    scoreRunId,
    idempotencyKey: keyFor(orgId, scoreRunId),
    status,
    startedAt: status === "RUNNING" ? RUNNING_STARTED_AT_RAW : null,
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

/** 부를 때마다 next() 의 값을 돌려준다. next 는 몇 번째 부름인지와 받은 입력을 받는다. */
function fakeFinder(next: (index: number, input: FinderInput) => Promise<StaleRun[]>) {
  const calls: FinderInput[] = [];
  const finder: StaleRunFinder = {
    findStaleRuns: (input) => {
      calls.push({ ...input });
      return next(calls.length - 1, input);
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
      return true;
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
    /** 던질 값. Error 가 아닌 값도 던질 수 있다(errorName 규칙을 본다). */
    stateErrors?: ReadonlyMap<string, unknown>;
    addErrors?: ReadonlyMap<string, Error>;
  } = {},
) {
  const asked: string[] = [];
  const adds: AddCall[] = [];
  const queue: ReconcileQueue = {
    getJobState: async (jobId) => {
      asked.push(jobId);
      if (options.stateErrors?.has(jobId)) throw options.stateErrors.get(jobId);
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
  finder?: (index: number, input: FinderInput) => Promise<StaleRun[]>;
  states?: Record<string, string>;
  stateErrors?: ReadonlyMap<string, unknown>;
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

/**
 * 복구가 닫을 때의 markFailed 입력. 찾은 run 의 상태(status·startedAt)를 쓰기 조건(expected)으로 건다 — 찾은 뒤 worker 가
 * 잡은 run 을 닫지 않는다. status 는 staleRun 의 기본값(RUNNING·RUNNING_STARTED_AT_RAW, QUEUED 면 started_at null)을 따른다.
 * 예전 기대(조건 없이 QUEUED·RUNNING 닫기)는 run 닫기의 compare-and-set 으로 바뀌었다.
 */
const staleFailure = (
  orgId: string,
  scoreRunId: string,
  status: StaleRun["status"] = "RUNNING",
): MarkFailedInput => ({
  orgId,
  scoreRunId,
  errorCode: "STALE_RUN",
  finishedAt: NOW_ISO,
  expected: { status, startedAt: status === "RUNNING" ? RUNNING_STARTED_AT_RAW : null },
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

  // 보안 후속 (g): 한 회차는 페이지를 이어 읽는다. 첫 페이지가 limit 보다 적으면 다음 페이지가 없으므로 한 번만 읽는다.
  it("멈춘 run 이 limit 보다 적으면 한 회차에 finder 를 한 번 부른다", async () => {
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

describe("reconcileOnce · RUNNING run 의 job 이 Redis 에 없으면(unknown) 다시 넣는다", () => {
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

// C5-B 보안 후속 1: 복구가 속도 제한을 우회하는 길을 막는다. 화면 역할은 PostgREST 로 score_runs 에 QUEUED 행을 직접 넣을 수 있다
// (열 단위 권한·"분석 요청" 정책). 그 행은 Route Handler 의 속도 제한을 거치지 않았으므로 복구가 큐에 넣으면 안 된다.
// 정상 경로의 enqueue 실패는 C6 가 ENQUEUE_FAILED 로 닫는다. 그래서 QUEUED + job 없음은 FAILED(STALE_RUN)로 닫는다.
describe("reconcileOnce · QUEUED run 의 job 이 Redis 에 없으면(unknown) 다시 넣지 않고 닫는다", () => {
  it("다시 넣지 않고 FAILED(STALE_RUN, finishedAt=now)로 닫는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "QUEUED" })] });
    await reconcileOnce(s.deps);
    expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, RUN_A, "QUEUED")] });
  });

  it("화면 역할이 직접 넣은 QUEUED run 은 idempotencyKey 가 C6 형식(`<orgId>:<uuid>`)이어도 다시 넣지 않는다", async () => {
    const direct = staleRun(RUN_A, {
      status: "QUEUED",
      idempotencyKey: `${ORG_ID}:7d9f5c2e-4b1a-4e8f-9c3d-2a6b8e0f1c4d`,
    });
    const s = setup({ runs: [direct] });
    await reconcileOnce(s.deps);
    expect(s.queue.adds).toEqual([]);
    expect(s.tracker.failed).toEqual([staleFailure(ORG_ID, RUN_A, "QUEUED")]);
  });

  it("job 상태는 물어본다(진행 중이면 그대로 두려고)", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "QUEUED" })] });
    await reconcileOnce(s.deps);
    expect(s.queue.asked).toEqual([jobIdFor(ORG_ID, RUN_A)]);
  });

  // 예전 기대(attemptStartedAt 없이 QUEUED·RUNNING 조건으로 닫기)는 찾은 상태를 쓰기 조건으로 거는 것으로 바뀌었다.
  it("markFailed 의 expected 는 찾은 run 의 상태(QUEUED·started_at null)다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "QUEUED" })] });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed.map((input) => input.expected)).toEqual([
      { status: "QUEUED", startedAt: null },
    ]);
  });

  it("다른 조직의 QUEUED run 은 그 행의 orgId 로 닫는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { orgId: OTHER_ORG_ID, status: "QUEUED" })] });
    await reconcileOnce(s.deps);
    expect(decision(s)).toEqual({
      adds: [],
      failed: [staleFailure(OTHER_ORG_ID, RUN_A, "QUEUED")],
    });
  });

  it("로그 줄은 jobState unknown·action FAIL 이다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "QUEUED" })] });
    await reconcileOnce(s.deps);
    expect(records(s.lines)).toContainEqual({
      event: "analysis.reconcile",
      orgId: ORG_ID,
      scoreRunId: RUN_A,
      jobState: "unknown",
      action: "FAIL",
    });
  });

  it("요약은 failed 로 센다(requeued 가 아니다)", async () => {
    const summary = await reconcileOnce(
      setup({ runs: [staleRun(RUN_A, { status: "QUEUED" }), staleRun(RUN_B)] }).deps,
    );
    expect(summary).toEqual({ checked: 2, requeued: 1, failed: 1, inFlight: 0 });
  });

  it("같은 회차의 RUNNING run(job 없음)은 그대로 다시 넣는다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { status: "QUEUED" }), staleRun(RUN_B)] });
    await reconcileOnce(s.deps);
    expect(s.queue.adds.map((add) => add.opts.jobId)).toEqual([jobIdFor(ORG_ID, RUN_B)]);
  });

  it.each(["waiting", "active", "delayed", "prioritized", "waiting-children"])(
    "QUEUED 라도 job 이 %s 이면 다시 넣지도 닫지도 않는다",
    async (state) => {
      const s = setup({
        runs: [staleRun(RUN_A, { status: "QUEUED" })],
        states: { [jobIdFor(ORG_ID, RUN_A)]: state },
      });
      await reconcileOnce(s.deps);
      expect(decision(s)).toEqual({ adds: [], failed: [] });
    },
  );

  it.each(["failed", "completed"])(
    "QUEUED 이고 job 이 %s 이면 FAILED(STALE_RUN)로 닫는다",
    async (state) => {
      const s = setup({
        runs: [staleRun(RUN_A, { status: "QUEUED" })],
        states: { [jobIdFor(ORG_ID, RUN_A)]: state },
      });
      await reconcileOnce(s.deps);
      expect(decision(s)).toEqual({ adds: [], failed: [staleFailure(ORG_ID, RUN_A, "QUEUED")] });
    },
  );
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

// 복구가 run 을 찾은 뒤 닫기 전에 worker 가 그 run 을 다시 잡을 수 있다. 닫기는 찾은 상태(status·started_at 원문)가 그대로일 때만이다.
describe("reconcileOnce · 닫기의 쓰기 조건은 찾은 run 의 상태다", () => {
  const RAW_A = "2026-10-16T08:11:11.111111+00:00";
  const RAW_B = "2026-10-16T17:22:22.222222+09:00";

  it("끝난 job 의 RUNNING run 은 expected 가 RUNNING·그 run 의 started_at 원문이다", async () => {
    const s = setup({
      runs: [staleRun(RUN_A, { startedAt: RAW_A })],
      states: { [jobIdFor(ORG_ID, RUN_A)]: "completed" },
    });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed.map((input) => input.expected)).toEqual([
      { status: "RUNNING", startedAt: RAW_A },
    ]);
  });

  it("job 데이터를 만들 수 없는 RUNNING run 도 expected 가 그 run 의 status·started_at 원문이다", async () => {
    const s = setup({ runs: [staleRun(RUN_A, { idempotencyKey: null, startedAt: RAW_B })] });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed.map((input) => input.expected)).toEqual([
      { status: "RUNNING", startedAt: RAW_B },
    ]);
  });

  it("run 마다 자기 상태를 쓴다(앞 run 의 값을 이어 쓰지 않는다)", async () => {
    const s = setup({
      runs: [
        staleRun(RUN_A, { startedAt: RAW_A }),
        staleRun(RUN_B, { status: "QUEUED" }),
        staleRun(RUN_C, { startedAt: RAW_B }),
      ],
      states: {
        [jobIdFor(ORG_ID, RUN_A)]: "failed",
        [jobIdFor(ORG_ID, RUN_C)]: "failed",
      },
    });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed.map((input) => [input.scoreRunId, input.expected] as const)).toEqual([
      [RUN_A, { status: "RUNNING", startedAt: RAW_A }],
      [RUN_B, { status: "QUEUED", startedAt: null }],
      [RUN_C, { status: "RUNNING", startedAt: RAW_B }],
    ]);
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
    // 낮음 (b): requestId 는 `^[A-Za-z0-9_-]{1,128}$` 이다.
    ["requestId 가 129자", { idempotencyKey: `${ORG_ID}:${"r".repeat(129)}` }],
    ["requestId 에 공백이 있다", { idempotencyKey: `${ORG_ID}:req 1` }],
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

// ── reconcileOnce · keyset 페이지 ──
// 예전에는 회차마다 오래된 순 batchLimit 건만 봤다. 그 건이 모두 진행 중(KEEP)이면 그 뒤 run 은 영원히 보지 못했다.
// 그래서 한 회차에서 id 순 페이지를 이어 읽는다. 첫 페이지 after 는 null, 다음 페이지 after 는 앞 페이지 마지막 run 의 { id } 다.
// 한 회차는 최대 20 페이지(batchLimit 50 이면 1000건)까지 읽는다. 예전 기대((queuedAt, id) 커서와 같은 밀리초의 run 을 거르던
// seen 집합)는 id 커서로 바뀌었다. id 커서는 같은 run 을 다시 내지 않으므로 회차 안의 중복 거르기가 필요 없다.

const PAGE_LIMIT = 50;
const MAX_PAGES = 20;
const PAGED_SETTINGS: ReconcileSettings = { ...SETTINGS, batchLimit: PAGE_LIMIT };

/** n 번째 run 의 id(uuid). 순서가 id 글자 순서와 같다. */
const pagedRunId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function pagedRun(n: number, overrides: Partial<StaleRun> = {}): StaleRun {
  return staleRun(pagedRunId(n), overrides);
}

type Cursor = { id: string };

/** 가짜 finder 가 받은 커서가 port 계약({ id } 하나)인지. 다른 키가 섞이면 계약 위반이다. */
function assertIdCursor(after: unknown): asserts after is Cursor | null {
  if (after === null) return;
  const isIdOnly =
    typeof after === "object" &&
    Object.keys(after).join(",") === "id" &&
    typeof Reflect.get(after, "id") === "string";
  if (!isIdOnly) throw new Error("가짜 finder: after 는 { id } 하나여야 한다");
}

/**
 * keyset 페이지 finder 흉내. id 순으로 정렬해 after.id 다음부터 limit 건을 돌려준다.
 * 커서를 잘못 넘기면(앞 페이지 처음 run 등) 같은 run 을 다시 받거나 뒤 run 에 닿지 못한다.
 * strictCursor 면 커서가 port 계약({ id } 하나)이 아닐 때 던진다.
 */
function keysetFinder(all: StaleRun[], options: { strictCursor?: boolean } = {}) {
  const sorted = all.toSorted((a, b) => (a.scoreRunId < b.scoreRunId ? -1 : 1));
  return async (_index: number, input: FinderInput): Promise<StaleRun[]> => {
    const after = input.after;
    if (options.strictCursor) assertIdCursor(after);
    const rest = after === null ? sorted : sorted.filter((run) => run.scoreRunId > after.id);
    return rest.slice(0, input.limit).map((run) => ({ ...run }));
  };
}

/** 진행 중(active)인 job 상태. */
const activeStates = (runs: StaleRun[]): Record<string, string> =>
  Object.fromEntries(runs.map((run) => [jobIdFor(run.orgId, run.scoreRunId), "active"]));

describe("reconcileOnce · keyset 페이지", () => {
  // 첫 페이지 50건은 모두 진행 중이고, 51번째는 job 이 Redis 에 없는 RUNNING run 이다.
  const FIRST_PAGE = Array.from({ length: PAGE_LIMIT }, (_, n) => pagedRun(n));
  const RUN_51 = pagedRun(PAGE_LIMIT, { status: "RUNNING" });
  const ALL_51 = [...FIRST_PAGE, RUN_51];

  function setup51() {
    return setup({
      finder: keysetFinder(ALL_51),
      states: activeStates(FIRST_PAGE),
      settings: PAGED_SETTINGS,
    });
  }

  it("첫 페이지 50건이 모두 진행 중이어도 51번째 run(job 이 없는 RUNNING)을 다시 넣는다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    expect(s.queue.adds.map((add) => add.opts.jobId)).toEqual([
      jobIdFor(RUN_51.orgId, RUN_51.scoreRunId),
    ]);
  });

  it("첫 페이지 50건이 모두 진행 중이어도 51번째 run 의 job 상태를 묻는다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    expect(s.queue.asked).toHaveLength(51);
    expect(s.queue.asked.at(-1)).toBe(jobIdFor(RUN_51.orgId, RUN_51.scoreRunId));
  });

  it("51번째 run 이 끝난 job 이면 FAILED(STALE_RUN)로 닫는다", async () => {
    const s = setup({
      finder: keysetFinder(ALL_51),
      states: {
        ...activeStates(FIRST_PAGE),
        [jobIdFor(RUN_51.orgId, RUN_51.scoreRunId)]: "failed",
      },
      settings: PAGED_SETTINGS,
    });
    await reconcileOnce(s.deps);
    expect(s.tracker.failed).toEqual([staleFailure(RUN_51.orgId, RUN_51.scoreRunId)]);
  });

  it("첫 페이지는 after=null 로 읽는다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    expect(s.finder.calls[0]?.after).toBeNull();
  });

  it("다음 페이지의 after 는 앞 페이지 마지막 run 의 { id } 하나다", async () => {
    const s = setup({
      finder: async (index) => (index === 0 ? FIRST_PAGE : []),
      settings: PAGED_SETTINGS,
    });
    await reconcileOnce(s.deps);
    const last = FIRST_PAGE[FIRST_PAGE.length - 1];
    expect(s.finder.calls[1]?.after).toStrictEqual({ id: last.scoreRunId });
  });

  it("한 회차의 모든 페이지는 같은 queuedBefore·runningBefore·limit 으로 읽는다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    const windows = s.finder.calls.map(({ queuedBefore, runningBefore, limit }) => ({
      queuedBefore,
      runningBefore,
      limit,
    }));
    expect(windows).toEqual([
      {
        queuedBefore: "2026-10-16T08:50:00.000Z",
        runningBefore: "2026-10-16T08:40:00.000Z",
        limit: 50,
      },
      {
        queuedBefore: "2026-10-16T08:50:00.000Z",
        runningBefore: "2026-10-16T08:40:00.000Z",
        limit: 50,
      },
    ]);
  });

  it("페이지가 limit 보다 적으면 다음 페이지를 읽지 않는다(51건이면 두 번)", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    expect(s.finder.calls).toHaveLength(2);
  });

  it("같은 회차에서 run 하나를 두 번 처리하지 않는다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    expect(new Set(s.queue.asked).size).toBe(s.queue.asked.length);
  });

  // 예전에는 같은 밀리초의 run 이 다음 페이지에 다시 나와 seen 으로 걸렀다. id 커서면 다시 나오지 않는다.
  it("run 60건은 id 커서로 두 페이지(50·10)에 걸쳐 한 번씩 처리한다", async () => {
    const runs = Array.from({ length: 60 }, (_, n) => pagedRun(60 - n)); // id 역순으로 준다
    const s = setup({
      finder: keysetFinder(runs, { strictCursor: true }),
      states: activeStates(runs),
      settings: PAGED_SETTINGS,
    });
    const summary = await reconcileOnce(s.deps);
    expect(s.finder.calls).toHaveLength(2);
    expect(s.queue.asked).toEqual(
      Array.from({ length: 60 }, (_, n) => jobIdFor(ORG_ID, pagedRunId(n + 1))),
    );
    expect(summary).toEqual({ checked: 60, requeued: 0, failed: 0, inFlight: 60 });
  });

  it("요약은 모든 페이지의 run 을 센다(checked 51·inFlight 50·requeued 1)", async () => {
    const summary = await reconcileOnce(setup51().deps);
    expect(summary).toEqual({ checked: 51, requeued: 1, failed: 0, inFlight: 50 });
  });

  it("요약 줄은 모든 페이지를 처리한 뒤 마지막에 한 번만 남긴다", async () => {
    const s = setup51();
    await reconcileOnce(s.deps);
    const events = records(s.lines).map(eventOf);
    expect(events.filter((event) => event === "analysis.reconcile")).toHaveLength(51);
    expect(events.filter((event) => event === "analysis.reconcile.summary")).toHaveLength(1);
    expect(events.at(-1)).toBe("analysis.reconcile.summary");
  });

  it("셋째 페이지(101번째 이후)의 run 도 처리한다", async () => {
    const runs = Array.from({ length: 120 }, (_, n) => pagedRun(n));
    const target = runs[110];
    const s = setup({
      finder: keysetFinder(runs),
      states: activeStates(runs.filter((run) => run !== target)),
      settings: PAGED_SETTINGS,
    });
    await reconcileOnce(s.deps);
    expect(s.queue.adds.map((add) => add.data.scoreRunId)).toEqual([target.scoreRunId]);
  });
});

describe("reconcileOnce · 한 회차의 페이지 상한", () => {
  // 1100건이 모두 진행 중이다. 한 회차는 20 페이지(1000건)까지만 읽는다.
  const MANY = Array.from({ length: 1_100 }, (_, n) => pagedRun(n));

  function setupMany() {
    return setup({
      finder: keysetFinder(MANY),
      states: activeStates(MANY),
      settings: PAGED_SETTINGS,
    });
  }

  it("한 회차에 finder 를 최대 20번까지만 부른다", async () => {
    const s = setupMany();
    await reconcileOnce(s.deps);
    expect(s.finder.calls).toHaveLength(MAX_PAGES);
  });

  it("한 회차에 최대 1000건(20 페이지 × 50)까지만 처리한다", async () => {
    const summary = await reconcileOnce(setupMany().deps);
    expect(summary).toEqual({ checked: 1_000, requeued: 0, failed: 0, inFlight: 1_000 });
  });

  it("상한에 닿아도 던지지 않고 요약 한 줄로 끝난다", async () => {
    const s = setupMany();
    await expect(reconcileOnce(s.deps)).resolves.toBeDefined();
    expect(records(s.lines).at(-1)).toEqual({
      event: "analysis.reconcile.summary",
      checked: 1_000,
      requeued: 0,
      failed: 0,
      inFlight: 1_000,
    });
  });

  it("상한 안에서는 페이지를 이어 읽는다(1000건이 모두 다르다)", async () => {
    const s = setupMany();
    await reconcileOnce(s.deps);
    expect(new Set(s.queue.asked).size).toBe(1_000);
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

// ── 로그의 errorName(보안 후속 (h)) ──
// error.name 은 /^[A-Za-z0-9_]{1,60}$/ 에 맞을 때만 그대로 싣고, 아니면 "Error", Error 가 아닌 값이면 "NonError" 다
// (analysis-job 의 errorNameOf 와 같은 규칙). 이름에 개행·공백·긴 값이 들어와 로그 줄을 깨거나 값을 싣지 않게 한다.

function namedError(name: string): Error {
  const error = new Error(`${LEAK} named`);
  error.name = name;
  return error;
}

/** [설명, 로그에 실을 errorName, 던진 값] */
const NAME_CASES: [string, string, unknown][] = [
  ["평범한 이름", "ReplyError", namedError("ReplyError")],
  ["밑줄·숫자가 든 이름", "Redis_Error_42", namedError("Redis_Error_42")],
  ["60자 이름", "A".repeat(60), namedError("A".repeat(60))],
  ["61자 이름", "Error", namedError("A".repeat(61))],
  ["개행이 든 이름", "Error", namedError('Reply\n{"event":"forged"}')],
  ["공백이 든 이름", "Error", namedError("Reply Error")],
  ["빈 이름", "Error", namedError("")],
  ["값(접속 문자열)이 든 이름", "Error", namedError("redis://:pw-secret@10.0.0.5")],
  ["한글 이름", "Error", namedError("레디스오류")],
  ["Error 가 아닌 글자", "NonError", `${LEAK} thrown string`],
  ["Error 가 아닌 객체(name 이 있다)", "NonError", { name: "ReplyError", message: LEAK }],
];

describe("reconcileOnce · run 처리 실패 로그의 errorName", () => {
  async function errorLineFor(thrown: unknown) {
    const s = setup({
      runs: [staleRun(RUN_A)],
      stateErrors: new Map([[jobIdFor(ORG_ID, RUN_A), thrown]]),
    });
    await reconcileOnce(s.deps);
    return { line: records(s.lines).find((record) => eventOf(record) === "analysis.reconcile"), s };
  }

  it.each(NAME_CASES)("%s 이면 errorName 은 %s 다", async (_label, expected, thrown) => {
    const { line } = await errorLineFor(thrown);
    expect(line).toMatchObject({ scoreRunId: RUN_A, action: "ERROR", errorName: expected });
  });

  it.each(NAME_CASES)(
    "%s 일 때도 로그는 줄바꿈 없는 JSON 한 줄씩이고 값을 싣지 않는다",
    async (_label, _expected, thrown) => {
      const { s } = await errorLineFor(thrown);
      for (const line of s.lines) {
        expect(line).not.toContain("\n");
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(s.lines.join("\n")).not.toContain("LEAK");
      expect(s.lines.join("\n")).not.toContain("pw-secret");
      expect(s.lines.join("\n")).not.toContain("forged");
    },
  );
});

describe("startReconciler · 회차 실패 로그의 errorName", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function failedLineFor(thrown: unknown) {
    const s = setup({ finder: async () => Promise.reject(thrown) });
    const handle = startReconciler(s.deps, { setInterval, clearInterval });
    await vi.advanceTimersByTimeAsync(0);
    await handle.stop();
    return {
      line: records(s.lines).find((record) => eventOf(record) === "analysis.reconcile.failed"),
      s,
    };
  }

  it.each(NAME_CASES)(
    "%s 이면 analysis.reconcile.failed 의 errorName 은 %s 다",
    async (_label, expected, thrown) => {
      const { line } = await failedLineFor(thrown);
      expect(line).toEqual({ event: "analysis.reconcile.failed", errorName: expected });
    },
  );

  it.each(NAME_CASES)(
    "%s 일 때도 회차 실패 로그에 값을 싣지 않는다",
    async (_label, _expected, thrown) => {
      const { s } = await failedLineFor(thrown);
      expect(s.lines.join("\n")).not.toContain("LEAK");
      expect(s.lines.join("\n")).not.toContain("pw-secret");
      expect(s.lines.join("\n")).not.toContain("forged");
    },
  );
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
