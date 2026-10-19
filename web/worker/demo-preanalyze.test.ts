import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { companyProfileUuid, demoIdFor, demoUuid } from "@test-harness/demo-plan.mjs";
import { orgUuid } from "@test-harness/people-seed.mjs";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  analysisJobDataSchema,
  type AnalysisJobData,
  type GatewayFailure,
  type GatewayHealth,
  type GatewayResult,
  type PreanalyzeStore,
  type ScoreRunStatus,
} from "@/server/analysis";
import {
  EMPTY_INGEST_SUMMARY,
  seedFixtureBids,
  type IngestionRepo,
  type SaveRevisionInput,
} from "@/server/ingestion";
import { CALCULATION_DATE, healthBody } from "@/worker/analysis-job.test-support";
import { runPreanalyze, type PreanalyzeDeps } from "@/worker/demo-preanalyze";

// 사전 분석 CLI(`pnpm demo:preanalyze`, C5-B). 19 §3 사전 준비 5번의 "FX-02를 뺀 적재 공고 18건"을
// mock 모드에서 분석 job 으로 넣고 끝날 때까지 기다린다. gateway·store·queue·시계·sleep·로그는 가짜다.
// Redis·Supabase·Compose·네트워크는 쓰지 않는다. 공고 행은 demo:reset 과 같은 C3 공고 적재(seedFixtureBids,
// idFor=demoIdFor)에 기록용 저장소를 넣어 받는다(대상 목록을 박지 않는다).

// 19 §3 5번: FX-02 는 미분석으로 남겨 S4 에서 라이브 분석한다. FX-12 는 격리라 적재 공고가 없다.
const LIVE_ANALYSIS_FIXTURE = "FX-02";
// 11 §5 6번: S2 BID 권고 3건(FX-01 94, FX-18 82, FX-06 78).
const S2_BID_FIXTURES = ["FX-01", "FX-18", "FX-06"];

// ── seed 공고 행 ──

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SEED_ANCHOR = new Date(`${CALCULATION_DATE}T18:00:00+09:00`);

type DemoBidRow = Awaited<ReturnType<PreanalyzeStore["listDemoBids"]>>[number];
type EnsureInput = Parameters<PreanalyzeStore["ensureQueuedRun"]>[0];
type SeedBid = { fixtureId: string; bidId: string; revisionId: string };
type SeedNotice = { id: string; latest_revision: number };
type SeedRevision = { id: string; bid_id: string; revision: number; raw_payload: unknown };

/**
 * 기록용 수집 저장소. saveRevision 입력을 RPC ingest_save_revision 이 revision 1 에서 쓰는 공고(latest_revision 1)·
 * revision(raw_payload 는 JSON) 행 가운데 사전 분석이 읽는 열만 쌓는다. SEED(revision 1)만 흉내 낸다.
 */
function recordingIngestionRepo(): {
  repo: IngestionRepo;
  notices: SeedNotice[];
  revisions: SeedRevision[];
} {
  const notices: SeedNotice[] = [];
  const revisions: SeedRevision[] = [];
  const save = ({ decision, rawPayload, ids }: SaveRevisionInput) => {
    const { bid } = decision;
    if (bid.revision !== 1)
      throw new Error(`기록용 저장소는 revision 1 만 쌓는다: ${bid.noticeId}`);
    // demo:reset 은 idFor 를 넘겨 id 를 정한다. 없으면 DB 가 만드는 값이라 seed 와 같은 id 를 낼 수 없다.
    const bidId = ids?.bidId;
    const revisionId = ids?.revisionId;
    if (bidId === undefined || revisionId === undefined) {
      throw new Error(`idFor 없이 저장하려 했다: ${bid.noticeId}`);
    }
    if (notices.some((notice) => notice.id === bidId)) throw new Error("INGEST_BID_EXISTS");
    notices.push({ id: bidId, latest_revision: 1 });
    revisions.push({
      id: revisionId,
      bid_id: bidId,
      revision: bid.revision,
      raw_payload: JSON.parse(JSON.stringify(rawPayload)),
    });
    return { bidId, revisionId };
  };
  const repo: IngestionRepo = {
    startRun: async (input) => ({
      runId: demoUuid("test-ingest-run", input.jobKey),
      status: "RUNNING",
      cursor: null,
      summary: { ...EMPTY_INGEST_SUMMARY },
      params: input.params,
    }),
    findLatestRevision: async () => null,
    findLatestSeedAnchor: async () => null,
    findLatestRunWindowEnd: async () => null,
    saveRevision: async (input) => save(input),
    recordError: async () => undefined,
    saveCheckpoint: async () => undefined,
    finishRun: async () => undefined,
  };
  return { repo, notices, revisions };
}

