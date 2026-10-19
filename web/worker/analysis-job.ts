import { UnrecoverableError, Worker, type ConnectionOptions } from "bullmq";
import {
  ANALYSIS_JOB,
  ANALYSIS_QUEUE,
  AnalysisInputError,
  analysisJobDataSchema,
  analyzeAndSave,
  createGatewayClient,
  readGatewayConfig,
  readRunMode,
  requestIdOf,
  toAnalysisSettings,
  type AnalysisContext,
  type AnalysisContextLoader,
  type AnalysisJobData,
  type AnalysisRunSink,
  type AnalysisRunTracker,
  type AnalysisSettings,
  type ExtractionStore,
  type GatewayClient,
  type LoadedAnalysisContext,
  type RunMode,
} from "@/server/analysis";

// ── analysis job: job 데이터 검증 → 처리 설정 → score_runs 대상 확인 → 분석·저장 → 로그 한 줄 ──
// 다른 조직·다른 run 의 데이터를 섞지 않게 loader 가 읽은 행이 job 데이터와 같은지 확인한 뒤에만 쓴다.
// 로그에는 식별자·상태·코드만 싣는다. 공고 원문·제목·프로필·오류 message 는 싣지 않는다(docs/14).

export type AnalysisJobDeps = {
  /** 프로세스당 하나. breaker 를 job 사이에 이어 쓴다. */
  gateway: GatewayClient;
  loader: AnalysisContextLoader;
  tracker: AnalysisRunTracker;
  extraction: ExtractionStore;
  sink: AnalysisRunSink;
  now: () => Date;
  env: { runMode: RunMode; given: boolean };
  /** JSON 한 줄. */
  log: (line: string) => void;
};

/** BullMQ Job 가운데 처리 함수가 읽는 것. 시험이 Redis 없이 만들 수 있게 좁혀 둔다. */
export type AnalysisJobLike = {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
};

export type AnalysisJobSummary =
  | {
      outcome: "ANALYZED";
      idempotencyKey: string;
      status: "COMPLETED" | "PARTIAL";
      errorCode: string | null;
      recommendationBasis: "RULES_ONLY" | "RULES_WITH_KEV_ASSIST";
    }
  | { outcome: "SKIPPED"; scoreRunStatus: "COMPLETED" | "PARTIAL" | "FAILED" };

// UnrecoverableError 의 message 로 쓰는 코드. 그대로 score_runs.error_code·로그 errorCode 가 된다.
const JOB_UNKNOWN = "ANALYSIS_JOB_UNKNOWN";
const JOB_INVALID = "ANALYSIS_JOB_INVALID";
const TARGET_NOT_FOUND = "ANALYSIS_TARGET_NOT_FOUND";
const TARGET_MISMATCH = "ANALYSIS_TARGET_MISMATCH";
const INPUT_INVALID = "ANALYSIS_INPUT_INVALID";
const JOB_FAILED = "ANALYSIS_JOB_FAILED";

/** 이 파일이 던지는 UnrecoverableError 의 message. 다른 곳이 던진 UnrecoverableError 의 message 는 값이 섞일 수 있어 코드로 쓰지 않는다. */
const OWN_CODES: ReadonlySet<string> = new Set([
  JOB_UNKNOWN,
  JOB_INVALID,
  TARGET_NOT_FOUND,
  TARGET_MISMATCH,
  INPUT_INVALID,
]);

type DoneStatus = Extract<LoadedAnalysisContext["status"], "COMPLETED" | "PARTIAL" | "FAILED">;

function isDone(status: LoadedAnalysisContext["status"]): status is DoneStatus {
  return status === "COMPLETED" || status === "PARTIAL" || status === "FAILED";
}

/** 실패 처리에 필요한 진행 단계. VERIFIED 뒤에만 score_runs 를 FAILED 로 바꾼다(그 전에는 남의 run 일 수 있다). */
type Progress =
  | { stage: "UNPARSED" }
  | { stage: "PARSED" | "VERIFIED"; data: AnalysisJobData; requestId: string };

/** 데이터 오류는 값·경로를 싣지 않고 코드만 던진다. requestId 는 스키마가 형식을 보장한다. */
function parseJobData(data: unknown): { data: AnalysisJobData; requestId: string } {
  const parsed = analysisJobDataSchema.safeParse(data);
  const requestId = parsed.success ? requestIdOf(parsed.data) : null;
  if (!parsed.success || requestId === null) throw new UnrecoverableError(JOB_INVALID);
  return { data: parsed.data, requestId };
}

