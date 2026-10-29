import { DelayedError, UnrecoverableError, Worker, type ConnectionOptions } from "bullmq";
import {
  ANALYSIS_JOB,
  ANALYSIS_QUEUE,
  FINISH_NOT_RUNNING_MESSAGE,
  AnalysisInputError,
  analysisJobDataSchema,
  analyzeAndSave,
  createGatewayClient,
  nextAttemptStartedAt,
  readGatewayConfig,
  readRunMode,
  requestIdOf,
  toAnalysisSettings,
  type AnalysisContext,
  type AnalysisContextLoader,
  type AnalysisJobData,
  type AnalysisRunDiagnostics,
  type AnalysisRunSink,
  type AnalysisRunTracker,
  type AnalysisSettings,
  type ExtractionStore,
  type GatewayClient,
  type LoadedAnalysisContext,
  type RunClaim,
  type RunMode,
} from "@/server/analysis";
import { decideDocumentsWait, type DocumentsWaitPort } from "@/worker/analysis-documents-wait";
import { errorNameOf } from "@/worker/error-name";

// ── analysis job: job 데이터 검증 → 처리 설정 → score_runs 대상 확인 → (live) 첨부 처리 대기 → 분석·저장 → 로그 한 줄 ──
// 다른 조직·다른 run 의 데이터를 섞지 않게 loader 가 읽은 행이 job 데이터와 같은지 확인한 뒤에만 쓴다.
// 로그에는 식별자·상태·코드만 싣는다. 공고 원문·제목·프로필·오류 message 는 싣지 않는다(docs/14).

export type AnalysisJobDeps = {
  /** 프로세스당 하나. breaker 를 job 사이에 이어 쓴다. */
  gateway: GatewayClient;
  loader: AnalysisContextLoader;
  tracker: AnalysisRunTracker;
  extraction: ExtractionStore;
  sink: AnalysisRunSink;
  /** live 분석이 run 을 잡기 전에 기다릴 첨부를 읽는다(ADR-056 대안 A). null 이면 기다리지 않는다. */
  documents: DocumentsWaitPort | null;
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
  /** 첨부 처리 대기. BullMQ 는 시도 수를 쓰지 않는다(skipAttempt). */
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
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
const RUN_SUPERSEDED = "ANALYSIS_RUN_SUPERSEDED";
const JOB_FAILED = "ANALYSIS_JOB_FAILED";

/** 이 파일이 던지는 UnrecoverableError 의 message. 다른 곳이 던진 UnrecoverableError 의 message 는 값이 섞일 수 있어 코드로 쓰지 않는다. */
const OWN_CODES: ReadonlySet<string> = new Set([
  JOB_UNKNOWN,
  JOB_INVALID,
  TARGET_NOT_FOUND,
  TARGET_MISMATCH,
  INPUT_INVALID,
  RUN_SUPERSEDED,
]);

// 결과 저장이 FINISH_NOT_RUNNING_MESSAGE(@/server/analysis)로 거절하면 다른 시도가 이미 끝냈거나 다시 잡은 run 이다.
// 재시도해도 같은 거절이고 gateway 만 다시 부르므로 영구 실패로 바꾼다. message 가 정확히 그것일 때만이다
// (NOT_FOUND 등 다른 거절·일시 오류는 예전처럼 재시도한다).

type DoneStatus = Extract<LoadedAnalysisContext["status"], "COMPLETED" | "PARTIAL" | "FAILED">;

function isDone(status: LoadedAnalysisContext["status"]): status is DoneStatus {
  return status === "COMPLETED" || status === "PARTIAL" || status === "FAILED";
}

/**
 * 실패 처리에 필요한 진행 단계. VERIFIED 뒤에만 score_runs 를 FAILED 로 바꾼다(그 전에는 남의 run 일 수 있다).
 * claim 은 닫기의 쓰기 조건이다. VERIFIED 는 loader 가 읽은 상태, RUNNING(markRunning 이 run 을 잡은 뒤)은
 * 이 시도가 잡은 상태(RUNNING·started_at = attemptStartedAt)다. 그 사이 다른 시도가 잡았거나 끝낸 run 은 닫지 않는다.
 */
type Progress =
  | { stage: "UNPARSED" }
  | { stage: "PARSED"; data: AnalysisJobData; requestId: string }
  | { stage: "VERIFIED" | "RUNNING"; data: AnalysisJobData; requestId: string; claim: RunClaim };

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

/**
 * loader 의 orgId·idempotencyKey·status 는 넣지 않는다. 조직은 대상 확인을 마친 job 데이터 값이다.
 * attemptStartedAt 은 markRunning 에 넘긴 startedAt 이다(시도 식별자).
 */
function toContext(
  loaded: LoadedAnalysisContext,
  data: AnalysisJobData,
  requestId: string,
  settings: AnalysisSettings,
  attemptStartedAt: string,
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
    attemptStartedAt,
  };
}

/** markRunning 뒤 결과 저장이 늦은 마감으로 거절됐는가. 그 전 단계의 오류는 이 시도가 잡은 run 이 없으므로 보지 않는다. */
function isSupersededFinish(error: unknown, progress: Progress): boolean {
  return (
    progress.stage === "RUNNING" &&
    error instanceof Error &&
    error.message === FINISH_NOT_RUNNING_MESSAGE
  );
}

