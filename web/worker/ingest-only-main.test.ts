import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  EMPTY_INGEST_SUMMARY,
  createFixtureConnector,
  createMemoryQuotaStore,
  loadFixtureManifest,
  type IngestionRepo,
  type LatestRunWindow,
  type StartRunInput,
} from "@/server/ingestion";
import { startAnalysisRuntime } from "@/worker/analysis-runtime";
import {
  defaultIngestOnlyDeps,
  ingestOnlyRegistrations,
  onceG2bJobData,
  runIngestOnly,
  type IngestOnlyDeps,
} from "@/worker/ingest-only-main";
import { processIngestJob, type IngestJobDeps } from "@/worker/ingest-queue";
import { createRegisteredWorker, type IngestOnceResult, type WorkerDeps } from "@/worker/main";

// BullMQ Worker·Queue, ioredis, Supabase createClient 를 가짜로 바꾼다. 실제 Redis·Supabase·외부 API 는 부르지 않는다.
// schedulers 는 Redis 의 Job Scheduler 를 흉내 낸다(큐 인스턴스 사이에 공유, 같은 id 는 덮어쓴다).
// fsReads 는 node:fs/promises readFile 이 받은 경로다(live 가 fixture 를 읽지 않는지 본다).
type FakeQueue = {
  name: string;
  upsertJobScheduler: Mock<(...args: unknown[]) => Promise<void>>;
  removeJobScheduler: Mock<(...args: unknown[]) => Promise<boolean>>;
  close: Mock<() => Promise<undefined>>;
};
const fake = vi.hoisted(() => ({
  workers: [] as string[],
  queues: [] as FakeQueue[],
  redis: [] as { disconnect: Mock<() => void> }[],
  schedulers: new Map<string, { every: number; next: number }>(),
  schedulerNext: Date.parse("2026-10-25T08:00:00.000Z"),
  fsReads: [] as string[],
}));

vi.mock("bullmq", async (importOriginal) => {
  class Worker {
    readonly on = vi.fn();
    readonly close = vi.fn(async () => undefined);
    constructor(name: string) {
      fake.workers.push(name);
    }
  }
  class Queue {
    readonly on = vi.fn();
    readonly add = vi.fn(async () => undefined);
    readonly getJobState = vi.fn(async () => "unknown");
    readonly close = vi.fn(async () => undefined);
    readonly upsertJobScheduler = vi.fn<(...args: unknown[]) => Promise<void>>(async (...args) => {
      const [id, repeat] = args;
      if (typeof id !== "string" || typeof repeat !== "object" || repeat === null) return;
      const every = "every" in repeat ? repeat.every : null;
      if (typeof every === "number") fake.schedulers.set(id, { every, next: fake.schedulerNext });
    });
    readonly removeJobScheduler = vi.fn<(...args: unknown[]) => Promise<boolean>>(
      async (...args) => typeof args[0] === "string" && fake.schedulers.delete(args[0]),
    );
    constructor(readonly name: string) {
      fake.queues.push(this);
    }
  }
  return { ...(await importOriginal<typeof import("bullmq")>()), Worker, Queue };
});

vi.mock("ioredis", async (importOriginal) => {
  // --status·기동 로그가 쓰는 읽기 명령만 둔다. 쓰기 명령은 없어서 부르면 TypeError 로 드러난다.
  class Redis {
    readonly on = vi.fn();
    readonly disconnect = vi.fn(() => undefined);
    readonly duplicate = vi.fn(() => ({ on: vi.fn(), disconnect: vi.fn() }));
    readonly llen = vi.fn(async () => 0);
    readonly zcard = vi.fn(async () => 0);
    readonly zrange = vi.fn(async () =>
      [...fake.schedulers].flatMap(([id, { next }]) => [id, String(next)]),
    );
    readonly hmget = vi.fn(async (key: string) => {
      const scheduler = fake.schedulers.get(key.split(":").at(-1) ?? "");
      return [scheduler === undefined ? null : String(scheduler.every), null];
    });
    constructor() {
      fake.redis.push(this);
    }
  }
  return { ...(await importOriginal<typeof import("ioredis")>()), default: Redis, Redis };
});

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      fake.fsReads.push(String(args[0]));
      return actual.readFile(...args);
    },
  };
});

