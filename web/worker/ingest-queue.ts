import {
  COVERAGE_UNVERIFIED_SOURCES,
  ingestJobDataSchemaAt,
  EXTERNAL_SERVICES,
  G2B_BID_NOTICE_LIST_OPERATION,
  type ExternalSourceKey,
  runIngest,
  type BidSourceConnector,
  type DocumentsJobData,
  type FixtureBatch,
  type G2bAuxFetcher,
  type IdFor,
  type IngestionRepo,
  type IngestJobData,
  type IngestQuota,
  type IngestRunMode,
  type IngestRunResult,
  type LatestRunWindow,
  type RetryDeps,
  type StartRunInput,
  INGEST_SCHEDULE_SLOT_HOURS_KST,
} from "@/server/ingestion";

// ── ingest job 처리 규칙(6-4). Redis·Supabase·서비스키 연결은 main.ts 가 하고, 여기는 주입받은 것만 쓴다 ──

/** 직전 성공 창이 없을 때(첫 일정 실행) 거슬러 올라가는 길이 */
export const DEFAULT_G2B_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** 로그·--check 에 싣는 정기 수집 일정. 정본은 @/server/ingestion 의 INGEST_SCHEDULE_* 다 */
export const INGEST_SCHEDULE_LABEL = `매일 KST ${INGEST_SCHEDULE_SLOT_HOURS_KST.map((hour) =>
  String(hour).padStart(2, "0"),
).join("·")}시 정각`;

const RUN_MODES = ["live", "fixture", "mock"] as const;
export type RunMode = (typeof RUN_MODES)[number];

type Env = Record<string, string | undefined>;

const RUN_MODE_ENV = "SOL_RUN_MODE";
/**
 * 10-26 전까지 수집 간격(분)을 정하던 env. 지금은 일정이 INGEST_SCHEDULE_PATTERN(KST 3시간 정각)으로 고정이라 읽지 않는다.
 * 회사 서버 env 에 남아 있을 수 있어, 값이 틀려도 기동을 멈추지 않고 "무시함" 한 줄만 남긴다(값은 찍지 않는다).
 */
export const LEGACY_INGEST_INTERVAL_ENV = "G2B_INGEST_INTERVAL_MINUTES";
const MINUTE_MS = 60_000;

/** 대소문자를 접지 않는다. 값이 틀리면 기동을 멈춘다(오류에는 env 이름만 싣는다) */
export function readRunMode(env: Env): RunMode {
  const value = env[RUN_MODE_ENV]?.trim();
  if (value === undefined || value === "") return "mock";
  const mode = RUN_MODES.find((candidate) => candidate === value);
  if (mode === undefined) throw new Error(`worker env 형식 오류: ${RUN_MODE_ENV}`);
  return mode;
}

/** 옛 간격 env 가 있으면(값과 형식은 보지 않는다) 남길 한 줄. 없으면 null */
export const ignoredIngestIntervalNotice = (env: Env): string | null =>
  env[LEGACY_INGEST_INTERVAL_ENV] === undefined
    ? null
    : `${LEGACY_INGEST_INTERVAL_ENV} 무시함: 정기 수집은 ${INGEST_SCHEDULE_LABEL}에 돈다`;

/**
 * job 하나의 예정·등록·실제 시작 시각(ISO)과 큐 대기(ms). ingest_runs.params.timing 과 ingest.job.timing 로그에 싣는다.
 * 예정 시각은 일정 job 이면 그 정각, 수동 job 이면 큐 등록 시각이다. queueDelayMs 가 음수면 시계 차이다(메우지 않는다).
 */
export type IngestJobTiming = {
  scheduledFor: string;
  enqueuedAt: string;
  startedAt: string;
  queueDelayMs: number;
};

/** BullMQ Job 중 시각을 읽는 데 쓰는 것 */
export type QueuedIngestJob = {
  id?: string;
  repeatJobKey?: string;
  timestamp: number;
  processedOn?: number;
};

const SCHEDULER_JOB_ID = /^repeat:(.+):(\d+)$/;

/**
 * BullMQ 6.3.17 의 Job Scheduler 는 회차 job id 를 `repeat:<schedulerId>:<예정 millis>` 로 짓는다
 * (dist/esm/classes/job-scheduler.js getSchedulerNextJobId, commands/addJobScheduler-11.lua·updateJobScheduler-12.lua).
 * timestamp + delay 는 재시도(backoff)·지난 시각 보정(delay 0)으로 바뀌어 예정 시각으로 쓰지 않는다.
 * startedAt 은 BullMQ 가 active 로 옮길 때 적은 processedOn, 없으면 now 다.
 */
