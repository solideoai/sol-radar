import { describe, expect, it } from "vitest";
import {
  requestIngestionRun,
  type IngestionAdminDeps,
  type IngestionIdempotencyRecord,
} from "./ingestion-admin.service";
import type { IngestJobData } from "./ingestion.queue";
import { createMemoryManualIngestGate } from "./manual-ingest-gate.memory";

const ctx = {
  orgId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "ADMIN" as const,
};
const input = {
  source: "kepco",
  serviceKey: "kepco-ebid-contract",
  companyId: "COM01",
  window: { from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z" },
};
const body = { declaredTooLarge: false, read: async () => ({ ok: true as const, value: input }) };
function setup(runMode: "mock" | "live", ready?: IngestionAdminDeps["serviceReady"]) {
  const jobs: IngestJobData[] = [];
  let claims = 0;
  const records = new Map<string, IngestionIdempotencyRecord>();
  const deps: IngestionAdminDeps = {
    runMode,
    now: () => new Date("2026-10-21T03:00:00.000Z"),
    newId: () => "33333333-3333-4333-8333-333333333333",
    cursor: null,
    repo: {
      listRuns: async () => [],
      findRun: async () => null,
      listErrors: async () => [],
      findRunningRun: async () => null,
      findMemberNames: async () => new Map([[ctx.userId, "담당자"]]),
      findManualRequesters: async () => new Map(),
    },
    queue: {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    idempotency: {
      get: async (key) => records.get(key) ?? null,
      claim: async (key, record) => {
        claims++;
        records.set(key, record);
        return true;
      },
      release: async (key) => {
        records.delete(key);
      },
    },
    limiter: { hit: async () => ({ allowed: true }) },
    serviceReady: ready,
    manualGate: createMemoryManualIngestGate(),
    scheduler: { read: async () => ({ active: true, nextRunAt: "2026-10-21T06:00:00.000Z" }) },
  };
  return { deps, jobs, claims: () => claims };
}
describe("external manual ingestion readiness", () => {
  it("defaults closed before claiming idempotency or enqueuing a new service", async () => {
    const test = setup("live");
    expect(await requestIngestionRun(ctx, body, "external-1", test.deps)).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "source", reason: "NOT_VERIFIED" },
    });
    expect(test.claims()).toBe(0);
    expect(test.jobs).toEqual([]);
  });
  it("rejects mock mode before checking external readiness", async () => {
    let checked = 0;
    const test = setup("mock", async () => {
      checked++;
      return { ok: true };
    });
    expect(await requestIngestionRun(ctx, body, "external-2", test.deps)).toMatchObject({
      ok: false,
      status: 409,
      code: "RUN_MODE_MISMATCH",
    });
    expect(checked).toBe(0);
    expect(test.jobs).toEqual([]);
  });
  it("enqueues the verified service partition and treats another company as a different request", async () => {
    const test = setup("live", async () => ({ ok: true }));
    expect(await requestIngestionRun(ctx, body, "external-3", test.deps)).toMatchObject({
      ok: true,
      status: 202,
      data: { source: "kepco", serviceKey: "kepco-ebid-contract" },
    });
    expect(test.jobs[0]).toMatchObject({
      ...input,
      trigger: "MANUAL",
      orgId: ctx.orgId,
      requestedBy: ctx.userId,
    });
    const other = {
      ...body,
      read: async () => ({ ok: true as const, value: { ...input, companyId: "COM02" } }),
    };
    expect(await requestIngestionRun(ctx, other, "external-3", test.deps)).toMatchObject({
      ok: false,
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(test.jobs).toHaveLength(1);
  });
});