/** loader 가 읽은 행이 job 데이터가 가리킨 run 인지 본다. idempotencyKey 가 비어 있는 행은 키로 비교하지 않는다. */
function isSameTarget(loaded: LoadedAnalysisContext, data: AnalysisJobData): boolean {
  return (
    loaded.orgId === data.orgId &&
    loaded.scoreRunId === data.scoreRunId &&
    (loaded.idempotencyKey === null || loaded.idempotencyKey === data.idempotencyKey)
  );
}

/** loader 의 orgId·idempotencyKey·status 는 넣지 않는다. 조직은 대상 확인을 마친 job 데이터 값이다. */
function toContext(
  loaded: LoadedAnalysisContext,
  data: AnalysisJobData,
  requestId: string,
  settings: AnalysisSettings,
): AnalysisContext {
  return {
    requestId,
    orgId: data.orgId,
    scoreRunId: loaded.scoreRunId,
    bidId: loaded.bidId,
    companyProfileId: loaded.companyProfileId,
    fixtureId: loaded.fixtureId,
    bid: loaded.bid,
    extraction: loaded.extraction,
    profile: loaded.profile,
    team: loaded.team,
    runMode: settings.runMode,
    aiProvider: settings.aiProvider,
    kev: settings.kev,
    documentIssues: loaded.documentIssues,
    queuedAt: loaded.queuedAt,
  };
}

/** 오류 이름. 클래스 이름 모양이 아니면(값이 섞였을 수 있다) "Error" 로 줄인다. */
function errorNameOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return /^[A-Za-z0-9_]{1,60}$/.test(error.name) ? error.name : "Error";
}

function isPermanent(error: unknown, job: AnalysisJobLike): boolean {
  const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  return (
    error instanceof UnrecoverableError || error instanceof AnalysisInputError || isLastAttempt
  );
}

function failureCodeOf(error: unknown): string {
  if (error instanceof UnrecoverableError && OWN_CODES.has(error.message)) return error.message;
  if (error instanceof AnalysisInputError) return INPUT_INVALID;
  return JOB_FAILED;
}

function elapsedMs(t0: Date, deps: AnalysisJobDeps): number {
  return Math.round(deps.now().getTime() - t0.getTime());
}

