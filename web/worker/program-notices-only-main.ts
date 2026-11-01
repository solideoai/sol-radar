import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  INGEST_SCHEDULE_PATTERN,
  INGEST_SCHEDULE_TIMEZONE,
  nextIngestSlotAfter,
} from "@/server/ingestion";
import {
  createSupabaseProgramNoticesStore,
  decodeServiceKey,
  loadProgramNoticesConfig,
  runProgramNoticeRound,
  type ProgramNoticeSource,
  type ProgramNoticesConfig,
  type ProgramRun,
} from "@/server/program-notices";
import { getSupabaseAdmin } from "@/server/supabase";
import { readWorkerEnv } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { INGEST_SCHEDULE_LABEL, readRunMode } from "@/worker/ingest-queue";
import {
  createRegisteredWorker,
  defaultWorkerDeps,
  errorCode,
  startWorker,
  type Closable,
  type WorkerDeps,
  type WorkerRegistration,
} from "@/worker/main";
import { PROGRAM_NOTICE_RETRY, readProgramNoticeRuntime } from "@/worker/program-notices";

// ── 부처 공고 전용 worker(2026-10-28 기업마당 운영 수집). 회사 서버에서 ingest·analysis·documents·notify 전용 worker 와 따로 돈다 ──
// 회사에는 전체 worker(main.ts)가 없어 programNoticesWorkerRegistration(주기 60분)이 돌지 않았다(운영 program_notices 0행).
// 이 worker 는 나라장터 수집과 같은 일정(Asia/Seoul cron, 매일 00·03·…·21시 정각)을 자기 큐(program-notices)에 건다.
// ingest 큐·일정·quota 키는 건드리지 않는다. 그래서 ingest 전용 worker 를 다시 만들지 않고 따로 켜고 끌 수 있다.
//
// 소스는 기업마당(사용자 결정 2026-10-28)과 과기정통부(사용자 결정 2026-11-01)다. 중기부 RSS 는 부르지 않는다.
// 기업마당이 꺼졌거나 키가 없으면 기동하지 않는다. 과기정통부는 설정·키가 틀리면 그 소스만 건너뛰고 기동한다.
// 수집·정규화·중복 제거·저장 규칙은 program-notices 도메인이다:
// (source, source_notice_id) upsert, 같은 회차 안 같은 id 는 뒤의 것, 해석 실패·0건이면 저장하지 않는다, 회차마다 program_notice_runs 한 행.
// live 요청은 수집과 같은 재시도 규칙(ingestion/retry.ts, 시간 초과·429·5xx 만 최대 3번 더)을 쓴다. 회차가 실패해도 일정은 남고 다음 정각에 다시 돈다.
// 로그에는 상태·건수·오류 코드만 남긴다. BIZINFO_API_KEY·MSIT_ANNOUNCEMENT_API_KEY 값·요청 URL·응답 본문은 남기지 않는다.
//
// 전체 worker(main.ts)의 programNoticesWorkerRegistration 은 로컬 Compose 용으로 그대로 둔다. 같은 DB 에서 둘이 함께 떠도 행은 겹치지 않는다
// (같은 공고는 (source, source_notice_id) upsert 로 한 행). 다만 그쪽은 기동 즉시·60분마다 기업마당과 중기부를 따로 불러 호출과
// program_notice_runs 행이 늘고, 운영에 중기부 공고가 들어온다. 그래서 함께 띄우지 않는다(compose.program-notices-only.company.yaml).
//
// 명령: (없음) 기동 · --check 설정 확인(Redis·Supabase·기업마당을 부르지 않는다) · --status 큐 읽기
//      · --once 1회 수집(소스마다 요청 1회, 시간 초과·429·5xx 면 최대 3번 더) · --unschedule program-notices 큐의 bizinfo-scheduled 만 삭제

type Env = Record<string, string | undefined>;
export type ShutdownSignal = "SIGTERM" | "SIGINT";

