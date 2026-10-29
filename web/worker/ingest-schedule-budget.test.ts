import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_INGEST_SUMMARY,
  G2B_AUX_OPERATIONS,
  G2B_BID_NOTICE_LIST_OPERATION,
  createG2bAuxFetcher,
  createMemoryQuotaStore,
  createOfficialApiConnector,
  quotaKey,
  quotaState,
  type BidSourceConnector,
  type IngestCompleteness,
  type IngestionRepo,
  type IngestQuota,
  type IngestRunStatus,
  type IngestSummary,
  type StartRunInput,
  type StartedRun,
} from "@/server/ingestion";
import {
  ingestJobTimingOf,
  processIngestJob,
  type IngestJobDeps,
  type IngestJobTiming,
} from "@/worker/ingest-queue";
import { SCHEDULED_WINDOW_CAP_MINUTES } from "@/worker/ingest-only-main";
import {
  MANUAL_RESERVED_CALLS,
  createG2bQuotas,
  manualDailyLimitOf,
  type QuotaRedis,
} from "@/worker/quota-store";

// ── 정기 수집 일정 전환(10-26)의 job 처리 규칙: job 시각 기록, 수동 수집 예산 몫, 24시간 창 상한과 창 잇기 ──
// 실제 Redis·Supabase·공공 API 는 부르지 않는다. 공공 API 응답은 아래 fetch 가짜가 만든다.

const SERVICE_ID = "15129394";
const DAILY_LIMIT = 1000;
const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const retry = { sleep: async () => undefined, random: () => 0 };
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

