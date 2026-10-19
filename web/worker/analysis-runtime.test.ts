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

type SetupOptions = { failing?: Partial<Record<Stage, Error>> };

/** 가짜 factory 셋과 mock 두 개. 부른 순서를 events 에 남긴다. */
function setup(options: SetupOptions = {}) {
  const failing = options.failing ?? {};
  const events: string[] = [];
  const connections: IORedis[] = [];
  const connectAttempts: number[] = [];
  const fetchCalls: { method: string; path: string }[] = [];

  const connection = () => {
    const index = connections.length + 1;
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
    queueArgs.push(conn);
    events.push("queue");
    return fakeQueue;
  };

  const workerCalls: { connection: unknown; deps: AnalysisJobDeps }[] = [];
  workerMock.mockImplementation((conn, deps) => {
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
});
