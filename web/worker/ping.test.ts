import { describe, expect, it } from "vitest";
import { PING_JOB_OPTIONS, withDeadline } from "@/worker/ping";

describe("withDeadline", () => {
  it("끝나지 않는 작업은 제한 시간에 reject 한다", async () => {
    await expect(withDeadline(new Promise<void>(() => undefined), 20)).rejects.toThrow(
      "ping timeout",
    );
  });

  it("제한 안에 끝나면 값을 돌려준다", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe("PING_JOB_OPTIONS", () => {
  it("완료·실패 job 을 즉시 지우지 않고 60초 뒤 지운다", () => {
    expect(PING_JOB_OPTIONS).toEqual({
      removeOnComplete: { age: 60 },
      removeOnFail: { age: 60 },
    });
  });
});