const NOW = new Date("2026-10-25T07:30:15.000Z");
const SERVICE_ROLE_KEY = "sk-test-SECRET-123";
const G2B_KEY = "FAKEKEY%2Btest%3D%3D";
const REGISTRY_FILE = fileURLToPath(new URL("../../infra/sources/registry.yaml", import.meta.url));
// live 는 fixture 를 읽지 않는다. 읽으면 ENOENT 로 드러나게 없는 경로를 준다.
const MISSING_FIXTURES_DIR = "/nonexistent-sol-radar-fixtures";
const liveEnv = {
  REDIS_URL: "redis://example-host/0",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  G2B_BID_NOTICE_SERVICE_KEY: G2B_KEY,
  SOL_RUN_MODE: "live",
  G2B_INGEST_INTERVAL_MINUTES: "60",
  FIXTURES_DIR: MISSING_FIXTURES_DIR,
  SOURCES_REGISTRY_FILE: REGISTRY_FILE,
};

const noRunOnce = vi.fn<IngestOnlyDeps["runOnce"]>(async () => {
  throw new Error("runOnce 는 부르지 않는다");
});

// 준비 확인(Redis·Supabase ping)과 heartbeat 파일만 가짜로 두고, Worker 생성은 ingest 전용 등록을 그대로 쓴다.
const testDeps = (
  overrides: { workerDeps?: Partial<WorkerDeps>; runOnce?: IngestOnlyDeps["runOnce"] } = {},
) => {
  const signals = new EventEmitter();
  const log = vi.fn<(line: string) => void>();
  const onSignal: IngestOnlyDeps["onSignal"] = (signal, listener) => {
    signals.once(signal, listener);
  };
  const deps = {
    workerDeps: {
      ...defaultIngestOnlyDeps.workerDeps,
      createWorker: createRegisteredWorker(ingestOnlyRegistrations(log)),
      checkReadiness: vi.fn(async () => undefined),
      startHeartbeat: () => ({ stop: () => undefined }),
      ...overrides.workerDeps,
    },
    runOnce: overrides.runOnce ?? noRunOnce,
    onSignal,
    exit: vi.fn(),
    log,
    logError: vi.fn<(line: string) => void>(),
    now: () => NOW,
  } satisfies IngestOnlyDeps;
  return { deps, signals };
};
const outputOf = (deps: ReturnType<typeof testDeps>["deps"]) =>
  [...deps.log.mock.calls, ...deps.logError.mock.calls].flat().join("\n");
const fixtureReads = () => fake.fsReads.filter((file) => file.startsWith(MISSING_FIXTURES_DIR));

// 기동했다가 SIGTERM 으로 닫는다. times 번 되풀이한다(재기동).
const startAndStop = async (times: number) => {
  const runs = [];
  for (let round = 1; round <= times; round += 1) {
    const { deps, signals } = testDeps();
    await runIngestOnly([], liveEnv, deps);
    expect(deps.exit, `${round}회차 기동`).not.toHaveBeenCalled();
    signals.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(deps.exit, `${round}회차 종료`).toHaveBeenCalledWith(0);
    });
    runs.push(deps);
  }
  return runs;
};

