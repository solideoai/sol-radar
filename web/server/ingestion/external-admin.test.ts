import { describe, expect, it } from "vitest";
import {
  getManualIngestGate,
  requestIngestionRun,
  type IngestionAdminDeps,
  type IngestionIdempotencyRecord,
} from "./ingestion-admin.service";
import type { IngestJobData } from "./ingestion.queue";
import { createMemoryManualIngestGate } from "./manual-ingest-gate.memory";
import {
  externalManualBlockOf,
  parseSourceReadiness,
  type SourceReadinessSnapshot,
  type SourceReadinessState,
} from "./source-readiness.model";

const snapshotWith = (state: SourceReadinessState): SourceReadinessSnapshot => ({
  version: 1,
  updatedAt: "2026-10-21T02:00:00.000Z",
  services: {
    "kepco-ebid-contract": { state, scheduled: state === "READY" },
    "lh-bid-notice": { state: "READY", scheduled: true },
  },
});

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
function setup(
  runMode: "mock" | "live",
  ready?: IngestionAdminDeps["serviceReady"],
  sourceStatus?: IngestionAdminDeps["sourceStatus"],
) {
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
    ...(sourceStatus === undefined ? {} : { sourceStatus }),
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
  // registry(redis-api 사본)는 허용해도 Worker 가 막은 서비스는 받지 않는다. 쿨다운·멱등 키·job 을 남기지 않는다.
  it.each([
    ["no snapshot yet", null, "WORKER_NOT_READY"],
    ["key missing", snapshotWith("KEY_MISSING"), "KEY_MISSING"],
    ["auth failed", snapshotWith("AUTH_FAILED"), "AUTH_FAILED"],
    ["quota unverified", snapshotWith("QUOTA_UNVERIFIED"), "QUOTA_UNVERIFIED"],
  ] as const)("rejects when the worker reports %s", async (_name, snapshot, reason) => {
    const test = setup("live", async () => ({ ok: true }), { read: async () => snapshot });
    expect(await requestIngestionRun(ctx, body, `worker-${reason}`, test.deps)).toMatchObject({
      ok: false,
      status: 503,
      details: { component: "source", serviceKey: "kepco-ebid-contract", reason },
    });
    expect(test.claims()).toBe(0);
    expect(test.jobs).toEqual([]);
  });
  it("accepts a READY worker service and fails closed on a status read error", async () => {
    const ready = setup("live", async () => ({ ok: true }), {
      read: async () => snapshotWith("READY"),
    });
    expect(await requestIngestionRun(ctx, body, "worker-ready", ready.deps)).toMatchObject({
      ok: true,
      status: 202,
    });
    const broken = setup("live", async () => ({ ok: true }), {
      read: async () => {
        throw new Error("redis down");
      },
    });
    expect(await requestIngestionRun(ctx, body, "worker-broken", broken.deps)).toMatchObject({
      ok: false,
      status: 503,
      details: { component: "redis" },
    });
    expect(broken.jobs).toEqual([]);
  });
  // OPERATION_UNVERIFIED 는 기본 조회 방식만 미검증이라는 뜻이다. 녹음으로 검증한 dmscptList 요청은 Worker gate 처럼 받고,
  // 검증하지 않은 공사 목록(cntrwkList) 요청은 막는다.
  it("accepts a verified operation of an OPERATION_UNVERIFIED service and rejects an unverified one", async () => {
    const snapshot: SourceReadinessSnapshot = {
      version: 1,
      updatedAt: "2026-10-21T02:00:00.000Z",
      services: { "kwater-bid-notice": { state: "OPERATION_UNVERIFIED", scheduled: false } },
    };
    const kwater = (operation?: string) => ({
      declaredTooLarge: false,
      read: async () => ({
        ok: true as const,
        value: {
          source: "kwater",
          serviceKey: "kwater-bid-notice",
          window: input.window,
          ...(operation === undefined ? {} : { operation }),
        },
      }),
    });
    const verified = setup("live", async () => ({ ok: true }), { read: async () => snapshot });
    expect(
      await requestIngestionRun(ctx, kwater("dmscptList"), "kwater-verified", verified.deps),
    ).toMatchObject({ ok: true, status: 202 });
    const fallback = setup("live", async () => ({ ok: true }), { read: async () => snapshot });
    expect(
      await requestIngestionRun(ctx, kwater("cntrwkList"), "kwater-unverified", fallback.deps),
    ).toMatchObject({
      ok: false,
      status: 503,
      details: { component: "source", reason: "OPERATION_UNVERIFIED" },
    });
    expect(fallback.jobs).toEqual([]);
  });
});

describe("source readiness snapshot", () => {
  // Worker 가 redis-api 보다 새 버전이면 모르는 서비스·상태가 섞인다. 아는 서비스는 그대로 판정한다.
  it("keeps known services when a newer worker adds unknown services or states", () => {
    const parsed = parseSourceReadiness(
      JSON.stringify({
        version: 1,
        updatedAt: "2026-10-21T02:00:00.000Z",
        services: {
          "lh-bid-notice": { state: "READY", scheduled: true },
          "kwater-bid-notice": { state: "PAUSED_BY_OPERATOR", scheduled: false },
          "new-agency-notice": { state: "READY", scheduled: true },
        },
      }),
    );
    expect(parsed?.services).toEqual({ "lh-bid-notice": { state: "READY", scheduled: true } });
    expect(externalManualBlockOf(parsed, "kwater-bid-notice", { operationVerified: false })).toBe(
      "WORKER_NOT_READY",
    );
  });
});

describe("manual gate external service states", () => {
  it("adds worker service states, and keeps the gate when the state read fails", async () => {
    const snapshot = snapshotWith("KEY_MISSING");
    const test = setup("live", undefined, { read: async () => snapshot });
    expect(await getManualIngestGate(ctx, test.deps)).toMatchObject({
      ok: true,
      data: { schedule: { active: true }, services: snapshot.services },
    });
    const broken = setup("live", undefined, {
      read: async () => {
        throw new Error("redis down");
      },
    });
    expect(await getManualIngestGate(ctx, broken.deps)).toMatchObject({
      ok: true,
      data: { schedule: { active: true }, services: null },
    });
  });
});
