import { describe, expect, it } from "vitest";
import {
  getManualIngestGate,
  requestIngestionRun,
  type IngestionAdminContext,
  type IngestionAdminDeps,
  type IngestionIdempotencyRecord,
} from "./ingestion-admin.service";
import type { IngestJobData } from "./ingestion.queue";
import { createMemoryManualIngestGate } from "./manual-ingest-gate.memory";
import type { IngestSchedulerState } from "./manual-ingest-gate.model";

// 수동 수집 gate(사용자 1시간·전역 10분·하루 20회)와 정기 일정 확인. 메모리 gate 로 서비스 흐름만 본다.
// Redis Lua 의 원자성은 격리 Redis 로 따로 확인한다(보고서의 gate-it 결과).

const ORG = "11111111-1111-4111-8111-111111111111";
const ctxOf = (
  userId: string,
  role: IngestionAdminContext["role"] = "ADMIN",
): IngestionAdminContext => ({
  orgId: ORG,
  userId,
  role,
});
const userId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const ALICE = ctxOf(userId(1));
const BOB = ctxOf(userId(2));
const kst = (local: string) => new Date(`${local}:00+09:00`);
const g2b = { source: "g2b" };
const bodyOf = (value: unknown) => ({
  declaredTooLarge: false,
  read: async () => ({ ok: true as const, value }),
});

type Setup = {
  runMode?: IngestionAdminDeps["runMode"];
  scheduler?: IngestSchedulerState | Error;
  running?: { id: string } | null;
};

function setup(options: Setup = {}) {
  let now = kst("2026-10-26T13:10");
  let ids = 0;
  let schedulerReads = 0;
  const jobs: IngestJobData[] = [];
  const records = new Map<string, IngestionIdempotencyRecord>();
  const queue = { fail: false };
  const gate = createMemoryManualIngestGate();
  const deps: IngestionAdminDeps = {
    runMode: options.runMode ?? "live",
    now: () => now,
    newId: () => `33333333-3333-4333-8333-${String(++ids).padStart(12, "0")}`,
    cursor: null,
    repo: {
      listRuns: async () => [],
      findRun: async () => null,
      listErrors: async () => [],
      findRunningRun: async () => options.running ?? null,
      findMemberNames: async (_org, users) => new Map(users.map((id) => [id, "담당자"])),
      findManualRequesters: async () => new Map(),
    },
    queue: {
      enqueue: async (job) => {
        if (queue.fail) throw new Error("queue down");
        jobs.push(job);
      },
    },
    idempotency: {
      get: async (key) => records.get(key) ?? null,
      // SET NX: 있으면 false
      claim: async (key, record) => {
        if (records.has(key)) return false;
        records.set(key, record);
        return true;
      },
      release: async (key) => {
        records.delete(key);
      },
    },
    limiter: { hit: async () => ({ allowed: true }) },
    manualGate: gate,
    scheduler: {
      read: async () => {
        schedulerReads += 1;
        const state = options.scheduler ?? {
          active: true,
          nextRunAt: "2026-10-26T06:00:00.000Z",
        };
        if (state instanceof Error) throw state;
        return state;
      },
    },
  };
  return {
    deps,
    gate,
    jobs,
    records,
    queue,
    schedulerReads: () => schedulerReads,
    at: (local: string) => {
      now = kst(local);
    },
    ask: (ctx: IngestionAdminContext, key: string, value: unknown = g2b) =>
      requestIngestionRun(ctx, bodyOf(value), key, deps),
  };
}

