import { describe, expect, it } from "vitest";
import { withDeadline } from "@/worker/ping";

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