/** demo:reset 의 공고 적재(createDefaultIngestBids)와 같은 호출. fetchedAt 은 결정적이도록 seed 시각으로 고정한다. */
async function recordFixtureSeed() {
  const { repo, notices, revisions } = recordingIngestionRepo();
  const result = await seedFixtureBids({
    repo,
    fixturesDir: path.join(REPO_ROOT, "fixtures"),
    anchor: SEED_ANCHOR,
    runMode: "MOCK",
    // demo:reset 이 넘기는 demoIdFor 그대로. plan.mjs 는 JS 라 revision 을 필수로 추론해 키를 풀어 넘긴다.
    idFor: (kind, { source, noticeId, revision }) =>
      demoIdFor(kind, { source, noticeId, revision }),
    now: () => SEED_ANCHOR,
  });
  if (result.status === "FAILED") throw new Error("seed 공고 적재가 FAILED 로 끝났다");
  return { bids: result.bids, notices, revisions };
}

const fixtureSeed = await recordFixtureSeed();
const SEEDED: SeedBid[] = fixtureSeed.bids.map(({ fixtureId, bidId, revisionId }) => ({
  fixtureId,
  bidId,
  revisionId,
}));
const notices: SeedNotice[] = fixtureSeed.notices;
const revisions: SeedRevision[] = fixtureSeed.revisions;

/** seed 와 같은 데모 공고 행(listDemoBids 가 돌려줄 모양). */
function seedBidRows(): DemoBidRow[] {
  return revisions.map((revision) => ({
    bidId: revision.bid_id,
    revisionId: revision.id,
    revision: revision.revision,
    rawPayload: structuredClone(revision.raw_payload),
    latestRevision: notices.find((notice) => notice.id === revision.bid_id)?.latest_revision ?? 0,
  }));
}

/** 기대 대상: seed 적재 공고에서 FX-02 를 뺀 것(fixtureId 순). */
const EXPECTED: SeedBid[] = SEEDED.filter(
  (bid) => bid.fixtureId !== LIVE_ANALYSIS_FIXTURE,
).toSorted((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));

/** seed 공고 원문(제목·본문). 로그에 새면 안 된다. */
const BID_TEXTS: string[] = revisions.flatMap((revision) => {
  const payload = revision.raw_payload;
  if (typeof payload !== "object" || payload === null) return [];
  return ["title", "content"].flatMap((key) => {
    const value: unknown = Reflect.get(payload, key);
    return typeof value === "string" && value.trim() !== "" ? [value] : [];
  });
});

// ── 고정 값 ──

const ORG_ID: string = orgUuid("org-01");
const PROFILE = { id: companyProfileUuid("org-01", 2), revision: 2 };
const NOW = new Date(`${CALCULATION_DATE}T09:00:00.000Z`);
const DEADLINE_MS = 600_000;
const POLL_MS = 2_000;

const runIdFor = (fixtureId: string): string => demoUuid("test-preanalyze-run", fixtureId);
const extractionIdFor = (revisionId: string): string =>
  demoUuid("test-preanalyze-extraction", revisionId);
/** e8: 멱등 키 `<org01>:demo-pre-<fixtureId>-r<NN>`. */
const keyFor = (fixtureId: string): string => `${ORG_ID}:demo-pre-${fixtureId}-r01`;
const jobIdFor = (scoreRunId: string): string => `analysis_${ORG_ID}_${scoreRunId}`;

const fixtureOfRevision = new Map(SEEDED.map((bid) => [bid.revisionId, bid.fixtureId]));
const fixtureOfRun = new Map(SEEDED.map((bid) => [runIdFor(bid.fixtureId), bid.fixtureId]));

const FIXTURE_ID = /FX-\d{2}/g;
const SETTLED_STATES: readonly ScoreRunStatus[] = ["COMPLETED", "PARTIAL", "FAILED"];
/** 결정 8: 기존 run 이 PARTIAL·FAILED 일 때 마지막 줄 앞에 한 번 찍는 안내. */
const NOT_COMPLETED_NOTICE =
  /^preanalyze: 끝난 run 이 COMPLETED 가 아니다 — pnpm demo:reset 뒤 다시 돌린다$/;
/** ensureQueuedRun 이 던지는 오류의 message. 로그로 새면 안 된다. */
const ENSURE_LEAK = "LEAK-ensure-message";

// ── 가짜 ──

const healthOk = (overrides: Partial<GatewayHealth> = {}): GatewayResult<GatewayHealth> => ({
  ok: true,
  value: healthBody(overrides),
  attempts: 1,
});
const healthFailed = (failure: GatewayFailure): GatewayResult<GatewayHealth> => ({
  ok: false,
  failure,
  attempts: failure.kind === "CIRCUIT_OPEN" ? 0 : 1,
});

type AddCall = {
  name: string;
  data: AnalysisJobData;
  opts: Parameters<PreanalyzeDeps["queue"]["add"]>[2];
};

