import { createClient } from "@supabase/supabase-js";
import IORedis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { createAnalysisWorker, type AnalysisJobDeps } from "@/worker/analysis-job";
import { startReconciler, type ReconcileDeps } from "@/worker/analysis-reconcile";
import { startAnalysisRuntime, type AnalysisRuntimeFactories } from "@/worker/analysis-runtime";

// analysis 런타임 조립(C5-B): Worker + 멈춘 run 복구. main.ts 의 기본 deps 가 부른다.
// connection·supabase·queue 는 가짜 factory 다. connection 은 lazyConnect 인 진짜 IORedis 라 명령을 보내지 않으면 붙지 않는다
// (connect 를 막아 두고 한 번도 불리지 않았는지 본다). supabase 는 가짜 fetch 를 넣은 진짜 supabase-js 클라이언트다.
// BullMQ Worker(createAnalysisWorker)와 주기 복구(startReconciler)는 Redis·타이머를 쓰므로 모듈 mock 으로 바꿔
// 받은 인자와 닫는 순서만 본다. 같은 모듈의 나머지(createAnalysisJobDeps·readReconcileSettings)는 진짜를 쓴다.

vi.mock(import("@/worker/analysis-job"), async (importOriginal) => ({
  ...(await importOriginal()),
  createAnalysisWorker: vi.fn(),
}));

vi.mock(import("@/worker/analysis-reconcile"), async (importOriginal) => ({
  ...(await importOriginal()),
  startReconciler: vi.fn(),
}));

// 기본 queue factory 의 오류 로그를 보려고 bullmq 의 Queue 만 가짜(EventEmitter)로 바꾼다. Redis 에 붙지 않는다.
// 다른 시험은 모두 factory 의 queue 를 넘기므로 이 가짜를 만나지 않는다. Worker·UnrecoverableError 는 진짜 그대로다.
const fakeBullQueues = vi.hoisted(
  () => [] as { name: string; emit(event: string, value: unknown): boolean }[],
);

// 가짜 Queue 는 bullmq 의 Queue 타입과 모양이 달라 import() 형식(모듈 타입 검사)이 아니라 경로 문자열로 바꾼다.
vi.mock("bullmq", async (importOriginal) => {
  const { EventEmitter } = await import("node:events");
  class FakeBullQueue extends EventEmitter {
    readonly name: string;
    constructor(name: string) {
      super();
      this.name = name;
      fakeBullQueues.push(this);
    }
    async close(): Promise<void> {}
    async getJobState(): Promise<string> {
      return "unknown";
    }
    async add(): Promise<undefined> {
      return undefined;
    }
  }
  return { ...(await importOriginal<Record<string, unknown>>()), Queue: FakeBullQueue };
});

const workerMock = vi.mocked(createAnalysisWorker);
const reconcilerMock = vi.mocked(startReconciler);

const ENV = {
  SOL_RUN_MODE: "fixture",
  ANALYSIS_STALE_QUEUED_MS: "120000",
  ANALYSIS_STALE_RUNNING_MS: "240000",
  ANALYSIS_RECONCILE_INTERVAL_MS: "30000",
};

/** message 에 값을 담은 오류. */
function stageError(name: string): Error {
  const error = new Error(`LEAK-redis://:pw-secret@10.0.0.5 ${name}`);
  error.name = name;
  return error;
}

type Stage = "reconciler.stop" | "worker.close" | "queue.close" | "disconnect#1" | "disconnect#2";

/** 기동 중에 만드는 것. 이 단계가 던지면 기동이 멈춘다(보안 후속 (f)). */
type StartStep = "connection#1" | "worker" | "connection#2" | "queue" | "reconciler";

type SetupOptions = {
  /** 닫는 단계가 던질 오류. */
  failing?: Partial<Record<Stage, Error>>;
  /** 만드는 단계가 던질 오류(만들기 전에 던진다). */
  throwing?: Partial<Record<StartStep, Error>>;
};

