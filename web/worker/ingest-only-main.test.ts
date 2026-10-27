import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import IORedis from "ioredis";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  EMPTY_INGEST_SUMMARY,
  EXTERNAL_SOURCE_KEYS,
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
  SCHEDULED_WINDOW_CAP_MINUTES,
  onceG2bJobData,
  runIngestOnly,
  type IngestOnlyDeps,
} from "@/worker/ingest-only-main";
import { processIngestJob, type IngestJobDeps } from "@/worker/ingest-queue";
import {
  createExternalRuntime,
  createIngestWorker,
  createRegisteredWorker,
  readinessBlockOf,
  withAuthCircuit,
  type IngestOnceResult,
  type WorkerDeps,
} from "@/worker/main";

// BullMQ Worker·Queue, ioredis, Supabase createClient 를 가짜로 바꾼다. 실제 Redis·Supabase·외부 API 는 부르지 않는다.
// schedulers 는 Redis 의 Job Scheduler 를 흉내 낸다(큐 인스턴스 사이에 공유, 같은 id 는 덮어쓴다).
// fsReads 는 node:fs/promises readFile 이 받은 경로다(live 가 fixture 를 읽지 않는지 본다).
type FakeQueue = {
  name: string;
  upsertJobScheduler: Mock<(...args: unknown[]) => Promise<void>>;
  removeJobScheduler: Mock<(...args: unknown[]) => Promise<boolean>>;
  close: Mock<() => Promise<undefined>>;
};
// schedulers 는 Redis 의 repeat:<id> 해시(every·pattern·tz)와 다음 예정 시각을 흉내 낸다. upsert 는 해시를 통째로 바꾼다(BullMQ storeJobScheduler 의 DEL + HMSET).
type FakeScheduler = {
  every: number | null;
  pattern: string | null;
  tz: string | null;
  next: number;
};
const fake = vi.hoisted(() => ({
  workers: [] as string[],
  processors: [] as ((job: unknown) => Promise<unknown>)[],
  queues: [] as FakeQueue[],
  redis: [] as { disconnect: Mock<() => void> }[],
  schedulers: new Map<string, FakeScheduler>(),
  schedulerNext: Date.parse("2026-10-25T08:00:00.000Z"),
  fsReads: [] as string[],
  // 복제 연결(예산·상태 기록)의 SET. setFails 면 Redis 장애처럼 거절한다
  sets: [] as [string, string][],
  setFails: false,
}));