type Setup = {
  health?: GatewayResult<GatewayHealth>;
  org?: string | null;
  profile?: { id: string; revision: number } | null;
  bids?: DemoBidRow[];
  extractionId?: (revisionId: string) => string | null;
  /** ensureQueuedRun 이 돌려줄 기존 run 상태(fixtureId 별). 없으면 QUEUED(새로 만든 run). */
  existing?: Partial<Record<string, ScoreRunStatus>>;
  /** readStatuses 가 돌려줄 상태(fixtureId·몇 번째 읽기). 없으면 COMPLETED. */
  poll?: (fixtureId: string, readIndex: number) => ScoreRunStatus;
  /** ensureQueuedRun 이 던질 fixtureId(예: score_runs_active_input_key 23505). */
  ensureErrors?: ReadonlySet<string>;
  /** readStatuses 행에 덧붙일 값(로그로 새면 안 된다). */
  extraColumns?: Record<string, unknown>;
  deadlineMs?: number;
  pollMs?: number;
};

const MAX_SLEEPS = 2_000;

function setup(options: Setup = {}) {
  const storeCalls: string[] = [];
  const ensured: EnsureInput[] = [];
  const extractionReads: string[] = [];
  const profileReads: string[] = [];
  const statusReads: { orgId: string; ids: string[] }[] = [];
  const adds: AddCall[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  let healthCalls = 0;
  let elapsedMs = 0;

  const store: PreanalyzeStore = {
    findDemoOrg: async () => {
      storeCalls.push("findDemoOrg");
      return options.org === undefined ? ORG_ID : options.org;
    },
    latestProfile: async (orgId) => {
      storeCalls.push("latestProfile");
      profileReads.push(orgId);
      return options.profile === undefined ? { ...PROFILE } : options.profile;
    },
    listDemoBids: async () => {
      storeCalls.push("listDemoBids");
      return options.bids ?? seedBidRows();
    },
    latestExtractionId: async (revisionId) => {
      storeCalls.push("latestExtractionId");
      extractionReads.push(revisionId);
      return options.extractionId === undefined
        ? extractionIdFor(revisionId)
        : options.extractionId(revisionId);
    },
    ensureQueuedRun: async (input) => {
      storeCalls.push("ensureQueuedRun");
      ensured.push({ ...input });
      const fixtureId = fixtureOfRevision.get(input.revisionId);
      if (fixtureId === undefined) throw new Error("seed 에 없는 revision 으로 run 을 만들었다");
      if (options.ensureErrors?.has(fixtureId)) {
        const error = new Error(`${ENSURE_LEAK} score_runs_active_input_key 23505`);
        throw Object.assign(error, { code: "23505" });
      }
      return { id: runIdFor(fixtureId), status: options.existing?.[fixtureId] ?? "QUEUED" };
    },
    readStatuses: async (orgId, ids) => {
      storeCalls.push("readStatuses");
      statusReads.push({ orgId, ids: [...ids] });
      if (statusReads.length > MAX_SLEEPS) throw new Error("readStatuses 를 너무 많이 불렀다");
      const readIndex = statusReads.length - 1;
      const rows = ids.map((id) => {
        const fixtureId = fixtureOfRun.get(id) ?? "unknown";
        // 이미 끝난 run 은 DB 에서 바뀌지 않는다(읽으면 그 상태 그대로다).
        const settled = options.existing?.[fixtureId];
        const status =
          settled !== undefined && SETTLED_STATES.includes(settled)
            ? settled
            : (options.poll?.(fixtureId, readIndex) ?? "COMPLETED");
        return { id, status, ...options.extraColumns };
      });
      return rows;
    },
  };

  const deps: PreanalyzeDeps = {
    gateway: {
      health: async () => {
        healthCalls += 1;
        return options.health ?? healthOk();
      },
    },
    store,
    queue: {
      add: async (name, data, opts) => {
        adds.push({ name, data: { ...data }, opts: { ...opts } });
        return { id: opts.jobId };
      },
    },
    now: () => new Date(NOW.getTime() + elapsedMs),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > MAX_SLEEPS) throw new Error("sleep 을 너무 많이 불렀다(멈추지 않는다)");
      elapsedMs += ms;
    },
    log: (line) => {
      lines.push(line);
    },
    deadlineMs: options.deadlineMs ?? DEADLINE_MS,
    pollMs: options.pollMs ?? POLL_MS,
  };

  return {
    deps,
    storeCalls,
    ensured,
    extractionReads,
    profileReads,
    statusReads,
    adds,
    sleeps,
    lines,
    healthCalls: () => healthCalls,
  };
}

async function run(options: Setup = {}) {
  const s = setup(options);
  const result = await runPreanalyze(s.deps);
  return { ...s, result };
}

/**
 * 찍힌 줄 + 마지막 줄. runPreanalyze 가 마지막 줄을 log 로도 찍었다면 그 줄이 맨 끝이어야 한다
 * (뒤에 다른 줄이 오면 마지막 줄이 아니다). 찍지 않았다면 돌려준 line 을 부른 쪽(main)이 마지막에 찍는다.
 */