/** 가짜 factory 셋과 mock 두 개. 부른 순서를 events 에 남긴다. */
function setup(options: SetupOptions = {}) {
  const failing = options.failing ?? {};
  const throwing = options.throwing ?? {};
  const events: string[] = [];
  const connections: IORedis[] = [];
  const connectAttempts: number[] = [];
  const fetchCalls: { method: string; path: string }[] = [];

  const connection = () => {
    const index = connections.length + 1;
    const thrown = throwing[index === 1 ? "connection#1" : "connection#2"];
    if (thrown) throw thrown;
    const redis = new IORedis({ lazyConnect: true, maxRetriesPerRequest: null });
    // 시험은 Redis 에 붙지 않는다. 붙으려 하면 기록하고 실패시킨다.
    vi.spyOn(redis, "connect").mockImplementation(() => {
      connectAttempts.push(index);
      return Promise.reject(new Error("시험은 Redis 에 붙지 않는다"));
    });
    const disconnect = redis.disconnect.bind(redis);
    vi.spyOn(redis, "disconnect").mockImplementation((reconnect) => {
      events.push(`disconnect#${index}`);
      const error = failing[index === 1 ? "disconnect#1" : "disconnect#2"];
      if (error) throw error;
      disconnect(reconnect);
    });
    connections.push(redis);
    events.push(`connection#${index}`);
    return redis;
  };

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    fetchCalls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const supabase = () => {
    events.push("supabase");
    // 시험용 가짜 값. 실제 키 모양이 아니다.
    return createClient<Database>("http://supabase.test", "fake-service-role-key-for-tests", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    });
  };

  const queueArgs: IORedis[] = [];
  const fakeQueue = {
    getJobState: async () => "unknown",
    add: async () => undefined,
    close: async () => {
      events.push("queue.close");
      if (failing["queue.close"]) throw failing["queue.close"];
    },
  };
  const queue = (conn: IORedis) => {
    if (throwing.queue) throw throwing.queue;
    queueArgs.push(conn);
    events.push("queue");
    return fakeQueue;
  };

  const workerCalls: { connection: unknown; deps: AnalysisJobDeps }[] = [];
  workerMock.mockImplementation((conn, deps) => {
    if (throwing.worker) throw throwing.worker;
    workerCalls.push({ connection: conn, deps });
    events.push("worker");
    return {
      close: async () => {
        events.push("worker.close");
        if (failing["worker.close"]) throw failing["worker.close"];
      },
    };
  });

  const reconcilerCalls: ReconcileDeps[] = [];
  reconcilerMock.mockImplementation((deps) => {
    if (throwing.reconciler) throw throwing.reconciler;
    reconcilerCalls.push(deps);
    events.push("reconciler");
    return {
      stop: async () => {
        events.push("reconciler.stop");
        if (failing["reconciler.stop"]) throw failing["reconciler.stop"];
      },
    };
  });

  const factories: AnalysisRuntimeFactories = { connection, supabase, queue };
  return {
    factories,
    events,
    connections,
    connectAttempts,
    fetchCalls,
    queueArgs,
    fakeQueue,
    workerCalls,
    reconcilerCalls,
  };
}

/** 던진 오류. 던지지 않으면 시험을 실패시킨다. */
function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("reject 하지 않았다");
}

afterEach(() => {
  workerMock.mockReset();
  reconcilerMock.mockReset();
  vi.restoreAllMocks();
  fakeBullQueues.length = 0;
});

// ── 조립 ──

describe("startAnalysisRuntime · 조립", () => {
  it("supabase → 첫 연결 → worker → 둘째 연결 → queue → reconciler 순서로 만든다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.events).toEqual([
      "supabase",
      "connection#1",
      "worker",
      "connection#2",
      "queue",
      "reconciler",
    ]);
  });

  it("연결은 두 개만 만든다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.connections).toHaveLength(2);
  });

  it("worker 는 첫 연결을 받는다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.workerCalls[0]?.connection).toBe(s.connections[0]);
  });

  it("queue 는 worker 와 다른 둘째 연결을 받는다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.queueArgs).toEqual([s.connections[1]]);
    expect(s.queueArgs[0]).not.toBe(s.connections[0]);
  });

  it("조립하는 동안 Redis 에 붙지 않는다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.connectAttempts).toEqual([]);
  });

  it("worker deps 의 실행 모드는 env 의 SOL_RUN_MODE 다(createAnalysisJobDeps 가 env 를 받는다)", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.workerCalls[0]?.deps.env).toEqual({ runMode: "fixture", given: true });
  });

  it("reconciler 는 factory 의 queue 를 받는다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.reconcilerCalls[0]?.queue).toBe(s.fakeQueue);
  });

  it("reconciler 의 tracker 는 worker deps 의 tracker 와 같은 저장 port 다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.reconcilerCalls[0]?.tracker).toBe(s.workerCalls[0]?.deps.tracker);
  });

  it("reconciler 의 finder 는 supabase factory 의 클라이언트로 score_runs 를 읽는다", async () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    await s.reconcilerCalls[0]?.finder.findStaleRuns({
      queuedBefore: "2026-10-16T08:50:00.000Z",
      runningBefore: "2026-10-16T08:40:00.000Z",
      limit: 50,
      after: null,
    });
    expect(s.fetchCalls).toEqual([{ method: "GET", path: "/rest/v1/score_runs" }]);
  });

  it("reconciler 설정은 env 에서 읽는다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect(s.reconcilerCalls[0]?.settings).toEqual({
      staleQueuedMs: 120_000,
      staleRunningMs: 240_000,
      intervalMs: 30_000,
      batchLimit: 50,
    });
  });

  it("reconciler 의 now 는 현재 시각의 Date 를 돌려준다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    const before = Date.now();
    const at = s.reconcilerCalls[0]?.now();
    expect(at).toBeInstanceOf(Date);
    expect(at?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("worker 와 reconciler 를 한 번씩만 만든다", () => {
    const s = setup();
    startAnalysisRuntime(ENV, s.factories);
    expect([s.workerCalls.length, s.reconcilerCalls.length]).toEqual([1, 1]);
  });
});

