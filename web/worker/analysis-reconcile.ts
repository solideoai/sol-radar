import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  analysisJobDataSchema,
  toAnalysisJobId,
  type AnalysisJobData,
  type AnalysisRunTracker,
  type StaleRun,
  type StaleRunCursor,
  type StaleRunFinder,
} from "@/server/analysis";
import { errorNameOf } from "@/worker/error-name";

// ── 멈춘 run 복구: 오래 QUEUED·RUNNING 으로 남은 score_runs 를 찾아 job 상태로 판정한다(docs/02 "job 유실 없음") ──
// RUNNING run 의 job 이 Redis 에 없으면(worker 가 죽었다) 같은 jobId 로 다시 넣는다. RUNNING 은 worker 만 쓴다.
// QUEUED run 의 job 이 없으면 다시 넣지 않고 FAILED(STALE_RUN)로 닫는다. 화면 역할이 PostgREST 로 직접 넣은 QUEUED 행이
// Route Handler 의 속도 제한을 건너 큐에 들어가지 않게 한다(C5-B 보안 후속 1). 정상 경로의 enqueue 실패는 C6 가 ENQUEUE_FAILED 로 닫는다.
// 시도를 다 썼거나 처리가 끝난 job 이면 FAILED(STALE_RUN)로 닫는다. 진행 중인 job 은 건드리지 않는다.
// 로그에는 식별자·상태·동작·오류 이름만 싣는다. idempotencyKey(requestId)·오류 message 는 싣지 않는다.

export type ReconcileSettings = {
  staleQueuedMs: number;
  staleRunningMs: number;
  intervalMs: number;
  batchLimit: number;
};

const QUEUED_KEY = "ANALYSIS_STALE_QUEUED_MS";
const RUNNING_KEY = "ANALYSIS_STALE_RUNNING_MS";
const INTERVAL_KEY = "ANALYSIS_RECONCILE_INTERVAL_MS";

const DEFAULT_STALE_MS = 600_000;
const DEFAULT_INTERVAL_MS = 60_000;
const BATCH_LIMIT = 50;
/** 한 회차가 이어 읽는 페이지 수 상한(batchLimit 50 이면 1000건). 넘는 run 은 다음 회차가 처음부터 다시 읽는다. */
const MAX_PAGES = 20;
const MIN_MS = 1;
const MAX_MS = 3_600_000;
const DECIMAL_INTEGER = /^[0-9]+$/;

