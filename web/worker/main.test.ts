import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type IORedis from "ioredis";
import {
  defaultWorkerDeps,
  errorCode,
  ingestWorkerRegistration,
  startRegistered,
  startWorker,
  systemWorkerRegistration,
  WORKER_REGISTRATIONS,
  type StartWorkers,
  type WorkerDeps,
} from "@/worker/main";

const env = {
  REDIS_URL: "redis://example-host/0",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123",
};

function fakeDeps(overrides: Partial<WorkerDeps> = {}) {
  const workerClose = vi.fn(() => Promise.resolve());
  const heartbeatStop = vi.fn();
  const deps = {
    checkReadiness: vi.fn(() => Promise.resolve()),
    createWorker: vi.fn(() => ({ close: workerClose })),
    startHeartbeat: vi.fn(() => ({ stop: heartbeatStop })),
    ...overrides,
  } satisfies WorkerDeps;
  return { deps, workerClose, heartbeatStop };
}

describe("startWorker", () => {
  it("준비 확인이 실패하면 reject 하고 worker 와 heartbeat 를 만들지 않는다", async () => {
    const { deps } = fakeDeps({ checkReadiness: vi.fn(() => Promise.reject(new Error("redis"))) });
    await expect(startWorker(env, deps)).rejects.toThrow("redis");
    expect(deps.createWorker).not.toHaveBeenCalled();
    expect(deps.startHeartbeat).not.toHaveBeenCalled();
  });

  it("env 가 부족하면 준비 확인 전에 reject 한다", async () => {
    const { deps } = fakeDeps();
    await expect(startWorker({}, deps)).rejects.toThrow("worker env 누락");
    expect(deps.checkReadiness).not.toHaveBeenCalled();
  });

  it("heartbeat 경로를 env 에서 받아 시작한다", async () => {
    const { deps } = fakeDeps();
    await startWorker({ ...env, WORKER_HEARTBEAT_FILE: "/run/hb" }, deps);
    expect(deps.startHeartbeat).toHaveBeenCalledWith("/run/hb");
  });

  it("close 가 worker 와 heartbeat 를 모두 닫는다", async () => {
    const { deps, workerClose, heartbeatStop } = fakeDeps();
    const handle = await startWorker(env, deps);
    await handle.close();
    expect(workerClose).toHaveBeenCalledOnce();
    expect(heartbeatStop).toHaveBeenCalledOnce();
  });
});

describe("startWorker heartbeat 파일", () => {
  it("준비 확인보다 먼저 이전 heartbeat 파일을 지운다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-hb-"));
    const file = join(dir, "hb");
    try {
      writeFileSync(file, "stale\n");
      let existedDuringReadiness = true;
      const { deps } = fakeDeps({
        checkReadiness: vi.fn(() => {
          existedDuringReadiness = existsSync(file);
          return Promise.reject(new Error("redis"));
        }),
      });
      await expect(startWorker({ ...env, WORKER_HEARTBEAT_FILE: file }, deps)).rejects.toThrow();
      expect(existedDuringReadiness).toBe(false);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("파일이 없어도 오류 없이 기동한다", async () => {
    const { deps } = fakeDeps();
    await expect(
      startWorker({ ...env, WORKER_HEARTBEAT_FILE: "/nonexistent-dir-sol/hb" }, deps),
    ).resolves.toBeDefined();
  });
});