export function ingestJobTimingOf(job: QueuedIngestJob, now: Date): IngestJobTiming | null {
  if (!Number.isFinite(job.timestamp)) return null;
  const slot = job.id === undefined ? null : SCHEDULER_JOB_ID.exec(job.id);
  const isSchedulerJob = slot !== null && job.repeatJobKey === slot[1];
  const scheduledMs = isSchedulerJob ? Number(slot[2]) : job.timestamp;
  const startedMs =
    job.processedOn !== undefined && Number.isFinite(job.processedOn)
      ? job.processedOn
      : now.getTime();
  return {
    scheduledFor: new Date(scheduledMs).toISOString(),
    enqueuedAt: new Date(job.timestamp).toISOString(),
    startedAt: new Date(startedMs).toISOString(),
    queueDelayMs: startedMs - scheduledMs,
  };
}

export type ExternalIngestJobData = Exclude<IngestJobData, { source: "fixture" }> & {
  serviceKey: ExternalSourceKey;
};
const isExternalJob = (data: IngestJobData): data is ExternalIngestJobData =>
  data.source !== "fixture" &&
  data.serviceKey !== undefined &&
  data.serviceKey !== "g2b-bid-notice";
export type IngestJobDeps = {
  scheduledExternalJobs?: ExternalIngestJobData[];
  createExternalConnector?(data: ExternalIngestJobData): Promise<BidSourceConnector>;
  externalSourceGate?(data: ExternalIngestJobData): string | null;
  quotaForExternal?(data: ExternalIngestJobData): IngestQuota | undefined;
  repo: IngestionRepo;
  runMode: RunMode;
  createFixtureConnector(batch: FixtureBatch): Promise<BidSourceConnector>;
  createG2bConnector(): Promise<BidSourceConnector>;
  /** 보조 조회 3종(07 §2.2). live 에서만 만든다. 없으면 g2b 수집이 보조 조회 없이 돈다 */
  createG2bAuxFetcher?(): Promise<G2bAuxFetcher>;
  enqueueDocuments(data: DocumentsJobData): Promise<void>;
  recordManualAudit(input: { orgId: string; actorId: string | null; runId: string }): Promise<void>;
  now(): Date;
  retry: RetryDeps;
  idFor?: IdFor;
  secrets: readonly string[];
  /** 호출 예산(07 §2.2). live 에서만 준다. 없으면 g2b 수집이 예산을 보지 않는다 */
  quota?: IngestQuota;
  /**
   * 수동(MANUAL) g2b 입찰공고 수집의 호출 예산. quota 와 같은 카운터 키를 쓰고 한도만 낮다(MANUAL_RESERVED_CALLS 를 뺀 값).
   * 수동 수집이 정기 목록 수집 몫을 다 쓰지 못하게 한다. live 에서 없으면 수동 g2b job 은 QUOTA_STORE_UNAVAILABLE 로 거절한다.
   */
  manualQuota?: IngestQuota;
  /** 주면 job 마다 ingest.job.timing 한 줄을 남긴다(시각·ms·source·trigger 만, 키 값·id 없음) */
  log?: (line: string) => void;
  /**
   * ingest 전용 worker 만 준다(10-25 live 수집 계획 B1). 창을 정하지 않은 정기 g2b 회차의 시작을 `지금 − maxMs` 보다
   * 앞으로 잡지 않는다. 잘라 낸 회차는 params.windowCap 에 남기고 log 로 한 줄 남긴다(키 값 없음).
   * 없으면(전체 worker) 상한 없이 직전 성공 창 끝(없으면 24시간 전)부터 받는다.
   */
  scheduledWindowCap?: { maxMs: number; log: (line: string) => void };
};

/** 정기 g2b 창을 상한으로 잘랐을 때 params.windowCap 에 남기는 값. 잘라 낸 구간은 previousSuccessEnd ~ window.from 이다 */
type WindowCapRecord = { maxMinutes: number; previousSuccessEnd: string | null };

const RUN_MODE_OF: Readonly<Record<RunMode, IngestRunMode>> = {
  live: "LIVE",
  fixture: "FIXTURE",
  mock: "MOCK",
};

