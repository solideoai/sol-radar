import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_INGEST_SUMMARY,
  createMemoryQuotaStore,
  type IngestionRepo,
  type StartRunInput,
  type IngestErrorInput,
} from "@/server/ingestion";
import { processIngestJob, type IngestJobDeps } from "./ingest-queue";

const job = {
  source: "kepco",
  serviceKey: "kepco-ebid-contract",
  trigger: "SCHEDULED",
  jobKey: "kepco-test",
  window: { from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z" },
};
function deps(mode: "mock" | "fixture" | "live", reason: string | null) {
  const errors: IngestErrorInput[] = [];
  const starts: StartRunInput[] = [];
  const repo: IngestionRepo = {
    startRun: async (run) => {
      starts.push(run);
      return {
        runId: "run-test",
        status: "RUNNING",
        cursor: null,
        summary: { ...EMPTY_INGEST_SUMMARY },
        params: null,
      };
    },
    findLatestRevision: async () => null,
    findLatestSeedAnchor: async () => null,
    findLatestRunWindow: async () => null,
    findLatestRunWindowEnd: async () => null,
    saveRevision: async () => {
      throw new Error("no save expected");
    },
    recordError: async (_runId, error) => {
      errors.push(error);
    },
    saveCheckpoint: async () => undefined,
    finishRun: async () => undefined,
  };
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("connector should not be created");
  };
  const input: IngestJobDeps = {
    repo,
    runMode: mode,
    createFixtureConnector: fail,
    createG2bConnector: fail,
    createExternalConnector: fail,
    externalSourceGate: () => reason,
    enqueueDocuments: async () => undefined,
    recordManualAudit: async () => undefined,
    now: () => new Date("2026-10-21T03:00:00.000Z"),
    retry: { sleep: async () => undefined, random: () => 0 },
    secrets: [],
  };
  return { repo, errors, starts, input, calls: () => calls };
}