/** 진단을 로그 필드로 옮긴다. 진단이 없는 쪽은 키를 넣지 않는다. 실패 종류와 "경로: 코드" 뿐이고 값·message 는 없다. */
function diagnosticFields(diagnostics: AnalysisRunDiagnostics): Record<string, unknown> {
  const { extract, kev } = diagnostics;
  return {
    ...(extract === null ? {} : { extractFailure: extract.failure, extractIssues: extract.issues }),
    ...(kev === null ? {} : { kevFailure: kev.failure, kevIssues: kev.issues }),
  };
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
): (job: AnalysisJobLike, token?: string) => Promise<AnalysisJobSummary> {
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
      errorCode !== null && (progress.stage === "VERIFIED" || progress.stage === "RUNNING")
        ? await markFailed(progress.data, errorCode, progress.claim)
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

  /**
   * markFailed 가 던지면 삼키지 않고 오류 이름을 돌려준다. 호출자는 원래 오류를 던진다.
   * expected(진행 단계의 claim)가 그대로인 run 만 닫는다. 다른 시도가 잡았거나 끝낸 run 은 0행이다.
   */
  async function markFailed(
    data: AnalysisJobData,
    errorCode: string,
    expected: RunClaim,
  ): Promise<string | null> {
    try {
      await deps.tracker.markFailed({
        orgId: data.orgId,
        scoreRunId: data.scoreRunId,
        errorCode,
        finishedAt: deps.now().toISOString(),
        expected,
      });
      return null;
    } catch (markError) {
      return errorNameOf(markError);
    }
  }

  return async (job, token) => {
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
      // 읽은 상태(QUEUED·RUNNING, started_at 원문). run 잡기와 이 단계 실패의 닫기가 쓰기 조건으로 건다.
      const expected: RunClaim = { status: loaded.status, startedAt: loaded.startedAt };
      progress = { stage: "VERIFIED", data, requestId, claim: expected };

      // live 는 run 을 잡기 전에 처리 범위 안 첨부를 기다린다(ADR-056 대안 A). 기다리는 동안 run 은 QUEUED 그대로다.
      const wait = await decideDocumentsWait(deps.documents, settings.runMode, loaded, deps.now());
      if (wait.kind === "WAIT") {
        deps.log(
          JSON.stringify({
            event: "analysis.waiting_documents",
            jobId,
            ...ids,
            attempt,
            pendingDocuments: wait.pending,
            resumeAt: new Date(wait.resumeAt).toISOString(),
            elapsedMs: elapsedMs(t0, deps),
          }),
        );
        await job.moveToDelayed(wait.resumeAt, token);
        throw new DelayedError();
      }
      const ready = wait.loaded;

      // 분석 시작 시각은 runAnalysis 가 따로 잰다. score_runs.started_at 은 이 시도의 식별자다.
      // 처리 시작 시각(t0)이되 앞 시도의 started_at 보다 늘 커서 같은 밀리초에 다시 잡아도 겹치지 않는다.
      const attemptStartedAt = nextAttemptStartedAt(t0, loaded.startedAt);
      const isClaimed = await deps.tracker.markRunning({
        orgId: data.orgId,
        scoreRunId: data.scoreRunId,
        runMode: settings.runMode,
        aiProvider: settings.aiProvider,
        startedAt: attemptStartedAt,
        expected,
      });
      // 읽은 뒤 다른 시도가 먼저 잡았거나 끝냈다. 재시도해도 같은 결과라 gateway 를 부르지 않고 영구 실패다.
      // 진행 단계는 VERIFIED 그대로라 닫기는 읽은 상태가 조건이고, 상태가 바뀌었으므로 0행이다.
      if (!isClaimed) throw new UnrecoverableError(RUN_SUPERSEDED);
      progress = {
        stage: "RUNNING",
        data,
        requestId,
        claim: { status: "RUNNING", startedAt: attemptStartedAt },
      };

      const context = toContext(ready, data, requestId, settings, attemptStartedAt);
      const record = await analyzeAndSave(context, {
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
          ...(wait.timedOut > 0 ? { documentsTimedOut: wait.timedOut } : {}),
          ...diagnosticFields(record.diagnostics),
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
      // 첨부 처리 대기는 실패가 아니다. job 은 이미 delayed 로 옮겼다.
      if (error instanceof DelayedError) throw error;
      // 늦은 마감은 원래 오류(message 에 표·코드가 있다) 대신 코드만 담은 영구 실패로 바꾼다.
      const failure = isSupersededFinish(error, progress)
        ? new UnrecoverableError(RUN_SUPERSEDED)
        : error;
      throw await onFailure(failure, job, progress, t0);
    }
  };
}

/** BullMQ Worker. concurrency 1(Qwen·Kev 가 GPU 하나를 함께 쓴다, 03 §5.9). main.ts 의 analysisWorkerRegistration 이 analysis-runtime 으로 띄운다. */
export function createAnalysisWorker(
  connection: ConnectionOptions,
  deps: AnalysisJobDeps,
): { close(): Promise<void> } {
  const worker = new Worker(ANALYSIS_QUEUE, createAnalysisProcessor(deps), {
    connection,
    concurrency: 1,
  });
  // message 는 접속 문자열을 담을 수 있어 쓰지 않고, 이름도 공용 규칙으로 거른다(main.ts 와 같은 원칙).
  worker.on("error", (error) => {
    console.error(`analysis worker 오류: ${errorNameOf(error)}`);
  });
  return { close: () => worker.close() };
}

/** env 로 gateway·시계·실행 모드·로그를 만든다. port 는 받는다. 설정 오류는 키 이름만 담아 그대로 던진다. */
export function createAnalysisJobDeps(
  env: Record<string, string | undefined>,
  ports: Pick<AnalysisJobDeps, "loader" | "tracker" | "extraction" | "sink" | "documents">,
): AnalysisJobDeps {
  return {
    gateway: createGatewayClient(readGatewayConfig(env)),
    loader: ports.loader,
    tracker: ports.tracker,
    extraction: ports.extraction,
    sink: ports.sink,
    documents: ports.documents,
    now: () => new Date(),
    env: readRunMode(env),
    log: (line) => {
      console.log(line);
    },
  };
}