export const PROGRAM_NOTICES_QUEUE = "program-notices";
export const BIZINFO_SCHEDULER_ID = "bizinfo-scheduled";
export const PROGRAM_NOTICES_JOB_NAME = "program-notices-round";
/** 회사 운영에서 도는 소스(2026-11-01 사용자 결정: 과기정통부 추가, 중기부는 계속 부르지 않는다) */
export const SCHEDULED_SOURCES: readonly ProgramNoticeSource[] = ["bizinfo", "msit"];

/** 나라장터 정기 수집(main.ts INGEST_REPEAT)과 같은 일정. immediately 를 주지 않아 기동 즉시 부르지 않고 다음 정각부터 돈다 */
export const PROGRAM_NOTICES_REPEAT = {
  pattern: INGEST_SCHEDULE_PATTERN,
  tz: INGEST_SCHEDULE_TIMEZONE,
} as const;

// ingest 큐(ingestion.queue.ts)와 같은 보존 기간. 회차 기록의 정본은 program_notice_runs 표다.
const JOB_RETENTION = {
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const;

export type ProgramNoticesPlan = {
  config: ProgramNoticesConfig;
  configFile: string;
  recordingsDir: string;
  /** 이번 기동에서 도는 소스. 기업마당은 늘 있고, 과기정통부는 설정·키가 맞을 때만 있다 */
  sources: ProgramNoticeSource[];
  /** --check·기동 로그에 남길 설명. env 값·키·요청 URL 은 싣지 않는다 */
  lines: string[];
};

function assertLiveRunMode(env: Env): void {
  if (readRunMode(env) !== "live") {
    throw new Error("부처 공고 전용 worker 는 SOL_RUN_MODE=live 에서만 실행한다");
  }
}

/** 과기정통부를 이번 기동에 넣을지와 그 설명 한 줄. 키 값은 싣지 않는다 */
function msitPlanOf(config: ProgramNoticesConfig, env: Env): { included: boolean; line: string } {
  const msit = config.msit;
  if (!msit.ok) return { included: false, line: `과기정통부: ${msit.reason}, 건너뜀` };
  const { enabled, keyEnv, maxItems } = msit.value;
  if (!enabled)
    return {
      included: false,
      line: "과기정통부: 꺼짐(program-notices.yaml sources.msit.enabled), 건너뜀",
    };
  if (decodeServiceKey(env[keyEnv]) === null)
    return { included: false, line: `과기정통부: ${keyEnv} 없음 또는 형식 오류, 건너뜀` };
  return { included: true, line: `과기정통부: 최대 ${maxItems}건 · ${keyEnv} SET` };
}

/** 기동 1단계. 기업마당이 틀리면 던진다(기업마당이 이 worker 의 기본 일이라 꺼진 채 뜨지 않는다). 메시지에는 키·경로 이름만 싣는다 */
export async function readProgramNoticesPlan(env: Env): Promise<ProgramNoticesPlan> {
  assertLiveRunMode(env);
  readWorkerEnv(env);
  const runtime = readProgramNoticeRuntime(env);
  if (!runtime.ok) throw new Error(runtime.reason);
  const loaded = await loadProgramNoticesConfig(runtime.configFile);
  if (!loaded.ok) throw new Error(`부처 공고 설정 오류: ${loaded.reason}`);
  const bizinfo = loaded.config.bizinfo;
  if (!bizinfo.ok) throw new Error(`기업마당 ${bizinfo.reason}`);
  const { enabled, keyEnv, categories, maxItems } = bizinfo.value;
  if (!enabled)
    throw new Error("기업마당이 꺼져 있다(program-notices.yaml sources.bizinfo.enabled)");
  if ((env[keyEnv]?.trim() ?? "") === "") {
    throw new Error(`${keyEnv} 가 비어 있다(값은 출력하지 않는다)`);
  }
  const msit = msitPlanOf(loaded.config, env);
  return {
    config: loaded.config,
    configFile: runtime.configFile,
    recordingsDir: runtime.recordingsDir,
    sources: SCHEDULED_SOURCES.filter((source) => source !== "msit" || msit.included),
    lines: [
      `부처 공고 설정: ${runtime.configFile}`,
      `기업마당: 분야 ${categories.join(",") || "전체"} · 최대 ${maxItems}건 · ${keyEnv} SET`,
      msit.line,
      `정기 수집: ${INGEST_SCHEDULE_LABEL}(${INGEST_SCHEDULE_TIMEZONE}), 큐 ${PROGRAM_NOTICES_QUEUE}, 일정 ${BIZINFO_SCHEDULER_ID}`,
    ],
  };
}

const logLine = (line: string) => {
  console.log(line);
};

/** 회사 회차 하나(plan.sources). 던지지 않는다(runProgramNoticeRound) */
export function runScheduledRound(env: Env, plan: ProgramNoticesPlan): Promise<ProgramRun[]> {
  return runProgramNoticeRound({
    config: plan.config,
    runMode: "live",
    env,
    fetch: (url, init) => fetch(url, init),
    store: createSupabaseProgramNoticesStore(getSupabaseAdmin()),
    recordingsDir: plan.recordingsDir,
    now: () => new Date(),
    log: logLine,
    retry: PROGRAM_NOTICE_RETRY,
    sources: plan.sources,
  });
}

/** 같은 id 로 다시 걸면 덮어써(upsertJobScheduler) 재기동해도 일정은 하나다 */
export async function scheduleProgramNotices(
  queue: Pick<Queue, "upsertJobScheduler">,
): Promise<void> {
  await queue.upsertJobScheduler(BIZINFO_SCHEDULER_ID, PROGRAM_NOTICES_REPEAT, {
    name: PROGRAM_NOTICES_JOB_NAME,
    data: { trigger: "SCHEDULED" },
    opts: JOB_RETENTION,
  });
}

// 오류 이름과 코드만 남긴다. message 는 접속 문자열을 담을 수 있다(main.ts logErrors 와 같은 규칙).
const describeError = (error: unknown): string => {
  const code = errorCode(error);
  return code ? `${errorNameOf(error)} ${code}` : errorNameOf(error);
};

type QueueDeps = {
  runRound: () => Promise<ProgramRun[]>;
  log: (line: string) => void;
  now: () => Date;
};

/** 큐 소비자(동시 1)와 일정을 건다. 회차 결과(소스·상태·저장 건수)만 job 결과로 남긴다 */
export async function startProgramNoticesQueue(
  connection: IORedis,
  deps: QueueDeps,
): Promise<Closable> {
  const worker = new Worker(
    PROGRAM_NOTICES_QUEUE,
    async () =>
      (await deps.runRound()).map(({ source, status, errorCode: code, savedCount }) => ({
        source,
        status,
        errorCode: code,
        savedCount,
      })),
    { connection, concurrency: 1 },
  );
  const queue = new Queue(PROGRAM_NOTICES_QUEUE, { connection });
  worker.on("error", (error) => deps.log(`program-notices worker 오류: ${describeError(error)}`));
  worker.on("failed", (_job, error) =>
    deps.log(`program-notices 회차 실패: ${describeError(error)}`),
  );
  queue.on("error", (error) => deps.log(`program-notices queue 오류: ${describeError(error)}`));
  const close = async () => {
    try {
      await worker.close();
    } finally {
      await queue.close();
    }
  };
  try {
    await scheduleProgramNotices(queue);
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  deps.log(
    `${BIZINFO_SCHEDULER_ID} 일정: ${INGEST_SCHEDULE_LABEL}(${INGEST_SCHEDULE_TIMEZONE}). ` +
      `기동 즉시 수집하지 않고 다음 정각 ${nextIngestSlotAfter(deps.now()).toISOString()} 부터 돈다(즉시 수집은 --once)`,
  );
  return { close };
}

export const programNoticesOnlyRegistration: WorkerRegistration = async (rawEnv) => {
  const plan = await readProgramNoticesPlan(rawEnv);
  return (connection) =>
    startProgramNoticesQueue(connection, {
      runRound: () => runScheduledRound(rawEnv, plan),
      log: logLine,
      now: () => new Date(),
    });
};

export type ProgramNoticesOnlyDeps = {
  workerDeps: WorkerDeps;
  runOnce: (env: Env, plan: ProgramNoticesPlan) => Promise<ProgramRun[]>;
  withRedis: <T>(env: Env, task: (redis: IORedis) => Promise<T>) => Promise<T>;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  exit: (code: number) => void;
  log: (line: string) => void;
  logError: (line: string) => void;
};

// 1회 명령(--status·--unschedule)의 연결. 닿지 않는 Redis 를 끝없이 기다리지 않는다(ingest-only-main.ts 와 같다).
const ONE_SHOT_REDIS_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  retryStrategy: (times: number) => (times > 3 ? null : 500),
};
const ignoreError = () => undefined;

async function withOneShotRedis<T>(env: Env, task: (redis: IORedis) => Promise<T>): Promise<T> {
  const redis = new IORedis(readWorkerEnv(env).redisUrl, ONE_SHOT_REDIS_OPTIONS);
  // 재연결마다 message(접속 대상)를 찍지 않게 받아만 둔다.
  redis.on("error", ignoreError);
  try {
    return await task(redis);
  } finally {
    redis.disconnect();
  }
}

export const defaultProgramNoticesOnlyDeps: ProgramNoticesOnlyDeps = {
  workerDeps: {
    ...defaultWorkerDeps,
    createWorker: createRegisteredWorker([programNoticesOnlyRegistration]),
  },
  runOnce: runScheduledRound,
  withRedis: withOneShotRedis,
  onSignal: (signal, listener) => {
    process.once(signal, listener);
  },
  exit: (code) => {
    process.exit(code);
  },
  log: logLine,
  logError: (line) => {
    console.error(line);
  },
};

const COMMANDS = ["--check", "--status", "--once", "--unschedule"] as const;
type Command = "run" | (typeof COMMANDS)[number];
const USAGE = `사용법: program-notices-only-main.ts [${COMMANDS.join(" | ")}]`;

function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 0) return "run";
  const [first] = argv;
  if (argv.length === 1 && (COMMANDS as readonly string[]).includes(first ?? "")) {
    return first as Command;
  }
  throw new Error(USAGE);
}

