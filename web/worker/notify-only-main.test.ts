import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultNotifyOnlyDeps,
  runNotifyOnly,
  type NotifyOnlyDeps,
} from "@/worker/notify-only-main";

// notify 전용 worker 는 live 에서만 뜨고, 알림 두 등록(outbox·마감)만 돌린다.
// BullMQ·ioredis·service role 클라이언트는 가짜다. 실제 Redis·Supabase·카카오는 부르지 않는다.
// fake.bullmq 는 만든 BullMQ Worker·Queue 이름, fake.tables·fake.rpcs 는 service role 클라이언트가 받은 표·함수 이름이다.
type FakeQuery = {
  select(): FakeQuery;
  in(): FakeQuery;
  or(): FakeQuery;
  order(): FakeQuery;
  limit(): Promise<{ data: never[]; error: null }>;
};
const fake = vi.hoisted(() => {
  const state = {
    bullmq: [] as string[],
    tables: [] as string[],
    rpcs: [] as string[],
    redisDisconnects: 0,
  };
  // findDue 의 from().select().in().or().order().order().limit() 를 받는다. 이벤트는 0건이다.
  const query: FakeQuery = {
    select: () => query,
    in: () => query,
    or: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  const admin = {
    from: (table: string) => {
      state.tables.push(table);
      return query;
    },
    rpc: async (fn: string) => {
      state.rpcs.push(fn);
      return { data: 0, error: null };
    },
  };
  return { state, admin };
});

vi.mock("bullmq", async (importOriginal) => {
  class Worker {
    readonly on = vi.fn();
    readonly close = vi.fn(async () => undefined);
    constructor(name: string) {
      fake.state.bullmq.push(`Worker:${name}`);
    }
  }
  class Queue {
    readonly on = vi.fn();
    readonly close = vi.fn(async () => undefined);
    constructor(name: string) {
      fake.state.bullmq.push(`Queue:${name}`);
    }
  }
  return { ...(await importOriginal<typeof import("bullmq")>()), Worker, Queue };
});

vi.mock("ioredis", async (importOriginal) => {
  class Redis {
    readonly on = vi.fn();
    readonly disconnect = vi.fn(() => {
      fake.state.redisDisconnects += 1;
    });
  }
  return { ...(await importOriginal<typeof import("ioredis")>()), default: Redis, Redis };
});

vi.mock("@/server/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/supabase")>()),
  getSupabaseAdmin: () => fake.admin,
}));

const SERVICE_ROLE_KEY = "sk-test-SECRET-123";
const liveEnv = {
  SOL_RUN_MODE: "live",
  REDIS_URL: "redis://redis.test:6379",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  // 기동 때 지우는 heartbeat 파일을 시험 전용 경로로 둔다.
  WORKER_HEARTBEAT_FILE: path.join(tmpdir(), `notify-only-test-heartbeat-${process.pid}`),
};

function testDeps(workerDeps: NotifyOnlyDeps["workerDeps"] = defaultNotifyOnlyDeps.workerDeps) {
  const signals = new EventEmitter();
  const checkReadiness = vi.fn(async () => undefined);
  const createWorker = vi.fn(workerDeps.createWorker);
  const deps: NotifyOnlyDeps = {
    workerDeps: { checkReadiness, createWorker, startHeartbeat: () => ({ stop: () => undefined }) },
    onSignal: (signal, listener) => {
      signals.once(signal, listener);
    },
    exit: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
  };
  return { deps, signals, checkReadiness, createWorker };
}

afterEach(() => {
  vi.restoreAllMocks();
  fake.state.bullmq.length = 0;
  fake.state.tables.length = 0;
  fake.state.rpcs.length = 0;
  fake.state.redisDisconnects = 0;
});

describe("notify 전용 worker", () => {
  it.each([
    ["모르는 인자", ["--once"], liveEnv, "사용법"],
    ["mock 모드", [], { ...liveEnv, SOL_RUN_MODE: "mock" }, "SOL_RUN_MODE=live"],
    [
      "memo 키 누락",
      [],
      { ...liveEnv, NOTIFY_KAKAO_PROVIDER: "memo", KAKAO_REST_API_KEY: "kakao-SECRET-456" },
      "KAKAO_CLIENT_SECRET",
    ],
  ])("%s 이면 연결하지 않고 exit 1, 값은 싣지 않는다", async (_label, argv, env, expected) => {
    const { deps, checkReadiness, createWorker } = testDeps();
    await runNotifyOnly(argv, env, deps);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
    const output = vi.mocked(deps.logError).mock.calls.flat().join("\n");
    expect(output).toContain(expected);
    expect(output).not.toContain("kakao-SECRET-456");
    expect(output).not.toContain(SERVICE_ROLE_KEY);
  });

  it("--check 는 설정만 읽고 Redis·Supabase·카카오를 부르지 않는다. 빈 발송 수단은 꺼짐이다", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { deps, checkReadiness, createWorker } = testDeps();
    await runNotifyOnly(["--check"], liveEnv, deps);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect([...fake.state.tables, ...fake.state.rpcs]).toEqual([]);
    const output = vi.mocked(deps.log).mock.calls.flat().join("\n");
    expect(output).toContain("카카오 발송: 꺼짐");
    expect(output).toContain("notify-only worker 확인 통과");
    expect(output).not.toContain(SERVICE_ROLE_KEY);
  });

  it("기동하면 outbox·마감 두 회차만 돌고 큐 소비자는 만들지 않는다. 종료 신호가 둘 와도 한 번만 닫는다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, signals, checkReadiness } = testDeps();
    await runNotifyOnly([], liveEnv, deps);

    expect(deps.logError).not.toHaveBeenCalled();
    expect(checkReadiness).toHaveBeenCalledTimes(1);
    expect(fake.state.bullmq).toEqual([]);
    expect(fake.state.tables).toEqual(["outbox_events"]);
    expect(fake.state.rpcs).toEqual(["send_deadline_reminders"]);

    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(fake.state.redisDisconnects).toBe(1);
  });
});