/** 빈 값은 fallback, 1 이상 3_600_000 이하 10진 정수만 받는다. 틀리면 null. */
function parseMs(raw: string | undefined, fallback: number): number | null {
  const value = raw?.trim() ?? "";
  if (value === "") return fallback;
  if (!DECIMAL_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return parsed >= MIN_MS && parsed <= MAX_MS ? parsed : null;
}

/** 복구 설정. 오류에는 틀린 키 이름만 싣고 값은 싣지 않는다. */
export function readReconcileSettings(env: Record<string, string | undefined>): ReconcileSettings {
  const staleQueuedMs = parseMs(env[QUEUED_KEY], DEFAULT_STALE_MS);
  const staleRunningMs = parseMs(env[RUNNING_KEY], DEFAULT_STALE_MS);
  const intervalMs = parseMs(env[INTERVAL_KEY], DEFAULT_INTERVAL_MS);
  if (staleQueuedMs === null || staleRunningMs === null || intervalMs === null) {
    const invalidKeys = [
      staleQueuedMs === null ? QUEUED_KEY : null,
      staleRunningMs === null ? RUNNING_KEY : null,
      intervalMs === null ? INTERVAL_KEY : null,
    ].filter((key) => key !== null);
    throw new Error(`worker env 오류: ${invalidKeys.join(", ")}`);
  }
  return { staleQueuedMs, staleRunningMs, intervalMs, batchLimit: BATCH_LIMIT };
}

/** BullMQ Queue 가운데 복구가 쓰는 것. */
export type ReconcileQueue = {
  /** "waiting"|"active"|"delayed"|"prioritized"|"waiting-children"|"completed"|"failed"|"unknown" */
  getJobState(jobId: string): Promise<string>;
  add(
    name: string,
    data: AnalysisJobData,
    opts: { jobId: string } & typeof ANALYSIS_JOB_OPTIONS,
  ): Promise<unknown>;
};

export type ReconcileDeps = {
  finder: StaleRunFinder;
  tracker: AnalysisRunTracker;
  queue: ReconcileQueue;
  now: () => Date;
  settings: ReconcileSettings;
  /** JSON 한 줄. */
  log: (line: string) => void;
};

export type ReconcileSummary = {
  checked: number;
  requeued: number;
  failed: number;
  inFlight: number;
};

type ReconcileAction = "REQUEUE" | "FAIL" | "KEEP";

/** worker 가 아직 잡고 있거나 곧 잡을 job. */
const IN_FLIGHT_STATES: readonly string[] = [
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
];
/** 시도를 다 썼거나(failed) 처리가 끝났는데(completed) run 이 남았다. 다시 넣어도 BullMQ 가 같은 jobId 를 무시한다. */
const FINISHED_STATES: readonly string[] = ["failed", "completed"];

const STALE_RUN_ERROR = "STALE_RUN";

type Step = "getJobState" | "add" | "markFailed";

type RunResult =
  | { ok: true; jobState: string; action: ReconcileAction }
  | { ok: false; jobState: string | null; step: Step; errorName: string };

/** run 하나를 판정하고 처리한다. 실패하면 어느 단계에서 무슨 이름의 오류였는지 돌려준다. */
async function reconcileRun(
  deps: ReconcileDeps,
  run: StaleRun,
  finishedAt: string,
): Promise<RunResult> {
  const jobId = toAnalysisJobId(run);
  let state: string;
  try {
    state = await deps.queue.getJobState(jobId);
  } catch (error) {
    return { ok: false, jobState: null, step: "getJobState", errorName: errorNameOf(error) };
  }

  // 진행 중인 job 은 idempotencyKey 와 상관없이 그대로 둔다(처리 중인 run 을 FAILED 로 닫지 않는다).
  if (IN_FLIGHT_STATES.includes(state)) return { ok: true, jobState: state, action: "KEEP" };

  const markStale = async (): Promise<RunResult> => {
    try {
      await deps.tracker.markFailed({
        orgId: run.orgId,
        scoreRunId: run.scoreRunId,
        errorCode: STALE_RUN_ERROR,
        finishedAt,
      });
      return { ok: true, jobState: state, action: "FAIL" };
    } catch (error) {
      return { ok: false, jobState: state, step: "markFailed", errorName: errorNameOf(error) };
    }
  };

  if (FINISHED_STATES.includes(state)) return markStale();
  if (state !== "unknown") return { ok: true, jobState: state, action: "KEEP" };

  // job 이 Redis 에 없다. QUEUED 는 누가 넣었는지 모르므로(속도 제한 우회) 다시 넣지 않고 닫는다.
  if (run.status === "QUEUED") return markStale();

  // RUNNING 이다. 다시 넣을 데이터를 C6 와 같은 계약으로 만들 수 없으면 닫는다.
  const parsed = analysisJobDataSchema.safeParse({
    orgId: run.orgId,
    scoreRunId: run.scoreRunId,
    idempotencyKey: run.idempotencyKey,
  });
  if (!parsed.success) return markStale();
  try {
    await deps.queue.add(ANALYSIS_JOB, parsed.data, { ...ANALYSIS_JOB_OPTIONS, jobId });
    return { ok: true, jobState: state, action: "REQUEUE" };
  } catch (error) {
    return { ok: false, jobState: state, step: "add", errorName: errorNameOf(error) };
  }
}

/** run 하나를 처리하고 결과 줄을 남긴다. 실패하면 null 이다. */
async function reconcileAndLog(
  deps: ReconcileDeps,
  run: StaleRun,
  finishedAt: string,
): Promise<ReconcileAction | null> {
  const result = await reconcileRun(deps, run, finishedAt);
  const base = { event: "analysis.reconcile", orgId: run.orgId, scoreRunId: run.scoreRunId };
  if (result.ok) {
    deps.log(JSON.stringify({ ...base, jobState: result.jobState, action: result.action }));
    return result.action;
  }
  deps.log(
    JSON.stringify({
      ...base,
      jobState: result.jobState,
      action: "ERROR",
      step: result.step,
      errorName: result.errorName,
    }),
  );
  return null;
}

/**
 * 한 번 돈다. (queuedAt, id) 순 keyset 페이지를 이어 읽어(최대 MAX_PAGES) 앞 페이지가 모두 진행 중이어도 뒤 run 에 닿는다.
 * run 하나의 처리 실패는 그 run 만 건너뛰고(로그) 나머지를 계속한다. finder 실패는 던진다.
 */
export async function reconcileOnce(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const now = deps.now().getTime();
  const { staleQueuedMs, staleRunningMs, batchLimit } = deps.settings;
  // 한 회차의 모든 페이지는 같은 기준 시각으로 읽는다.
  const staleWindow = {
    queuedBefore: new Date(now - staleQueuedMs).toISOString(),
    runningBefore: new Date(now - staleRunningMs).toISOString(),
    limit: batchLimit,
  };
  const finishedAt = new Date(now).toISOString();

  // 커서가 밀리초라 같은 밀리초 안의 run 이 다음 페이지에 다시 나올 수 있다(finder 설명). 한 회차에서는 한 번만 처리한다.
  const seen = new Set<string>();
  const actions: (ReconcileAction | null)[] = [];
  let after: StaleRunCursor | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const runs = await deps.finder.findStaleRuns({ ...staleWindow, after });
    // 순서대로 하나씩 처리한다. 같은 회차 안에서 Redis·DB 에 몰아 보내지 않는다.
    for (const run of runs) {
      if (seen.has(run.scoreRunId)) continue;
      seen.add(run.scoreRunId);
      actions.push(await reconcileAndLog(deps, run, finishedAt));
    }
    const last = runs.at(-1);
    if (runs.length < batchLimit || last === undefined) break;
    after = { queuedAt: last.queuedAt, id: last.scoreRunId };
  }

  const count = (action: ReconcileAction) => actions.filter((item) => item === action).length;
  const summary: ReconcileSummary = {
    checked: actions.length,
    requeued: count("REQUEUE"),
    failed: count("FAIL"),
    inFlight: count("KEEP"),
  };
  deps.log(JSON.stringify({ event: "analysis.reconcile.summary", ...summary }));
  return summary;
}

type ReconcileTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

/**
 * 기동 때 한 번, 그 뒤 intervalMs 마다 돈다. 앞 회차가 안 끝났으면 이번 회차는 건너뛴다(겹치지 않는다).
 * 회차 오류는 삼키고 로그 한 줄만 남긴다(worker 를 죽이지 않는다). stop 은 타이머를 멈추고 진행 중 회차를 기다린다.
 */
export function startReconciler(
  deps: ReconcileDeps,
  timers: ReconcileTimers = { setInterval, clearInterval },
): { stop(): Promise<void> } {
  // 진행 중인 회차. 끝나면 null 로 되돌린다. 이 closure 밖에서는 보이지 않는다.
  let running: Promise<void> | null = null;
  let isStopped = false;

  const round = () => {
    if (isStopped || running !== null) return;
    running = reconcileOnce(deps).then(
      () => undefined,
      (error: unknown) => {
        deps.log(
          JSON.stringify({ event: "analysis.reconcile.failed", errorName: errorNameOf(error) }),
        );
      },
    );
    void running.finally(() => {
      running = null;
    });
  };

  round();
  const handle = timers.setInterval(round, deps.settings.intervalMs);

  return {
    async stop() {
      isStopped = true;
      timers.clearInterval(handle);
      if (running !== null) await running;
    },
  };
}