// 큐 읽기만 한다. 일정·job 을 만들거나 지우지 않는다.
async function printStatus(env: Env, deps: ProgramNoticesOnlyDeps): Promise<void> {
  const status = await deps
    .withRedis(env, async (connection) => {
      const queue = new Queue(PROGRAM_NOTICES_QUEUE, { connection });
      queue.on("error", ignoreError);
      try {
        return {
          schedulers: await queue.getJobSchedulers(0, -1),
          counts: await queue.getJobCounts("waiting", "delayed", "active", "completed", "failed"),
        };
      } finally {
        await queue.close();
      }
    })
    .catch((error: unknown) => {
      throw new Error(`program-notices 큐 상태 읽기 실패: ${describeError(error)}`);
    });
  deps.log(`Job Scheduler ${status.schedulers.length}개`);
  for (const scheduler of status.schedulers) {
    const next = scheduler.next === undefined ? "-" : new Date(scheduler.next).toISOString();
    deps.log(`- ${scheduler.key} ${scheduler.pattern ?? "-"} ${scheduler.tz ?? "-"} 다음 ${next}`);
  }
  deps.log(
    `job: ${Object.entries(status.counts)
      .map(([name, count]) => `${name}=${count}`)
      .join(" ")}`,
  );
}

async function unschedule(env: Env, deps: ProgramNoticesOnlyDeps): Promise<void> {
  await deps
    .withRedis(env, async (connection) => {
      const queue = new Queue(PROGRAM_NOTICES_QUEUE, { connection });
      queue.on("error", ignoreError);
      try {
        await queue.removeJobScheduler(BIZINFO_SCHEDULER_ID);
      } finally {
        await queue.close();
      }
    })
    .catch((error: unknown) => {
      throw new Error(`기업마당 정기 일정 삭제 실패: ${describeError(error)}`);
    });
  deps.log(`${PROGRAM_NOTICES_QUEUE} 큐의 정기 일정을 지웠다: ${BIZINFO_SCHEDULER_ID}`);
}