// 05·ADR-020: live 는 g2b 만, fixture·mock 은 fixture 만 받는다.
const acceptsSource = (mode: RunMode, source: IngestJobData["source"]): boolean =>
  mode === "live" ? source !== "fixture" : source === "fixture";

const floorToMinute = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);

// 7-1: window.to 가 지금보다 5분 넘게 미래인 job 도 여기서 거른다(큐에 넣은 뒤 시간이 지나 처리돼도 같은 규칙).
function parseJobData(data: unknown, now: Date): IngestJobData {
  const parsed = ingestJobDataSchemaAt(now).safeParse(data);
  if (!parsed.success) {
    // job data 의 값은 오류에 싣지 않는다(요청자 id 등). 경로만 남긴다.
    const paths = [...new Set(parsed.error.issues.map(({ path }) => path.map(String).join(".")))];
    throw new Error(`ingest job data 가 잘못됐다: ${paths.join(", ") || "(root)"}`);
  }
  return parsed.data;
}

// 6-4 보충: window 가 없으면 트리거와 상관없이 직전 성공 창 끝 ~ 지금(분 내림). 없으면 지금 − 1일부터.
// 7-1: 직전 창은 SCHEDULED run 의 것만 본다. MANUAL 의 창(미래일 수 있다)을 이으면 일정 수집이 구간을 건너뛴다.
// C8: 마지막 SCHEDULED run 이 FAILED 면 그 창을 다시 쓴다. jobKey 가 같아져 저장된 cursor 부터 잇는다(07 §2.6).
// 새 24h 창을 열면 재기동·일정마다 같은 공고를 다시 받고 호출 예산을 또 쓴다.
// 10-25 B1: scheduledWindowCap 이 있으면(ingest 전용 worker) 창 시작을 max(직전 성공 창 끝, 지금 − 상한)으로 자른다.
// 상한보다 오래된 실패 창도 다시 쓰지 않는다. 상한보다 긴 백필은 창을 정한 1회 수집(--once)으로만 한다.
async function g2bWindowOf(
  data: Extract<IngestJobData, { source: "g2b" }>,
  deps: IngestJobDeps,
): Promise<{ window: { from: string; to: string }; cap: WindowCapRecord | null }> {
  if (data.window !== undefined) return { window: data.window, cap: null };
  const scope = { serviceKey: "g2b-bid-notice" };
  const capMs = deps.scheduledWindowCap?.maxMs;
  const last = await deps.repo.findLatestRunWindow("g2b", "SCHEDULED", scope);
  if (
    last !== null &&
    last.status === "FAILED" &&
    last.window !== null &&
    (capMs === undefined ||
      Date.parse(last.window.from) >= floorToMinute(deps.now()).getTime() - capMs)
  )
    return { window: last.window, cap: null };
  const to = floorToMinute(deps.now());
  const lastEnd = await deps.repo.findLatestRunWindowEnd("g2b", "SCHEDULED", scope);
  const from = lastEnd ?? new Date(to.getTime() - DEFAULT_G2B_LOOKBACK_MS);
  if (capMs === undefined || from.getTime() >= to.getTime() - capMs) {
    return { window: { from: from.toISOString(), to: to.toISOString() }, cap: null };
  }
  const floor = new Date(to.getTime() - capMs);
  return {
    window: { from: floor.toISOString(), to: to.toISOString() },
    cap: { maxMinutes: capMs / MINUTE_MS, previousSuccessEnd: lastEnd?.toISOString() ?? null },
  };
}

/**
 * 외부 정기 창 상한(10-26 0순위). 첫 수집·오래 멈춘 뒤에도 최근 24시간만 받는다. 3시간 일정이면 하루 8회라
 * 실패 창을 다시 쓰는 동안(같은 날 한도 소진 → 다음 날)도 덮는다. 더 긴 백필은 창을 정한 수동 요청(90일 이하)으로 한다.
 */
export const EXTERNAL_WINDOW_CAP_MS = 24 * 60 * 60 * 1000;

/** 외부 창을 상한으로 잘랐을 때 params.windowCap 에 남기는 값. skippedFrom ~ window.from 은 받지 않은 구간이다 */
type ExternalWindowCap = { maxMinutes: number; skippedFrom: string };

type ExternalScope = { serviceKey: ExternalSourceKey; operation: string; partitionKey: string };

const isValidWindow = (
  window: { from: string; to: string } | null,
): window is { from: string; to: string } =>
  window !== null && Date.parse(window.from) < Date.parse(window.to);

