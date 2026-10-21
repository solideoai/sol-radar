import { describe, expect, it } from "vitest";
import { parseDependencyReport } from "@/server/health";
import { createDependencyReporter } from "@/worker/dependency-health";

describe("Worker dependency readiness", () => {
  const scope = {
    runMode: "mock",
    supabaseUrl: "https://db.test",
    rawBucket: "bid-documents",
    parsedBucket: "bid-parsed",
  };
  it("publishes real probe failures and expires stale or differently scoped reports", async () => {
    const records: string[] = [];
    let storageOk = true;
    const reporter = createDependencyReporter({
      scope,
      now: () => 1_000_000,
      storage: async () => {
        if (!storageOk) throw new Error("private secret");
      },
      ai: async () => "mock",
      publish: async (value) => {
        records.push(value);
      },
    });
    await reporter.run();
    expect(parseDependencyReport(records[0], scope, 1_000_000)?.storage).toBe("ok");
    expect(parseDependencyReport(records[0], scope, 1_120_001)).toBeNull();
    expect(parseDependencyReport(records[0], { ...scope, runMode: "live" }, 1_000_000)).toBeNull();
    storageOk = false;
    await reporter.run();
    expect(parseDependencyReport(records[1], scope, 1_000_000)?.storage).toBe("unavailable");
    expect(records[1]).not.toContain("secret");
  });
  it("a failed or hung probe cannot publish fresh success, and report parser rejects forged shapes/future times", async () => {
    expect(parseDependencyReport(null, scope, 0)).toBeNull();
    expect(parseDependencyReport('{"storage":"ok"}', scope, 0)).toBeNull();
    const values: string[] = [];
    const reporter = createDependencyReporter({
      scope,
      now: () => 1_000_000,
      timeoutMs: 5,
      storage: () => new Promise<void>(() => {}),
      ai: async () => "unavailable",
      publish: async (value) => {
        values.push(value);
      },
    });
    await reporter.run();
    expect(parseDependencyReport(values[0], scope, 1_000_000)?.storage).toBe("unavailable");
    expect(parseDependencyReport(values[0], scope, 900_000)).toBeNull();
  });
});