// ── 설정 오류 ──

describe("startAnalysisRuntime · 설정 오류는 키 이름만 담아 던진다", () => {
  it.each([
    "ANALYSIS_STALE_QUEUED_MS",
    "ANALYSIS_STALE_RUNNING_MS",
    "ANALYSIS_RECONCILE_INTERVAL_MS",
  ])("%s 가 틀리면 'worker env 오류: <키 이름>' 을 던진다", (key) => {
    const s = setup();
    const error = thrownBy(() =>
      startAnalysisRuntime({ ...ENV, [key]: "SECRETVALUE-5150" }, s.factories),
    );
    expect(error.message).toBe(`worker env 오류: ${key}`);
  });

  it("SOL_RUN_MODE 가 틀리면 'worker env 오류: SOL_RUN_MODE' 를 던진다", () => {
    const s = setup();
    const error = thrownBy(() =>
      startAnalysisRuntime({ ...ENV, SOL_RUN_MODE: "SECRETVALUE-prod" }, s.factories),
    );
    expect(error.message).toBe("worker env 오류: SOL_RUN_MODE");
  });

  it("AI_GATEWAY_URL 이 틀리면 'AI gateway 설정 오류: AI_GATEWAY_URL' 을 던지고 값(계정 정보)은 싣지 않는다", () => {
    const s = setup();
    const error = thrownBy(() =>
      startAnalysisRuntime(
        { ...ENV, AI_GATEWAY_URL: "http://user:SECRETVALUE@gw.test:8000" },
        s.factories,
      ),
    );
    expect(error.message).toBe("AI gateway 설정 오류: AI_GATEWAY_URL");
  });

  it("gateway 설정 오류면 연결과 worker 를 만들지 않는다", () => {
    const s = setup();
    thrownBy(() => startAnalysisRuntime({ ...ENV, AI_GATEWAY_URL: "ftp://gw" }, s.factories));
    expect(s.events.filter((event) => event !== "supabase")).toEqual([]);
  });
});

// ── 닫기 ──