/**
 * 마지막 정기 run 을 다시 받아야 하는지. 실패·중단(FAILED·RUNNING)과, 끝까지 받지 못한 PARTIAL(잘린 쪽에서 멈춤)이다.
 * 빠짐없는지 확인할 수 없는 서비스(KEPCO)의 PARTIAL 은 다시 받아도 COMPLETE 가 될 수 없어 다시 쓰지 않는다.
 * 격리 때문에 PARTIAL 이지만 끝까지 받은 run(completeness COMPLETE)도 다시 쓰지 않는다.
 */
const needsRetry = (last: LatestRunWindow, serviceKey: ExternalSourceKey): boolean =>
  last.status === "FAILED" ||
  last.status === "RUNNING" ||
  (last.status === "PARTIAL" &&
    last.completeness !== "COMPLETE" &&
    !COVERAGE_UNVERIFIED_SOURCES.has(serviceKey));

/**
 * 외부 정기 창. 창을 정한 job(수동 백필)은 그대로 쓴다. 정하지 않았으면:
 * - 마지막 run 을 다시 받아야 하고 그 창이 상한 안이면 그 창을 다시 쓴다(jobKey 가 같아 저장된 cursor 부터 잇는다)
 * - 아니면 마지막 창 끝(다시 받아야 하는 창이면 그 시작)부터 지금까지. 겹쳐 받지 않는다. 시작은 `지금 − 24시간`보다 앞서지 않는다
 * - 이력이 없으면 최근 24시간
 * 외부 API 요청은 KST 날짜 단위라 창 경계가 하루 안에 있으면 같은 날을 다시 부른다(중복은 저장 때 걸러진다).
 */
async function externalWindowOf(
  data: ExternalIngestJobData,
  deps: IngestJobDeps,
  scope: ExternalScope,
): Promise<{ window: { from: string; to: string }; cap: ExternalWindowCap | null }> {
  if (data.window !== undefined) return { window: data.window, cap: null };
  const to = floorToMinute(deps.now());
  const floor = to.getTime() - EXTERNAL_WINDOW_CAP_MS;
  const last = await deps.repo.findLatestRunWindow(data.source, "SCHEDULED", scope);
  const lastWindow = last !== null && isValidWindow(last.window) ? last.window : null;
  const retry = last !== null && lastWindow !== null && needsRetry(last, data.serviceKey);
  if (retry && Date.parse(lastWindow.from) >= floor) return { window: lastWindow, cap: null };
  const resumeAt = lastWindow === null ? null : retry ? lastWindow.from : lastWindow.to;
  const from = resumeAt === null ? floor : Math.max(Date.parse(resumeAt), floor);
  return {
    window: { from: new Date(from).toISOString(), to: to.toISOString() },
    cap:
      resumeAt !== null && Date.parse(resumeAt) < floor
        ? { maxMinutes: EXTERNAL_WINDOW_CAP_MS / MINUTE_MS, skippedFrom: resumeAt }
        : null,
  };
}

// 같은 jobKey 의 run 을 이어 가면 repo 가 처음 저장한 params 를 그대로 둔다(timing 도 첫 시도의 값). 이번 시도는 로그에 남는다.
const timingParam = (timing: IngestJobTiming | null): { timing?: IngestJobTiming } =>
  timing === null ? {} : { timing };