describe("errorCode", () => {
  it("문자열 code 만 돌려주고 message 는 보지 않는다", () => {
    expect(errorCode(Object.assign(new Error("redis://:pw@h"), { code: "ECONNREFUSED" }))).toBe(
      "ECONNREFUSED",
    );
    expect(errorCode(new Error("x"))).toBeNull();
    expect(errorCode({ code: 5 })).toBeNull();
    expect(errorCode({ code: "has space://pw" })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe("기본 준비 확인 오류", () => {
  it("닫힌 포트면 실패한 쪽 이름과 오류 코드만 싣고 URL·비밀번호는 싣지 않는다", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await new Promise((resolve) => server.close(resolve));
    const error: unknown = await defaultWorkerDeps
      .checkReadiness({
        redisUrl: `redis://:pw-secret@127.0.0.1:${port}`,
        heartbeatFile: "/unused",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("준비 확인 실패: redis");
    expect(message).toContain("redis: ECONNREFUSED");
    expect(message).not.toContain("pw-secret");
    expect(message).not.toContain(String(port));
  });
});

// ── 6-6: 기본 createWorker 가 ingest Worker 와 live 모드의 g2b 일정 실행을 건다 ──
// BullMQ Worker·Queue, ioredis, Supabase createClient 를 가짜로 바꾼 새 모듈 그래프에서 기본 deps 를 돌린다.
// 위 시험(실제 포트로 준비 확인)이 진짜 ioredis 를 쓰므로 vi.mock 대신 vi.doMock + 동적 import 로 이 묶음에만 건다.
// 실제 Redis·Supabase 는 부르지 않는다.
type FakeWorker = { queueName: string; close: Mock<() => Promise<undefined>> };
type FakeQueue = {
  queueName: string;
  upsertJobScheduler: Mock<(...args: unknown[]) => Promise<undefined>>;
  removeJobScheduler: Mock<(...args: unknown[]) => Promise<boolean>>;
};
type FakeRedis = { disconnect: Mock<() => void> };
// log 는 닫는 순서를 본다(close:<큐 이름>, disconnect). failUpsert 는 live 시작 중 실패를 흉내 낸다.
const bull = {
  workers: [] as FakeWorker[],
  queues: [] as FakeQueue[],
  redis: [] as FakeRedis[],
  log: [] as string[],
  failUpsert: false,
};

const REGISTRY_FILE = fileURLToPath(new URL("../../infra/sources/registry.yaml", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures", import.meta.url));

// interval 이 null 이면 간격 env 를 넣지 않는다(undefined 는 기본 인자 "7" 이 된다).
const ingestEnv = (mode: string | undefined, interval: string | null = "7") => ({
  ...env,
  WORKER_HEARTBEAT_FILE: "/nonexistent-dir-sol/hb",
  SOL_RUN_MODE: mode,
  G2B_INGEST_INTERVAL_MINUTES: interval ?? undefined,
  // 가짜 서비스키(Encoding 형). live 모드가 기동할 때 읽어도 되게 둔다
  G2B_BID_NOTICE_SERVICE_KEY: "FAKEKEY%2Btest%3D%3D",
  FIXTURES_DIR,
  SOURCES_REGISTRY_FILE: REGISTRY_FILE,
});

const loadMainWithFakes = async () => {
  vi.resetModules();
  bull.workers = [];
  bull.queues = [];
  bull.redis = [];
  bull.log = [];
  bull.failUpsert = false;
  vi.doMock("bullmq", () => {
    class Worker {
      readonly close: Mock<() => Promise<undefined>>;
      readonly on = vi.fn();
      constructor(queueName: string) {
        this.close = vi.fn(async () => {
          bull.log.push(`close:${queueName}`);
          return undefined;
        });
        bull.workers.push({ queueName, close: this.close });
      }
    }
    class Queue {
      readonly upsertJobScheduler = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => {
        if (bull.failUpsert) throw new Error("upsert 실패 흉내");
        return undefined;
      });
      readonly removeJobScheduler = vi.fn<(...args: unknown[]) => Promise<boolean>>(
        async () => false,
      );
      readonly add = vi.fn(async () => undefined);
      readonly close = vi.fn(async () => undefined);
      readonly on = vi.fn();
      constructor(queueName: string) {
        bull.queues.push({
          queueName,
          upsertJobScheduler: this.upsertJobScheduler,
          removeJobScheduler: this.removeJobScheduler,
        });
      }
    }
    return { Worker, Queue };
  });
  vi.doMock("ioredis", () => {
    class Redis {
      readonly disconnect = vi.fn(() => {
        bull.log.push("disconnect");
      });
      readonly quit = vi.fn(async () => "OK");
      readonly on = vi.fn();
      constructor() {
        bull.redis.push({ disconnect: this.disconnect });
      }
    }
    return { default: Redis, Redis };
  });
  vi.doMock("@supabase/supabase-js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
    createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
  }));
  return import("@/worker/main");
};

// 기본 createWorker 를 쓰고, 준비 확인·heartbeat 만 가짜로 둔다. env 는 인자와 process.env 둘 다에 넣는다.
const startWithDefaultCreateWorker = async (
  workerEnvRecord: Record<string, string | undefined>,
) => {
  for (const [key, value] of Object.entries(workerEnvRecord)) vi.stubEnv(key, value);
  const main = await loadMainWithFakes();
  const handle = await main.startWorker(workerEnvRecord, {
    ...main.defaultWorkerDeps,
    checkReadiness: async () => undefined,
    startHeartbeat: () => ({ stop: () => undefined }),
  });
  await vi.waitFor(() => {
    expect(bull.workers.map((worker) => worker.queueName)).toContain("ingest");
  });
  return handle;
};

const schedulerCalls = () =>
  bull.queues.flatMap((queue) =>
    queue.upsertJobScheduler.mock.calls.map((args) => ({ queueName: queue.queueName, args })),
  );
const removeSchedulerCalls = () =>
  bull.queues.flatMap((queue) =>
    queue.removeJobScheduler.mock.calls.map((args) => ({ queueName: queue.queueName, args })),
  );

// 비동기로 거는 일정 실행이 있으면 끝나게 한 번 넘긴다.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("기본 createWorker — ingest Worker (6-6)", () => {
  afterEach(() => {
    vi.doUnmock("bullmq");
    vi.doUnmock("ioredis");
    vi.doUnmock("@supabase/supabase-js");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("system Worker 와 함께 ingest Worker 를 만든다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("mock"));
    expect(bull.workers.map((worker) => worker.queueName).sort()).toEqual(["ingest", "system"]);
    await handle.close();
  });

  it("close 는 system Worker 와 ingest Worker 를 모두 닫는다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("mock"));
    await handle.close();
    expect(
      bull.workers.map((worker) => [worker.queueName, worker.close.mock.calls.length]).sort(),
    ).toEqual([
      ["ingest", 1],
      ["system", 1],
    ]);
  });

  it("live 모드면 ingest 큐에 g2b 일정 실행을 readIngestIntervalMinutes 간격(7분)으로 건다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("live", "7"));
    await vi.waitFor(() => {
      expect(schedulerCalls()).toEqual([
        {
          queueName: "ingest",
          args: [
            "g2b-scheduled",
            { every: 7 * 60_000 },
            {
              name: "run",
              data: { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" },
            },
          ],
        },
      ]);
    });
    // 8-1: live 는 일정을 걸기만 하고 지우지 않는다
    expect(removeSchedulerCalls()).toEqual([]);
    await handle.close();
  });

  it("live 모드에서 간격 env 가 없으면 기본 30분 간격이다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("live", null));
    await vi.waitFor(() => {
      expect(schedulerCalls().map(({ args }) => args[1])).toEqual([{ every: 30 * 60_000 }]);
    });
    await handle.close();
  });

  it.each([["fixture"], ["mock"], [undefined]])(
    "SOL_RUN_MODE=%s 이면 g2b 일정 실행을 걸지 않는다",
    async (mode) => {
      const handle = await startWithDefaultCreateWorker(ingestEnv(mode));
      await settle();
      expect(schedulerCalls()).toEqual([]);
      await handle.close();
    },
  );

  // 8-1: Redis 가 appendonly·named volume 이라 live 때 건 g2b-scheduled 가 남는다. live 가 아니면 지운다.
  it.each([["fixture"], ["mock"], [undefined]])(
    "SOL_RUN_MODE=%s 이면 ingest 큐의 g2b-scheduled 일정을 지운다(removeJobScheduler, C3 계약 8-1)",
    async (mode) => {
      const handle = await startWithDefaultCreateWorker(ingestEnv(mode));
      await vi.waitFor(() => {
        expect(removeSchedulerCalls()).toEqual([{ queueName: "ingest", args: ["g2b-scheduled"] }]);
      });
      expect(schedulerCalls()).toEqual([]);
      await handle.close();
    },
  );
});

// ── 8-4: worker 등록을 함수 단위로(분석 worker 를 붙일 자리). 1단계(설정 검증, Redis 전) → 2단계(시작) ──
describe("startRegistered (C3 계약 8-4)", () => {
  const connection = { name: "가짜 연결" } as unknown as IORedis;

  const recorder = () => {
    const log: string[] = [];
    const received: unknown[] = [];
    const starter =
      (name: string, failStart = false): StartWorkers =>
      async (given) => {
        received.push(given);
        log.push(`start:${name}`);
        if (failStart) throw new Error(`${name} 시작 실패`);
        return {
          close: async () => {
            log.push(`close:${name}`);
          },
        };
      };
    return { log, received, starter };
  };

  it("등록 순서대로 하나씩 시작한다", async () => {
    const { log, starter } = recorder();
    await startRegistered(connection, [starter("a"), starter("b"), starter("c")]);
    expect(log).toEqual(["start:a", "start:b", "start:c"]);
  });

  it("각 시작 함수에 같은 연결을 넘긴다", async () => {
    const { received, starter } = recorder();
    await startRegistered(connection, [starter("a"), starter("b")]);
    expect(received).toEqual([connection, connection]);
    expect(received.every((given) => given === connection)).toBe(true);
  });

  it("close 는 시작의 거꾸로 닫는다", async () => {
    const { log, starter } = recorder();
    const handle = await startRegistered(connection, [starter("a"), starter("b"), starter("c")]);
    await handle.close();
    expect(log.slice(3)).toEqual(["close:c", "close:b", "close:a"]);
  });

  it("두 번째 시작이 던지면 첫 번째 것을 닫고 그 오류를 다시 던진다", async () => {
    const { log, starter } = recorder();
    await expect(startRegistered(connection, [starter("a"), starter("b", true)])).rejects.toThrow(
      "b 시작 실패",
    );
    expect(log).toEqual(["start:a", "start:b", "close:a"]);
  });

  it("세 번째 시작이 던지면 이미 시작한 것을 거꾸로 닫는다", async () => {
    const { log, starter } = recorder();
    await expect(
      startRegistered(connection, [starter("a"), starter("b"), starter("c", true), starter("d")]),
    ).rejects.toThrow("c 시작 실패");
    expect(log).toEqual(["start:a", "start:b", "start:c", "close:b", "close:a"]);
  });

  it("첫 시작이 던지면 닫을 것이 없고 그 오류를 다시 던진다", async () => {
    const { log, starter } = recorder();
    await expect(startRegistered(connection, [starter("a", true), starter("b")])).rejects.toThrow(
      "a 시작 실패",
    );
    expect(log).toEqual(["start:a"]);
  });
});

describe("WORKER_REGISTRATIONS (C3 계약 8-4)", () => {
  it("system·ingest 두 등록을 그 순서로 담는다", () => {
    expect(WORKER_REGISTRATIONS).toEqual([systemWorkerRegistration, ingestWorkerRegistration]);
    expect(WORKER_REGISTRATIONS).toHaveLength(2);
  });
});

describe("기본 createWorker — 등록 1·2단계 (C3 계약 8-4)", () => {
  afterEach(() => {
    vi.doUnmock("bullmq");
    vi.doUnmock("ioredis");
    vi.doUnmock("@supabase/supabase-js");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const startDefault = async (workerEnvRecord: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(workerEnvRecord)) vi.stubEnv(key, value);
    const main = await loadMainWithFakes();
    const started = main.startWorker(workerEnvRecord, {
      ...main.defaultWorkerDeps,
      checkReadiness: async () => undefined,
      startHeartbeat: () => ({ stop: () => undefined }),
    });
    return { main, started };
  };

  it("live 인데 registry 파일이 없으면 1단계에서 멈추고 Redis 연결·Worker 를 만들지 않는다", async () => {
    const { started } = await startDefault({
      ...ingestEnv("live"),
      SOURCES_REGISTRY_FILE: "/nonexistent-dir-sol/registry.yaml",
    });
    await expect(started).rejects.toThrow();
    expect(bull.redis).toEqual([]);
    expect(bull.workers).toEqual([]);
  });

  it("실행 모드 값이 틀리면(LIVE) 1단계에서 멈추고 Redis 연결을 만들지 않는다", async () => {
    const { started } = await startDefault(ingestEnv("LIVE"));
    await expect(started).rejects.toThrow("SOL_RUN_MODE");
    expect(bull.redis).toEqual([]);
  });

  it("ingest 시작이 실패하면 먼저 시작한 system Worker 를 닫고 연결을 끊은 뒤 던진다", async () => {
    const env6 = ingestEnv("live");
    for (const [key, value] of Object.entries(env6)) vi.stubEnv(key, value);
    const main = await loadMainWithFakes();
    bull.failUpsert = true;
    await expect(
      main.startWorker(env6, {
        ...main.defaultWorkerDeps,
        checkReadiness: async () => undefined,
        startHeartbeat: () => ({ stop: () => undefined }),
      }),
    ).rejects.toThrow("upsert 실패 흉내");
    expect(
      bull.workers.find((worker) => worker.queueName === "system")?.close.mock.calls,
    ).toHaveLength(1);
    expect(bull.redis.map((redis) => redis.disconnect.mock.calls.length)).toEqual([1]);
  });

  it("close 는 등록의 거꾸로(ingest → system) 닫고 마지막에 연결을 끊는다", async () => {
    const { started } = await startDefault(ingestEnv("mock"));
    const handle = await started;
    bull.log.length = 0;
    await handle.close();
    expect(bull.log).toEqual(["close:ingest", "close:system", "disconnect"]);
  });

  it("systemWorkerRegistration 의 시작은 받은 연결로 system 큐 Worker 를 만든다", async () => {
    const main = await loadMainWithFakes();
    const start = await main.systemWorkerRegistration(ingestEnv("mock"));
    const closable = await start({} as unknown as IORedis);
    expect(bull.workers.map((worker) => worker.queueName)).toEqual(["system"]);
    await closable.close();
  });

  it("ingestWorkerRegistration 의 1단계는 연결 없이 설정을 검증한다(틀린 모드면 던지고 Worker 를 만들지 않는다)", async () => {
    const main = await loadMainWithFakes();
    await expect(main.ingestWorkerRegistration(ingestEnv("LIVE"))).rejects.toThrow("SOL_RUN_MODE");
    expect(bull.workers).toEqual([]);
  });
});