function transcriptOf(lines: string[], line: string): string[] {
  const index = lines.indexOf(line);
  if (index === -1) return [...lines, line];
  expect(index).toBe(lines.length - 1);
  return lines;
}

/** 마지막 줄 앞의 줄 가운데 fixtureId 가 있는 줄. */
function fixtureLines(r: Awaited<ReturnType<typeof run>>): string[] {
  return transcriptOf(r.lines, r.result.line)
    .slice(0, -1)
    .filter((line) => line.match(FIXTURE_ID) !== null);
}

/** enqueue 한 job 의 fixtureId(scoreRunId 로 찾는다). */
const addedFixtures = (adds: AddCall[]) =>
  adds.map((add) => fixtureOfRun.get(add.data.scoreRunId) ?? "unknown");

// ── gateway 확인 ──

describe("runPreanalyze · gateway 확인", () => {
  const FAILURES: [string, GatewayFailure][] = [
    ["UNREACHABLE", { kind: "UNREACHABLE", code: "ECONNREFUSED" }],
    ["TIMEOUT", { kind: "TIMEOUT" }],
    ["HTTP_ERROR", { kind: "HTTP_ERROR", httpStatus: 503, errorCode: null }],
    ["INVALID_RESPONSE", { kind: "INVALID_RESPONSE", issues: ["runMode"] }],
    ["CIRCUIT_OPEN", { kind: "CIRCUIT_OPEN" }],
  ];

  it.each(FAILURES)(
    "health 가 %s 로 실패하면 exit 1 과 'gateway 응답 없음' 줄을 돌려준다",
    async (_kind, failure) => {
      const r = await run({ health: healthFailed(failure) });
      expect(r.result).toEqual({
        exitCode: 1,
        line: "preanalyze: gateway 응답 없음 — Compose 의 ai-gateway 를 먼저 띄운다",
      });
    },
  );

  it.each(FAILURES)(
    "health 가 %s 로 실패하면 store·queue 를 부르지 않는다",
    async (_kind, failure) => {
      const r = await run({ health: healthFailed(failure) });
      expect(r.storeCalls).toEqual([]);
      expect(r.adds).toEqual([]);
    },
  );

  it.each(["fixture", "live"] as const)(
    "runMode=%s 면 exit 2 와 'mock 모드가 아니다' 줄을 돌려준다",
    async (runMode) => {
      const r = await run({ health: healthOk({ runMode, provider: "local" }) });
      expect(r.result).toEqual({
        exitCode: 2,
        line: `preanalyze: mock 모드가 아니다(runMode=${runMode}) — 사전 분석은 mock 에서만 한다`,
      });
    },
  );

  it.each(["fixture", "live"] as const)(
    "runMode=%s 면 store·queue 를 부르지 않는다",
    async (runMode) => {
      const r = await run({ health: healthOk({ runMode, provider: "local" }) });
      expect(r.storeCalls).toEqual([]);
      expect(r.adds).toEqual([]);
    },
  );

  it("health 는 한 번 부른다", async () => {
    const r = await run();
    expect(r.healthCalls()).toBe(1);
  });
});

// ── 준비 확인 ──

describe("runPreanalyze · 데모 조직·회사 프로필·대상", () => {
  it("데모 조직이 없으면 exit 1 과 'pnpm demo:reset 을 먼저 돌린다' 줄을 돌려준다", async () => {
    const r = await run({ org: null });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: 데모 조직이 없다 — pnpm demo:reset 을 먼저 돌린다",
    });
  });

  it("데모 조직이 없으면 run 을 만들지 않고 enqueue 하지 않는다", async () => {
    const r = await run({ org: null });
    expect(r.ensured).toEqual([]);
    expect(r.adds).toEqual([]);
  });

  it("회사 프로필은 데모 조직 id 로 읽는다", async () => {
    const r = await run();
    expect(r.profileReads).toEqual([ORG_ID]);
  });

  // 설계 §3 2번 "같은 식": 문구는 정하지 않았고 demo:reset 안내로 끝나는 줄이다.
  it("회사 프로필이 없으면 exit 1 이고 demo:reset 을 먼저 돌리라는 줄을 돌려준다", async () => {
    const r = await run({ profile: null });
    expect(r.result.exitCode).toBe(1);
    expect(r.result.line).toMatch(/^preanalyze: .+ — pnpm demo:reset 을 먼저 돌린다$/);
  });

  it("회사 프로필이 없으면 run 을 만들지 않고 enqueue 하지 않는다", async () => {
    const r = await run({ profile: null });
    expect(r.ensured).toEqual([]);
    expect(r.adds).toEqual([]);
  });

  it("데모 공고가 없어 대상이 0건이면 exit 1 이고 enqueue 하지 않는다", async () => {
    const r = await run({ bids: [] });
    expect(r.result.exitCode).toBe(1);
    expect(r.result.line).toMatch(/^preanalyze: /);
    expect(r.ensured).toEqual([]);
    expect(r.adds).toEqual([]);
  });

  it("FX-02 하나뿐이라 대상이 0건이어도 exit 1 이고 enqueue 하지 않는다", async () => {
    const fx02 = seedBidRows().filter(
      (row) => fixtureOfRevision.get(row.revisionId) === LIVE_ANALYSIS_FIXTURE,
    );
    const r = await run({ bids: fx02 });
    expect(r.result.exitCode).toBe(1);
    expect(r.ensured).toEqual([]);
    expect(r.adds).toEqual([]);
  });
});