describe("external ingest job gates", () => {
  it.each(["mock", "fixture"] as const)("keeps %s jobs off HTTP and quota paths", async (mode) => {
    const scenario = deps(mode, null);
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    const reserve = vi.spyOn(store, "reserve");
    scenario.input.quota = { store, serviceId: "15129394", dailyLimit: 1 };
    scenario.input.createFixtureConnector = async () => ({
      source: "fixture",
      fetchPage: async () => ({
        ok: true,
        page: { records: [], nextCursor: null, rateLimitInfo: null },
      }),
    });
    expect(
      (
        await processIngestJob(
          { source: "fixture", batch: "SEED", trigger: "DEMO", jobKey: mode },
          scenario.input,
        )
      ).status,
    ).toBe("SUCCEEDED");
    expect(
      (
        await processIngestJob(
          { source: "g2b", trigger: "SCHEDULED", jobKey: "blocked" },
          scenario.input,
        )
      ).status,
    ).toBe("FAILED");
    expect(scenario.calls()).toBe(0);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("rejects a live job without quota before constructing its connector", async () => {
    const scenario = deps("live", null);
    expect((await processIngestJob(job, scenario.input)).status).toBe("FAILED");
    expect(scenario.calls()).toBe(0);
    expect(scenario.errors.at(-1)?.errorCode).toBe("QUOTA_STORE_UNAVAILABLE");
  });

  it("keeps legacy G2B bid windows separate from procurement-request runs and tags new bid runs", async () => {
    const scenario = deps("mock", null);
    const scopes: Array<{ serviceKey?: string } | undefined> = [];
    scenario.repo.findLatestRunWindow = async (_source, _trigger, scope) => {
      scopes.push(scope);
      return { status: "SUCCEEDED", completeness: "COMPLETE", window: null };
    };
    scenario.repo.findLatestRunWindowEnd = async (_source, _trigger, scope) => {
      scopes.push(scope);
      return new Date(
        scope?.serviceKey === "g2b-bid-notice"
          ? "2026-10-20T01:00:00.000Z"
          : "2026-10-21T02:00:00.000Z",
      );
    };

    await processIngestJob(
      { source: "g2b", trigger: "SCHEDULED", jobKey: "legacy-bid" },
      scenario.input,
    );

    expect(scopes).toEqual([{ serviceKey: "g2b-bid-notice" }, { serviceKey: "g2b-bid-notice" }]);
    expect(scenario.starts[0]).toMatchObject({
      serviceKey: "g2b-bid-notice",
      operation: "getBidPblancListInfoServc",
      partitionKey: "all",
      jobKey: "g2b:SCHEDULED:2026-10-21T03:00:00.000Z",
      params: {
        window: { from: "2026-10-20T01:00:00.000Z", to: "2026-10-21T03:00:00.000Z" },
      },
    });
    expect(scenario.calls()).toBe(0);
  });
  it("rejects external jobs in mock before constructing a connector", async () => {
    const scenario = deps("mock", null);
    expect((await processIngestJob(job, scenario.input)).status).toBe("FAILED");
    expect(scenario.calls()).toBe(0);
    expect(scenario.errors.at(-1)?.errorCode).toBe("RUN_MODE_MISMATCH");
  });
  it.each(["DISABLED", "KEY_MISSING", "QUOTA_UNVERIFIED", "AUTH_FAILED"])(
    "records %s readiness in live without reading credentials or fetching",
    async (reason) => {
      const scenario = deps("live", reason);
      expect((await processIngestJob(job, scenario.input)).status).toBe("FAILED");
      expect(scenario.calls()).toBe(0);
      expect(scenario.errors.at(-1)?.errorCode).toBe(`SOURCE_${reason}`);
    },
  );
  it("reuses an unfinished scheduled window after a checkpoint instead of opening a new job", async () => {
    const scenario = deps("live", "DISABLED");
    const prior = { from: "2026-10-20T21:00:00.000Z", to: "2026-10-21T00:00:00.000Z" };
    scenario.repo.findLatestRunWindow = async () => ({
      status: "RUNNING",
      completeness: "COMPLETE",
      window: prior,
    });
    await processIngestJob(
      { source: "kepco", serviceKey: "kepco-ebid-contract", trigger: "SCHEDULED", jobKey: "retry" },
      scenario.input,
    );
    expect(scenario.starts[0].params?.window).toEqual(prior);
    expect(scenario.starts[0].jobKey).toBe(
      `kepco-ebid-contract:electContract:all:${prior.from}:${prior.to}`,
    );
  });
});

// 외부 정기 창(10-26 0순위): 지금 2026-10-21T03:00Z, 상한 24시간 → 가장 이른 시작은 2026-10-20T03:00Z.
describe("external scheduled window cap", () => {
  const NOW = "2026-10-21T03:00:00.000Z";
  const FLOOR = "2026-10-20T03:00:00.000Z";
  const recent = { from: "2026-10-20T21:00:00.000Z", to: "2026-10-21T00:00:00.000Z" };
  const old = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" };
  type Last = Awaited<ReturnType<IngestionRepo["findLatestRunWindow"]>>;
  it.each<[string, "kepco-ebid-contract" | "lh-bid-notice", Last, object, object | undefined]>([
    [
      "first run looks back 24 hours, not 90 days",
      "lh-bid-notice",
      null,
      { from: FLOOR, to: NOW },
      undefined,
    ],
    [
      "continues after a finished window without overlap",
      "lh-bid-notice",
      { status: "SUCCEEDED", completeness: "COMPLETE", window: recent },
      { from: recent.to, to: NOW },
      undefined,
    ],
    [
      "retries a truncated PARTIAL window inside the cap",
      "lh-bid-notice",
      { status: "PARTIAL", completeness: "PARTIAL", window: recent },
      recent,
      undefined,
    ],
    [
      "moves past a KEPCO PARTIAL window (coverage cannot become COMPLETE)",
      "kepco-ebid-contract",
      { status: "PARTIAL", completeness: "PARTIAL", window: recent },
      { from: recent.to, to: NOW },
      undefined,
    ],
    [
      "drops a failed window older than the cap and records the skipped range",
      "lh-bid-notice",
      { status: "FAILED", completeness: "UNKNOWN", window: old },
      { from: FLOOR, to: NOW },
      { maxMinutes: 1440, skippedFrom: old.from },
    ],
    [
      "caps a long gap after the last success",
      "kepco-ebid-contract",
      { status: "SUCCEEDED", completeness: "COMPLETE", window: old },
      { from: FLOOR, to: NOW },
      { maxMinutes: 1440, skippedFrom: old.to },
    ],
  ])("%s", async (_name, serviceKey, last, window, cap) => {
    const scenario = deps("live", "DISABLED");
    scenario.repo.findLatestRunWindow = async () => last;
    const source = serviceKey === "lh-bid-notice" ? "lh" : "kepco";
    await processIngestJob(
      { source, serviceKey, trigger: "SCHEDULED", jobKey: `${serviceKey}:SCHEDULED` },
      scenario.input,
    );
    expect(scenario.starts[0].params?.window).toEqual(window);
    expect(scenario.starts[0].params?.windowCap).toEqual(cap);
  });
});
