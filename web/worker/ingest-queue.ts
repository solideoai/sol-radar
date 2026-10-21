import {
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
  type RetryDeps,
  type StartRunInput,
} from "@/server/ingestion";

// ── ingest job 처리 규칙(6-4). Redis·Supabase·서비스키 연결은 main.ts 가 하고, 여기는 주입받은 것만 쓴다 ──

/** 07 에 정본값이 없어 정한 값(e8 판정). env G2B_INGEST_INTERVAL_MINUTES 로 바꾼다 */
export const DEFAULT_G2B_INGEST_INTERVAL_MINUTES = 30;
/** 직전 성공 창이 없을 때(첫 일정 실행) 거슬러 올라가는 길이 */
export const DEFAULT_G2B_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const RUN_MODES = ["live", "fixture", "mock"] as const;
export type RunMode = (typeof RUN_MODES)[number];

type Env = Record<string, string | undefined>;

const RUN_MODE_ENV = "SOL_RUN_MODE";
const INTERVAL_ENV = "G2B_INGEST_INTERVAL_MINUTES";
const MINUTE_MS = 60_000;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** 대소문자를 접지 않는다. 값이 틀리면 기동을 멈춘다(오류에는 env 이름만 싣는다) */
export function readRunMode(env: Env): RunMode {
  const value = env[RUN_MODE_ENV]?.trim();
  if (value === undefined || value === "") return "mock";
  const mode = RUN_MODES.find((candidate) => candidate === value);
  if (mode === undefined) throw new Error(`worker env 형식 오류: ${RUN_MODE_ENV}`);
  return mode;
}

export function readIngestIntervalMinutes(env: Env): number {
  const value = env[INTERVAL_ENV]?.trim();
  if (value === undefined || value === "") return DEFAULT_G2B_INGEST_INTERVAL_MINUTES;
  if (!POSITIVE_INTEGER.test(value)) {
    throw new Error(`worker env 형식 오류: ${INTERVAL_ENV} (양의 정수 분)`);
  }
  return Number(value);
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
};

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
async function g2bWindowOf(
  data: Extract<IngestJobData, { source: "g2b" }>,
  deps: IngestJobDeps,
): Promise<{ from: string; to: string }> {
  if (data.window !== undefined) return data.window;
  const scope = { serviceKey: "g2b-bid-notice" };
  const last = await deps.repo.findLatestRunWindow("g2b", "SCHEDULED", scope);
  if (last !== null && last.status === "FAILED" && last.window !== null) return last.window;
  const to = floorToMinute(deps.now());
  const lastEnd = await deps.repo.findLatestRunWindowEnd("g2b", "SCHEDULED", scope);
  const from = lastEnd ?? new Date(to.getTime() - DEFAULT_G2B_LOOKBACK_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function runInputOf(data: IngestJobData, deps: IngestJobDeps): Promise<StartRunInput> {
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
    const last = await deps.repo.findLatestRunWindow(data.source, "SCHEDULED", scope);
    const to = floorToMinute(deps.now());
    const end = await deps.repo.findLatestRunWindowEnd(data.source, "SCHEDULED", scope);
    const from =
      end === null
        ? new Date(to.getTime() - (data.source === "kepco" ? 89 : 90) * 24 * 60 * 60 * 1000)
        : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const window =
      data.window ??
      ((last?.status === "FAILED" ||
        last?.status === "RUNNING" ||
        last?.completeness === "PARTIAL" ||
        last?.completeness === "UNKNOWN") &&
      last.window !== null
        ? last.window
        : { from: from.toISOString(), to: to.toISOString() });
    return {
      ...common,
      source: data.source,
      ...scope,
      jobKey:
        data.trigger === "SCHEDULED"
          ? `${data.serviceKey}:${operation}:${partitionKey}:${window.from}:${window.to}`
          : data.jobKey,
      batch: null,
      params: { window, serviceKey: data.serviceKey, operation, partitionKey },
    };
  }
  if (data.source !== "g2b") throw new Error("ingest source missing serviceKey");
  const window = await g2bWindowOf(data, deps);
  return {
    ...common,
    source: "g2b",
    serviceKey: "g2b-bid-notice",
    operation: G2B_BID_NOTICE_LIST_OPERATION,
    partitionKey: "all",
    // 반복 job 의 data 는 고정이라 jobKey 를 창 끝으로 나눠야 일정 실행마다 새 run 이 된다.
    jobKey: data.trigger === "SCHEDULED" ? `g2b:SCHEDULED:${window.to}` : data.jobKey,
    batch: null,
    // 05: 실제 적용한 기본값을 params 에 남긴다. 지금 수집하는 단계는 공고(NOTICE)뿐이다.
    params: { window, stages: ["NOTICE"] },
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

export async function processIngestJob(
  data: unknown,
  deps: IngestJobDeps,
): Promise<IngestRunResult> {
  const job = parseJobData(data, deps.now());
  const run = await runInputOf(job, deps);
  const modeReason = rejectReasonOf(run, deps.runMode);
  const externalReason =
    modeReason === null && isExternalJob(job)
      ? (deps.externalSourceGate?.(job) ??
        (deps.externalSourceGate === undefined ? "NOT_VERIFIED" : null))
      : null;
  const reason =
    modeReason ??
    (externalReason === null
      ? null
      : {
          sourceKey: `${job.source}:readiness`,
          errorCode: `SOURCE_${externalReason}`,
          detail: `source readiness: ${externalReason}`,
        });
  const quota = isExternalJob(job) ? deps.quotaForExternal?.(job) : deps.quota;

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
