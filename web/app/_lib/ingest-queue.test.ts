import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobQueue } from "@/server/ingestion";
import { createIngestQueue } from "./ingest-queue";

// 수동 수집(N8) "ingest" 큐 producer(계획 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1 10번, §2 ingest-queue.ts).
// analysis-queue.test.ts 관례: 주입한 가짜 큐로 job 모양·제한 시간을, 가짜 bullmq Queue 로 URL 당 캐시·실패 시 버리기를 본다.
// 실제 Redis·BullMQ 에 붙지 않는다.

type FakeBullQueue = {
  name: string;
  connection: unknown;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

// 만들어진 가짜 Queue(FakeBullQueue 모양). vi.hoisted 안에서는 바깥 형 별칭을 쓸 수 없어 모양을 다시 적는다.
const bull = vi.hoisted(() => ({
  instances: [] as {
    name: string;
    connection: unknown;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }[],
  // 만들어지는 Queue 차례대로의 add 동작(없으면 ok)
  plan: [] as ("ok" | "fail" | "hang")[],
}));

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    connection: unknown;
    add: ReturnType<typeof vi.fn>;
    close = vi.fn(async () => {});
    on = vi.fn();
    constructor(name: string, opts: { connection: unknown }) {
      this.name = name;
      this.connection = opts.connection;
      const behavior = bull.plan[bull.instances.length] ?? "ok";
      this.add = vi.fn(() =>
        behavior === "ok"
          ? Promise.resolve({ id: "job" })
          : behavior === "fail"
            ? Promise.reject(new Error("redis down"))
            : new Promise(() => {}),
      );
      bull.instances.push(this);
    }
  },
}));
vi.mock("./redis-client", () => ({
  sharedRedis: vi.fn((url: string) => ({ sharedConnectionFor: url })),
}));

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const RUN_ID = "a8000000-0000-4000-8000-000000000001";
const REQUEST_ID = "3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c";
const NOW = new Date("2026-10-20T03:04:05.000Z");
const JOB_KEY = `manual:${ORG_ID}:${REQUEST_ID}`;

// Route Handler 가 넣는 fixture 수동 수집 job(계획 §1 10번)
const FIXTURE_JOB = {
  source: "fixture" as const,
  batch: "SEED" as const,
  trigger: "MANUAL" as const,
  jobKey: JOB_KEY,
  idempotencyKey: `${ORG_ID}:${REQUEST_ID}`,
  requestedBy: USER_ID,
  orgId: ORG_ID,
  runId: RUN_ID,
};
const G2B_JOB = {
  source: "g2b" as const,
  window: { from: "2026-10-15T00:00:00Z", to: "2026-10-16T00:00:00Z" },
  trigger: "MANUAL" as const,
  jobKey: JOB_KEY,
  idempotencyKey: `${ORG_ID}:${REQUEST_ID}`,
  requestedBy: USER_ID,
  orgId: ORG_ID,
  runId: RUN_ID,
};

// job 스키마(strict·MANUAL 요청자·runId UUID·window 미래 5분)를 어기는 data. 형을 일부러 깨므로 unknown 으로 넘긴다.
const INVALID_JOBS: [string, unknown][] = [
  ["MANUAL 에 requestedBy 없음", { ...FIXTURE_JOB, requestedBy: undefined }],
  ["MANUAL 에 orgId 없음", { ...FIXTURE_JOB, orgId: undefined }],
  ["stages 같은 모르는 키", { ...G2B_JOB, stages: ["NOTICE"] }],
  ["fixture 에 batch 없음", { ...FIXTURE_JOB, batch: undefined }],
  ["runId 가 UUID 아님", { ...FIXTURE_JOB, runId: "run-1" }],
  [
    "window.to 가 지금보다 5분 넘게 미래",
    { ...G2B_JOB, window: { from: "2026-10-19T00:00:00Z", to: "2026-10-20T03:09:05.001Z" } },
  ],
];