// ── 대상과 enqueue ──

describe("runPreanalyze · 대상과 enqueue", () => {
  it("run 을 만드는 대상은 seed 적재 공고에서 FX-02 를 뺀 공고다(fixtureId 순)", async () => {
    const r = await run();
    expect(r.ensured.map((input) => input.revisionId)).toEqual(
      EXPECTED.map((bid) => bid.revisionId),
    );
  });

  it("run 을 18건 만들고 18건 enqueue 한다(19 §3 5번: FX-02 를 뺀 적재 공고 18건)", async () => {
    const r = await run();
    expect(r.ensured).toHaveLength(18);
    expect(r.adds).toHaveLength(18);
  });

  it("FX-02 는 run 을 만들지도 enqueue 하지도 않는다(19 §3 5번: S4 라이브 분석)", async () => {
    const r = await run();
    const fx02 = SEEDED.find((bid) => bid.fixtureId === LIVE_ANALYSIS_FIXTURE);
    expect(r.ensured.map((input) => input.revisionId)).not.toContain(fx02?.revisionId);
    expect(r.adds.map((add) => add.data.scoreRunId)).not.toContain(runIdFor(LIVE_ANALYSIS_FIXTURE));
  });

  it.each(S2_BID_FIXTURES)("S2 BID 권고 공고 %s 를 enqueue 한다(11 §5 6번)", async (fixtureId) => {
    const r = await run();
    expect(addedFixtures(r.adds)).toContain(fixtureId);
  });

  it("ensureQueuedRun 입력은 데모 조직·공고·revision·최신 프로필·최근 추출·멱등 키다", async () => {
    const r = await run();
    expect(r.ensured).toEqual(
      EXPECTED.map((bid) => ({
        orgId: ORG_ID,
        bidId: bid.bidId,
        revisionId: bid.revisionId,
        companyProfileId: PROFILE.id,
        profileRevision: PROFILE.revision,
        extractionId: extractionIdFor(bid.revisionId),
        idempotencyKey: keyFor(bid.fixtureId),
      })),
    );
  });

  it("멱등 키는 `<orgId>:demo-pre-<fixtureId>-r01` 이다(e8)", async () => {
    const r = await run();
    for (const input of r.ensured) {
      expect(input.idempotencyKey).toMatch(new RegExp(`^${ORG_ID}:demo-pre-FX-\\d{2}-r01$`));
    }
  });

  it("최근 추출은 대상 revision 마다 latestExtractionId 로 읽는다", async () => {
    const r = await run();
    expect(r.extractionReads.toSorted()).toEqual(EXPECTED.map((bid) => bid.revisionId).toSorted());
  });

  it("성공 추출이 없는 revision 은 extractionId 를 null 로 넘긴다", async () => {
    const fx11 = EXPECTED.find((bid) => bid.fixtureId === "FX-11");
    const r = await run({
      extractionId: (revisionId) =>
        revisionId === fx11?.revisionId ? null : extractionIdFor(revisionId),
    });
    const input = r.ensured.find((entry) => entry.revisionId === fx11?.revisionId);
    expect(input?.extractionId).toBeNull();
  });

  it("queue.add 는 ANALYSIS_JOB·{ orgId, scoreRunId, idempotencyKey }·ANALYSIS_JOB_OPTIONS+jobId 로 부른다", async () => {
    const r = await run();
    expect(r.adds).toEqual(
      EXPECTED.map((bid) => {
        const scoreRunId = runIdFor(bid.fixtureId);
        return {
          name: ANALYSIS_JOB,
          data: { orgId: ORG_ID, scoreRunId, idempotencyKey: keyFor(bid.fixtureId) },
          opts: { ...ANALYSIS_JOB_OPTIONS, jobId: jobIdFor(scoreRunId) },
        };
      }),
    );
  });

  it("job 데이터의 scoreRunId 는 ensureQueuedRun 이 돌려준 id 이고 jobId 는 analysis_<orgId>_<scoreRunId> 다", async () => {
    const r = await run();
    for (const add of r.adds) {
      expect([...fixtureOfRun.keys()]).toContain(add.data.scoreRunId);
      expect(add.opts.jobId).toBe(`analysis_${ORG_ID}_${add.data.scoreRunId}`);
    }
  });

  it("job 데이터는 analysisJobDataSchema 를 통과한다(같은 enqueue 계약)", async () => {
    const r = await run();
    for (const add of r.adds) expect(analysisJobDataSchema.safeParse(add.data).success).toBe(true);
  });
});

