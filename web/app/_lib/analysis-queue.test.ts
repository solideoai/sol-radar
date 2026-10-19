import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalysisQueue,
  createQueueCache,
  describeQueueError,
  type QueueHandle,
} from "./analysis-queue";

afterEach(() => vi.useRealTimers());

const orgId = "11111111-1111-4111-8111-111111111111";
const scoreRunId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const job = { orgId, scoreRunId, idempotencyKey: `${orgId}:${requestId}` };

describe("createAnalysisQueue", () => {
  it("analyze job 을 run 단위 jobId 와 재시도 옵션으로 한 번 등록한다", async () => {
    const addJob = vi.fn().mockResolvedValue(undefined);
    const queue = createAnalysisQueue({ redisUrl: "redis://h:6379", addJob });
    await queue.enqueue(job);
    expect(addJob).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addJob.mock.calls[0] ?? [];
    expect(name).toBe("analyze");
    expect(data).toEqual(job);
    expect(opts.jobId).toBe(`analysis_${orgId}_${scoreRunId}`);
    expect(opts.attempts).toBe(3);
  });

  it("다른 조직 접두어의 키는 거부하고 등록하지 않는다", async () => {
    const addJob = vi.fn().mockResolvedValue(undefined);
    const queue = createAnalysisQueue({ redisUrl: "redis://h:6379", addJob });
    const other = "44444444-4444-4444-8444-444444444444";
    await expect(
      queue.enqueue({ orgId, scoreRunId, idempotencyKey: `${other}:${requestId}` }),
    ).rejects.toThrow();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("등록이 제한 시간을 넘기면 거부한다", async () => {
    vi.useFakeTimers();
    const addJob = vi.fn(() => new Promise<unknown>((resolve) => setTimeout(resolve, 5000)));
    const queue = createAnalysisQueue({ redisUrl: "redis://h:6379", addJob, timeoutMs: 50 });
    const result = expect(queue.enqueue(job)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await result;
  });

  it("Redis 주소가 없으면 거부한다", async () => {
    const queue = createAnalysisQueue({ redisUrl: undefined });
    await expect(queue.enqueue(job)).rejects.toThrow();
  });
});

function fakeQueues(addResults: Array<"ok" | "fail">) {
  const created: Array<
    QueueHandle & { add: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
  > = [];
  const factory = vi.fn((): QueueHandle => {
    const result = addResults[created.length] ?? "ok";
    const handle = {
      add: vi.fn(() =>
        result === "ok" ? Promise.resolve(undefined) : Promise.reject(new Error("redis down")),
      ),
      close: vi.fn(async () => {}),
    };
    created.push(handle);
    return handle;
  });
  return { created, factory };
}

describe("Queue 재사용", () => {
  it("enqueue 를 여러 번, createAnalysisQueue 를 두 번 불러도 Queue 는 한 번만 만든다", async () => {
    const { created, factory } = fakeQueues(["ok"]);
    const queueCache = createQueueCache(factory);
    const first = createAnalysisQueue({ redisUrl: "redis://h:6379", queueCache });
    const second = createAnalysisQueue({ redisUrl: "redis://h:6379", queueCache });
    await first.enqueue(job);
    await second.enqueue(job);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(created[0]?.add).toHaveBeenCalledTimes(2);
    expect(created[0]?.close).not.toHaveBeenCalled();
  });

  it("등록이 실패하면 그 Queue 를 닫고 버려 다음 호출이 새로 만든다", async () => {
    const { created, factory } = fakeQueues(["fail", "ok"]);
    const queue = createAnalysisQueue({
      redisUrl: "redis://h:6379",
      queueCache: createQueueCache(factory),
    });
    await expect(queue.enqueue(job)).rejects.toThrow("redis down");
    expect(created[0]?.close).toHaveBeenCalledTimes(1);
    await queue.enqueue(job);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(created[1]?.add).toHaveBeenCalledTimes(1);
  });

  it("제한 시간을 넘긴 등록도 Queue 를 버린다", async () => {
    vi.useFakeTimers();
    const hang: QueueHandle = {
      add: () => new Promise(() => {}),
      close: vi.fn(async () => {}),
    };
    const factory = vi.fn(() => hang);
    const queue = createAnalysisQueue({
      redisUrl: "redis://h:6379",
      timeoutMs: 50,
      queueCache: createQueueCache(factory),
    });
    const result = expect(queue.enqueue(job)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(hang.close).toHaveBeenCalledTimes(1);
  });
});

describe("describeQueueError", () => {
  it("메시지 안 접속 비밀을 가린다", () => {
    const text = describeQueueError(new Error("connect redis://:pw123@h:6380"));
    expect(text).not.toContain("pw123");
    expect(text).toContain("//***@");
  });
  it("Error 가 아닌 값도 문자열로 만든다", () => {
    expect(describeQueueError("redis://user:secret@h")).not.toContain("secret");
  });
  // 보안 L4: 비밀 안에 @·/ 가 있어도 스킴 뒤부터 마지막 @ 까지 가린다.
  it.each([
    ["redis://:p@ss@host:6379", ["p@ss", "ss@"]],
    ["redis://u:pa/ss@host:6379", ["pa/ss", "u:pa"]],
    ["rediss://user:a@b/c@d@host", ["a@b", "b/c", "c@d"]],
  ])("%s 의 비밀을 모두 가린다", (url, secrets) => {
    const text = describeQueueError(new Error(`connect ECONNREFUSED ${url} failed`));
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).toContain("//***@host");
    expect(text).toContain(" failed");
  });
  it("접속 정보가 없는 메시지는 그대로다", () => {
    expect(describeQueueError(new Error("connect ECONNREFUSED 127.0.0.1:6379"))).toBe(
      "connect ECONNREFUSED 127.0.0.1:6379",
    );
  });
});
