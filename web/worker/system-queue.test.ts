import { describe, expect, it } from "vitest";
import { PING_JOB, SYSTEM_QUEUE, processSystemJob } from "@/worker/system-queue";

describe("processSystemJob", () => {
  it("큐 이름과 job 이름 상수를 고정한다", () => {
    expect(SYSTEM_QUEUE).toBe("system");
    expect(PING_JOB).toBe("ping");
  });

  it("ping 에 pong 으로 답한다", async () => {
    await expect(processSystemJob({ name: "ping" })).resolves.toEqual({ pong: true });
  });

  it("모르는 job 이름은 거부한다", async () => {
    await expect(processSystemJob({ name: "nope" })).rejects.toThrow("unknown system job: nope");
  });
});