// ── 멱등 ──

describe("runPreanalyze · 멱등", () => {
  it("이미 COMPLETED 인 run 은 enqueue 하지 않는다", async () => {
    const r = await run({ existing: { "FX-01": "COMPLETED" } });
    expect(addedFixtures(r.adds)).not.toContain("FX-01");
    expect(r.adds).toHaveLength(17);
  });

  it("이미 COMPLETED 인 run 도 완료로 세어 18건 완료면 exit 0 이다", async () => {
    const r = await run({ existing: { "FX-01": "COMPLETED" } });
    expect(r.result).toEqual({
      exitCode: 0,
      line: "preanalyze: targets=18 completed=18 partial=0 failed=0",
    });
  });

  it.each(["QUEUED", "RUNNING"] as const)(
    "기존 run 이 %s 면 같은 jobId 로 다시 넣는다(BullMQ 가 같은 jobId 를 무시한다)",
    async (status) => {
      const r = await run({ existing: { "FX-06": status } });
      const add = r.adds.find((entry) => entry.data.scoreRunId === runIdFor("FX-06"));
      expect(add?.opts.jobId).toBe(jobIdFor(runIdFor("FX-06")));
    },
  );

  it("다시 돌려 18건 모두 이미 COMPLETED 면 enqueue 없이 exit 0 이다", async () => {
    const existing = Object.fromEntries(
      EXPECTED.map((bid): [string, ScoreRunStatus] => [bid.fixtureId, "COMPLETED"]),
    );
    const r = await run({ existing });
    expect(r.adds).toEqual([]);
    expect(r.result).toEqual({
      exitCode: 0,
      line: "preanalyze: targets=18 completed=18 partial=0 failed=0",
    });
  });
});

// ── 결정 8: 기존 run 이 PARTIAL·FAILED(같은 멱등 키) ──

describe("runPreanalyze · 기존 run 이 PARTIAL·FAILED", () => {
  /** 마지막 줄 앞의 줄 가운데 안내 줄. */
  const notices = (r: Awaited<ReturnType<typeof run>>) =>
    transcriptOf(r.lines, r.result.line)
      .slice(0, -1)
      .filter((line) => NOT_COMPLETED_NOTICE.test(line));

  it.each(["PARTIAL", "FAILED"] as const)(
    "기존 run 이 %s 면 다시 enqueue 하지 않는다",
    async (status) => {
      const r = await run({ existing: { "FX-05": status } });
      expect(addedFixtures(r.adds)).not.toContain("FX-05");
      expect(r.adds).toHaveLength(17);
    },
  );

  it("기존 run 이 PARTIAL 이면 partial 로 세고 exit 1 이다", async () => {
    const r = await run({ existing: { "FX-05": "PARTIAL" } });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=1 failed=0",
    });
  });

  it("기존 run 이 FAILED 면 failed 로 세고 exit 1 이다", async () => {
    const r = await run({ existing: { "FX-13": "FAILED" } });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=0 failed=1",
    });
  });

  it("기존 PARTIAL·FAILED 공고는 fixtureId 를 한 줄씩 마지막 줄 앞에 찍는다", async () => {
    const r = await run({ existing: { "FX-05": "PARTIAL", "FX-13": "FAILED" } });
    const lines = fixtureLines(r);
    for (const line of lines) expect(line.match(FIXTURE_ID)).toHaveLength(1);
    expect(lines.map((line) => line.match(FIXTURE_ID)?.[0]).toSorted()).toEqual(["FX-05", "FX-13"]);
  });

  it("기존 run 이 PARTIAL·FAILED 면 'demo:reset 뒤 다시 돌린다' 안내를 마지막 줄 앞에 한 번 찍는다", async () => {
    const r = await run({ existing: { "FX-05": "PARTIAL", "FX-13": "FAILED" } });
    expect(notices(r)).toHaveLength(1);
  });

  it.each(["PARTIAL", "FAILED"] as const)(
    "기존 run 하나가 %s 여도 안내를 찍는다",
    async (status) => {
      const r = await run({ existing: { "FX-05": status } });
      expect(notices(r)).toHaveLength(1);
    },
  );

  it("기존 run 이 COMPLETED 뿐이면 안내를 찍지 않는다", async () => {
    const r = await run({ existing: { "FX-01": "COMPLETED" } });
    expect(notices(r)).toEqual([]);
  });

  it("기존 PARTIAL·FAILED 가 있어도 다른 공고는 enqueue 하고 완료로 센다", async () => {
    const r = await run({ existing: { "FX-05": "PARTIAL", "FX-13": "FAILED" } });
    expect(r.adds).toHaveLength(16);
    expect(r.result.line).toBe("preanalyze: targets=18 completed=16 partial=1 failed=1");
  });
});