const asJob = (data: unknown) =>
  data as Parameters<ReturnType<typeof createIngestQueue>["enqueue"]>[0];
const never = <T>() => new Promise<T>(() => {});
const fakeAdd = () => vi.fn<JobQueue["add"]>(async () => undefined);

let urlCount = 0;
// Queue 캐시는 모듈에 하나라 시험마다 다른 주소를 써서 서로 섞이지 않게 한다.
const freshUrl = () => {
  urlCount += 1;
  return `redis://cache-${urlCount}:6379`;
};
const queuesFor = (url: string): FakeBullQueue[] =>
  bull.instances.filter(
    (queue) => (queue.connection as { sharedConnectionFor: string }).sharedConnectionFor === url,
  );

beforeEach(() => {
  bull.instances.length = 0;
  bull.plan.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("createIngestQueue — 주입한 큐", () => {
  it('정상 data 는 이름 "run"·jobId encodeURIComponent(jobKey) 로 한 번 넣는다', async () => {
    const add = fakeAdd();
    const queue = createIngestQueue({ redisUrl: undefined, queue: { add }, now: () => NOW });

    await queue.enqueue(FIXTURE_JOB);

    expect(add.mock.calls).toEqual([["run", FIXTURE_JOB, { jobId: encodeURIComponent(JOB_KEY) }]]);
  });

  it("jobId 에는 ':' 가 없다(BullMQ 사용자 jobId 제약)", async () => {
    const add = fakeAdd();
    const queue = createIngestQueue({ redisUrl: undefined, queue: { add }, now: () => NOW });

    await queue.enqueue(FIXTURE_JOB);

    const opts = add.mock.calls[0]?.[2] as { jobId: string } | undefined;
    expect(opts?.jobId).not.toContain(":");
  });

  it("g2b 수동 수집 data 의 window·runId 를 그대로 싣는다", async () => {
    const add = fakeAdd();
    const queue = createIngestQueue({ redisUrl: undefined, queue: { add }, now: () => NOW });

    await queue.enqueue(G2B_JOB);

    expect(add.mock.calls[0]?.[1]).toEqual(G2B_JOB);
  });

  it.each(INVALID_JOBS)("job 스키마를 어기면(%s) 큐에 넣기 전에 던진다", async (_label, data) => {
    const add = fakeAdd();
    const queue = createIngestQueue({ redisUrl: undefined, queue: { add }, now: () => NOW });

    await expect(queue.enqueue(asJob(data))).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });

  it("window.to 가 지금 + 5분이면 받는다(경계)", async () => {
    const add = fakeAdd();
    const queue = createIngestQueue({ redisUrl: undefined, queue: { add }, now: () => NOW });
    const window = { from: "2026-10-19T00:00:00Z", to: "2026-10-20T03:09:05.000Z" };

    await queue.enqueue({ ...G2B_JOB, window });

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("add 가 던지면 enqueue 도 같은 오류로 던진다", async () => {
    const queue = createIngestQueue({
      redisUrl: undefined,
      queue: { add: vi.fn(async () => Promise.reject(new Error("redis down"))) },
      now: () => NOW,
    });

    await expect(queue.enqueue(FIXTURE_JOB)).rejects.toThrow("redis down");
  });

  it("add 가 기본 제한 3000ms 안에 끝나지 않으면 던진다(2999ms 에는 아직 기다린다)", async () => {
    vi.useFakeTimers();
    const queue = createIngestQueue({
      redisUrl: undefined,
      queue: { add: vi.fn(() => never()) },
      now: () => NOW,
    });
    const settled = vi.fn();

    const enqueued = queue.enqueue(FIXTURE_JOB);
    enqueued.then(settled, settled);
    const result = expect(enqueued).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
  });
});

describe("createIngestQueue — Queue 캐시", () => {
  it("Redis 주소가 없으면 Queue 를 만들지 않고 던진다", async () => {
    const queue = createIngestQueue({ redisUrl: undefined, now: () => NOW });

    await expect(queue.enqueue(FIXTURE_JOB)).rejects.toThrow();
    expect(bull.instances).toHaveLength(0);
  });

  it('"ingest" 큐를 공용 연결로 한 번만 만들고 여러 producer·여러 enqueue 가 함께 쓴다', async () => {
    const url = freshUrl();
    const first = createIngestQueue({ redisUrl: url, now: () => NOW });
    const second = createIngestQueue({ redisUrl: url, now: () => NOW });

    await first.enqueue(FIXTURE_JOB);
    await second.enqueue(FIXTURE_JOB);

    const created = queuesFor(url);
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe("ingest");
    expect(created[0]?.add).toHaveBeenCalledTimes(2);
    expect(created[0]?.add).toHaveBeenCalledWith("run", FIXTURE_JOB, {
      jobId: encodeURIComponent(JOB_KEY),
    });
    expect(created[0]?.close).not.toHaveBeenCalled();
  });

  it("add 가 실패하면 그 Queue 를 닫고 버려 다음 enqueue 가 새로 만든다", async () => {
    const url = freshUrl();
    bull.plan.push("fail", "ok");
    const queue = createIngestQueue({ redisUrl: url, now: () => NOW });

    await expect(queue.enqueue(FIXTURE_JOB)).rejects.toThrow("redis down");
    expect(queuesFor(url)[0]?.close).toHaveBeenCalledTimes(1);

    await queue.enqueue(FIXTURE_JOB);
    const created = queuesFor(url);
    expect(created).toHaveLength(2);
    expect(created[1]?.add).toHaveBeenCalledTimes(1);
  });

  it("add 가 제한 시간을 넘겨도 Queue 를 닫고 버린다", async () => {
    vi.useFakeTimers();
    const url = freshUrl();
    bull.plan.push("hang", "ok");
    const queue = createIngestQueue({ redisUrl: url, timeoutMs: 50, now: () => NOW });

    const result = expect(queue.enqueue(FIXTURE_JOB)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(queuesFor(url)[0]?.close).toHaveBeenCalledTimes(1);

    await queue.enqueue(FIXTURE_JOB);
    expect(queuesFor(url)).toHaveLength(2);
  });

  it.each(INVALID_JOBS)(
    "job 스키마를 어긴 data(%s)는 멀쩡한 Queue 를 버리지 않고, 다음 정상 data 가 같은 Queue 를 쓴다",
    async (_label, data) => {
      const url = freshUrl();
      const queue = createIngestQueue({ redisUrl: url, now: () => NOW });
      await queue.enqueue(FIXTURE_JOB);

      await expect(queue.enqueue(asJob(data))).rejects.toThrow();
      await queue.enqueue(FIXTURE_JOB);

      const created = queuesFor(url);
      expect(created).toHaveLength(1);
      expect(created[0]?.close).not.toHaveBeenCalled();
      expect(created[0]?.add).toHaveBeenCalledTimes(2);
    },
  );

  it("첫 data 가 스키마를 어기면 Queue 를 만들지도 않는다", async () => {
    const url = freshUrl();
    const queue = createIngestQueue({ redisUrl: url, now: () => NOW });

    await expect(queue.enqueue(asJob({ ...FIXTURE_JOB, runId: "run-1" }))).rejects.toThrow();

    expect(queuesFor(url)).toHaveLength(0);
  });

  it("Queue 의 error 이벤트는 접속 비밀을 가린 한 줄로만 남긴다", async () => {
    const url = freshUrl();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await createIngestQueue({ redisUrl: url, now: () => NOW }).enqueue(FIXTURE_JOB);
    const onCall = queuesFor(url)[0]?.on.mock.calls.find(([event]) => event === "error");
    const handler = onCall?.[1] as ((error: Error) => void) | undefined;

    handler?.(new Error("connect redis://user:s3cret@redis:6379 refused"));

    expect(handler).toBeTypeOf("function");
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).not.toContain("s3cret");
    expect(JSON.parse(line)).toMatchObject({ event: "ingest_queue_error" });
    log.mockRestore();
  });
});
