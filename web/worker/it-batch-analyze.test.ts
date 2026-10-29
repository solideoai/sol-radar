import { describe, expect, it } from "vitest";
import {
  itBatchIdempotencyKey,
  type GatewayHealth,
  type ItBatchRunInput,
  type ItBatchStore,
  type ItBatchTarget,
  type ScoreRunStatus,
} from "@/server/analysis";
import {
  parseItBatchArgs,
  runItBatch,
  type ItBatchDeps,
  type ItBatchOptions,
} from "@/worker/it-batch-analyze";

// IT 공고 1회 일괄 분석 CLI(ADR-069). 가짜 gateway·store·queue 만 쓴다(Redis·Supabase·gateway 를 부르지 않는다).

const ORG_SLUG = "solideo";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE = { id: "22222222-2222-4222-8222-222222222222", revision: 5 };
const POLL_MS = 5_000;

const LIVE_HEALTH: GatewayHealth = {
  status: "ok",
  runMode: "live",
  provider: "local",
  kevEnabled: true,
  qwen: { model: "qwen", promptHash: "hash" },
  kev: null,
  questionSets: [],
  parsers: [],
};

const targetsOf = (count: number): ItBatchTarget[] =>
  Array.from({ length: count }, (_, index) => ({
    bidId: `bid-${index + 1}`,
    revisionId: `rev-${index + 1}`,
    revision: 1,
  }));

type FakeRun = { id: string; input: ItBatchRunInput; status: ScoreRunStatus };

const UNSETTLED: readonly ScoreRunStatus[] = ["QUEUED", "RUNNING"];

/**
 * 가짜 store. settle 이 true 면 상태를 읽을 때마다 가장 먼저 넣은 미완료 run 하나를 COMPLETED 로 바꾼다(늦게 끝나는 worker).
 * existing 은 이미 있는 run 의 멱등 키 → 상태다.
 */
function fakeStore(options: {
  ready: ItBatchTarget[];
  skippedNoSource?: number;
  existing?: ReadonlyMap<string, ScoreRunStatus>;
  settle?: boolean;
  failOn?: string;
}) {
  const runs = new Map<string, FakeRun>();
  for (const [key, status] of options.existing ?? []) {
    runs.set(key, { id: `old-${runs.size + 1}`, input: { ...inputOf(key) }, status });
  }
  const unfinished = () => [...runs.values()].filter((run) => UNSETTLED.includes(run.status));
  const store: ItBatchStore = {
    findOrgBySlug: async (slug) => (slug === ORG_SLUG ? ORG_ID : null),
    latestProfile: async () => PROFILE,
    listTargets: async () => ({
      ready: options.ready,
      skippedNoSource: options.skippedNoSource ?? 0,
    }),
    ensureQueuedRun: async (input) => {
      if (input.bidId === options.failOn) {
        throw new Error("duplicate key value 비밀 제목 원문 Postgres 접속 문자열");
      }
      const found = runs.get(input.idempotencyKey);
      if (found !== undefined) return { id: found.id, status: found.status, created: false };
      const run: FakeRun = { id: `run-${runs.size + 1}`, input, status: "QUEUED" };
      runs.set(input.idempotencyKey, run);
      return { id: run.id, status: run.status, created: true };
    },
    readStatuses: async (_orgId, ids) => {
      const first = unfinished()[0];
      if (options.settle !== false && first !== undefined) first.status = "COMPLETED";
      return [...runs.values()]
        .filter((run) => ids.includes(run.id))
        .map((run) => ({ id: run.id, status: run.status }));
    },
  };
  return { store, runs, unfinished };
}

function inputOf(idempotencyKey: string): ItBatchRunInput {
  return {
    orgId: ORG_ID,
    bidId: "old",
    revisionId: "old",
    companyProfileId: PROFILE.id,
    profileRevision: PROFILE.revision,
    idempotencyKey,
  };
}

function harness(
  fake: ReturnType<typeof fakeStore>,
  health: GatewayHealth = LIVE_HEALTH,
): { deps: ItBatchDeps; lines: string[]; added: string[]; unfinishedAtAdd: number[] } {
  let clock = Date.parse("2026-10-30T01:00:00.000Z");
  const lines: string[] = [];
  const added: string[] = [];
  const unfinishedAtAdd: number[] = [];
  const deps: ItBatchDeps = {
    gateway: { health: async () => ({ ok: true, value: health, attempts: 1 }) },
    store: fake.store,
    queue: {
      add: async (_name, data) => {
        added.push(data.scoreRunId);
        unfinishedAtAdd.push(fake.unfinished().length);
      },
    },
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => {
      lines.push(line);
    },
    pollMs: POLL_MS,
  };
  return { deps, lines, added, unfinishedAtAdd };
}

const OPTIONS: ItBatchOptions = {
  orgSlug: ORG_SLUG,
  maxInFlight: 2,
  limit: null,
  dryRun: false,
  deadlineMs: 3_600_000,
};