describe("수동 수집 사용자 쿨다운(1시간)", () => {
  it("13:10 접수 → 13:30 429(14:10 KST 까지) → 14:10 부터 다시 접수", async () => {
    const test = setup();
    expect(await test.ask(ALICE, "k1")).toMatchObject({ ok: true, status: 202 });

    test.at("2026-10-26T13:30");
    expect(await test.ask(ALICE, "k2")).toEqual({
      ok: false,
      status: 429,
      code: "MANUAL_COOLDOWN",
      message: "1시간에 한 번만 불러올 수 있습니다",
      details: { nextAvailableAt: "2026-10-26T05:10:00.000Z", retryAfterSeconds: 2400 },
    });

    test.at("2026-10-26T14:10");
    expect(await test.ask(ALICE, "k3")).toMatchObject({ ok: true, status: 202 });
    expect(test.jobs).toHaveLength(2);
    expect(test.gate.dailyCount("20261026")).toBe(2);
  });

  it("같은 사용자가 다른 키로 동시에 두 번 눌러도 하나만 접수한다", async () => {
    const test = setup();
    const results = await Promise.all([test.ask(ALICE, "tab-1"), test.ask(ALICE, "tab-2")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      status: 429,
      code: "MANUAL_COOLDOWN",
    });
    expect(test.jobs).toHaveLength(1);
  });

  it("같은 키 더블클릭이 gate 에서 막혀도 먼저 접수된 기록이 있으면 그 202 를 재현한다", async () => {
    const test = setup();
    const first = await test.ask(ALICE, "same-key");
    expect(first).toMatchObject({ ok: true, status: 202 });
    // 두 번째 요청이 첫 요청의 키 기록보다 먼저 읽은 경우(경합)를 만든다: 첫 읽기만 비어 있다.
    const get = test.deps.idempotency.get;
    let firstRead = true;
    test.deps.idempotency.get = async (key) => {
      if (firstRead) {
        firstRead = false;
        return null;
      }
      return get(key);
    };
    const second = await test.ask(ALICE, "same-key");
    expect(second).toEqual(first);
    expect(test.jobs).toHaveLength(1);
  });
});

describe("전역 공유 실행(10분)", () => {
  it("다른 사용자의 동시 요청 중 하나만 접수하고, 나머지는 그 run 을 알려 준다", async () => {
    const test = setup();
    const [a, b] = await Promise.all([test.ask(ALICE, "a"), test.ask(BOB, "b")]);
    const winner = [a, b].find((result) => result.ok);
    const loser = [a, b].find((result) => !result.ok);
    expect(winner).toMatchObject({ ok: true, status: 202 });
    const runId = winner?.ok ? winner.data.id : null;
    expect(loser).toEqual({
      ok: false,
      status: 409,
      code: "MANUAL_SHARED_RUN",
      message: "다른 수동 수집이 방금 접수됐습니다",
      details: {
        runId,
        requestedAt: "2026-10-26T04:10:00.000Z",
        nextAvailableAt: "2026-10-26T04:20:00.000Z",
        retryAfterSeconds: 600,
        mine: false,
      },
    });
    expect(test.jobs).toHaveLength(1);
    // 응답에는 접수한 다른 사용자의 id 가 실리지 않는다(mine 불리언만).
    expect(JSON.stringify(loser)).not.toContain(winner === a ? ALICE.userId : BOB.userId);
  });

  it("10분이 지나면 다른 사용자는 접수된다", async () => {
    const test = setup();
    expect(await test.ask(ALICE, "a")).toMatchObject({ ok: true });
    test.at("2026-10-26T13:20");
    expect(await test.ask(BOB, "b")).toMatchObject({ ok: true, status: 202 });
  });
});

