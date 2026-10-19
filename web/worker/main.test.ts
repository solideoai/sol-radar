import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { defaultWorkerDeps, errorCode, startWorker, type WorkerDeps } from "@/worker/main";

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
};
const bull = { workers: [] as FakeWorker[], queues: [] as FakeQueue[] };

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
  vi.doMock("bullmq", () => {
    class Worker {
      readonly close = vi.fn(async () => undefined);
      readonly on = vi.fn();
      constructor(queueName: string) {
        bull.workers.push({ queueName, close: this.close });
      }
    }
    class Queue {
      readonly upsertJobScheduler = vi.fn<(...args: unknown[]) => Promise<undefined>>(
        async () => undefined,
      );
      readonly add = vi.fn(async () => undefined);
      readonly close = vi.fn(async () => undefined);
      readonly on = vi.fn();
      constructor(queueName: string) {
        bull.queues.push({ queueName, upsertJobScheduler: this.upsertJobScheduler });
      }
    }
    return { Worker, Queue };
  });
  vi.doMock("ioredis", () => {
    class Redis {
      readonly disconnect = vi.fn();
      readonly quit = vi.fn(async () => "OK");
      readonly on = vi.fn();
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
});