describe("startAnalysisRuntime · close", () => {
  it("reconciler.stop → worker.close → queue.close → 두 연결 disconnect 순서로 닫는다", async () => {
    const s = setup();
    const runtime = startAnalysisRuntime(ENV, s.factories);
    s.events.length = 0;
    await runtime.close();
    expect(s.events.slice(0, 3)).toEqual(["reconciler.stop", "worker.close", "queue.close"]);
    expect(s.events.slice(3).toSorted()).toEqual(["disconnect#1", "disconnect#2"]);
  });

  it("close 는 각 단계를 한 번씩만 부른다", async () => {
    const s = setup();
    const runtime = startAnalysisRuntime(ENV, s.factories);
    s.events.length = 0;
    await runtime.close();
    expect(s.events).toHaveLength(5);
  });

  it("다 닫히면 resolve 한다", async () => {
    const s = setup();
    const runtime = startAnalysisRuntime(ENV, s.factories);
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it("닫는 동안 Redis 에 붙지 않는다", async () => {
    const s = setup();
    const runtime = startAnalysisRuntime(ENV, s.factories);
    await runtime.close();
    expect(s.connectAttempts).toEqual([]);
  });

  const STAGES: Stage[] = [
    "reconciler.stop",
    "worker.close",
    "queue.close",
    "disconnect#1",
    "disconnect#2",
  ];

  it.each(STAGES)("%s 가 던져도 나머지 단계를 모두 부른다", async (stage) => {
    const s = setup({ failing: { [stage]: stageError("StageError") } });
    const runtime = startAnalysisRuntime(ENV, s.factories);
    s.events.length = 0;
    await rejectionOf(runtime.close());
    expect(s.events.toSorted()).toEqual(STAGES.toSorted());
  });

  it.each(STAGES)("%s 가 던지면 close 는 그 오류로 reject 한다", async (stage) => {
    const failing = stageError("StageError");
    const s = setup({ failing: { [stage]: failing } });
    const runtime = startAnalysisRuntime(ENV, s.factories);
    expect(await rejectionOf(runtime.close())).toBe(failing);
  });

  it("여러 단계가 던지면 첫 오류로 reject 한다", async () => {
    const first = stageError("FirstError");
    const s = setup({
      failing: { "reconciler.stop": first, "queue.close": stageError("SecondError") },
    });
    const runtime = startAnalysisRuntime(ENV, s.factories);
    expect(await rejectionOf(runtime.close())).toBe(first);
  });

  // 보안 후속 (e-runtime): 첫 실패에서 멈추지 않는다. 모든 단계를 시도하고 첫 오류를 마지막에 던진다.
  it("다섯 단계가 모두 던져도 다섯 단계를 한 번씩 모두 부른다", async () => {
    const s = setup({
      failing: Object.fromEntries(STAGES.map((stage) => [stage, stageError(`${stage}Error`)])),
    });
    const runtime = startAnalysisRuntime(ENV, s.factories);
    s.events.length = 0;
    await rejectionOf(runtime.close());
    expect(s.events.toSorted()).toEqual(STAGES.toSorted());
  });

  it("다섯 단계가 모두 던지면 첫 단계(reconciler.stop)의 오류로 reject 한다", async () => {
    const first = stageError("FirstError");
    const s = setup({
      failing: {
        "reconciler.stop": first,
        "worker.close": stageError("WorkerError"),
        "queue.close": stageError("QueueError"),
        "disconnect#1": stageError("Disconnect1Error"),
        "disconnect#2": stageError("Disconnect2Error"),
      },
    });
    const runtime = startAnalysisRuntime(ENV, s.factories);
    expect(await rejectionOf(runtime.close())).toBe(first);
  });
});

// ── 기동 중 실패(보안 후속 (f)) ──
// 만든 것을 순서대로 기록하고, 중간에 던지면 만든 것을 거꾸로 닫은 뒤(close·disconnect, 닫는 중 오류는 버린다) 원래 오류를 다시 던진다.
// 기동이 동기로 던지든 reject 하든 받는다(startFailureOf). 닫기가 비동기면 한 차례 기다린 뒤(settle) 본다.

/** 기동이 던진(또는 reject 한) 값. 던지지 않으면 시험을 실패시킨다. */
async function startFailureOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("기동이 던지지 않았다");
}

/** 대기 중인 비동기 닫기를 한 차례 흘려보낸다. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const CLOSE_EVENT = /^(reconciler\.stop|worker\.close|queue\.close|disconnect#\d)$/;

describe("startAnalysisRuntime · 기동 중 실패는 만든 것을 닫고 원래 오류를 던진다", () => {
  /** 던지는 단계와, 그 앞에서 만든 것을 거꾸로 닫는 순서. */
  const CASES: [StartStep, string[]][] = [
    ["connection#1", []],
    ["worker", ["disconnect#1"]],
    ["connection#2", ["worker.close", "disconnect#1"]],
    ["queue", ["disconnect#2", "worker.close", "disconnect#1"]],
    ["reconciler", ["queue.close", "disconnect#2", "worker.close", "disconnect#1"]],
  ];

  async function failAt(step: StartStep, failing: SetupOptions["failing"] = {}) {
    const original = stageError("StartError");
    const s = setup({ throwing: { [step]: original }, failing });
    const error = await startFailureOf(() => startAnalysisRuntime(ENV, s.factories));
    await settle();
    return { s, error, original };
  }

  const closeEvents = (s: ReturnType<typeof setup>) =>
    s.events.filter((event) => CLOSE_EVENT.test(event));

  it.each(CASES)("%s 가 던지면 그 오류를 그대로 다시 던진다", async (step) => {
    const { error, original } = await failAt(step);
    expect(error).toBe(original);
  });

  it.each(CASES)(
    "%s 가 던지면 앞서 만든 것만 만든 순서의 거꾸로 닫는다",
    async (step, expected) => {
      const { s } = await failAt(step);
      expect(closeEvents(s)).toEqual(expected);
    },
  );

  it("queue 생성이 던지면 worker 를 닫고 두 연결을 모두 끊는다", async () => {
    const { s } = await failAt("queue");
    expect(closeEvents(s).toSorted()).toEqual(["disconnect#1", "disconnect#2", "worker.close"]);
  });

  it("reconciler 시작이 던지면 queue·worker 를 닫고 두 연결을 모두 끊는다", async () => {
    const { s } = await failAt("reconciler");
    expect(closeEvents(s).toSorted()).toEqual(
      ["disconnect#1", "disconnect#2", "queue.close", "worker.close"].toSorted(),
    );
  });

  it("기동이 실패해 닫는 동안 Redis 에 붙지 않는다", async () => {
    const { s } = await failAt("reconciler");
    expect(s.connectAttempts).toEqual([]);
  });

  it("닫는 중 오류는 버리고 원래 오류를 다시 던진다", async () => {
    const { error, original } = await failAt("reconciler", {
      "queue.close": stageError("QueueCloseError"),
      "worker.close": stageError("WorkerCloseError"),
      "disconnect#2": stageError("DisconnectError"),
    });
    expect(error).toBe(original);
  });

  it("닫는 중 한 단계가 던져도 나머지를 모두 닫는다", async () => {
    const { s } = await failAt("reconciler", {
      "queue.close": stageError("QueueCloseError"),
      "disconnect#2": stageError("DisconnectError"),
    });
    expect(closeEvents(s)).toEqual(["queue.close", "disconnect#2", "worker.close", "disconnect#1"]);
  });

  it("닫는 중 reject 를 처리되지 않은 채 남기지 않는다", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      await failAt("reconciler", {
        "queue.close": stageError("QueueCloseError"),
        "worker.close": stageError("WorkerCloseError"),
      });
      await settle();
    } finally {
      process.off("unhandledRejection", record);
    }
    expect(unhandled).toEqual([]);
  });
});