// ── 결정 9: ensureQueuedRun 이 던질 때 ──

describe("runPreanalyze · ensureQueuedRun 이 던질 때", () => {
  const throwsFor = (...fixtureIds: string[]) => new Set(fixtureIds);

  it("던진 대상은 enqueue 하지 않는다", async () => {
    const r = await run({ ensureErrors: throwsFor("FX-07") });
    expect(addedFixtures(r.adds)).not.toContain("FX-07");
    expect(r.adds).toHaveLength(17);
  });

  it.each(["FX-01", "FX-07", "FX-20"])(
    "%s 가 던져도 다른 대상은 계속 처리한다(run 18건 시도, 17건 enqueue)",
    async (fixtureId) => {
      const r = await run({ ensureErrors: throwsFor(fixtureId) });
      expect(r.ensured).toHaveLength(18);
      expect(addedFixtures(r.adds).toSorted()).toEqual(
        EXPECTED.map((bid) => bid.fixtureId).filter((id) => id !== fixtureId),
      );
    },
  );

  it("던진 대상은 failed 로 세고 exit 1 이다", async () => {
    const r = await run({ ensureErrors: throwsFor("FX-07") });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=0 failed=1",
    });
  });

  it("던진 대상은 폴링하지 않아 deadline 까지 기다리지 않는다", async () => {
    const r = await run({ ensureErrors: throwsFor("FX-07") });
    expect(r.statusReads).toHaveLength(1);
    expect(r.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(DEADLINE_MS);
  });

  it("던진 대상의 fixtureId 를 한 줄 마지막 줄 앞에 찍는다", async () => {
    const r = await run({ ensureErrors: throwsFor("FX-07") });
    expect(fixtureLines(r).map((line) => line.match(FIXTURE_ID))).toEqual([["FX-07"]]);
  });

  it("오류 message 를 로그와 마지막 줄에 싣지 않는다", async () => {
    const r = await run({ ensureErrors: throwsFor("FX-07", "FX-13") });
    for (const line of transcriptOf(r.lines, r.result.line)) {
      expect(line).not.toContain(ENSURE_LEAK);
      expect(line).not.toContain("score_runs_active_input_key");
    }
  });

  it("모든 대상이 던지면 enqueue 없이 failed=18 이고 exit 1 이다", async () => {
    const r = await run({ ensureErrors: new Set(EXPECTED.map((bid) => bid.fixtureId)) });
    expect(r.adds).toEqual([]);
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=0 partial=0 failed=18",
    });
  });

  it("모든 대상이 던지면 상태를 읽지 않는다", async () => {
    const r = await run({ ensureErrors: new Set(EXPECTED.map((bid) => bid.fixtureId)) });
    for (const read of r.statusReads) expect(read.ids).toEqual([]);
    expect(r.sleeps).toEqual([]);
  });
});

// ── 기다리기 ──

describe("runPreanalyze · 기다리기", () => {
  /** 첫 읽기에는 FX-05 가 RUNNING, 그다음부터 모두 COMPLETED. */
  const finishesOnSecondRead = (fixtureId: string, readIndex: number): ScoreRunStatus =>
    fixtureId === "FX-05" && readIndex === 0 ? "RUNNING" : "COMPLETED";

  it("모든 run 이 끝나면 더 읽지 않는다", async () => {
    const r = await run({ poll: finishesOnSecondRead });
    expect(r.statusReads).toHaveLength(2);
    expect(r.result.exitCode).toBe(0);
  });

  it("첫 읽기에 모두 끝났으면(COMPLETED·PARTIAL·FAILED) 한 번만 읽는다", async () => {
    const r = await run({
      poll: (fixtureId) =>
        fixtureId === "FX-05" ? "PARTIAL" : fixtureId === "FX-13" ? "FAILED" : "COMPLETED",
    });
    expect(r.statusReads).toHaveLength(1);
  });

  it("상태는 데모 조직 id 와 enqueue 한 run id 로 읽는다", async () => {
    const r = await run({ poll: finishesOnSecondRead });
    const enqueued = r.adds.map((add) => add.data.scoreRunId);
    for (const read of r.statusReads) expect(read.orgId).toBe(ORG_ID);
    expect(r.statusReads[0]?.ids).toEqual(expect.arrayContaining(enqueued));
  });

  it("읽기 사이에는 pollMs 만큼 sleep 한다", async () => {
    const r = await run({ poll: finishesOnSecondRead, pollMs: 1_500 });
    expect(r.sleeps.length).toBeGreaterThanOrEqual(r.statusReads.length - 1);
    for (const ms of r.sleeps) expect(ms).toBe(1_500);
  });

  it("deadlineMs 가 지나면 남은 run 을 pending 으로 두고 멈춘다", async () => {
    const r = await run({
      poll: (fixtureId) => (fixtureId === "FX-20" ? "QUEUED" : "COMPLETED"),
      deadlineMs: 10_000,
      pollMs: 2_000,
    });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=0 failed=0",
    });
  });

  it("deadline 전에는 멈추지 않고 deadline 을 크게 넘기지도 않는다", async () => {
    const r = await run({
      poll: (fixtureId) => (fixtureId === "FX-20" ? "RUNNING" : "COMPLETED"),
      deadlineMs: 10_000,
      pollMs: 2_000,
    });
    const slept = r.sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(10_000 - 2_000);
    expect(slept).toBeLessThanOrEqual(10_000 + 2_000);
  });

  it("전체 상한 10분(600000ms)·2초 간격에서도 끝나지 않는 run 이 있으면 멈춘다", async () => {
    const r = await run({ poll: (fixtureId) => (fixtureId === "FX-20" ? "RUNNING" : "COMPLETED") });
    expect(r.result.exitCode).toBe(1);
    const slept = r.sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(slept).toBeLessThanOrEqual(DEADLINE_MS + POLL_MS);
  });
});

