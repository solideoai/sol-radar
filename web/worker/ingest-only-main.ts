import { Queue } from "bullmq";
import IORedis from "ioredis";
import { INGEST_QUEUE, type RefillG2bAuxResult } from "@/server/ingestion";
import { readWorkerEnv } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { INGEST_SCHEDULE_LABEL, readRunMode } from "@/worker/ingest-queue";
import { formatIngestQueueStatus, readIngestQueueStatus } from "@/worker/ingest-queue-status";
import {
  INGEST_SCHEDULER_IDS,
  createIngestWorkerRegistration,
  createRegisteredWorker,
  defaultWorkerDeps,
  describeIngestConfig,
  errorCode,
  runG2bAuxRefillOnce,
  runG2bIngestOnce,
  startWorker,
  type IngestOnceResult,
  type WorkerDeps,
  type WorkerRegistration,
} from "@/worker/main";

// ── Ingest 전용 worker(10-25 live 수집 계획 B1). 회사 서버에서 전체 worker 와 따로 g2b live 수집만 돌린다 ──
// 의존성 보고·분석·알림·마감·부처 공고·Storage 정리 등록은 넣지 않는다. 의존성 보고는 scope 에 runMode 가 들어가
// live 보고가 다른 모드의 보고를 덮으면 회사 redis-api readiness 가 503 이 된다(server/health/dependency-report.ts).
// documents 큐에는 소비자가 없어 첨부 job 도 넣지 않는다(첨부 행은 DB 에 PENDING 으로 남는다, main.ts ingestJobDepsOf).
//
// 명령: (없음) 정기 수집 기동 · --check 설정 확인 · --status 큐 읽기 · --once --window-minutes N 1회 수집 · --unschedule 정기 일정 전부 삭제
// · --refill-aux --limit N 보조 조회가 빠진 나라장터 공고 N건까지 같은 revision 에 채우기(사용자 결정 2026-10-29)

type Env = Record<string, string | undefined>;
export type ShutdownSignal = "SIGTERM" | "SIGINT";
type G2bOnceJobData = {
  source: "g2b";
  trigger: "SCHEDULED";
  jobKey: string;
  window: { from: string; to: string };
};

/**
 * 정기 창 상한(분) = 24시간. 이전 성공 run 이 없거나 24시간보다 오래됐으면 최근 24시간만 받는다(더 긴 백필은 --once).
 * 3시간 일정에서 상한이 6시간이면, 하루 예산 소진·장애로 실패한 창을 자정 뒤에 다시 쓸 때 6시간 넘은 구간이 잘려 빈틈이 생긴다.
 * 24시간은 실패 창 재사용(그날 소진 → 다음 날 00시)을 덮고, 10-26 D4 1회 수집(창 24시간, 호출 259회)과 같은 크기다.
 */
export const SCHEDULED_WINDOW_CAP_MINUTES = 1440;
export const ONCE_MAX_WINDOW_MINUTES = 1440;
/** --refill-aux 한 번에 고를 공고 수 상한. 오퍼레이션별 하루 한도(1,000)보다 크지 않게 둔다 */
export const REFILL_MAX_LIMIT = 1000;

export const ingestOnlyRegistrations = (log: (line: string) => void): WorkerRegistration[] => [
  createIngestWorkerRegistration({
    documents: false,
    scheduledWindowCapMinutes: SCHEDULED_WINDOW_CAP_MINUTES,
    log,
  }),
];

export type IngestOnlyDeps = {
  workerDeps: WorkerDeps;
  runOnce: (env: Env, data: G2bOnceJobData) => Promise<IngestOnceResult>;
  refillAux: (env: Env, limit: number) => Promise<RefillG2bAuxResult>;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  exit: (code: number) => void;
  log: (line: string) => void;
  logError: (line: string) => void;
  now: () => Date;
};

// 1회 명령(--status·--unschedule·--once)의 연결이다. 닿지 않는 Redis 를 끝없이 기다리지 않게 재연결을 몇 번만 하고 포기한다.
const ONE_SHOT_REDIS_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  retryStrategy: (times: number) => (times > 3 ? null : 500),
};
const ignoreError = () => undefined;

async function withOneShotRedis<T>(env: Env, task: (redis: IORedis) => Promise<T>): Promise<T> {
  const { redisUrl } = readWorkerEnv(env);
  const redis = new IORedis(redisUrl, ONE_SHOT_REDIS_OPTIONS);
  // 연결 오류는 명령의 거절로 한 번 드러난다. 재연결마다 message(접속 대상)를 찍지 않게 받아만 둔다.
  redis.on("error", ignoreError);
  try {
    return await task(redis);
  } finally {
    redis.disconnect();
  }
}