// Redis 예산 키를 흉내 낸다. 두 Lua(예약·소진 표시)의 계약만 옮겼다: 예약은 사용량 < ARGV 한도일 때만 1 을 더한다.
// 실제 Lua·TTL 은 저장소 밖 통합 확인(실 Redis)이 본다.
function fakeQuotaRedis() {
  const values = new Map<string, string>();
  const usedOf = (key: string): number => {
    const raw = values.get(key);
    if (raw === undefined) return 0;
    return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const evalCommand = vi.fn(
    async (script: string, _keys: number, key: string, limit: number): Promise<number> => {
      const used = usedOf(key);
      if (script.includes("redis.call('INCR'")) {
        if (!Number.isFinite(used) || used >= limit) return 0;
        values.set(key, String(used + 1));
        return 1;
      }
      if (!Number.isFinite(used) || used < limit) values.set(key, String(limit));
      return 1;
    },
  );
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    eval: evalCommand,
    incrby: vi.fn(async (key: string, calls: number) => {
      const next = usedOf(key) + calls;
      values.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { redis: redis as unknown as QuotaRedis, values, evalCommand, raw: redis };
}

type FakeRun = {
  runId: string;
  input: StartRunInput;
  status: IngestRunStatus;
  completeness: IngestCompleteness;
  cursor: string | null;
  summary: IngestSummary;
  quotaUsed: number;
};

type WindowScope = NonNullable<Parameters<IngestionRepo["findLatestRunWindow"]>[2]>;
const SCOPE_KEYS = ["serviceKey", "operation", "partitionKey"] as const;

const windowOfParams = (params: Record<string, unknown> | null) => {
  const window = params?.window;
  if (typeof window !== "object" || window === null) return null;
  const { from, to } = window as Record<string, unknown>;
  return typeof from === "string" && typeof to === "string" ? { from, to } : null;
};

// ingestion.repo.ts 와 같은 규칙의 저장소 가짜: jobKey 가 같으면 그 run 을 다시 연다(성공한 run 은 그대로),
// 창 끝은 SUCCEEDED + COMPLETE run 만, 직전 창은 상태와 무관하게 가장 최근에 연 run 을 본다(C8).
function statefulRepo() {
  const runs: FakeRun[] = [];
  const errors: { runId: string; errorCode: string; sourceKey: string }[] = [];
  let savedRevisions = 0;
  const runOf = (runId: string): FakeRun => {
    const run = runs.find((candidate) => candidate.runId === runId);
    if (run === undefined) throw new Error(`없는 run: ${runId}`);
    return run;
  };
  const startedOf = (run: FakeRun): StartedRun => ({
    runId: run.runId,
    status: run.status,
    cursor: run.cursor,
    summary: { ...run.summary },
    params: structuredClone(run.input.params),
    quotaUsed: run.quotaUsed,
    completeness: run.completeness,
  });
  const inScope = (
    run: FakeRun,
    source: string,
    trigger: string,
    scope: WindowScope = {},
  ): boolean =>
    run.input.source === source &&
    run.input.trigger === trigger &&
    SCOPE_KEYS.every((key) => scope[key] === undefined || run.input[key] === scope[key]);
  const repo: IngestionRepo = {
    startRun: async (input) => {
      const existing = runs.find((run) => run.input.jobKey === input.jobKey);
      if (existing !== undefined) {
        if (existing.status !== "SUCCEEDED") existing.status = "RUNNING";
        return startedOf(existing);
      }
      const run: FakeRun = {
        runId: input.runId ?? `run-${runs.length + 1}`,
        input: structuredClone(input),
        status: "RUNNING",
        completeness: input.serviceKey === undefined ? "COMPLETE" : "UNKNOWN",
        cursor: null,
        summary: { ...EMPTY_INGEST_SUMMARY },
        quotaUsed: 0,
      };
      runs.push(run);
      return startedOf(run);
    },
    findLatestRevision: async () => null,
    findLatestSeedAnchor: async () => null,
    findLatestRunWindow: async (source, trigger, scope) => {
      const last = runs.filter((run) => inScope(run, source, trigger, scope)).at(-1);
      return last === undefined
        ? null
        : {
            status: last.status,
            completeness: last.completeness,
            window: windowOfParams(last.input.params),
          };
    },
    findLatestRunWindowEnd: async (source, trigger, scope) => {
      const last = runs
        .filter(
          (run) =>
            inScope(run, source, trigger, scope) &&
            run.status === "SUCCEEDED" &&
            run.completeness === "COMPLETE",
        )
        .at(-1);
      const window = last === undefined ? null : windowOfParams(last.input.params);
      return window === null ? null : new Date(window.to);
    },
    saveRevision: async () => {
      savedRevisions += 1;
      return {
        bidId: `bid-${savedRevisions}`,
        revisionId: `rev-${savedRevisions}`,
        revisionCreatedAt: new Date(Date.UTC(2026, 9, 26, 0, 0, savedRevisions)).toISOString(),
      };
    },
    recordError: async (runId, error) => {
      errors.push({ runId, errorCode: error.errorCode, sourceKey: error.sourceKey });
    },
    saveCheckpoint: async (runId, checkpoint) => {
      const run = runOf(runId);
      run.cursor = checkpoint.cursor;
      run.summary = { ...checkpoint.summary };
      if (checkpoint.quotaUsed !== undefined) run.quotaUsed = checkpoint.quotaUsed;
      if (checkpoint.completeness !== undefined) run.completeness = checkpoint.completeness;
    },
    finishRun: async (runId, result) => {
      const run = runOf(runId);
      run.status = result.status;
      run.summary = { ...result.summary };
      if (result.quotaUsed !== undefined) run.quotaUsed = result.quotaUsed;
      if (result.completeness !== undefined) run.completeness = result.completeness;
    },
  };
  return { repo, runs, errors, savedRevisions: () => savedRevisions };
}

const unusedConnector = async (): Promise<BidSourceConnector> => {
  throw new Error("이 시험에서는 만들지 않는다");
};

function baseDeps(repo: IngestionRepo, overrides: Partial<IngestJobDeps>): IngestJobDeps {
  return {
    repo,
    runMode: "live",
    createFixtureConnector: unusedConnector,
    createG2bConnector: unusedConnector,
    enqueueDocuments: async () => undefined,
    recordManualAudit: async () => undefined,
    now: () => new Date("2026-10-26T03:00:00.000Z"),
    retry,
    secrets: [],
    ...overrides,
  };
}

const SCHEDULED_JOB = { source: "g2b", trigger: "SCHEDULED", jobKey: "g2b:SCHEDULED" };
const manualJob = (jobKey: string) => ({
  source: "g2b",
  trigger: "MANUAL",
  jobKey,
  orgId: ORG_ID,
  requestedBy: USER_ID,
});

describe("job 시각(ingest_runs.params.timing)", () => {
  const SLOT = Date.parse("2026-10-26T06:00:00.000Z"); // KST 15:00 정각
  const NOW = new Date("2026-10-26T06:10:00.000Z");

  it("일정 회차 job 은 job id 의 정각을 예정 시각으로, BullMQ processedOn 을 시작 시각으로 쓴다", () => {
    expect(
      ingestJobTimingOf(
        {
          id: `repeat:g2b-scheduled:${SLOT}`,
          repeatJobKey: "g2b-scheduled",
          timestamp: SLOT - 3 * 3_600_000,
          processedOn: SLOT + 125_000,
        },
        NOW,
      ),
    ).toEqual({
      scheduledFor: "2026-10-26T06:00:00.000Z",
      enqueuedAt: "2026-10-26T03:00:00.000Z",
      startedAt: "2026-10-26T06:02:05.000Z",
      queueDelayMs: 125_000,
    });
  });

  it("수동 job 은 큐 등록 시각을 예정 시각으로 쓰고, processedOn 이 없으면 지금을 시작 시각으로 쓴다", () => {
    const enqueued = Date.parse("2026-10-26T05:59:30.000Z");
    expect(
      ingestJobTimingOf({ id: "manual%3Aorg%3Areq", timestamp: enqueued, processedOn: SLOT }, NOW),
    ).toMatchObject({ scheduledFor: "2026-10-26T05:59:30.000Z", queueDelayMs: 30_000 });
    expect(ingestJobTimingOf({ id: "manual%3Aorg%3Areq", timestamp: enqueued }, NOW)).toEqual({
      scheduledFor: "2026-10-26T05:59:30.000Z",
      enqueuedAt: "2026-10-26T05:59:30.000Z",
      startedAt: "2026-10-26T06:10:00.000Z",
      queueDelayMs: 630_000,
    });
  });

  it("다른 일정의 id 모양이면(repeatJobKey 가 다르면) 정각으로 읽지 않는다. 시각이 숫자가 아니면 기록하지 않는다", () => {
    const timestamp = SLOT - 1_000;
    expect(
      ingestJobTimingOf(
        { id: `repeat:g2b-scheduled:${SLOT}`, repeatJobKey: "other", timestamp },
        NOW,
      )?.scheduledFor,
    ).toBe(new Date(timestamp).toISOString());
    expect(ingestJobTimingOf({ timestamp: Number.NaN }, NOW)).toBeNull();
  });

  const timing: IngestJobTiming = {
    scheduledFor: "2026-10-26T06:00:00.000Z",
    enqueuedAt: "2026-10-26T03:00:00.000Z",
    startedAt: "2026-10-26T06:00:02.000Z",
    queueDelayMs: 2_000,
  };
  const emptyG2b: BidSourceConnector = {
    source: "g2b",
    fetchPage: async () => ({
      ok: true,
      page: { records: [], nextCursor: null, rateLimitInfo: null },
    }),
  };

  it("정기·외부 소스 run 의 params 에 timing 을 넣고 시각·ms 만 담은 한 줄을 남긴다", async () => {
    const { repo, runs } = statefulRepo();
    const log = vi.fn<(line: string) => void>();
    const quota: IngestQuota = {
      store: createMemoryQuotaStore({ dailyLimit: DAILY_LIMIT }),
      serviceId: SERVICE_ID,
      dailyLimit: DAILY_LIMIT,
    };
    const deps = baseDeps(repo, {
      log,
      quota,
      createG2bConnector: async () => emptyG2b,
      createExternalConnector: async () => ({ ...emptyG2b, source: "lh" }),
      externalSourceGate: () => null,
      quotaForExternal: () => quota,
      now: () => new Date("2026-10-26T06:00:02.000Z"),
    });
    await processIngestJob(SCHEDULED_JOB, deps, timing);
    await processIngestJob(
      { source: "lh", serviceKey: "lh-bid-notice", trigger: "SCHEDULED", jobKey: "lh" },
      deps,
      timing,
    );
    expect(runs.map((run) => run.input.params?.timing)).toEqual([timing, timing]);
    expect(log.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "ingest.job.timing",
          source: "g2b",
          trigger: "SCHEDULED",
          ...timing,
        }),
      ],
      [
        JSON.stringify({
          event: "ingest.job.timing",
          source: "lh",
          trigger: "SCHEDULED",
          ...timing,
        }),
      ],
    ]);
  });

  it("이어 가는 run(같은 jobKey)은 처음 params 를 그대로 두고 깨지지 않는다. 이번 시도의 시각은 로그에 남는다", async () => {
    const { repo, runs } = statefulRepo();
    const log = vi.fn<(line: string) => void>();
    const failing: BidSourceConnector = {
      source: "g2b",
      fetchPage: async () => ({
        ok: false,
        failure: { kind: "HTTP_ERROR", status: 400, detail: "x" },
      }),
    };
    const quota: IngestQuota = {
      store: createMemoryQuotaStore({ dailyLimit: DAILY_LIMIT }),
      serviceId: SERVICE_ID,
      dailyLimit: DAILY_LIMIT,
    };
    const first = baseDeps(repo, { quota, createG2bConnector: async () => failing });
    // 시각 없이 연(배포 전 worker 가 연) 실패 run 을 다음 회차가 시각과 함께 이어 간다.
    expect((await processIngestJob(SCHEDULED_JOB, first)).status).toBe("FAILED");
    const later = baseDeps(repo, {
      quota,
      log,
      createG2bConnector: async () => emptyG2b,
      now: () => new Date("2026-10-26T06:00:02.000Z"),
    });
    const resumed = await processIngestJob(SCHEDULED_JOB, later, timing);
    expect(resumed.status).toBe("SUCCEEDED");
    expect(runs).toHaveLength(1);
    expect(runs[0].input.params).not.toHaveProperty("timing");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

// 공고 1건 + 보조 조회 3종(빈 응답)을 돌려주는 공공 API 가짜. 호출을 operation 별로 센다.
function g2bApi() {
  const operations: string[] = [];
  const item = {
    bidNtceNo: "BUDGET-001",
    bidNtceOrd: "000",
    bidNtceNm: "데이터 시스템 용역",
    ntceKindNm: "등록공고",
    dminsttNm: "시험기관",
    bidNtceDt: "2026-10-26 09:00:00",
    bidClseDt: "2026-10-30 18:00:00",
    bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
  };
  const fetch = async (url: string) => {
    const operation = new URL(url).pathname.split("/").at(-1) ?? "";
    operations.push(operation);
    const items = operation === G2B_BID_NOTICE_LIST_OPERATION ? [item] : [];
    return Response.json({
      response: { header: { resultCode: "00" }, body: { items, totalCount: items.length } },
    });
  };
  const config = { endpoint: ENDPOINT, serviceKey: "test-only-key", fetch };
  return {
    operations,
    listCalls: () => operations.filter((op) => op === G2B_BID_NOTICE_LIST_OPERATION).length,
    auxCalls: () => operations.filter((op) => op !== G2B_BID_NOTICE_LIST_OPERATION).length,
    connector: async () => createOfficialApiConnector({ ...config, isInfoBizNotice: () => true }),
    aux: async () => createG2bAuxFetcher({ ...config, retry }),
  };
}

describe("수동 수집 예산 몫(MANUAL_RESERVED_CALLS)", () => {
  const AT = new Date("2026-10-26T03:00:00.000Z"); // KST 12:00
  const KEY = quotaKey(SERVICE_ID, AT);
  const WINDOW = { from: "2026-10-26T00:00:00.000Z", to: "2026-10-26T03:00:00.000Z" };

  it("수동 한도는 일 한도에서 200 을 뺀 값이다(registry 1000 → 800, 200 이하 → 0)", () => {
    expect(manualDailyLimitOf(DAILY_LIMIT)).toBe(DAILY_LIMIT - MANUAL_RESERVED_CALLS);
    expect(manualDailyLimitOf(DAILY_LIMIT)).toBe(800);
    expect(manualDailyLimitOf(150)).toBe(0);
  });

  it.each([
    { trigger: "MANUAL", used: 719, state: "OK", reserves: true },
    { trigger: "MANUAL", used: 720, state: "AUXILIARY_STOPPED", reserves: true },
    { trigger: "MANUAL", used: 799, state: "AUXILIARY_STOPPED", reserves: true },
    { trigger: "MANUAL", used: 800, state: "EXHAUSTED", reserves: false },
    { trigger: "SCHEDULED", used: 800, state: "OK", reserves: true },
    { trigger: "SCHEDULED", used: 899, state: "OK", reserves: true },
    { trigger: "SCHEDULED", used: 900, state: "AUXILIARY_STOPPED", reserves: true },
    { trigger: "SCHEDULED", used: 999, state: "AUXILIARY_STOPPED", reserves: true },
    { trigger: "SCHEDULED", used: 1000, state: "EXHAUSTED", reserves: false },
  ] as const)(
    "$trigger 사용량 $used → $state, 다음 1회 예약 $reserves (같은 키)",
    async ({ trigger, used, state, reserves }) => {
      const fake = fakeQuotaRedis();
      fake.values.set(KEY, String(used));
      const quotas = createG2bQuotas(fake.redis, {
        serviceId: SERVICE_ID,
        dailyLimit: DAILY_LIMIT,
      });
      const quota = trigger === "MANUAL" ? quotas.manual : quotas.scheduled;
      expect(quotaState(await quota.store.get(SERVICE_ID, AT), quota.dailyLimit)).toBe(state);
      expect(await quota.store.reserve(SERVICE_ID, AT)).toBe(reserves);
      expect(fake.values.get(KEY)).toBe(String(reserves ? used + 1 : used));
      // 두 예산은 키 하나를 센다. Lua 한도(ARGV)만 다르다.
      expect(fake.evalCommand.mock.calls.map((call) => [call[2], call[3]])).toEqual([
        [KEY, trigger === "MANUAL" ? 800 : 1000],
      ]);
    },
  );

  it("수동 예산이 결과코드 22 로 소진을 표시하면 일 한도(1000)까지 올려 정기 수집도 그날 멈춘다", async () => {
    const fake = fakeQuotaRedis();
    fake.values.set(KEY, "300");
    const { manual, scheduled } = createG2bQuotas(fake.redis, {
      serviceId: SERVICE_ID,
      dailyLimit: DAILY_LIMIT,
    });
    await manual.store.markExhausted(SERVICE_ID, AT);
    expect(fake.values.get(KEY)).toBe("1000");
    expect(await scheduled.store.reserve(SERVICE_ID, AT)).toBe(false);
  });

  // 2026-10-29: 한도는 오퍼레이션마다 따로다. 목록 카운터(KEY)와 보조 3종 카운터(AUX_KEYS)를 같은 값에서 시작해,
  // 목록은 목록 카운터로, 보조 조회는 보조 카운터(90% 경계)로 판정하는지 본다.
  const AUX_KEYS = G2B_AUX_OPERATIONS.map(({ registryKey }) =>
    quotaKey(`${SERVICE_ID}:${registryKey}`, AT),
  );
  it.each([
    { trigger: "MANUAL", before: 719, list: 1, aux: 3, after: 720, status: "SUCCEEDED" },
    { trigger: "MANUAL", before: 720, list: 1, aux: 0, after: 721, status: "SUCCEEDED" },
    { trigger: "MANUAL", before: 799, list: 1, aux: 0, after: 800, status: "SUCCEEDED" },
    { trigger: "MANUAL", before: 800, list: 0, aux: 0, after: 800, status: "FAILED" },
    { trigger: "SCHEDULED", before: 800, list: 1, aux: 3, after: 801, status: "SUCCEEDED" },
    { trigger: "SCHEDULED", before: 899, list: 1, aux: 3, after: 900, status: "SUCCEEDED" },
    { trigger: "SCHEDULED", before: 900, list: 1, aux: 0, after: 901, status: "SUCCEEDED" },
    { trigger: "SCHEDULED", before: 999, list: 1, aux: 0, after: 1000, status: "SUCCEEDED" },
    { trigger: "SCHEDULED", before: 1000, list: 0, aux: 0, after: 1000, status: "FAILED" },
  ] as const)(
    "$trigger g2b job: 실행 전 사용량 $before(목록·보조 각각) → 목록 $list·보조 $aux 회, 끝 목록 사용량 $after, $status",
    async ({ trigger, before, list, aux, after, status }) => {
      const fake = fakeQuotaRedis();
      for (const key of [KEY, ...AUX_KEYS]) fake.values.set(key, String(before));
      const quotas = createG2bQuotas(fake.redis, {
        serviceId: SERVICE_ID,
        dailyLimit: DAILY_LIMIT,
      });
      const api = g2bApi();
      const { repo, runs, errors } = statefulRepo();
      const data =
        trigger === "MANUAL"
          ? { ...manualJob("manual:budget"), window: WINDOW }
          : { ...SCHEDULED_JOB, jobKey: "g2b:ONCE:budget", window: WINDOW };
      const result = await processIngestJob(
        data,
        baseDeps(repo, {
          quota: quotas.scheduled,
          manualQuota: quotas.manual,
          createG2bConnector: api.connector,
          createG2bAuxFetcher: api.aux,
          now: () => AT,
        }),
      );
      expect({
        status: result.status,
        list: api.listCalls(),
        aux: api.auxCalls(),
        after: fake.values.get(KEY),
        auxAfter: AUX_KEYS.map((key) => fake.values.get(key)),
      }).toEqual({
        status,
        list,
        aux,
        after: String(after),
        auxAfter: AUX_KEYS.map(() => String(aux === 0 ? before : before + 1)),
      });
      // 예산이 없어도 run 행은 열리고, 소진 사유가 기존 코드로 남는다.
      expect(runs).toHaveLength(1);
      expect(errors.filter((error) => error.errorCode === "QUOTA_EXCEEDED")).toEqual(
        status === "FAILED"
          ? [{ runId: runs[0].runId, errorCode: "QUOTA_EXCEEDED", sourceKey: "g2b:quota" }]
          : [],
      );
    },
  );

  it("live 수동 g2b job 에 수동 예산이 없으면 connector 를 만들지 않고 QUOTA_STORE_UNAVAILABLE 로 닫는다", async () => {
    const { repo, errors } = statefulRepo();
    const createG2bConnector = vi.fn(unusedConnector);
    const result = await processIngestJob(
      manualJob("manual:no-quota"),
      baseDeps(repo, {
        quota: {
          store: createMemoryQuotaStore({ dailyLimit: DAILY_LIMIT }),
          serviceId: SERVICE_ID,
          dailyLimit: DAILY_LIMIT,
        },
        createG2bConnector,
      }),
    );
    expect(result.status).toBe("FAILED");
    expect(createG2bConnector).not.toHaveBeenCalled();
    expect(errors.map((error) => error.errorCode)).toEqual(["QUOTA_STORE_UNAVAILABLE"]);
  });

  it("Redis 오류면 수동 수집도 호출하지 않고 QUOTA_STORE_UNAVAILABLE 로 닫는다(오류 원문 없음)", async () => {
    const fake = fakeQuotaRedis();
    const refused = new Error("connect ECONNREFUSED 10.1.2.3:6379");
    fake.raw.get.mockRejectedValue(refused);
    fake.evalCommand.mockRejectedValue(refused);
    const quotas = createG2bQuotas(fake.redis, { serviceId: SERVICE_ID, dailyLimit: DAILY_LIMIT });
    const api = g2bApi();
    const { repo, errors } = statefulRepo();
    const result = await processIngestJob(
      { ...manualJob("manual:redis-down"), window: WINDOW },
      baseDeps(repo, {
        quota: quotas.scheduled,
        manualQuota: quotas.manual,
        createG2bConnector: api.connector,
        now: () => AT,
      }),
    );
    expect(result.status).toBe("FAILED");
    expect(api.operations).toEqual([]);
    expect(errors.map((error) => error.errorCode)).toContain("QUOTA_STORE_UNAVAILABLE");
    expect(JSON.stringify(errors)).not.toContain("10.1.2.3");
  });
});

describe("정기 창 잇기(24시간 상한·실패 창 재사용·cursor 재개)", () => {
  // 쪽 두 개(cursor null → p2 → 끝)를 돌려주고, 쪽마다 HTTP 직전 예산을 예약하는 connector 가짜
  const pagedConnector = (cursors: (string | null)[]): BidSourceConnector => ({
    source: "g2b",
    fetchPage: async (input) => {
      const blocked = (await input.beforeRequest?.()) ?? null;
      if (blocked !== null) return { ok: false, failure: blocked };
      cursors.push(input.cursor);
      return {
        ok: true,
        page: { records: [], nextCursor: input.cursor === null ? "p2" : null, rateLimitInfo: null },
      };
    },
  });

  // KST 10-26 09시부터 10-27 03시까지 정각마다 정기 회차를 돈다. 12시 회차 첫 쪽에서 그날 예산(1000)을 다 쓴다.
  async function runDay(capMinutes: number) {
    const { repo, runs, errors } = statefulRepo();
    const store = createMemoryQuotaStore({ dailyLimit: DAILY_LIMIT });
    const cursors: (string | null)[] = [];
    let clock = new Date("2026-10-26T00:00:00.000Z");
    const deps = baseDeps(repo, {
      quota: { store, serviceId: SERVICE_ID, dailyLimit: DAILY_LIMIT },
      createG2bConnector: async () => pagedConnector(cursors),
      now: () => clock,
      scheduledWindowCap: { maxMs: capMinutes * 60_000, log: () => undefined },
    });
    const slots = [0, 3, 6, 9, 12, 15, 18].map((hour) => new Date(Date.UTC(2026, 9, 26, hour)));
    const statuses: string[] = [];
    for (const slot of slots) {
      clock = slot;
      // KST 12시(UTC 03시) 회차 직전, 그날 사용량을 999 로 둔다. 첫 쪽이 1000번째 호출이다.
      if (slot.getUTCHours() === 3) {
        const used = await store.get(SERVICE_ID, slot);
        await store.add(SERVICE_ID, slot, 999 - used);
      }
      statuses.push((await processIngestJob(SCHEDULED_JOB, deps)).status);
    }
    return { runs, errors, cursors, statuses, store };
  }

  it("상한 24시간이면 그날 예산 소진 뒤에도 자정 회차가 실패 창을 cursor 부터 잇고, 앞 run 의 to = 다음 run 의 from 이다", async () => {
    const { runs, errors, cursors, statuses, store } = await runDay(SCHEDULED_WINDOW_CAP_MINUTES);
    // KST 09 성공, 12·15·18·21 소진, 10-27 00 재개 성공, 03 성공
    expect(statuses).toEqual([
      "SUCCEEDED",
      "FAILED",
      "FAILED",
      "FAILED",
      "FAILED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    expect(
      runs.map((run) => ({
        jobKey: run.input.jobKey,
        window: run.input.params?.window,
        windowCap: run.input.params?.windowCap,
        status: run.status,
      })),
    ).toEqual([
      {
        jobKey: "g2b:SCHEDULED:2026-10-26T00:00:00.000Z",
        window: { from: "2026-10-25T00:00:00.000Z", to: "2026-10-26T00:00:00.000Z" },
        windowCap: undefined,
        status: "SUCCEEDED",
      },
      {
        jobKey: "g2b:SCHEDULED:2026-10-26T03:00:00.000Z",
        window: { from: "2026-10-26T00:00:00.000Z", to: "2026-10-26T03:00:00.000Z" },
        windowCap: undefined,
        status: "SUCCEEDED",
      },
      {
        jobKey: "g2b:SCHEDULED:2026-10-26T18:00:00.000Z",
        window: { from: "2026-10-26T03:00:00.000Z", to: "2026-10-26T18:00:00.000Z" },
        windowCap: undefined,
        status: "SUCCEEDED",
      },
    ]);
    // 실패한 12시 회차는 첫 쪽을 받고 p2 에서 멈췄다. 15·18·21시는 호출 없이 실패하고, 자정 회차가 p2 부터 잇는다.
    expect(cursors).toEqual([null, "p2", null, "p2", null, "p2"]);
    expect(errors.filter((error) => error.errorCode === "QUOTA_EXCEEDED")).toHaveLength(4);
    expect(new Set(errors.map((error) => error.runId))).toEqual(new Set([runs[1].runId]));
    expect(await store.get(SERVICE_ID, new Date("2026-10-26T03:00:00.000Z"))).toBe(1000);
    expect(await store.get(SERVICE_ID, new Date("2026-10-26T15:00:00.000Z"))).toBe(3);
  });

  it("상한이 6시간(옛 2주기)이면 같은 하루에서 실패 창을 버리고 잘라 빈틈이 생긴다(24시간으로 올린 이유)", async () => {
    const { runs } = await runDay(360);
    const succeeded = runs
      .filter((run) => run.status === "SUCCEEDED")
      .map((run) => windowOfParams(run.input.params));
    const contiguous = succeeded.every(
      (window, index) => index === 0 || window?.from === succeeded[index - 1]?.to,
    );
    expect(contiguous).toBe(false);
    expect(runs.some((run) => run.input.params?.windowCap !== undefined)).toBe(true);
  });
});