// ── 마지막 줄과 종료 코드 ──

describe("runPreanalyze · 마지막 줄과 종료 코드", () => {
  it("18건 모두 COMPLETED 면 exit 0 이고 마지막 줄은 'preanalyze: targets=18 completed=18 partial=0 failed=0' 이다", async () => {
    const r = await run();
    expect(r.result).toEqual({
      exitCode: 0,
      line: "preanalyze: targets=18 completed=18 partial=0 failed=0",
    });
  });

  it("마지막 줄 뒤에 다른 줄을 찍지 않는다", async () => {
    const r = await run();
    const transcript = transcriptOf(r.lines, r.result.line);
    expect(transcript.at(-1)).toBe(r.result.line);
  });

  it("PARTIAL 이 하나면 exit 1 이고 partial=1 로 센다", async () => {
    const r = await run({ poll: (fixtureId) => (fixtureId === "FX-05" ? "PARTIAL" : "COMPLETED") });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=1 failed=0",
    });
  });

  it("FAILED 가 하나면 exit 1 이고 failed=1 로 센다", async () => {
    const r = await run({ poll: (fixtureId) => (fixtureId === "FX-13" ? "FAILED" : "COMPLETED") });
    expect(r.result).toEqual({
      exitCode: 1,
      line: "preanalyze: targets=18 completed=17 partial=0 failed=1",
    });
  });

  it("PARTIAL·FAILED·pending 인 공고만 fixtureId 를 한 줄씩 마지막 줄 앞에 찍는다", async () => {
    const r = await run({
      poll: (fixtureId) =>
        fixtureId === "FX-05"
          ? "PARTIAL"
          : fixtureId === "FX-13"
            ? "FAILED"
            : fixtureId === "FX-20"
              ? "RUNNING"
              : "COMPLETED",
      deadlineMs: 10_000,
    });
    expect(r.result.line).toBe("preanalyze: targets=18 completed=15 partial=1 failed=1");
    const lines = fixtureLines(r);
    for (const line of lines) expect(line.match(FIXTURE_ID)).toHaveLength(1);
    expect(lines.map((line) => line.match(FIXTURE_ID)?.[0]).toSorted()).toEqual([
      "FX-05",
      "FX-13",
      "FX-20",
    ]);
  });

  it("모두 COMPLETED 면 fixtureId 줄을 찍지 않는다", async () => {
    const r = await run();
    expect(fixtureLines(r)).toEqual([]);
  });
});

// ── 로그 ──

describe("runPreanalyze · 로그", () => {
  async function noisyRun() {
    return run({
      poll: (fixtureId) =>
        fixtureId === "FX-05" ? "PARTIAL" : fixtureId === "FX-13" ? "FAILED" : "COMPLETED",
      extraColumns: { score: 94, recommendation: "BID", explanation: "LEAK-설명-원문" },
    });
  }

  it("로그와 마지막 줄에 공고 원문(제목·본문)을 싣지 않는다", async () => {
    const r = await noisyRun();
    expect(BID_TEXTS.length).toBeGreaterThan(0);
    for (const line of transcriptOf(r.lines, r.result.line)) {
      for (const text of BID_TEXTS) expect(line).not.toContain(text);
    }
  });

  it("로그와 마지막 줄에 점수·설명 같은 run 결과 값을 싣지 않는다", async () => {
    const r = await noisyRun();
    for (const line of transcriptOf(r.lines, r.result.line)) {
      expect(line).not.toContain("LEAK-");
      expect(line).not.toMatch(/\b94\b/);
      expect(line).not.toContain("explanation");
    }
  });
});