vi.mock("bullmq", async (importOriginal) => {
  class Worker {
    readonly on = vi.fn();
    readonly close = vi.fn(async () => undefined);
    constructor(name: string, processor: (job: unknown) => Promise<unknown>) {
      fake.workers.push(name);
      fake.processors.push(processor);
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
      const field = (key: string) => {
        const value: unknown = key in repeat ? (repeat as Record<string, unknown>)[key] : null;
        return value ?? null;
      };
      const [every, pattern, tz] = [field("every"), field("pattern"), field("tz")];
      fake.schedulers.set(id, {
        every: typeof every === "number" ? every : null,
        pattern: typeof pattern === "string" ? pattern : null,
        tz: typeof tz === "string" ? tz : null,
        next: fake.schedulerNext,
      });
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
    readonly duplicate = vi.fn(() => ({
      on: vi.fn(),
      disconnect: vi.fn(),
      set: vi.fn(async (key: string, value: string) => {
        if (fake.setFails)
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        fake.sets.push([key, value]);
        return "OK";
      }),
    }));
    readonly llen = vi.fn(async () => 0);
    readonly zcard = vi.fn(async () => 0);
    readonly zrange = vi.fn(async () =>
      [...fake.schedulers].flatMap(([id, { next }]) => [id, String(next)]),
    );
    readonly hmget = vi.fn(async (key: string) => {
      const scheduler = fake.schedulers.get(key.split(":").at(-1) ?? "");
      if (scheduler === undefined) return [null, null, null];
      return [
        scheduler.every === null ? null : String(scheduler.every),
        scheduler.pattern,
        scheduler.tz,
      ];
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
const startAndStop = async (times: number, env: Record<string, string> = liveEnv) => {
  const runs = [];
  for (let round = 1; round <= times; round += 1) {
    const { deps, signals } = testDeps();
    await runIngestOnly([], env, deps);
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
  fake.processors = [];
  fake.queues = [];
  fake.redis = [];
  fake.schedulers.clear();
  fake.fsReads = [];
  fake.sets = [];
  fake.setFails = false;
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

  it("옛 1시간 every 일정이 있어도 같은 id 로 KST 3시간 정각 cron 하나로 바꾸고, 재기동해도 하나이며 목록을 로그로 남긴다", async () => {
    fake.schedulers.set("g2b-scheduled", {
      every: 3_600_000,
      pattern: null,
      tz: null,
      next: fake.schedulerNext,
    });
    const runs = await startAndStop(2);
    expect([...fake.schedulers]).toEqual([
      [
        "g2b-scheduled",
        { every: null, pattern: "0 */3 * * *", tz: "Asia/Seoul", next: fake.schedulerNext },
      ],
    ]);
    // 기동마다 같은 id 로 한 번씩 upsert 한다. 반복 옵션은 pattern·tz 둘뿐이다(every·immediately 없음 = 즉시 회차 없음).
    const g2bUpserts = fake.queues.flatMap((queue) =>
      queue.upsertJobScheduler.mock.calls.filter(([id]) => id === "g2b-scheduled"),
    );
    expect(g2bUpserts).toHaveLength(2);
    for (const [, repeat] of g2bUpserts) {
      expect(repeat).toStrictEqual({ pattern: "0 */3 * * *", tz: "Asia/Seoul" });
    }
    const g2bRemovals = fake.queues.flatMap((queue) =>
      queue.removeJobScheduler.mock.calls.filter(([id]) => id === "g2b-scheduled"),
    );
    expect(g2bRemovals).toEqual([]);
    for (const deps of runs) {
      expect(deps.log).toHaveBeenCalledWith("ingest 큐 Job Scheduler 1개");
      expect(deps.log).toHaveBeenCalledWith(
        '  id=g2b-scheduled every=- pattern="0 */3 * * *" tz=Asia/Seoul next=2026-10-25T08:00:00.000Z',
      );
      expect(deps.log).toHaveBeenCalledWith(
        "ingest-only worker started: SOL_RUN_MODE=live, 정기 수집 매일 KST 00·03·06·09·12·15·18·21시 정각",
      );
    }
  });

  // 외부 서비스 4개를 켠 registry 사본: lh-bid-notice 만 키가 맞고, 나머지는 키 없음·키 형식 오류·한도 미정이다.
  const registryDoc = z.looseObject({ sources: z.array(z.looseObject({ key: z.string() })) });
  const ENABLED = {
    enabled: true,
    verification: "VERIFIED",
    approvalStatus: "APPROVED",
    fieldMapping: { title: "title" },
  };
  const isolationEnv = async () => {
    const doc = registryDoc.parse(parseYaml(await readFile(REGISTRY_FILE, "utf8")));
    const enabled = new Set([
      "lh-bid-notice",
      "kwater-bid-notice",
      "lh-pre-specification",
      "kepco-ebid-contract",
    ]);
    const dir = await mkdtemp(path.join(tmpdir(), "sol-registry-"));
    const file = path.join(dir, "registry.yaml");
    await writeFile(
      file,
      stringifyYaml({
        ...doc,
        sources: doc.sources.map((entry) =>
          enabled.has(entry.key) ? { ...entry, ...ENABLED } : entry,
        ),
      }),
    );
    return {
      dir,
      env: {
        ...liveEnv,
        SOURCES_REGISTRY_FILE: file,
        LH_BID_NOTICE_SERVICE_KEY: "lh-test-key-VALUE",
        // URL 인코딩이 깨진 값(형식 오류). K-water 키는 없다. KEPCO 는 registry quota.daily 가 null 이다.
        LH_PRE_SPECIFICATION_SERVICE_KEY: "%E0%A4%A",
      },
    };
  };

  it("외부 서비스 키 없음·형식 오류·한도 미정이 있어도 나라장터와 준비된 서비스로 기동한다(재기동해도 일정 중복 없음)", async () => {
    const { dir, env } = await isolationEnv();
    try {
      const runs = await startAndStop(2, env);
      expect([...fake.schedulers.keys()].sort()).toEqual([
        "g2b-scheduled",
        "lh-bid-notice-scheduled",
      ]);
      const output = runs.map(outputOf).join("\n");
      for (const line of [
        "외부 소스 lh-bid-notice: READY · 정기 수집",
        "외부 소스 kwater-bid-notice: KEY_MISSING · 정기 수집 제외",
        "외부 소스 lh-pre-specification: KEY_INVALID · 정기 수집 제외",
        "외부 소스 kepco-ebid-contract: QUOTA_UNVERIFIED · 정기 수집 제외",
        "외부 소스 g2b-procurement-request: NOT_CALLABLE(DISABLED) · 정기 수집 제외",
      ])
        expect(output).toContain(line);
      expect(output).not.toContain("lh-test-key-VALUE");
      // 기동마다 상태를 Redis 에 남긴다(키 값 없음)
      expect(fake.sets).toHaveLength(2);
      const [key, value] = fake.sets[0];
      expect(key).toBe("ingest:source-readiness");
      expect(value).not.toContain("lh-test-key-VALUE");
      expect(JSON.parse(value)).toMatchObject({
        version: 1,
        services: {
          "lh-bid-notice": { state: "READY", scheduled: true },
          "kwater-bid-notice": { state: "KEY_MISSING", scheduled: false },
          "lh-pre-specification": { state: "KEY_INVALID", scheduled: false },
          "kepco-ebid-contract": { state: "QUOTA_UNVERIFIED", scheduled: false },
          "kwater-procurement-plan": {
            state: "NOT_CALLABLE",
            reason: "DISABLED",
            scheduled: false,
          },
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("상태 기록이 Redis 장애로 실패해도 기동과 일정은 그대로다(이름·코드만 로그)", async () => {
    fake.setFails = true;
    const [run] = await startAndStop(1);
    expect([...fake.schedulers.keys()]).toEqual(["g2b-scheduled"]);
    expect(outputOf(run)).toContain("외부 수집 상태 기록 실패: Error ECONNREFUSED");
    expect(outputOf(run)).not.toContain("example-host");
  });

  it("인증 오류를 받은 외부 서비스만 AUTH_FAILED 로 막고 상태는 한 번만 다시 기록한다", async () => {
    const changed = vi.fn();
    const runtime = createExternalRuntime(
      new Map([
        ["lh-bid-notice", { state: "READY", scheduled: true }],
        ["kwater-bid-notice", { state: "READY", scheduled: true }],
      ] as const),
      { log: vi.fn(), changed },
    );
    const rejected = withAuthCircuit(
      {
        source: "lh",
        fetchPage: async () => ({
          ok: false,
          failure: { kind: "SERVICE_KEY_INVALID", resultCode: "30", detail: "SERVICE_KEY" },
        }),
      },
      "lh-bid-notice",
      runtime,
    );
    const page = { from: "2026-10-25T00:00:00.000Z", to: "2026-10-25T03:00:00.000Z", cursor: null };
    await rejected.fetchPage(page);
    await rejected.fetchPage(page);
    expect(runtime.readiness.get("lh-bid-notice")).toEqual({
      state: "AUTH_FAILED",
      scheduled: true,
    });
    expect(readinessBlockOf(runtime.readiness.get("lh-bid-notice"))).toBe("AUTH_FAILED");
    expect(readinessBlockOf(runtime.readiness.get("kwater-bid-notice"))).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("기동 로그에 즉시 수집하지 않고 다음 KST 정각부터 돈다고 한 줄 남긴다", async () => {
    // Date 만 고정한다(타이머는 그대로). NOW 는 KST 16:30:15 라 다음 정각은 KST 18:00(UTC 09:00)이다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const [deps] = await startAndStop(1);
      expect(deps.log).toHaveBeenCalledWith(
        "g2b-scheduled 일정: 매일 KST 00·03·06·09·12·15·18·21시 정각(Asia/Seoul). " +
          "기동 즉시 수집하지 않고 다음 정각 2026-10-25T09:00:00.000Z 부터 돈다(즉시 수집은 --once·수동 요청)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([["60"], ["not-a-number-77x"], [""]])(
    "옛 간격 env G2B_INGEST_INTERVAL_MINUTES=%j 는 형식과 상관없이 무시하고 값 없이 한 줄만 남긴다",
    async (value) => {
      const { deps, signals } = testDeps();
      await runIngestOnly([], { ...liveEnv, G2B_INGEST_INTERVAL_MINUTES: value }, deps);
      expect(deps.exit).not.toHaveBeenCalled();
      signals.emit("SIGTERM");
      await vi.waitFor(() => {
        expect(deps.exit).toHaveBeenCalledWith(0);
      });
      const notices = deps.log.mock.calls.flat().filter((line) => line.includes("무시함"));
      expect(notices).toEqual([
        "G2B_INGEST_INTERVAL_MINUTES 무시함: 정기 수집은 매일 KST 00·03·06·09·12·15·18·21시 정각에 돈다",
      ]);
      // 값은 로그에 싣지 않는다(틀린 값도 그대로 찍지 않는다).
      if (value === "not-a-number-77x") expect(outputOf(deps)).not.toContain(value);
    },
  );

  it("옛 간격 env 가 없으면 무시함 줄을 남기지 않는다", async () => {
    const withoutInterval = Object.fromEntries(
      Object.entries(liveEnv).filter(([key]) => key !== "G2B_INGEST_INTERVAL_MINUTES"),
    );
    const { deps, signals } = testDeps();
    await runIngestOnly([], withoutInterval, deps);
    signals.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
    expect(outputOf(deps)).not.toContain("무시함");
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
    expect(deps.log.mock.calls.flat().slice(-2)).toEqual([
      "G2B_INGEST_INTERVAL_MINUTES 무시함: 정기 수집은 매일 KST 00·03·06·09·12·15·18·21시 정각에 돈다",
      "ingest-only worker 확인 통과: SOL_RUN_MODE=live, 정기 수집 매일 KST 00·03·06·09·12·15·18·21시 정각",
    ]);
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

  it("--status 는 Queue 를 만들지 않고(쓰기 없음) job 수와 Job Scheduler 목록(옛 every·새 pattern 구분)만 출력한다", async () => {
    fake.schedulers.set("g2b-scheduled", {
      every: null,
      pattern: "0 */3 * * *",
      tz: "Asia/Seoul",
      next: fake.schedulerNext,
    });
    fake.schedulers.set("old-every", {
      every: 3_600_000,
      pattern: null,
      tz: null,
      next: fake.schedulerNext,
    });
    const { deps } = testDeps();
    await runIngestOnly(["--status"], liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.log.mock.calls.flat()).toEqual([
      "ingest 큐 job 수: waiting=0 active=0 delayed=0 failed=0 completed=0 paused=0 prioritized=0",
      "ingest 큐 Job Scheduler 2개",
      '  id=g2b-scheduled every=- pattern="0 */3 * * *" tz=Asia/Seoul next=2026-10-25T08:00:00.000Z',
      "  id=old-every every=3600000 next=2026-10-25T08:00:00.000Z",
    ]);
    expect(fake.queues).toEqual([]);
    expect(fake.workers).toEqual([]);
    expect(fake.redis.map((redis) => redis.disconnect.mock.calls.length)).toEqual([1]);
  });

  it("--unschedule 은 ingest 큐의 정기 일정(g2b·외부 서비스별)만 지우고 연결을 닫는다", async () => {
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
    ).toEqual([
      {
        name: "ingest",
        removed: [["g2b-scheduled"], ...EXTERNAL_SOURCE_KEYS.map((key) => [`${key}-scheduled`])],
        upserts: 0,
        closes: 1,
      },
    ]);
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

  // ingest 전용 worker 의 실제 상한(24시간). NOW 는 2026-10-25T07:30:15Z(KST 16:30)라 창 끝은 07:30, 바닥은 하루 전 07:30 이다.
  const CAP = { maxMs: SCHEDULED_WINDOW_CAP_MINUTES * 60_000 };
  const FLOOR = "2026-10-24T07:30:00.000Z";
  it.each([
    {
      name: "상한 + 이전 성공 없음 → 기본 24시간(상한과 같아 자른 기록 없음)",
      cap: true,
      latest: { end: null, last: null },
      from: FLOOR,
      jobTo: "2026-10-25T07:30:00.000Z",
      windowCap: undefined,
    },
    {
      name: "상한 + 30시간 전 성공 끝·25시간 전 시작한 실패 창 → 실패 창을 버리고 최근 24시간으로 자름",
      cap: true,
      latest: {
        end: new Date("2026-10-24T01:30:00.000Z"),
        last: {
          status: "FAILED" as const,
          window: { from: "2026-10-24T06:30:00.000Z", to: "2026-10-24T09:30:00.000Z" },
        },
      },
      from: FLOOR,
      jobTo: "2026-10-25T07:30:00.000Z",
      windowCap: { maxMinutes: 1440, previousSuccessEnd: "2026-10-24T01:30:00.000Z" },
    },
    {
      // 예산 소진(KST 10-24 21시 회차) 뒤 자정을 넘겨 다시 도는 경우. 6시간 상한이면 이 창을 버려 빈틈이 생겼다.
      name: "상한 + 19시간 전 시작한 실패 창 → 그 창과 jobKey 를 그대로 다시 씀(C8)",
      cap: true,
      latest: {
        end: new Date("2026-10-24T09:00:00.000Z"),
        last: {
          status: "FAILED" as const,
          window: { from: "2026-10-24T12:00:00.000Z", to: "2026-10-24T15:00:00.000Z" },
        },
      },
      from: "2026-10-24T12:00:00.000Z",
      jobTo: "2026-10-24T15:00:00.000Z",
      windowCap: undefined,
    },
    {
      name: "상한 + 7시간 전 성공 끝 → 그 끝부터(옛 2주기 상한이면 잘렸다)",
      cap: true,
      latest: { end: new Date("2026-10-25T00:30:00.000Z"), last: null },
      from: "2026-10-25T00:30:00.000Z",
      jobTo: "2026-10-25T07:30:00.000Z",
      windowCap: undefined,
    },
    {
      name: "상한 없음(전체 worker) + 이전 성공 없음 → 24시간 그대로",
      cap: false,
      latest: { end: null, last: null },
      from: "2026-10-24T07:30:00.000Z",
      jobTo: "2026-10-25T07:30:00.000Z",
      windowCap: undefined,
    },
  ])("정기 창: $name", async ({ cap, latest, from, jobTo, windowCap }) => {
    const { repo, starts } = repoWith(latest);
    const log = vi.fn<(line: string) => void>();
    await processIngestJob(
      SCHEDULED_JOB,
      jobDeps(repo, cap ? { scheduledWindowCap: { ...CAP, log } } : {}),
    );
    expect(starts.map(({ jobKey, params }) => ({ jobKey, params }))).toEqual([
      {
        jobKey: `g2b:SCHEDULED:${jobTo}`,
        params: {
          window: { from, to: jobTo },
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

// createIngestWorker 를 위 BullMQ 가짜로 띄운다. 처리기는 fake.processors 에 남는다.
describe("ingest Worker 일정과 job 처리", () => {
  const SLOT_MS = Date.parse("2026-10-25T06:00:00.000Z"); // KST 15:00 정각
  const schedulerJob = (data: unknown) => ({
    id: `repeat:g2b-scheduled:${SLOT_MS}`,
    repeatJobKey: "g2b-scheduled",
    timestamp: SLOT_MS - 3 * 3_600_000, // 앞 회차(KST 12:00)가 시작할 때 큐에 들어갔다
    processedOn: SLOT_MS + 4_000, // 앞 job 이 4초 더 돌아 늦게 시작했다
    data,
  });
  const removedIds = () =>
    fake.queues.flatMap((queue) => queue.removeJobScheduler.mock.calls.map(([id]) => id));

  it.each([["mock"], ["fixture"]] as const)(
    "%s 면 g2b·외부 소스 일정을 모두 지우고 새로 걸지 않는다(8-1)",
    async (runMode) => {
      fake.schedulers.set("g2b-scheduled", {
        every: null,
        pattern: "0 */3 * * *",
        tz: "Asia/Seoul",
        next: fake.schedulerNext,
      });
      const { repo } = repoWith({ end: null, last: null });
      const worker = await createIngestWorker(new IORedis(), jobDeps(repo, { runMode }));
      await worker.close();
      expect(removedIds()).toEqual([
        "g2b-scheduled",
        ...EXTERNAL_SOURCE_KEYS.map((key) => `${key}-scheduled`),
      ]);
      expect(fake.queues.flatMap((queue) => queue.upsertJobScheduler.mock.calls)).toEqual([]);
      expect(fake.schedulers.size).toBe(0);
    },
  );

  it("여러 외부 서비스도 같은 KST 3시간 정각 cron 으로 걸고, 나라장터보다 뒤에 돌게 우선순위를 단다", async () => {
    const { repo } = repoWith({ end: null, last: null });
    const scheduled = [
      { source: "lh" as const, serviceKey: "lh-bid-notice" as const },
      { source: "kepco" as const, serviceKey: "kepco-ebid-contract" as const },
    ].map((job) => ({
      ...job,
      trigger: "SCHEDULED" as const,
      jobKey: `${job.serviceKey}:SCHEDULED`,
    }));
    // 재기동 두 번: 같은 id 로 덮어써 일정이 늘지 않는다
    for (let round = 0; round < 2; round += 1) {
      const worker = await createIngestWorker(
        new IORedis(),
        jobDeps(repo, { scheduledExternalJobs: scheduled }),
      );
      await worker.close();
    }
    const cron = { pattern: "0 */3 * * *", tz: "Asia/Seoul" };
    const upserts = fake.queues.flatMap((queue) => queue.upsertJobScheduler.mock.calls);
    expect(
      upserts.slice(0, 3).map(([id, repeat, template]) => ({ id, repeat, template })),
    ).toStrictEqual([
      {
        id: "g2b-scheduled",
        repeat: cron,
        template: {
          name: "run",
          data: { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" },
        },
      },
      {
        id: "lh-bid-notice-scheduled",
        repeat: cron,
        template: { name: "run", data: scheduled[0], opts: { priority: 10 } },
      },
      {
        id: "kepco-ebid-contract-scheduled",
        repeat: cron,
        template: { name: "run", data: scheduled[1], opts: { priority: 10 } },
      },
    ]);
    expect(upserts).toHaveLength(6);
    expect([...fake.schedulers.keys()].sort()).toEqual([
      "g2b-scheduled",
      "kepco-ebid-contract-scheduled",
      "lh-bid-notice-scheduled",
    ]);
  });

  it("job 처리가 던져도 일정을 지우지 않는다(일정 등록은 처리 결과와 무관)", async () => {
    const { repo } = repoWith({ end: null, last: null });
    const worker = await createIngestWorker(new IORedis(), jobDeps(repo));
    const [processor] = fake.processors;
    await expect(processor(schedulerJob({ source: "g2b" }))).rejects.toThrow(
      "ingest job data 가 잘못됐다",
    );
    await expect(processor(schedulerJob(SCHEDULED_JOB))).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    await worker.close();
    expect(removedIds()).not.toContain("g2b-scheduled");
    expect([...fake.schedulers.keys()]).toEqual(["g2b-scheduled"]);
  });

  it("처리기는 회차 job 의 정각·등록·시작 시각과 큐 대기를 params.timing 과 로그 한 줄로 남긴다", async () => {
    const { repo, starts } = repoWith({ end: null, last: null });
    const log = vi.fn<(line: string) => void>();
    const worker = await createIngestWorker(new IORedis(), jobDeps(repo, { log }));
    await fake.processors[0](schedulerJob(SCHEDULED_JOB));
    await worker.close();
    const timing = {
      scheduledFor: "2026-10-25T06:00:00.000Z",
      enqueuedAt: "2026-10-25T03:00:00.000Z",
      startedAt: "2026-10-25T06:00:04.000Z",
      queueDelayMs: 4_000,
    };
    expect(starts.map(({ params }) => params?.timing)).toEqual([timing]);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "ingest.job.timing",
        source: "g2b",
        trigger: "SCHEDULED",
        ...timing,
      }),
    );
  });
});

describe("큐 소비자", () => {
  it("analysis runtime 은 analysis 큐 Worker 하나만 만든다", async () => {
    const runtime = startAnalysisRuntime({ REDIS_URL: liveEnv.REDIS_URL });
    await runtime.close();
    expect(fake.workers).toEqual(["analysis"]);
  });
});