beforeEach(() => {
  fake.workers = [];
  fake.queues = [];
  fake.redis = [];
  fake.schedulers.clear();
  fake.fsReads = [];
  noRunOnce.mockClear();
  // getSupabaseAdmin 은 process.env 를 읽는다(createClient 는 위에서 가짜다).
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", liveEnv.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ingest 전용 worker 기동", () => {
  // 의존성 보고(scope 에 runMode)가 live 로 올라가면 회사 redis-api readiness 가 503 이 된다.
  it("등록은 ingest 하나이고 BullMQ Worker 는 ingest 큐 하나만 만든다", async () => {
    expect(ingestOnlyRegistrations(vi.fn())).toHaveLength(1);
    await startAndStop(1);
    expect(fake.workers).toEqual(["ingest"]);
  });

  it("live·60분이면 g2b-scheduled 하나를 1시간 간격으로 두고, 재기동해도 같은 id 하나로 유지하며 목록을 로그로 남긴다", async () => {
    const runs = await startAndStop(2);
    expect([...fake.schedulers]).toEqual([
      ["g2b-scheduled", { every: 3_600_000, next: fake.schedulerNext }],
    ]);
    const g2bRemovals = fake.queues.flatMap((queue) =>
      queue.removeJobScheduler.mock.calls.filter(([id]) => id === "g2b-scheduled"),
    );
    expect(g2bRemovals).toEqual([]);
    for (const deps of runs) {
      expect(deps.log).toHaveBeenCalledWith("ingest 큐 Job Scheduler 1개");
      expect(deps.log).toHaveBeenCalledWith(
        "  id=g2b-scheduled every=3600000 next=2026-10-25T08:00:00.000Z",
      );
    }
  });

  it("documents 큐를 만들지 않고, 없는 FIXTURES_DIR 로도 기동하며 fixture 파일을 읽지 않는다", async () => {
    await startAndStop(1);
    expect(fake.queues.map((queue) => queue.name)).toEqual(["ingest"]);
    expect(fake.fsReads).toContain(REGISTRY_FILE);
    expect(fixtureReads()).toEqual([]);
  });

  // mock·fixture 로 뜨면 ingest 등록이 g2b-scheduled 일정을 지운다.
  it.each([["mock"], ["fixture"], [""], ["LIVE"]])(
    "SOL_RUN_MODE=%j 이면 Redis 에 연결하지 않고 exit 1, 로그에 키 값이 없다",
    async (mode) => {
      const { deps } = testDeps();
      await runIngestOnly([], { ...liveEnv, SOL_RUN_MODE: mode }, deps);
      expect(deps.exit).toHaveBeenCalledWith(1);
      expect(deps.workerDeps.checkReadiness).not.toHaveBeenCalled();
      expect(fake.redis).toEqual([]);
      const output = outputOf(deps);
      expect(output).toContain("SOL_RUN_MODE");
      expect(output).not.toContain(SERVICE_ROLE_KEY);
      expect(output).not.toContain(G2B_KEY);
    },
  );

  it("SIGTERM 에 close 를 한 번만 부르고 exit 0 (뒤이은 SIGINT 는 무시)", async () => {
    const close = vi.fn(async () => undefined);
    const { deps, signals } = testDeps({ workerDeps: { createWorker: () => ({ close }) } });
    await runIngestOnly([], liveEnv, deps);
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });
});

describe("ingest 전용 worker 1회 명령", () => {
  it("--check 는 Redis 없이 registry 의 목록·보조 3종을 해석하고 fixture 를 읽지 않는다", async () => {
    const { deps } = testDeps();
    await runIngestOnly(["--check"], liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(0);
    const output = outputOf(deps);
    expect(output).toContain(REGISTRY_FILE);
    expect(output).toContain(
      "g2b-bid-notice, g2b-bid-license-limit, g2b-bid-region, g2b-bid-eorder-attach",
    );
    expect(fake.redis).toEqual([]);
    expect(fixtureReads()).toEqual([]);
  });

  it("--check 는 registry 파일이 없으면 경로만 출력하고 exit 1", async () => {
    const { deps } = testDeps();
    await runIngestOnly(
      ["--check"],
      { ...liveEnv, SOURCES_REGISTRY_FILE: "/nonexistent-sol-radar/registry.yaml" },
      deps,
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.logError.mock.calls).toEqual([
      ["수집 소스 registry 를 읽을 수 없다: /nonexistent-sol-radar/registry.yaml (ENOENT)"],
    ]);
  });

  it("--status 는 Queue 를 만들지 않고(쓰기 없음) job 수와 Job Scheduler 목록만 출력한다", async () => {
    fake.schedulers.set("g2b-scheduled", { every: 3_600_000, next: fake.schedulerNext });
    const { deps } = testDeps();
    await runIngestOnly(["--status"], liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.log.mock.calls.flat()).toEqual([
      "ingest 큐 job 수: waiting=0 active=0 delayed=0 failed=0 completed=0 paused=0 prioritized=0",
      "ingest 큐 Job Scheduler 1개",
      "  id=g2b-scheduled every=3600000 next=2026-10-25T08:00:00.000Z",
    ]);
    expect(fake.queues).toEqual([]);
    expect(fake.workers).toEqual([]);
    expect(fake.redis.map((redis) => redis.disconnect.mock.calls.length)).toEqual([1]);
  });

  it("--unschedule 은 ingest 큐의 removeJobScheduler('g2b-scheduled') 만 부르고 연결을 닫는다", async () => {
    const { deps } = testDeps();
    await runIngestOnly(["--unschedule"], liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(
      fake.queues.map((queue) => ({
        name: queue.name,
        removed: queue.removeJobScheduler.mock.calls,
        upserts: queue.upsertJobScheduler.mock.calls.length,
        closes: queue.close.mock.calls.length,
      })),
    ).toEqual([{ name: "ingest", removed: [["g2b-scheduled"]], upserts: 0, closes: 1 }]);
    expect(fake.workers).toEqual([]);
    expect(deps.workerDeps.checkReadiness).not.toHaveBeenCalled();
    expect(fake.redis.map((redis) => redis.disconnect.mock.calls.length)).toEqual([1]);
  });

  it.each([
    [["--once"]],
    [["--once", "--window-minutes", "0"]],
    [["--once", "--window-minutes", "1441"]],
    [["--once", "--window-minutes", "1.5"]],
    [["--window-minutes", "60"]],
    [["--once", "--check", "--window-minutes", "60"]],
  ])("%j 는 수집하지 않고 exit 1", async (argv) => {
    const { deps } = testDeps();
    await runIngestOnly(argv, liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(noRunOnce).not.toHaveBeenCalled();
    expect(fake.redis).toEqual([]);
  });

  it("--once --window-minutes 60 은 일정 없이 창 60분 수집을 1회 돌리고 요약만 출력한다", async () => {
    const result: IngestOnceResult = {
      runId: "run-once",
      status: "SUCCEEDED",
      summary: { ...EMPTY_INGEST_SUMMARY, created: 1, changed: 2, skippedDuplicate: 3 },
      saved: [],
      quarantined: [],
      resumedFromCursor: null,
      alreadyFinished: false,
      quotaUsed: 7,
    };
    const runOnce = vi.fn<IngestOnlyDeps["runOnce"]>(async () => result);
    const { deps } = testDeps({ runOnce });
    await runIngestOnly(["--once", "--window-minutes", "60"], liveEnv, deps);
    expect(runOnce.mock.calls).toEqual([[liveEnv, onceG2bJobData(NOW, 60)]]);
    expect(onceG2bJobData(NOW, 60)).toEqual({
      source: "g2b",
      trigger: "SCHEDULED",
      jobKey: "g2b:ONCE:2026-10-25T06:30:00.000Z:2026-10-25T07:30:00.000Z",
      window: { from: "2026-10-25T06:30:00.000Z", to: "2026-10-25T07:30:00.000Z" },
    });
    expect(deps.log.mock.calls.flat().join("\n")).toContain(
      "status=SUCCEEDED created=1 changed=2 skippedDuplicate=3 quarantined=0 quotaUsed=7",
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(fake.schedulers.size).toBe(0);
    expect(fake.workers).toEqual([]);
  });

  it("--once 가 Redis 오류로 실패하면 오류 이름·코드만 남기고 접속 주소는 찍지 않는다", async () => {
    const runOnce = vi.fn<IngestOnlyDeps["runOnce"]>(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.9.8.7:6379"), {
        code: "ECONNREFUSED",
      });
    });
    const { deps } = testDeps({ runOnce });
    await runIngestOnly(["--once", "--window-minutes", "60"], liveEnv, deps);
    const output = outputOf(deps);
    expect(output).toContain("ECONNREFUSED");
    expect(output).not.toContain("10.9.8.7");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});

// processIngestJob 을 가짜 저장소로 돌려 run 에 넘긴 값(jobKey·창·params)을 본다.
const repoWith = (latest: { end: Date | null; last: LatestRunWindow | null }) => {
  const starts: StartRunInput[] = [];
  const errors: string[] = [];
  const repo: IngestionRepo = {
    startRun: async (input) => {
      starts.push(input);
      return {
        runId: "run-1",
        status: "RUNNING",
        cursor: null,
        summary: { ...EMPTY_INGEST_SUMMARY },
        params: input.params,
      };
    },
    findLatestRevision: async () => null,
    findLatestSeedAnchor: async () => null,
    findLatestRunWindow: async () => latest.last,
    findLatestRunWindowEnd: async () => latest.end,
    saveRevision: async () => {
      throw new Error("저장할 공고가 없다");
    },
    recordError: async (_runId, error) => {
      errors.push(error.errorCode);
    },
    saveCheckpoint: async () => undefined,
    finishRun: async () => undefined,
  };
  return { repo, starts, errors };
};
const jobDeps = (repo: IngestionRepo, overrides: Partial<IngestJobDeps> = {}): IngestJobDeps => ({
  repo,
  runMode: "live",
  quota: {
    store: createMemoryQuotaStore({ dailyLimit: 1000 }),
    serviceId: "15129394",
    dailyLimit: 1000,
  },
  createFixtureConnector: async () => {
    throw new Error("fixture connector 를 만들지 않는다");
  },
  createG2bConnector: async () => ({
    source: "g2b",
    fetchPage: async () => ({
      ok: true,
      page: { records: [], nextCursor: null, rateLimitInfo: null },
    }),
  }),
  enqueueDocuments: async () => undefined,
  recordManualAudit: async () => undefined,
  now: () => NOW,
  retry: { sleep: async () => undefined, random: () => 0 },
  secrets: [],
  ...overrides,
});
const SCHEDULED_JOB = { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" };

describe("ingest job 처리", () => {
  it("--once job 은 자기 jobKey·창을 그대로 쓴다(일정 회차 jobKey 와 겹치지 않음)", async () => {
    const { repo, starts } = repoWith({ end: null, last: null });
    const data = onceG2bJobData(NOW, 1440);
    await processIngestJob(data, jobDeps(repo));
    expect(starts.map(({ jobKey, trigger, params }) => ({ jobKey, trigger, params }))).toEqual([
      {
        jobKey: "g2b:ONCE:2026-10-24T07:30:00.000Z:2026-10-25T07:30:00.000Z",
        trigger: "SCHEDULED",
        params: { window: data.window, stages: ["NOTICE"] },
      },
    ]);
  });

  const CAP = { maxMs: 2 * 3_600_000 };
  const FLOOR = "2026-10-25T05:30:00.000Z";
  it.each([
    {
      name: "상한 + 이전 성공 없음 → 최근 2시간만",
      cap: true,
      latest: { end: null, last: null },
      from: FLOOR,
      windowCap: { maxMinutes: 120, previousSuccessEnd: null },
    },
    {
      name: "상한 + 오래된 성공 끝·오래된 실패 창 → 최근 2시간으로 자름",
      cap: true,
      latest: {
        end: new Date("2026-10-25T02:00:00.000Z"),
        last: {
          status: "FAILED" as const,
          window: { from: "2026-10-24T02:00:00.000Z", to: "2026-10-25T02:00:00.000Z" },
        },
      },
      from: FLOOR,
      windowCap: { maxMinutes: 120, previousSuccessEnd: "2026-10-25T02:00:00.000Z" },
    },
    {
      name: "상한 + 최근 성공 끝 → 그 끝부터",
      cap: true,
      latest: { end: new Date("2026-10-25T07:00:00.000Z"), last: null },
      from: "2026-10-25T07:00:00.000Z",
      windowCap: undefined,
    },
    {
      name: "상한 없음(전체 worker) + 이전 성공 없음 → 24시간 그대로",
      cap: false,
      latest: { end: null, last: null },
      from: "2026-10-24T07:30:00.000Z",
      windowCap: undefined,
    },
  ])("정기 창: $name", async ({ cap, latest, from, windowCap }) => {
    const { repo, starts } = repoWith(latest);
    const log = vi.fn<(line: string) => void>();
    await processIngestJob(
      SCHEDULED_JOB,
      jobDeps(repo, cap ? { scheduledWindowCap: { ...CAP, log } } : {}),
    );
    const to = "2026-10-25T07:30:00.000Z";
    expect(starts.map(({ jobKey, params }) => ({ jobKey, params }))).toEqual([
      {
        jobKey: `g2b:SCHEDULED:${to}`,
        params: {
          window: { from, to },
          stages: ["NOTICE"],
          ...(windowCap === undefined ? {} : { windowCap }),
        },
      },
    ]);
    expect(log.mock.calls.length).toBe(windowCap === undefined ? 0 : 1);
  });

  it("live 는 fixture job 을 fixture 파일을 읽기 전에 거절하고 g2b job 도 fixture 를 읽지 않는다", async () => {
    // 전체 worker 와 같은 조립(manifest 를 읽고 connector 를 만든다). 불리면 없는 경로라 ENOENT 다.
    const fixtureConnector = vi.fn<IngestJobDeps["createFixtureConnector"]>(async (batch) =>
      createFixtureConnector({
        fixturesDir: MISSING_FIXTURES_DIR,
        batch,
        manifest: await loadFixtureManifest(MISSING_FIXTURES_DIR),
      }),
    );
    const { repo, errors } = repoWith({ end: null, last: null });
    const deps = jobDeps(repo, { createFixtureConnector: fixtureConnector });
    const rejected = await processIngestJob(
      { source: "fixture", batch: "SEED", trigger: "DEMO", jobKey: "fixture:SEED" },
      deps,
    );
    const collected = await processIngestJob(SCHEDULED_JOB, deps);
    expect([rejected.status, collected.status]).toEqual(["FAILED", "SUCCEEDED"]);
    expect(errors).toEqual(["RUN_MODE_MISMATCH"]);
    expect(fixtureConnector).not.toHaveBeenCalled();
    expect(fixtureReads()).toEqual([]);
  });
});

describe("큐 소비자", () => {
  it("analysis runtime 은 analysis 큐 Worker 하나만 만든다", async () => {
    const runtime = startAnalysisRuntime({ REDIS_URL: liveEnv.REDIS_URL });
    await runtime.close();
    expect(fake.workers).toEqual(["analysis"]);
  });
});