async function runInputOf(
  data: IngestJobData,
  deps: IngestJobDeps,
  timing: IngestJobTiming | null,
): Promise<StartRunInput> {
  const common = {
    runMode: RUN_MODE_OF[deps.runMode],
    trigger: data.trigger,
    requestedBy: data.requestedBy ?? null,
    idempotencyKey: data.idempotencyKey ?? null,
    // N8: 수동 수집 요청이 정한 run id 를 행 id 로 쓴다. 없으면 키를 두지 않는다(DB 기본값)
    ...(data.runId === undefined ? {} : { runId: data.runId }),
  };
  if (data.source === "fixture") {
    return { ...common, source: "fixture", jobKey: data.jobKey, batch: data.batch, params: null };
  }
  if (isExternalJob(data)) {
    const operation = data.operation ?? EXTERNAL_SERVICES[data.serviceKey].operation;
    const partitionKey =
      data.source === "kepco"
        ? (data.companyId ?? "all")
        : data.source === "g2b" && data.requestId !== undefined
          ? `request:${data.requestId}`
          : "all";
    const scope = { serviceKey: data.serviceKey, operation, partitionKey };
    const { window, cap } = await externalWindowOf(data, deps, scope);
    if (cap !== null) {
      (deps.scheduledWindowCap?.log ?? deps.log)?.(
        JSON.stringify({
          event: "ingest.window.capped",
          source: data.source,
          serviceKey: data.serviceKey,
          ...window,
          ...cap,
        }),
      );
    }
    return {
      ...common,
      source: data.source,
      ...scope,
      jobKey:
        data.trigger === "SCHEDULED"
          ? `${data.serviceKey}:${operation}:${partitionKey}:${window.from}:${window.to}`
          : data.jobKey,
      batch: null,
      params: {
        window,
        serviceKey: data.serviceKey,
        operation,
        partitionKey,
        ...(cap === null ? {} : { windowCap: cap }),
        ...timingParam(timing),
      },
    };
  }
  if (data.source !== "g2b") throw new Error("ingest source missing serviceKey");
  const { window, cap } = await g2bWindowOf(data, deps);
  if (cap !== null) {
    deps.scheduledWindowCap?.log(
      JSON.stringify({ event: "ingest.window.capped", source: "g2b", ...window, ...cap }),
    );
  }
  return {
    ...common,
    source: "g2b",
    serviceKey: "g2b-bid-notice",
    operation: G2B_BID_NOTICE_LIST_OPERATION,
    partitionKey: "all",
    // 반복 job 의 data 는 고정(창 없음)이라 jobKey 를 창 끝으로 나눠야 일정 실행마다 새 run 이 된다.
    // 창을 정해 넣은 job(ingest 전용 --once)은 자기 jobKey 를 쓴다. 일정 회차의 jobKey 와 겹치지 않게 한다.
    jobKey:
      data.trigger === "SCHEDULED" && data.window === undefined
        ? `g2b:SCHEDULED:${window.to}`
        : data.jobKey,
    batch: null,
    // 05: 실제 적용한 기본값을 params 에 남긴다. 지금 수집하는 단계는 공고(NOTICE)뿐이다.
    params: {
      window,
      stages: ["NOTICE"],
      ...(cap === null ? {} : { windowCap: cap }),
      ...timingParam(timing),
    },
  };
}

type RejectReason = { sourceKey: string; errorCode: string; detail: string };

// 모드가 받지 않는 source(RUN_MODE_MISMATCH)·거꾸로 된 기본 창(WINDOW_INVALID)이 그 사유다.
function rejectReasonOf(run: StartRunInput, mode: RunMode): RejectReason | null {
  if (!acceptsSource(mode, run.source)) {
    return {
      sourceKey: `${run.source}:mode`,
      errorCode: "RUN_MODE_MISMATCH",
      detail: `실행 모드 ${mode} 에서 ${run.source} 수집을 받지 않는다`,
    };
  }
  const window = run.source !== "fixture" ? windowOfParams(run.params) : null;
  if (window !== null && Date.parse(window.from) >= Date.parse(window.to)) {
    return {
      sourceKey: "g2b:window",
      errorCode: "WINDOW_INVALID",
      detail: "수집 창의 시작이 끝보다 늦다",
    };
  }
  return null;
}

const windowOfParams = (
  params: Record<string, unknown> | null,
): { from: string; to: string } | null => {
  const window = params?.window;
  if (typeof window !== "object" || window === null) return null;
  const from = "from" in window ? window.from : null;
  const to = "to" in window ? window.to : null;
  return typeof from === "string" && typeof to === "string" ? { from, to } : null;
};

// 받을 수 없는 job 은 run 을 열어 사유를 남기고 FAILED 로 닫는다. connector 는 만들지 않는다.
async function rejectRun(
  run: StartRunInput,
  reason: RejectReason,
  deps: IngestJobDeps,
): Promise<IngestRunResult> {
  const started = await deps.repo.startRun(run);
  const isFinished = started.status === "SUCCEEDED" || started.status === "PARTIAL";
  if (!isFinished) {
    await deps.repo.recordError(started.runId, {
      sourceKey: reason.sourceKey,
      errorCode: reason.errorCode,
      resultCode: null,
      redactedDetail: reason.detail,
    });
    await deps.repo.finishRun(started.runId, { status: "FAILED", summary: started.summary });
  }
  return {
    runId: started.runId,
    status: isFinished ? started.status : "FAILED",
    summary: started.summary,
    saved: [],
    quarantined: [],
    resumedFromCursor: isFinished ? null : started.cursor,
    alreadyFinished: isFinished,
  };
}