export const defaultIngestOnlyDeps: IngestOnlyDeps = {
  workerDeps: {
    ...defaultWorkerDeps,
    createWorker: createRegisteredWorker(
      ingestOnlyRegistrations((line) => {
        console.log(line);
      }),
    ),
  },
  runOnce: (env, data) => withOneShotRedis(env, (redis) => runG2bIngestOnce(env, redis, data)),
  refillAux: (env, limit) =>
    withOneShotRedis(env, (redis) => runG2bAuxRefillOnce(env, redis, limit)),
  onSignal: (signal, listener) => {
    process.once(signal, listener);
  },
  exit: (code) => {
    process.exit(code);
  },
  log: (line) => {
    console.log(line);
  },
  logError: (line) => {
    console.error(line);
  },
  now: () => new Date(),
};

type Command =
  | { kind: "run" }
  | { kind: "check" }
  | { kind: "status" }
  | { kind: "unschedule" }
  | { kind: "once"; windowMinutes: number }
  | { kind: "refillAux"; limit: number };

const MODE_FLAGS = ["--check", "--status", "--unschedule", "--once", "--refill-aux"] as const;
const WINDOW_FLAG = "--window-minutes";
const LIMIT_FLAG = "--limit";
const USAGE =
  "사용법: ingest-only-main.ts [--check | --status | --unschedule | --once --window-minutes <1~1440> | --refill-aux --limit <1~1000>]";

/** 값을 받는 인자(flag 와 바로 뒤 값)를 떼어 낸다 */
function takeValueFlag(
  argv: readonly string[],
  flag: string,
): { present: boolean; value: string | undefined; rest: readonly string[] } {
  const index = argv.indexOf(flag);
  if (index === -1) return { present: false, value: undefined, rest: argv };
  return {
    present: true,
    value: argv[index + 1],
    rest: argv.filter((_, at) => at !== index && at !== index + 1),
  };
}

const positiveIntOf = (value: string | undefined): number =>
  value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : 0;

// 인자 값은 오류에 싣지 않는다. 틀리면 사용법만 알린다.
function parseCommand(argv: readonly string[]): Command {
  const window = takeValueFlag(argv, WINDOW_FLAG);
  const limit = takeValueFlag(window.rest, LIMIT_FLAG);
  const rest = limit.rest;
  const modes = rest.filter((arg) => (MODE_FLAGS as readonly string[]).includes(arg));
  if (modes.length !== rest.length || modes.length > 1) throw new Error(USAGE);
  const mode = modes[0];
  if ((mode !== "--once" && window.present) || (mode !== "--refill-aux" && limit.present))
    throw new Error(USAGE);
  if (mode === "--once") {
    const minutes = positiveIntOf(window.value);
    if (minutes < 1 || minutes > ONCE_MAX_WINDOW_MINUTES) {
      throw new Error(
        `--once 에는 ${WINDOW_FLAG} 1~${ONCE_MAX_WINDOW_MINUTES} 가 필요하다. ${USAGE}`,
      );
    }
    return { kind: "once", windowMinutes: minutes };
  }
  if (mode === "--refill-aux") {
    const count = positiveIntOf(limit.value);
    if (count < 1 || count > REFILL_MAX_LIMIT)
      throw new Error(
        `--refill-aux 에는 ${LIMIT_FLAG} 1~${REFILL_MAX_LIMIT} 가 필요하다. ${USAGE}`,
      );
    return { kind: "refillAux", limit: count };
  }
  if (mode === "--check") return { kind: "check" };
  if (mode === "--status") return { kind: "status" };
  if (mode === "--unschedule") return { kind: "unschedule" };
  return { kind: "run" };
}

const MINUTE_MS = 60_000;

/**
 * --once 의 job data. 창은 [지금(분 내림) − N분, 지금(분 내림)]. trigger 는 DB 가 받는 SCHEDULED 다(ingest_runs_trigger_check).
 * jobKey 는 g2b:ONCE: 로 시작해 일정 회차(g2b:SCHEDULED:<창 끝>)와 겹치지 않는다. 같은 분에 다시 돌리면 같은 run 을 이어 쓴다.
 */
