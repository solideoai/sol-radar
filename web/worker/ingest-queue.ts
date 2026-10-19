import {
  ingestJobDataSchema,
  runIngest,
  type BidSourceConnector,
  type DocumentsJobData,
  type FixtureBatch,
  type IdFor,
  type IngestionRepo,
  type IngestJobData,
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

export type IngestJobDeps = {
  repo: IngestionRepo;
  runMode: RunMode;
  createFixtureConnector(batch: FixtureBatch): Promise<BidSourceConnector>;
  createG2bConnector(): Promise<BidSourceConnector>;
  enqueueDocuments(data: DocumentsJobData): Promise<void>;
  recordManualAudit(input: { orgId: string; actorId: string | null; runId: string }): Promise<void>;
  now(): Date;
  retry: RetryDeps;
  idFor?: IdFor;
  secrets: readonly string[];
};

const RUN_MODE_OF: Readonly<Record<RunMode, IngestRunMode>> = {
  live: "LIVE",
  fixture: "FIXTURE",
  mock: "MOCK",
};

// 05·ADR-020: live 는 g2b 만, fixture·mock 은 fixture 만 받는다.
const acceptsSource = (mode: RunMode, source: IngestJobData["source"]): boolean =>
  mode === "live" ? source === "g2b" : source === "fixture";

const floorToMinute = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);

function parseJobData(data: unknown): IngestJobData {
  const parsed = ingestJobDataSchema.safeParse(data);
  if (!parsed.success) {
    // job data 의 값은 오류에 싣지 않는다(요청자 id 등). 경로만 남긴다.
    const paths = [...new Set(parsed.error.issues.map(({ path }) => path.map(String).join(".")))];
    throw new Error(`ingest job data 가 잘못됐다: ${paths.join(", ") || "(root)"}`);
  }
  return parsed.data;
}

// 6-4 보충: window 가 없으면 트리거와 상관없이 직전 성공 창 끝 ~ 지금(분 내림). 없으면 지금 − 1일부터.
async function g2bWindowOf(
  data: Extract<IngestJobData, { source: "g2b" }>,
  deps: IngestJobDeps,
): Promise<{ from: string; to: string }> {
  if (data.window !== undefined) return data.window;
  const to = floorToMinute(deps.now());
  const lastEnd = await deps.repo.findLatestRunWindowEnd("g2b");
  const from = lastEnd ?? new Date(to.getTime() - DEFAULT_G2B_LOOKBACK_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function runInputOf(data: IngestJobData, deps: IngestJobDeps): Promise<StartRunInput> {
  const common = {
    runMode: RUN_MODE_OF[deps.runMode],
    trigger: data.trigger,
    requestedBy: data.requestedBy ?? null,
    idempotencyKey: data.idempotencyKey ?? null,
  };
  if (data.source === "fixture") {
    return { ...common, source: "fixture", jobKey: data.jobKey, batch: data.batch, params: null };
  }
  const window = await g2bWindowOf(data, deps);
  return {
    ...common,
    source: "g2b",
    // 반복 job 의 data 는 고정이라 jobKey 를 창 끝으로 나눠야 일정 실행마다 새 run 이 된다.
    jobKey: data.trigger === "SCHEDULED" ? `g2b:SCHEDULED:${window.to}` : data.jobKey,
    batch: null,
    // 05: 실제 적용한 기본값을 params 에 남긴다. 지금 수집하는 단계는 공고(NOTICE)뿐이다.
    params: { window, stages: ["NOTICE"] },
  };
}

// 모드가 받지 않는 source 는 run 을 열어 사유를 남기고 FAILED 로 닫는다. connector 는 만들지 않는다.
async function rejectRunMode(run: StartRunInput, deps: IngestJobDeps): Promise<IngestRunResult> {
  const started = await deps.repo.startRun(run);
  const isFinished = started.status === "SUCCEEDED" || started.status === "PARTIAL";
  if (!isFinished) {
    await deps.repo.recordError(started.runId, {
      sourceKey: `${run.source}:mode`,
      errorCode: "RUN_MODE_MISMATCH",
      resultCode: null,
      redactedDetail: `실행 모드 ${deps.runMode} 에서 ${run.source} 수집을 받지 않는다`,
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
  return data.source === "fixture"
    ? deps.createFixtureConnector(data.batch)
    : deps.createG2bConnector();
}

export async function processIngestJob(
  data: unknown,
  deps: IngestJobDeps,
): Promise<IngestRunResult> {
  const job = parseJobData(data);
  const run = await runInputOf(job, deps);

  const result = acceptsSource(deps.runMode, job.source)
    ? await runIngest({
        connector: await connectorFor(job, deps),
        repo: deps.repo,
        run,
        now: deps.now,
        retry: deps.retry,
        secrets: deps.secrets,
        ...(deps.idFor === undefined ? {} : { idFor: deps.idFor }),
      })
    : await rejectRunMode(run, deps);

  // 첨부가 있는 revision 만 documents job 을 건다. 차례로 넣어 실패한 지점을 알 수 있게 한다.
  for (const saved of result.saved) {
    if (saved.attachmentCount > 0) {
      await deps.enqueueDocuments({ bidId: saved.bidId, revisionId: saved.revisionId });
    }
  }

  // 수동 수집은 누가 시작했는지 조직 감사 기록에 남긴다(어긋난 모드로 거절한 요청도 남긴다).
  if (job.trigger === "MANUAL" && job.orgId !== undefined) {
    await deps.recordManualAudit({
      orgId: job.orgId,
      actorId: job.requestedBy ?? null,
      runId: result.runId,
    });
  }
  return result;
}
