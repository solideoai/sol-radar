import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type IORedis from "ioredis";
import {
  analysisWorkerRegistration,
  defaultWorkerDeps,
  errorCode,
  ingestWorkerRegistration,
  startRegistered,
  startWorker,
  systemWorkerRegistration,
  WORKER_REGISTRATIONS,
  type Closable,
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
      // analysis 등록이 공유 연결을 복제해 쓴다(C5-B). 복제는 bull.redis 에 넣지 않고, 끊기면 따로 표시한다.
      readonly duplicate = vi.fn(() => ({
        disconnect: vi.fn(() => {
          bull.log.push("disconnect:복제");
        }),
        quit: vi.fn(async () => "OK"),
        on: vi.fn(),
      }));
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

  it("system·analysis Worker 와 함께 ingest Worker 를 만든다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("mock"));
    expect(bull.workers.map((worker) => worker.queueName).sort()).toEqual([
      "analysis",
      "ingest",
      "system",
    ]);
    await handle.close();
  });

  it("close 는 system·ingest·analysis Worker 를 모두 닫는다", async () => {
    const handle = await startWithDefaultCreateWorker(ingestEnv("mock"));
    await handle.close();
    expect(
      bull.workers.map((worker) => [worker.queueName, worker.close.mock.calls.length]).sort(),
    ).toEqual([
      ["analysis", 1],
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
    // failClose 면 close 가 `${name} 닫기 실패` 로 reject 한다(닫기를 시도한 기록은 남긴다).
    const starter =
      (name: string, failStart = false, failClose = false): StartWorkers =>
      async (given) => {
        received.push(given);
        log.push(`start:${name}`);
        if (failStart) throw new Error(`${name} 시작 실패`);
        return {
          close: async () => {
            log.push(`close:${name}`);
            if (failClose) throw new Error(`${name} 닫기 실패`);
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

  // 낮음 (e): 돌려준 close 는 한 등록의 close 가 던져도 나머지를 모두 닫고, 끝에 첫 오류(닫는 순서로 처음)를 던진다.
  it("close 중 한 등록의 close 가 던져도 나머지 등록을 거꾸로 모두 닫는다", async () => {
    const { log, starter } = recorder();
    const handle = await startRegistered(connection, [
      starter("a"),
      starter("b", false, true),
      starter("c"),
    ]);
    await handle.close().catch(() => undefined);
    expect(log.slice(3)).toEqual(["close:c", "close:b", "close:a"]);
  });

  it("close 중 한 등록의 close 가 던지면 나머지를 닫은 뒤 그 오류로 reject 한다", async () => {
    const { log, starter } = recorder();
    const handle = await startRegistered(connection, [
      starter("a"),
      starter("b", false, true),
      starter("c"),
    ]);
    await expect(handle.close()).rejects.toThrow("b 닫기 실패");
    expect(log.at(-1)).toBe("close:a");
  });

  it("close 중 두 등록이 던지면 모두 닫고 닫는 순서로 처음 던진 오류로 reject 한다", async () => {
    const { log, starter } = recorder();
    const handle = await startRegistered(connection, [
      starter("a", false, true),
      starter("b"),
      starter("c", false, true),
    ]);
    await expect(handle.close()).rejects.toThrow("c 닫기 실패");
    expect(log.slice(3)).toEqual(["close:c", "close:b", "close:a"]);
  });

  it("close 가 모두 성공하면 resolve 한다", async () => {
    const { starter } = recorder();
    const handle = await startRegistered(connection, [starter("a"), starter("b")]);
    await expect(handle.close()).resolves.toBeUndefined();
  });

  // 시작 실패 정리는 닫는 중 오류를 버리고(원인 오류를 가리지 않는다) 나머지를 닫은 뒤 원래 시작 오류를 던진다.
  it("시작 실패 정리 중 이미 시작한 등록의 close 가 던져도 나머지를 닫고 원래 시작 오류를 던진다", async () => {
    const { log, starter } = recorder();
    await expect(
      startRegistered(connection, [starter("a"), starter("b", false, true), starter("c", true)]),
    ).rejects.toThrow("c 시작 실패");
    expect(log).toEqual(["start:a", "start:b", "start:c", "close:b", "close:a"]);
  });
});

describe("WORKER_REGISTRATIONS (C3 계약 8-4)", () => {
  it("system·ingest 두 등록을 그 순서로 앞에 담는다", () => {
    expect(WORKER_REGISTRATIONS.slice(0, 2)).toEqual([
      systemWorkerRegistration,
      ingestWorkerRegistration,
    ]);
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

  it("close 는 등록의 거꾸로(analysis → ingest → system) 닫고 마지막에 연결을 끊는다", async () => {
    const { started } = await startDefault(ingestEnv("mock"));
    const handle = await started;
    bull.log.length = 0;
    await handle.close();
    // analysis 복제 연결의 끊김은 아래 C5-B 묶음이 본다.
    expect(bull.log.filter((entry) => entry !== "disconnect:복제")).toEqual([
      "close:analysis",
      "close:ingest",
      "close:system",
      "disconnect",
    ]);
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

// ── C5-B: analysis worker 등록. 1단계(설정 검증, Redis 연결 전) → 2단계(공유 연결을 duplicate 해 startAnalysisRuntime) ──
// 새 주입 지점 없이 실제 analysisWorkerRegistration·startAnalysisRuntime 을 돌린다. BullMQ Worker·Queue, ioredis,
// supabase-js 의 fetch 만 가짜다. 위 묶음과 같은 이유로 vi.doMock + 동적 import 를 이 묶음에만 건다.
// 실제 Redis·Supabase·AI gateway 는 부르지 않는다(전역 fetch 도 막는다).
describe("WORKER_REGISTRATIONS — analysis 등록 (C5-B)", () => {
  it("system·ingest 를 그 순서로 두고 마지막에 analysisWorkerRegistration 을 담는다", () => {
    expect(WORKER_REGISTRATIONS).toStrictEqual([
      systemWorkerRegistration,
      ingestWorkerRegistration,
      analysisWorkerRegistration,
    ]);
  });
});

type RecordedBullClient = {
  queueName: string;
  connection: unknown;
  close: Mock<() => Promise<undefined>>;
};

/** 공유 연결 흉내. duplicate() 가 만든 복제도 같은 모양이고, disconnect 는 label 을 analysisFakes.log 에 남긴다. */
type FakeConnection = {
  readonly label: string;
  readonly duplicates: FakeConnection[];
  readonly duplicate: Mock<() => FakeConnection>;
  readonly disconnect: Mock<() => void>;
  readonly quit: Mock<() => Promise<string>>;
  readonly on: Mock<(...args: unknown[]) => unknown>;
};

const analysisFakes = {
  /** new IORedis(...) 로 만든 연결(기본 createWorker 의 공유 연결). duplicate() 로 만든 복제는 여기 없다. */
  redis: [] as FakeConnection[],
  workers: [] as RecordedBullClient[],
  queues: [] as RecordedBullClient[],
  log: [] as string[],
};

const fakeConnection = (label: string): FakeConnection => {
  const duplicates: FakeConnection[] = [];
  return {
    label,
    duplicates,
    duplicate: vi.fn(() => {
      const copy = fakeConnection(`${label}/복제${duplicates.length + 1}`);
      duplicates.push(copy);
      return copy;
    }),
    disconnect: vi.fn(() => {
      analysisFakes.log.push(`disconnect:${label}`);
    }),
    quit: vi.fn(async () => "OK"),
    on: vi.fn(),
  };
};

const loadMainWithAnalysisFakes = async () => {
  vi.resetModules();
  analysisFakes.redis = [];
  analysisFakes.workers = [];
  analysisFakes.queues = [];
  analysisFakes.log = [];
  vi.doMock("bullmq", async (importOriginal) => {
    const original = await importOriginal<typeof import("bullmq")>();
    const record = (list: RecordedBullClient[], queueName: string, connection: unknown) => {
      const close = vi.fn(async () => undefined);
      list.push({ queueName, connection, close });
      return close;
    };
    class Worker {
      readonly close: Mock<() => Promise<undefined>>;
      readonly on = vi.fn();
      constructor(queueName: string, _processor: unknown, options: { connection?: unknown } = {}) {
        this.close = record(analysisFakes.workers, queueName, options.connection);
      }
    }
    class Queue {
      readonly close: Mock<() => Promise<undefined>>;
      readonly on = vi.fn();
      readonly add = vi.fn(async () => undefined);
      readonly getJobState = vi.fn(async () => "unknown");
      readonly upsertJobScheduler = vi.fn(async () => undefined);
      readonly removeJobScheduler = vi.fn(async () => false);
      constructor(queueName: string, options: { connection?: unknown } = {}) {
        this.close = record(analysisFakes.queues, queueName, options.connection);
      }
    }
    return { ...original, Worker, Queue };
  });
  vi.doMock("ioredis", () => {
    class Redis {
      constructor() {
        const connection = fakeConnection(`ioredis#${analysisFakes.redis.length + 1}`);
        analysisFakes.redis.push(connection);
        Object.assign(this, connection);
      }
    }
    return { default: Redis, Redis };
  });
  // service role 클라이언트는 진짜 supabase-js 로 만들되 fetch 만 빈 목록을 돌려주는 가짜로 바꾼다(복구 회차가 score_runs 를 읽는다).
  vi.doMock("@supabase/supabase-js", async (importOriginal) => {
    const original = await importOriginal<typeof import("@supabase/supabase-js")>();
    const fakeFetch: typeof fetch = async () =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    return {
      ...original,
      createClient: vi.fn((url: string, key: string) =>
        original.createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: fakeFetch },
        }),
      ),
    };
  });
  return import("@/worker/main");
};

/** 분석 설정을 모두 맞게 준 env. 시험용 가짜 값이다. */
const analysisEnv = {
  ...ingestEnv("fixture"),
  AI_GATEWAY_URL: "http://ai-gateway.test:8000",
  ANALYSIS_STALE_QUEUED_MS: "120000",
  ANALYSIS_STALE_RUNNING_MS: "240000",
  ANALYSIS_RECONCILE_INTERVAL_MS: "30000",
};

/** reject 한 값. resolve 하면 시험을 실패시킨다. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("reject 하지 않았다");
    },
    (error: unknown) => error,
  );

const analysisClient = (list: readonly RecordedBullClient[]) =>
  list.find((client) => client.queueName === "analysis");

describe("analysisWorkerRegistration (C5-B)", () => {
  // 시험이 연 것을 닫는다. 복구 주기 타이머가 다음 시험으로 넘어가지 않게 한다(두 번 닫아도 가짜라 괜찮다).
  const opened: Closable[] = [];

  beforeEach(() => {
    // getSupabaseAdmin 은 process.env 를 읽는다.
    for (const [key, value] of Object.entries(analysisEnv)) vi.stubEnv(key, value);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("시험은 네트워크에 붙지 않는다");
      }),
    );
    // 복구 회차의 요약 로그를 숨긴다.
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const closable of opened.splice(0)) await closable.close();
    vi.doUnmock("bullmq");
    vi.doUnmock("ioredis");
    vi.doUnmock("@supabase/supabase-js");
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("1단계(연결 전 설정 검증)", () => {
    it.each([
      ["ANALYSIS_RECONCILE_INTERVAL_MS", "SECRETVALUE-5150"],
      ["AI_GATEWAY_URL", "http://user:SECRETVALUE@gw.test:8000"],
      ["SOL_RUN_MODE", "SECRETVALUE-prod"],
    ])("%s 가 틀리면 그 키 이름만 담아 던진다(값은 싣지 않는다)", async (key, value) => {
      const main = await loadMainWithAnalysisFakes();
      const error = await rejectionOf(
        main.analysisWorkerRegistration({ ...analysisEnv, [key]: value }),
      );
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain(key);
      expect(message).not.toContain("SECRETVALUE");
    });

    it("설정이 맞으면 Worker·연결을 만들지 않고 2단계 시작 함수를 돌려준다", async () => {
      const main = await loadMainWithAnalysisFakes();
      const start = await main.analysisWorkerRegistration(analysisEnv);
      expect(start).toBeTypeOf("function");
      expect([analysisFakes.redis, analysisFakes.workers, analysisFakes.queues]).toEqual([
        [],
        [],
        [],
      ]);
    });
  });

  describe("2단계(공유 연결을 duplicate 해 runtime 시작)", () => {
    const startAnalysis = async () => {
      const main = await loadMainWithAnalysisFakes();
      const shared = fakeConnection("공유");
      const start = await main.analysisWorkerRegistration(analysisEnv);
      const runtime = await start(shared as unknown as IORedis);
      opened.push(runtime);
      return { shared, runtime };
    };

    it("받은 공유 연결의 duplicate() 로 runtime 연결을 만든다", async () => {
      const { shared } = await startAnalysis();
      expect(shared.duplicate).toHaveBeenCalled();
    });

    it("analysis Worker 는 공유 연결이 아니라 duplicate() 가 만든 연결을 받는다", async () => {
      const { shared } = await startAnalysis();
      const worker = analysisClient(analysisFakes.workers);
      expect(worker?.connection).not.toBe(shared);
      expect(shared.duplicates).toContain(worker?.connection);
    });

    it("analysis 복구 Queue 도 duplicate() 가 만든 연결을 받는다", async () => {
      const { shared } = await startAnalysis();
      const queue = analysisClient(analysisFakes.queues);
      expect(queue?.connection).not.toBe(shared);
      expect(shared.duplicates).toContain(queue?.connection);
    });

    it("analysis Worker 와 Queue 는 서로 다른 복제 연결을 받는다", async () => {
      await startAnalysis();
      const worker = analysisClient(analysisFakes.workers);
      const queue = analysisClient(analysisFakes.queues);
      expect(worker?.connection).toBeDefined();
      expect(worker?.connection).not.toBe(queue?.connection);
    });

    it("close 는 공유 연결을 disconnect·quit 하지 않는다", async () => {
      const { shared, runtime } = await startAnalysis();
      await runtime.close();
      expect(shared.disconnect).not.toHaveBeenCalled();
      expect(shared.quit).not.toHaveBeenCalled();
    });

    it("close 는 analysis runtime 을 닫는다(analysis Worker close·복제 연결마다 disconnect 한 번)", async () => {
      const { shared, runtime } = await startAnalysis();
      await runtime.close();
      expect(analysisClient(analysisFakes.workers)?.close).toHaveBeenCalledOnce();
      expect(shared.duplicates).not.toEqual([]);
      expect(shared.duplicates.map((copy) => copy.disconnect.mock.calls.length)).toEqual(
        shared.duplicates.map(() => 1),
      );
    });
  });

  describe("기본 createWorker 와 함께", () => {
    const startDefault = (
      main: Awaited<ReturnType<typeof loadMainWithAnalysisFakes>>,
      workerEnvRecord: Record<string, string | undefined>,
    ) =>
      main.startWorker(workerEnvRecord, {
        ...main.defaultWorkerDeps,
        checkReadiness: async () => undefined,
        startHeartbeat: () => ({ stop: () => undefined }),
      });

    // SOL_RUN_MODE 는 ingest 1단계도 막으므로 analysis 만 읽는 두 키로 본다.
    it.each([
      ["ANALYSIS_RECONCILE_INTERVAL_MS", "0"],
      ["AI_GATEWAY_URL", "ftp://gw.test"],
    ])("%s 가 틀리면 Redis 연결·Worker 를 만들기 전에 기동을 멈춘다", async (key, value) => {
      const main = await loadMainWithAnalysisFakes();
      await expect(startDefault(main, { ...analysisEnv, [key]: value })).rejects.toThrow(key);
      expect(analysisFakes.redis).toEqual([]);
      expect(analysisFakes.workers).toEqual([]);
    });

    it("system·ingest Worker 와 함께 analysis Worker 를 만든다", async () => {
      const main = await loadMainWithAnalysisFakes();
      opened.push(await startDefault(main, analysisEnv));
      expect(analysisFakes.workers.map((worker) => worker.queueName).toSorted()).toEqual([
        "analysis",
        "ingest",
        "system",
      ]);
    });

    it("close 는 analysis 복제 연결을 먼저 끊고 공유 연결은 마지막에 한 번만 끊는다", async () => {
      const main = await loadMainWithAnalysisFakes();
      const handle = await startDefault(main, analysisEnv);
      await handle.close();
      const shared = analysisFakes.redis[0];
      expect(shared?.duplicates).not.toEqual([]);
      expect(analysisFakes.log).toEqual([
        ...(shared?.duplicates ?? []).map((copy) => `disconnect:${copy.label}`),
        `disconnect:${shared?.label}`,
      ]);
    });
  });
});