describe("하루 상한(한국시간 날짜당 20회)", () => {
  it("20번째까지 접수하고 21번째는 429, 한국시간 자정이 지나면 다시 받는다", async () => {
    const test = setup();
    for (let n = 0; n < 20; n += 1) {
      // 공유 실행 창(10분)을 피하려고 사람·시각을 바꾼다. 한국시간 00:05 부터 11분 간격(같은 날 03:34 까지)
      const minutes = 5 + n * 11;
      test.at(
        `2026-10-26T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
      );
      expect(await test.ask(ctxOf(userId(100 + n)), `d${n}`)).toMatchObject({ ok: true });
    }
    expect(test.gate.dailyCount("20261026")).toBe(20);

    test.at("2026-10-26T23:50");
    expect(await test.ask(ctxOf(userId(200)), "d20")).toEqual({
      ok: false,
      status: 429,
      code: "MANUAL_DAILY_LIMIT",
      message: "오늘 수동 수집 한도를 다 썼습니다",
      details: {
        limit: 20,
        nextAvailableAt: "2026-10-26T15:00:00.000Z",
        retryAfterSeconds: 600,
      },
    });

    test.at("2026-10-27T00:00");
    expect(await test.ask(ctxOf(userId(200)), "d21")).toMatchObject({ ok: true, status: 202 });
    expect(test.jobs).toHaveLength(21);
  });
});

describe("쿨다운이 남지 않는 실패", () => {
  it("큐 등록 실패는 503 이고 gate·멱등 키를 되돌려 같은 사용자가 바로 다시 요청할 수 있다", async () => {
    const test = setup();
    test.queue.fail = true;
    expect(await test.ask(ALICE, "q1")).toMatchObject({
      ok: false,
      status: 503,
      details: { component: "queue" },
    });
    expect(test.gate.dailyCount("20261026")).toBe(0);
    expect(test.records.size).toBe(0);

    test.queue.fail = false;
    expect(await test.ask(ALICE, "q1")).toMatchObject({ ok: true, status: 202 });
    expect(test.gate.dailyCount("20261026")).toBe(1);
  });

  it("권한 거부·검증 오류에는 쿨다운이 없다", async () => {
    const test = setup();
    expect(await test.ask(ctxOf(userId(1), "VIEWER"), "v1")).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(await test.ask(ALICE, "v2", { source: "g2b", unknown: true })).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(test.gate.dailyCount("20261026")).toBe(0);
    expect(await test.ask(ALICE, "v3")).toMatchObject({ ok: true, status: 202 });
  });

  it("같은 소스가 실행 중이면 409 INGESTION_IN_PROGRESS 이고 일정·gate 를 보지 않는다", async () => {
    const test = setup({ running: { id: "44444444-4444-4444-8444-444444444444" } });
    expect(await test.ask(ALICE, "r1")).toMatchObject({
      status: 409,
      code: "INGESTION_IN_PROGRESS",
    });
    expect(test.schedulerReads()).toBe(0);
    expect(test.gate.dailyCount("20261026")).toBe(0);
  });
});

describe("정기 일정(Job Scheduler) 전제", () => {
  it("g2b-scheduled 가 등록돼 있지 않으면 503 ingest-worker 이고 job·쿨다운이 없다", async () => {
    const test = setup({ scheduler: { active: false, nextRunAt: null } });
    expect(await test.ask(ALICE, "s1")).toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "수집 Worker 가 아직 켜지지 않았습니다",
      details: { component: "ingest-worker", reason: "SCHEDULER_INACTIVE" },
    });
    expect(test.jobs).toEqual([]);
    expect(test.gate.dailyCount("20261026")).toBe(0);
  });

  it("일정 읽기가 Redis 오류면 503 redis 이고 접수하지 않는다", async () => {
    const test = setup({ scheduler: new Error("redis down") });
    expect(await test.ask(ALICE, "s2")).toMatchObject({
      status: 503,
      details: { component: "redis" },
    });
    expect(test.jobs).toEqual([]);
  });

  it("gate 저장소 오류면 503 redis 이고 키·job 을 남기지 않는다(fail-closed)", async () => {
    const test = setup();
    test.deps.manualGate = {
      ...test.gate,
      claim: async () => {
        throw new Error("redis down");
      },
    };
    expect(await test.ask(ALICE, "s3")).toMatchObject({
      status: 503,
      details: { component: "redis" },
    });
    expect(test.records.size).toBe(0);
    expect(test.jobs).toEqual([]);
  });

  it("claim 이 Redis 에 반영된 뒤 응답만 시간 초과돼도 503 이고 쿨다운을 되돌린다", async () => {
    const test = setup();
    test.deps.manualGate = {
      ...test.gate,
      claim: async (input) => {
        await test.gate.claim(input);
        throw new Error("수동 수집 gate 잡기 시간 초과");
      },
    };
    expect(await test.ask(ALICE, "s4")).toMatchObject({
      status: 503,
      details: { component: "redis" },
    });
    expect(test.jobs).toEqual([]);
    const state = await test.gate.read({ userId: ALICE.userId, at: test.deps.now() });
    expect(state).toEqual({ user: null, shared: null, dailyUsed: 0 });
  });
});

describe("fixture(Compose 데모·E2E)는 gate 를 쓰지 않는다", () => {
  it("fixture 모드에서 같은 사용자가 연달아 요청해도 일정·gate 없이 접수한다", async () => {
    const test = setup({ runMode: "fixture", scheduler: { active: false, nextRunAt: null } });
    const seed = { source: "fixture", batch: "seed" };
    expect(await test.ask(ALICE, "f1", seed)).toMatchObject({ ok: true, status: 202 });
    expect(await test.ask(ALICE, "f2", { source: "fixture", batch: "live" })).toMatchObject({
      ok: true,
      status: 202,
    });
    expect(test.schedulerReads()).toBe(0);
    expect(test.gate.dailyCount("20261026")).toBe(0);
  });
});

describe("GET manual-gate 상태", () => {
  it("접수 뒤 이 사용자의 다음 가능 시각·공유 실행·오늘 사용량·정기 일정을 돌려준다", async () => {
    const test = setup();
    const accepted = await test.ask(ALICE, "g1");
    const runId = accepted.ok ? accepted.data.id : null;
    test.at("2026-10-26T13:15");
    expect(await getManualIngestGate(ALICE, test.deps)).toEqual({
      ok: true,
      status: 200,
      data: {
        cooldownMinutes: 60,
        nextAvailableAt: "2026-10-26T05:10:00.000Z",
        sharedRun: {
          runId,
          requestedAt: "2026-10-26T04:10:00.000Z",
          until: "2026-10-26T04:20:00.000Z",
          mine: true,
        },
        daily: { used: 1, limit: 20, resetsAt: "2026-10-26T15:00:00.000Z" },
        schedule: {
          pattern: "0 */3 * * *",
          timezone: "Asia/Seoul",
          slotHoursKst: [0, 3, 6, 9, 12, 15, 18, 21],
          active: true,
          nextRunAt: "2026-10-26T06:00:00.000Z",
        },
        ingestMode: "live",
        // Worker 상태 읽기를 주지 않았다(외부 서비스 상태 모름)
        services: null,
      },
    });
    // 같은 공유 실행도 다른 사용자에게는 mine false 이고, ALICE 의 id 는 싣지 않는다.
    const forBob = await getManualIngestGate(BOB, test.deps);
    expect(forBob).toMatchObject({
      ok: true,
      data: { nextAvailableAt: null, sharedRun: { runId, mine: false } },
    });
    expect(JSON.stringify(forBob)).not.toContain(ALICE.userId);
    // 다른 사용자에게는 쿨다운이 없고, 10분이 지나면 공유 실행도 없다.
    test.at("2026-10-26T13:21");
    expect(await getManualIngestGate(BOB, test.deps)).toMatchObject({
      ok: true,
      data: { nextAvailableAt: null, sharedRun: null, daily: { used: 1 } },
    });
  });

  it("ADMIN 이 아니면 403, Redis 오류면 503 redis 다", async () => {
    const test = setup({ scheduler: { active: false, nextRunAt: null } });
    expect(await getManualIngestGate(ctxOf(userId(9), "SALES"), test.deps)).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(await getManualIngestGate(ALICE, test.deps)).toMatchObject({
      ok: true,
      data: { schedule: { active: false, nextRunAt: null } },
    });
    const broken = setup({ scheduler: new Error("redis down") });
    expect(await getManualIngestGate(ALICE, broken.deps)).toMatchObject({
      status: 503,
      details: { component: "redis" },
    });
  });
});