export function onceG2bJobData(now: Date, windowMinutes: number): G2bOnceJobData {
  const to = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const from = new Date(to.getTime() - windowMinutes * MINUTE_MS);
  const window = { from: from.toISOString(), to: to.toISOString() };
  return {
    source: "g2b",
    trigger: "SCHEDULED",
    jobKey: `g2b:ONCE:${window.from}:${window.to}`,
    window,
  };
}

// mock·fixture 로 뜨면 ingest 등록이 g2b-scheduled 일정을 지운다(main.ts syncG2bSchedule). 그래서 Redis 연결 전에 멈춘다.
// readRunMode 는 값이 틀리면(예: LIVE) env 이름만 담아 던진다.
function assertLiveRunMode(env: Env): void {
  if (readRunMode(env) !== "live") {
    throw new Error(
      "ingest 전용 worker 는 SOL_RUN_MODE=live 에서만 실행한다(mock·fixture 는 g2b 일정을 지운다)",
    );
  }
}

// 이름·코드만 싣는다. Redis 오류 message 는 접속 대상을 담을 수 있다(main.ts errorCode 와 같은 규칙).
const describeRedisError = (error: unknown): string => {
  const code = errorCode(error);
  return code ? `${errorNameOf(error)} ${code}` : errorNameOf(error);
};

// --check: 등록의 1단계(registry·서비스키 env 이름 확인)까지만 돈다. Redis·Supabase·외부 API 는 부르지 않는다.
async function checkIngestOnly(env: Env, deps: IngestOnlyDeps): Promise<void> {
  assertLiveRunMode(env);
  readWorkerEnv(env);
  const config = await describeIngestConfig(env);
  deps.log(`registry: ${config.registryFile}`);
  deps.log(`g2b 소스(목록·보조): ${config.g2bSources.join(", ")}`);
  // 외부 서비스는 서비스마다 상태만 알린다. 키가 없거나 한도가 미정인 서비스가 있어도 확인은 통과한다(나라장터만 필수).
  for (const line of config.externalReadiness) deps.log(line);
  if (config.ignoredIntervalNotice !== null) deps.log(config.ignoredIntervalNotice);
  deps.log(`ingest-only worker 확인 통과: SOL_RUN_MODE=live, 정기 수집 ${config.schedule}`);
}

// --status: 읽기 명령만 쓴다(ingest-queue-status.ts). 기동 전 확인용이다.
async function printIngestStatus(env: Env, deps: IngestOnlyDeps): Promise<void> {
  const status = await withOneShotRedis(env, readIngestQueueStatus).catch((error: unknown) => {
    throw new Error(`ingest 큐 상태 읽기 실패: ${describeRedisError(error)}`);
  });
  for (const line of formatIngestQueueStatus(status)) deps.log(line);
}

// --unschedule: 이 worker 가 거는 정기 일정(g2b-scheduled 와 외부 서비스별 <key>-scheduled)을 모두 지운다.
// 없는 일정은 오류가 아니다. 큐에 남은 job·quota 키·수집 상태 키·수집한 공고는 건드리지 않는다.
async function unscheduleIngest(env: Env, deps: IngestOnlyDeps): Promise<void> {
  await withOneShotRedis(env, async (connection) => {
    const queue = new Queue(INGEST_QUEUE, { connection });
    queue.on("error", ignoreError);
    try {
      for (const id of INGEST_SCHEDULER_IDS) await queue.removeJobScheduler(id);
    } finally {
      await queue.close();
    }
  }).catch((error: unknown) => {
    throw new Error(`정기 수집 일정 삭제 실패: ${describeRedisError(error)}`);
  });
  deps.log(`ingest 큐의 정기 일정을 지웠다: ${INGEST_SCHEDULER_IDS.join(", ")}`);
}

// --once: 일정을 만들지 않고 이 프로세스에서 수집을 1회 돈다. 실제 API 를 부른다(F08 예약으로 일 한도를 지킨다).
async function runOnce(env: Env, windowMinutes: number, deps: IngestOnlyDeps): Promise<boolean> {
  assertLiveRunMode(env);
  await deps.workerDeps.checkReadiness(readWorkerEnv(env));
  const data = onceG2bJobData(deps.now(), windowMinutes);
  deps.log(`ingest-only 1회 수집 시작: 창 ${data.window.from} ~ ${data.window.to}`);
  // 수집 중 Redis·DB 연결 오류의 message 는 접속 주소를 담을 수 있다. 이름·코드만 남긴다(보안 검토 10-25 낮음 2).
  const result = await deps.runOnce(env, data).catch((error: unknown) => {
    throw new Error(`ingest-only 1회 수집 실패: ${describeRedisError(error)}`);
  });
  const { summary } = result;
  deps.log(
    [
      `ingest-only 1회 수집 결과: status=${result.status}`,
      `created=${summary.created}`,
      `changed=${summary.changed}`,
      `skippedDuplicate=${summary.skippedDuplicate}`,
      `quarantined=${summary.quarantined}`,
      `quotaUsed=${result.quotaUsed ?? "-"}`,
      `alreadyFinished=${result.alreadyFinished}`,
      `runId=${result.runId}`,
    ].join(" "),
  );
  return result.status === "SUCCEEDED" || result.status === "PARTIAL";
}