/** --once: 일정을 만들지 않고 이 프로세스에서 plan.sources 를 1회 부른다(실호출). 모두 성공·일부 성공이면 true */
async function runOnce(env: Env, deps: ProgramNoticesOnlyDeps): Promise<boolean> {
  const plan = await readProgramNoticesPlan(env);
  for (const line of plan.lines) deps.log(line);
  const runs = await deps.runOnce(env, plan);
  for (const run of runs) {
    deps.log(
      [
        `program-notices-only 1회 수집 결과: source=${run.source}`,
        `status=${run.status}`,
        `fetched=${run.fetchedCount}`,
        `saved=${run.savedCount}`,
        `dropped=${run.droppedCount}`,
        `errorCode=${run.errorCode ?? "-"}`,
      ].join(" "),
    );
  }
  return (
    runs.length > 0 && runs.every((run) => run.status === "SUCCEEDED" || run.status === "PARTIAL")
  );
}

async function startProgramNoticesOnly(env: Env, deps: ProgramNoticesOnlyDeps): Promise<void> {
  for (const line of (await readProgramNoticesPlan(env)).lines) deps.log(line);
  const handle = await startWorker(env, deps.workerDeps);
  deps.log("program-notices-only worker started: SOL_RUN_MODE=live");
  // SIGTERM 뒤 SIGINT 가 와도 close 는 한 번만 부른다. close 는 진행 중 회차가 끝나기를 기다린다.
  let isClosing = false;
  const shutdown = () => {
    if (isClosing) return;
    isClosing = true;
    handle.close().then(
      () => deps.exit(0),
      (error: unknown) => {
        deps.logError(`program-notices-only worker 종료 실패: ${errorNameOf(error)}`);
        deps.exit(1);
      },
    );
  };
  deps.onSignal("SIGTERM", shutdown);
  deps.onSignal("SIGINT", shutdown);
}