describe("IT 공고 일괄 분석 CLI", () => {
  it("mock·hosted 에서는 넣지 않고 exit 2", async () => {
    for (const mode of [
      { runMode: "mock", provider: "mock" },
      { runMode: "live", provider: "hosted" },
      { runMode: "mock", provider: "local" },
    ] as const) {
      const fake = fakeStore({ ready: targetsOf(2) });
      const { deps, added } = harness(fake, { ...LIVE_HEALTH, ...mode });
      const result = await runItBatch(deps, OPTIONS);
      expect(result.exitCode).toBe(2);
      expect(result.line).toBe(
        `it-batch: live·local 이 아니다(runMode=${mode.runMode}, provider=${mode.provider})`,
      );
      expect(added).toEqual([]);
      expect(fake.runs.size).toBe(0);
    }
  });

  it("원문 없는 공고는 넣지 않고 skipped_no_source 로 센다", async () => {
    const fake = fakeStore({ ready: targetsOf(1), skippedNoSource: 2 });
    const { deps, added } = harness(fake);
    const result = await runItBatch(deps, OPTIONS);
    expect(added).toHaveLength(1);
    expect(result.line).toBe(
      "it-batch: targets=1 skipped_no_source=2 enqueued=1 existing=0 completed=1 partial=0 failed=0 unfinished=0",
    );
    expect(result.exitCode).toBe(0);
  });

  it("동시에 넣는 run 은 maxInFlight 를 넘지 않는다", async () => {
    const fake = fakeStore({ ready: targetsOf(6) });
    const { deps, added, unfinishedAtAdd } = harness(fake);
    const result = await runItBatch(deps, OPTIONS);
    expect(added).toHaveLength(6);
    expect(Math.max(...unfinishedAtAdd)).toBe(2);
    expect(result.line).toContain("enqueued=6 existing=0 completed=6");
    expect(result.exitCode).toBe(0);
  });

  it("기다리는 시간이 지나면 더 넣지 않고 끝나지 않은 수를 센다", async () => {
    const fake = fakeStore({ ready: targetsOf(3), settle: false });
    const { deps, added } = harness(fake);
    const result = await runItBatch(deps, { ...OPTIONS, deadlineMs: 4 * POLL_MS });
    expect(added).toHaveLength(2);
    expect(result.line).toBe(
      "it-batch: targets=3 skipped_no_source=0 enqueued=2 existing=0 completed=0 partial=0 failed=0 unfinished=3",
    );
    expect(result.exitCode).toBe(1);
  });

  it("--dry-run 은 queue.add 를 부르지 않는다", async () => {
    const fake = fakeStore({ ready: targetsOf(2), skippedNoSource: 1 });
    const { deps, added } = harness(fake);
    const result = await runItBatch(deps, { ...OPTIONS, dryRun: true });
    expect(added).toEqual([]);
    expect(fake.runs.size).toBe(0);
    expect(result).toEqual({
      exitCode: 0,
      line: "it-batch: dry-run targets=2 skipped_no_source=1",
    });
  });

  it("이미 같은 키의 run 이 있으면 다시 넣지 않는다", async () => {
    const [first, second] = targetsOf(2);
    if (first === undefined || second === undefined) throw new Error("대상 둘이 필요하다");
    const existing = new Map<string, ScoreRunStatus>([
      [itBatchIdempotencyKey(ORG_ID, first, PROFILE.revision), "COMPLETED"],
    ]);
    const fake = fakeStore({ ready: [first, second], existing });
    const { deps, added } = harness(fake);
    const result = await runItBatch(deps, OPTIONS);
    expect(added).toEqual(["run-2"]);
    expect(result.line).toContain("enqueued=1 existing=1 completed=2");
  });

  it("준비 실패는 bid id 와 단계만 찍고 오류 message 는 찍지 않는다", async () => {
    const fake = fakeStore({ ready: targetsOf(2), failOn: "bid-1" });
    const { deps, lines } = harness(fake);
    const result = await runItBatch(deps, OPTIONS);
    expect(lines).toContain("it-batch: bid-1 FAILED — 준비 실패(ensureQueuedRun)");
    expect(lines.join("\n")).not.toMatch(/비밀|원문|duplicate|Postgres/);
    expect(result.line).toContain("enqueued=1 existing=0 completed=1 partial=0 failed=1");
    expect(result.exitCode).toBe(1);
  });
});

describe("일괄 분석 인자", () => {
  it("--org-slug 는 필수이고 나머지는 기본값이 있다", () => {
    expect(parseItBatchArgs(["--", "--org-slug", ORG_SLUG])).toEqual({
      orgSlug: ORG_SLUG,
      maxInFlight: 2,
      limit: null,
      dryRun: false,
      deadlineMs: 240 * 60_000,
    });
    expect(
      parseItBatchArgs([
        "--org-slug",
        ORG_SLUG,
        "--max-in-flight",
        "1",
        "--limit",
        "10",
        "--dry-run",
        "--deadline-min",
        "30",
      ]),
    ).toEqual({
      orgSlug: ORG_SLUG,
      maxInFlight: 1,
      limit: 10,
      dryRun: true,
      deadlineMs: 1_800_000,
    });
    expect(() => parseItBatchArgs([])).toThrow(/사용법/);
    expect(() => parseItBatchArgs(["--org-slug", ORG_SLUG, "--limit", "0"])).toThrow(/사용법/);
  });
});