// --refill-aux: 보조 조회가 빠진 나라장터 공고를 같은 revision 에 채운다. 실제 API 를 부른다(오퍼레이션별 예약으로 일 한도를 지킨다).
// 새 revision·변경 이벤트를 만들지 않는다. 정기 수집 몫을 쓰지 않게 그날 마지막 회차(21시) 뒤에 돌린다.
async function refillAux(env: Env, limit: number, deps: IngestOnlyDeps): Promise<boolean> {
  assertLiveRunMode(env);
  await deps.workerDeps.checkReadiness(readWorkerEnv(env));
  deps.log(`ingest-only 보조 조회 다시 채우기 시작: 최대 ${limit}건`);
  const result = await deps.refillAux(env, limit).catch((error: unknown) => {
    throw new Error(`ingest-only 보조 조회 다시 채우기 실패: ${describeRedisError(error)}`);
  });
  const failures = Object.entries(result.failures)
    .map(([key, count]) => `${key}=${count}`)
    .join(",");
  deps.log(
    [
      `ingest-only 보조 조회 다시 채우기 결과: checked=${result.checked}`,
      `refilled=${result.refilled}`,
      `incomplete=${result.incomplete}`,
      `closed=${result.closed}`,
      `conflicted=${result.conflicted}`,
      `calls=${result.calls}`,
      `stoppedBy=${result.stoppedBy ?? "-"}`,
      `failures=${failures === "" ? "-" : failures}`,
    ].join(" "),
  );
  return result.stoppedBy !== "QUOTA_UNAVAILABLE";
}

async function startIngestOnly(env: Env, deps: IngestOnlyDeps): Promise<void> {
  assertLiveRunMode(env);
  const handle = await startWorker(env, deps.workerDeps);
  deps.log(`ingest-only worker started: SOL_RUN_MODE=live, 정기 수집 ${INGEST_SCHEDULE_LABEL}`);
  // SIGTERM 뒤 SIGINT 가 와도 close 는 한 번만 부른다.
  let isClosing = false;
  const shutdown = () => {
    if (isClosing) return;
    isClosing = true;
    handle.close().then(
      () => deps.exit(0),
      (error: unknown) => {
        deps.logError(`ingest-only worker 종료 실패: ${errorNameOf(error)}`);
        deps.exit(1);
      },
    );
  };
  deps.onSignal("SIGTERM", shutdown);
  deps.onSignal("SIGINT", shutdown);
}

export async function runIngestOnly(
  argv: readonly string[],
  env: Env,
  deps: IngestOnlyDeps = defaultIngestOnlyDeps,
): Promise<void> {
  try {
    const command = parseCommand(argv);
    if (command.kind === "run") {
      await startIngestOnly(env, deps);
      return;
    }
    if (command.kind === "check") await checkIngestOnly(env, deps);
    if (command.kind === "status") await printIngestStatus(env, deps);
    if (command.kind === "unschedule") await unscheduleIngest(env, deps);
    if (command.kind === "once") {
      deps.exit((await runOnce(env, command.windowMinutes, deps)) ? 0 : 1);
      return;
    }
    if (command.kind === "refillAux") {
      deps.exit((await refillAux(env, command.limit, deps)) ? 0 : 1);
      return;
    }
    deps.exit(0);
  } catch (error) {
    // 메시지는 env 이름·구성요소 이름·경로·오류 코드만 담는다(readWorkerEnv·readRunMode·checkReadiness, main.ts 와 같다).
    deps.logError(error instanceof Error ? error.message : "ingest-only worker 실패");
    deps.exit(1);
  }
}

// 테스트가 불러올 때는 자동 기동하지 않는다.
if (/[\\/]worker[\\/]ingest-only-main\.ts$/.test(process.argv[1] ?? "")) {
  void runIngestOnly(process.argv.slice(2), process.env);
}