export async function runProgramNoticesOnly(
  argv: readonly string[],
  env: Env,
  deps: ProgramNoticesOnlyDeps = defaultProgramNoticesOnlyDeps,
): Promise<void> {
  try {
    const command = parseCommand(argv);
    if (command === "run") {
      await startProgramNoticesOnly(env, deps);
      return;
    }
    if (command === "--once") {
      deps.exit((await runOnce(env, deps)) ? 0 : 1);
      return;
    }
    if (command === "--check") {
      for (const line of (await readProgramNoticesPlan(env)).lines) deps.log(line);
      deps.log("program-notices-only worker 확인 통과: SOL_RUN_MODE=live");
    }
    if (command === "--status") await printStatus(env, deps);
    if (command === "--unschedule") await unschedule(env, deps);
    deps.exit(0);
  } catch (error) {
    // 메시지는 env 이름·구성요소 이름·경로·오류 코드만 담는다(readWorkerEnv·readRunMode·설정 읽기·checkReadiness).
    deps.logError(error instanceof Error ? error.message : "program-notices-only worker 실패");
    deps.exit(1);
  }
}

// 테스트가 불러올 때는 자동 기동하지 않는다.
if (/[\\/]worker[\\/]program-notices-only-main\.ts$/.test(process.argv[1] ?? "")) {
  void runProgramNoticesOnly(process.argv.slice(2), process.env);
}