async function connectorFor(data: IngestJobData, deps: IngestJobDeps): Promise<BidSourceConnector> {
  if (isExternalJob(data)) {
    if (deps.createExternalConnector === undefined)
      throw new Error("external connector not configured");
    return deps.createExternalConnector(data);
  }
  return data.source === "fixture"
    ? deps.createFixtureConnector(data.batch)
    : deps.createG2bConnector();
}

// 보조 조회는 g2b 수집에만 붙는다. fixture 는 공공 API 를 부르지 않는다.
async function auxFor(data: IngestJobData, deps: IngestJobDeps): Promise<{ aux?: G2bAuxFetcher }> {
  if (data.source !== "g2b" || isExternalJob(data) || deps.createG2bAuxFetcher === undefined)
    return {};
  return { aux: await deps.createG2bAuxFetcher() };
}

// 수동 g2b 입찰공고 수집은 낮은 한도의 예산을 쓴다. 외부 소스는 소스마다 자기 예산이 있어 trigger 로 나누지 않는다.
function quotaFor(job: IngestJobData, deps: IngestJobDeps): IngestQuota | undefined {
  if (isExternalJob(job)) return deps.quotaForExternal?.(job);
  return job.trigger === "MANUAL" && job.source === "g2b" ? deps.manualQuota : deps.quota;
}

// 시각·ms 와 source·trigger(고정 값)만 싣는다. jobKey·job id 는 조직 id 를 담을 수 있어 넣지 않는다.
const timingLine = (job: IngestJobData, timing: IngestJobTiming): string =>
  JSON.stringify({
    event: "ingest.job.timing",
    source: job.source,
    trigger: job.trigger,
    ...timing,
  });

/**
 * timing 은 큐에서 꺼낸 job 의 시각(ingestJobTimingOf)이다. 큐를 거치지 않는 1회 수집(--once)·시험은 주지 않는다.
 * 주면 run params.timing 에 넣고 deps.log 로 한 줄 남긴다.
 */
export async function processIngestJob(
  data: unknown,
  deps: IngestJobDeps,
  timing: IngestJobTiming | null = null,
): Promise<IngestRunResult> {
  const job = parseJobData(data, deps.now());
  if (timing !== null) deps.log?.(timingLine(job, timing));
  const run = await runInputOf(job, deps, timing);
  const modeReason = rejectReasonOf(run, deps.runMode);
  const externalReason =
    modeReason === null && isExternalJob(job)
      ? (deps.externalSourceGate?.(job) ??
        (deps.externalSourceGate === undefined ? "NOT_VERIFIED" : null))
      : null;
  const quota = quotaFor(job, deps);
  const reason =
    modeReason ??
    (externalReason === null
      ? null
      : {
          sourceKey: `${job.source}:readiness`,
          errorCode: `SOURCE_${externalReason}`,
          detail: `source readiness: ${externalReason}`,
        }) ??
    (deps.runMode === "live" && quota === undefined
      ? {
          sourceKey: `${job.source}:quota`,
          errorCode: "QUOTA_STORE_UNAVAILABLE",
          detail: "live 수집의 호출 예산 저장소가 구성되지 않았다",
        }
      : null);

  const result =
    reason === null
      ? await runIngest({
          connector: await connectorFor(job, deps),
          repo: deps.repo,
          run,
          now: deps.now,
          retry: deps.retry,
          secrets: deps.secrets,
          ...(deps.idFor === undefined ? {} : { idFor: deps.idFor }),
          ...(quota === undefined ? {} : { quota }),
          ...(await auxFor(job, deps)),
        })
      : await rejectRun(run, reason, deps);

  // 첨부가 있는 revision 만 documents job 을 건다. 차례로 넣어 실패한 지점을 알 수 있게 한다.
  for (const saved of result.saved) {
    if (saved.attachmentCount > 0) {
      await deps.enqueueDocuments({
        bidId: saved.bidId,
        revisionId: saved.revisionId,
        revisionCreatedAt: saved.revisionCreatedAt,
      });
    }
  }

  // 수동 수집은 누가 시작했는지 조직 감사 기록에 남긴다(거절한 요청도 남긴다). 7-5 로 MANUAL 은 둘 다 있다.
  if (job.trigger === "MANUAL" && job.orgId !== undefined) {
    await deps.recordManualAudit({
      orgId: job.orgId,
      actorId: job.requestedBy ?? null,
      runId: result.runId,
    });
  }
  return result;
}