export function createAnalysisProcessor(
  deps: AnalysisJobDeps,
): (job: AnalysisJobLike) => Promise<AnalysisJobSummary> {
  /** 영구 실패면 대상 확인을 마친 run 만 FAILED 로 바꾸고, 로그 한 줄을 남긴 뒤 던질 오류를 돌려준다. */
  async function onFailure(
    error: unknown,
    job: AnalysisJobLike,
    progress: Progress,
    t0: Date,
  ): Promise<unknown> {
    const permanent = isPermanent(error, job);
    const errorCode = permanent ? failureCodeOf(error) : null;
    const markFailedError =
      errorCode !== null && progress.stage === "VERIFIED"
        ? await markFailed(progress.data, errorCode)
        : null;
    const ids =
      progress.stage === "UNPARSED"
        ? {}
        : {
            requestId: progress.requestId,
            orgId: progress.data.orgId,
            scoreRunId: progress.data.scoreRunId,
          };
    deps.log(
      JSON.stringify({
        event: "analysis.failed",
        jobId: job.id ?? null,
        ...ids,
        attempt: job.attemptsMade + 1,
        errorName: errorNameOf(error),
        ...(errorCode === null ? {} : { errorCode }),
        permanent,
        elapsedMs: elapsedMs(t0, deps),
        ...(markFailedError === null ? {} : { markFailedError }),
      }),
    );
    // BullMQ 가 재시도하지 않게 바꾼다. 원래 message(issue 목록)는 실패 job 에 남기지 않는다.
    return error instanceof AnalysisInputError ? new UnrecoverableError(INPUT_INVALID) : error;
  }

  /** markFailed 가 던지면 삼키지 않고 오류 이름을 돌려준다. 호출자는 원래 오류를 던진다. */
  async function markFailed(data: AnalysisJobData, errorCode: string): Promise<string | null> {
    try {
      await deps.tracker.markFailed({
        orgId: data.orgId,
        scoreRunId: data.scoreRunId,
        errorCode,
        finishedAt: deps.now().toISOString(),
      });
      return null;
    } catch (markError) {
      return errorNameOf(markError);
    }
  }

  return async (job) => {
    const t0 = deps.now();
    let progress: Progress = { stage: "UNPARSED" };
    try {
      if (job.name !== ANALYSIS_JOB) throw new UnrecoverableError(JOB_UNKNOWN);
      const { data, requestId } = parseJobData(job.data);
      progress = { stage: "PARSED", data, requestId };

      const settings = toAnalysisSettings(await deps.gateway.health(), deps.env);
      const loaded = await deps.loader.load(
        { orgId: data.orgId, scoreRunId: data.scoreRunId },
        settings.cacheKey,
      );
      if (loaded === null) throw new UnrecoverableError(TARGET_NOT_FOUND);
      if (!isSameTarget(loaded, data)) throw new UnrecoverableError(TARGET_MISMATCH);
      progress = { stage: "VERIFIED", data, requestId };

      const ids = { requestId, orgId: data.orgId, scoreRunId: data.scoreRunId };
      const attempt = job.attemptsMade + 1;
      const jobId = job.id ?? null;

      // 앞 시도가 끝낸 run 을 다시 쓰지 않는다. RUNNING 은 앞 시도가 죽은 경우라 이어서 한다.
      if (isDone(loaded.status)) {
        deps.log(
          JSON.stringify({
            event: "analysis.skipped",
            jobId,
            ...ids,
            attempt,
            scoreRunStatus: loaded.status,
            elapsedMs: elapsedMs(t0, deps),
          }),
        );
        return { outcome: "SKIPPED", scoreRunStatus: loaded.status };
      }

      // 분석 시작 시각은 runAnalysis 가 따로 잰다. score_runs.started_at 은 처리 시작 시각이다.
      await deps.tracker.markRunning({
        orgId: data.orgId,
        scoreRunId: data.scoreRunId,
        runMode: settings.runMode,
        aiProvider: settings.aiProvider,
        startedAt: t0.toISOString(),
      });

      const record = await analyzeAndSave(toContext(loaded, data, requestId, settings), {
        gateway: deps.gateway,
        now: deps.now,
        extraction: deps.extraction,
        sink: deps.sink,
      });
      const { status, errorCode, recommendationBasis } = record.result;
      deps.log(
        JSON.stringify({
          event: "analysis.completed",
          jobId,
          ...ids,
          bidId: loaded.bidId,
          attempt,
          status,
          errorCode,
          recommendationBasis,
          settingsSource: settings.source,
          runModeMismatch: settings.runModeMismatch,
          elapsedMs: elapsedMs(t0, deps),
        }),
      );
      return {
        outcome: "ANALYZED",
        idempotencyKey: record.idempotencyKey,
        status,
        errorCode,
        recommendationBasis,
      };
    } catch (error) {
      throw await onFailure(error, job, progress, t0);
    }
  };
}

/** BullMQ Worker. concurrency 1(Qwen·Kev 가 GPU 하나를 함께 쓴다, 03 §5.9). main.ts 등록은 읽기 port 구현 뒤다. */
export function createAnalysisWorker(
  connection: ConnectionOptions,
  deps: AnalysisJobDeps,
): { close(): Promise<void> } {
  const worker = new Worker(ANALYSIS_QUEUE, createAnalysisProcessor(deps), {
    connection,
    concurrency: 1,
  });
  // message 는 접속 문자열을 담을 수 있어 쓰지 않는다(main.ts 와 같은 원칙).
  worker.on("error", (error) => {
    console.error(`analysis worker 오류: ${error.name}`);
  });
  return { close: () => worker.close() };
}

/** env 로 gateway·시계·실행 모드·로그를 만든다. port 는 받는다. 설정 오류는 키 이름만 담아 그대로 던진다. */
export function createAnalysisJobDeps(
  env: Record<string, string | undefined>,
  ports: Pick<AnalysisJobDeps, "loader" | "tracker" | "extraction" | "sink">,
): AnalysisJobDeps {
  return {
    gateway: createGatewayClient(readGatewayConfig(env)),
    loader: ports.loader,
    tracker: ports.tracker,
    extraction: ports.extraction,
    sink: ports.sink,
    now: () => new Date(),
    env: readRunMode(env),
    log: (line) => {
      console.log(line);
    },
  };
}