// ── 기본 queue factory 의 오류 로그(오류 이름 공용화, 보안 후속 낮음 h 의 남은 곳) ──
// Queue 는 연결 오류를 'error' 로 내보낸다. 그 줄에는 공용 errorNameOf 로 거른 이름만 싣는다(message 는 접속 문자열을 담을 수 있다).
// 이름에 개행·긴 값·접속 문자열이 들어와도 로그 줄을 깨거나 값을 싣지 않는다. 규칙 표는 error-name.test.ts 가 본다.

function namedError(name: string): Error {
  const error = new Error("LEAK-redis://:pw-secret@10.0.0.5 queue");
  error.name = name;
  return error;
}

/** [설명, 줄에 실을 이름, 내보낸 값] */
const QUEUE_ERROR_CASES: [string, string, unknown][] = [
  ["평범한 이름", "ReplyError", namedError("ReplyError")],
  ["61자 이름", "Error", namedError("A".repeat(61))],
  ["개행이 든 이름", "Error", namedError('Reply\n{"event":"forged"}')],
  ["값(접속 문자열)이 든 이름", "Error", namedError("redis://:pw-secret@10.0.0.5")],
  ["Error 가 아닌 값", "NonError", "LEAK thrown string"],
];

describe("startAnalysisRuntime · 기본 queue factory 의 오류 로그", () => {
  /** factory 의 queue 를 넘기지 않아 기본 factory(new Queue)가 가짜 bullmq Queue 를 만든다. */
  function startWithDefaultQueue() {
    const s = setup();
    const { connection, supabase } = s.factories;
    const runtime = startAnalysisRuntime(ENV, { connection, supabase });
    const queue = fakeBullQueues[0];
    if (!queue) throw new Error("기본 queue factory 가 Queue 를 만들지 않았다");
    return { s, runtime, queue };
  }

  it("기본 factory 는 analysis 큐 하나를 만들고 Redis 에 붙지 않는다", async () => {
    const { s, runtime } = startWithDefaultQueue();
    expect(fakeBullQueues.map((queue) => queue.name)).toEqual(["analysis"]);
    await runtime.close();
    expect(s.connectAttempts).toEqual([]);
  });

  it.each(QUEUE_ERROR_CASES)(
    "%s 이면 줄은 'analysis queue 오류: %s' 다",
    async (_label, expected, emitted) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const { runtime, queue } = startWithDefaultQueue();
      queue.emit("error", emitted);
      await runtime.close();
      expect(errorLog.mock.calls).toEqual([[`analysis queue 오류: ${expected}`]]);
    },
  );

  it.each(QUEUE_ERROR_CASES)(
    "%s 일 때 줄에 개행·값을 싣지 않는다",
    async (_label, _expected, emitted) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const { runtime, queue } = startWithDefaultQueue();
      queue.emit("error", emitted);
      await runtime.close();
      const text = errorLog.mock.calls.flat().map(String).join("|");
      expect(text).not.toContain("\n");
      expect(text).not.toContain("LEAK");
      expect(text).not.toContain("pw-secret");
      expect(text).not.toContain("forged");
    },
  );
});
