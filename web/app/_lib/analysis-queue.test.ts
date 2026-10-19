import { describe, expect, it, vi } from "vitest";
import { createAnalysisQueue, describeQueueError } from "./analysis-queue";

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
    const addJob = vi.fn(() => new Promise<unknown>((resolve) => setTimeout(resolve, 5000)));
    const queue = createAnalysisQueue({ redisUrl: "redis://h:6379", addJob, timeoutMs: 50 });
    await expect(queue.enqueue(job)).rejects.toThrow();
  });

  it("Redis 주소가 없으면 거부한다", async () => {
    const queue = createAnalysisQueue({ redisUrl: undefined });
    await expect(queue.enqueue(job)).rejects.toThrow();
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
});
