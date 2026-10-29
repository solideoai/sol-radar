import { setTimeout as delay } from "node:timers/promises";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  ANALYSIS_QUEUE,
  createGatewayClient,
  createItBatchStore,
  itBatchIdempotencyKey,
  readGatewayConfig,
  toAnalysisJobId,
  type AnalysisJobData,
  type GatewayClient,
  type ItBatchStore,
  type ItBatchTarget,
  type ScoreRunStatus,
} from "@/server/analysis";
import { getSupabaseAdmin } from "@/server/supabase";
import { errorNameOf } from "@/worker/error-name";
import { errorCode } from "@/worker/main";

// ── IT 공고 1회 일괄 분석 CLI(`pnpm it:batch-analyze`, ADR-069) ──
// 마감 전 IT 범위 실공고 가운데 최신 회사 프로필로 돈 분석이 없는 공고를 analysis 큐에 한 번 넣는다.
// 대상은 DB(opportunity_list_items.it_scope)에서 고르고, 분석할 원문(정규화 본문 또는 파싱된 첨부)이 없는 공고는 건너뛰고 센다.
// 화면 [분석]과 같은 enqueue 계약(score_runs QUEUED 행 + analysis job)으로 넣고 회사 Analysis Worker 가 처리한다.
// demo-preanalyze 와 같은 모양이다. 다른 점: live·local gateway 에서만 돌고, 원문을 확인하고, 미완료 run 을 maxInFlight 건까지만 둔다.
// run 행에 requested_by 를 넣지 않는다(BID_RECOMMENDED 알림을 만들지 않는다). 정기 실행·자동 재시도는 없다.
// 로그에는 bid id·상태·건수만 싣는다. 공고 제목·원문·점수·오류 message 는 싣지 않는다(docs/14).
// worker 컨테이너 안에서 돈다(REDIS_URL·service role·AI_GATEWAY_URL 이 거기 있다). 운영 DB 에 쓴다.

/** 미완료 run 상태를 읽는 간격. */
export const IT_BATCH_POLL_MS = 5_000;
const DEFAULT_MAX_IN_FLIGHT = 2;
/** 사람의 [분석]이 오래 기다리지 않게 동시에 두는 run 의 상한을 작게 막는다. */
const MAX_IN_FLIGHT_LIMIT = 4;
const DEFAULT_DEADLINE_MIN = 240;
const MAX_DEADLINE_MIN = 1_440;
const MINUTE_MS = 60_000;

/** BullMQ Queue 가운데 일괄 분석이 쓰는 것(demo-preanalyze 의 enqueue 와 같은 모양). */
export type ItBatchQueue = {
  add(
    name: string,
    data: AnalysisJobData,
    opts: { jobId: string } & typeof ANALYSIS_JOB_OPTIONS,
  ): Promise<unknown>;
};

export type ItBatchDeps = {
  gateway: Pick<GatewayClient, "health">;
  store: ItBatchStore;
  queue: ItBatchQueue;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** 한 줄. 마지막 줄은 늘 돌려주는 line 이다. */
  log: (line: string) => void;
  pollMs: number;
};

export type ItBatchOptions = {
  orgSlug: string;
  maxInFlight: number;
  /** 마감 임박 순으로 앞에서 이만큼만 넣는다. null 이면 전부. */
  limit: number | null;
  /** 대상 수만 세고 아무것도 넣지 않는다. */
  dryRun: boolean;
  /** 시작부터 이 시간이 지나면 더 넣지 않고 기다리지도 않는다. */
  deadlineMs: number;
};

export type ItBatchResult = { exitCode: 0 | 1 | 2; line: string };

const GATEWAY_DOWN_LINE = "it-batch: gateway 응답 없음 — 회사 AI gateway 를 먼저 확인한다";
const NO_ORG_LINE = "it-batch: --org-slug 의 조직이 없다";
const NO_PROFILE_LINE = "it-batch: 조직의 회사 프로필이 없다";
const QUEUE_STOP_LINE =
  "it-batch: analysis 큐에 넣지 못해 더 넣지 않는다 — Redis 를 확인하고 다시 돌린다";

const SETTLED_STATES: readonly ScoreRunStatus[] = ["COMPLETED", "PARTIAL", "FAILED"];

function isSettled(state: ScoreRunStatus): boolean {
  return SETTLED_STATES.includes(state);
}

/** 대상 하나를 준비하다 실패한 단계. 로그에는 이 이름만 싣는다. */
type PrepareStep = "ensureQueuedRun" | "queue.add";

type Outcome =
  /** 넣었다. */
  | { kind: "ENQUEUED"; target: ItBatchTarget; runId: string; state: ScoreRunStatus }
  /** 같은 멱등 키의 run 이나 같은 입력의 진행 중 run 이 이미 있다. 다시 넣지 않는다. */
  | { kind: "EXISTING"; target: ItBatchTarget; runId: string; state: ScoreRunStatus }
  /** 준비 중에 던졌다. 실패로 센다. */
  | { kind: "PREPARE_FAILED"; target: ItBatchTarget; step: PrepareStep }
  /** 기다리는 시간이 지났거나 큐 오류로 멈춰 넣지 않았다. */
  | { kind: "NOT_STARTED"; target: ItBatchTarget };

async function prepareTarget(
  deps: ItBatchDeps,
  orgId: string,
  profile: { id: string; revision: number },
  target: ItBatchTarget,
): Promise<Outcome> {
  const idempotencyKey = itBatchIdempotencyKey(orgId, target, profile.revision);
  // 실패한 단계만 기억한다. 오류 message 는 값(제약 이름·접속 문자열)을 담을 수 있어 버린다.
  let step: PrepareStep = "ensureQueuedRun";
  try {
    const run = await deps.store.ensureQueuedRun({
      orgId,
      bidId: target.bidId,
      revisionId: target.revisionId,
      companyProfileId: profile.id,
      profileRevision: profile.revision,
      idempotencyKey,
    });
    if (!run.created) return { kind: "EXISTING", target, runId: run.id, state: run.status };
    step = "queue.add";
    const data: AnalysisJobData = { orgId, scoreRunId: run.id, idempotencyKey };
    await deps.queue.add(ANALYSIS_JOB, data, {
      ...ANALYSIS_JOB_OPTIONS,
      jobId: toAnalysisJobId(data),
    });
    return { kind: "ENQUEUED", target, runId: run.id, state: run.status };
  } catch {
    // queue.add 에서 실패하면 run 은 QUEUED 로 남는다. worker 의 멈춘 run 복구가 다시 넣는다.
    return { kind: "PREPARE_FAILED", target, step };
  }
}

/** 일괄 분석 한 번. 마지막 줄을 log 로 찍고 함께 돌려준다. 예상하지 못한 저장 오류는 던진다. */
export async function runItBatch(
  deps: ItBatchDeps,
  options: ItBatchOptions,
): Promise<ItBatchResult> {
  const startedAt = deps.now().getTime();
  const end = (exitCode: ItBatchResult["exitCode"], line: string): ItBatchResult => {
    deps.log(line);
    return { exitCode, line };
  };
  const isPastDeadline = () => deps.now().getTime() - startedAt >= options.deadlineMs;

  const health = await deps.gateway.health();
  if (!health.ok) return end(1, GATEWAY_DOWN_LINE);
  // runMode·provider 는 enum 값이라 줄에 실어도 된다. mock 이면 가짜 분석이, hosted 면 유료 호출이 운영 DB 에 남는다.
  const { runMode, provider } = health.value;
  if (runMode !== "live" || provider !== "local") {
    return end(2, `it-batch: live·local 이 아니다(runMode=${runMode}, provider=${provider})`);
  }

  const orgId = await deps.store.findOrgBySlug(options.orgSlug);
  if (orgId === null) return end(1, NO_ORG_LINE);
  const profile = await deps.store.latestProfile(orgId);
  if (profile === null) return end(1, NO_PROFILE_LINE);
  const listed = await deps.store.listTargets(orgId, deps.now());
  const targets = options.limit === null ? listed.ready : listed.ready.slice(0, options.limit);
  const counted = `targets=${targets.length} skipped_no_source=${listed.skippedNoSource}`;
  if (options.dryRun) return end(0, `it-batch: dry-run ${counted}`);
  deps.log(
    `it-batch: 시작 ${counted} — 미완료 run 을 ${options.maxInFlight}건까지 두고 넣는다(최대 ${Math.round(options.deadlineMs / MINUTE_MS)}분)`,
  );

  // 넣었거나 이미 있던 run 의 마지막으로 읽은 상태.
  const states = new Map<string, ScoreRunStatus>();
  const unsettledIds = () => [...states].flatMap(([id, state]) => (isSettled(state) ? [] : [id]));
  const refresh = async () => {
    const ids = unsettledIds();
    const requested = new Set(ids);
    for (const run of await deps.store.readStatuses(orgId, ids)) {
      if (requested.has(run.id)) states.set(run.id, run.status);
    }
  };
  /** 미완료 run 이 count 건 이하가 될 때까지 pollMs 마다 읽는다. 기다리는 시간이 지나면 false. */
  const waitUntilAtMost = async (count: number): Promise<boolean> => {
    while (unsettledIds().length > count) {
      if (isPastDeadline()) return false;
      await deps.sleep(deps.pollMs);
      await refresh();
    }
    return true;
  };

  // 하나씩 넣는다. 미완료 run 이 maxInFlight 건이면 하나가 끝날 때까지 기다린다(사람의 [분석]이 뒤에서 오래 기다리지 않게).
  const outcomes: Outcome[] = [];
  let stopped = false;
  for (const target of targets) {
    if (stopped || !(await waitUntilAtMost(options.maxInFlight - 1))) {
      stopped = true;
      outcomes.push({ kind: "NOT_STARTED", target });
      continue;
    }
    const outcome = await prepareTarget(deps, orgId, profile, target);
    outcomes.push(outcome);
    if (outcome.kind === "PREPARE_FAILED") {
      deps.log(`it-batch: ${target.bidId} FAILED — 준비 실패(${outcome.step})`);
      // 큐가 안 되면 QUEUED 행만 쌓이고, 나중에 멈춘 run 복구가 한꺼번에 넣는다. 더 만들지 않는다.
      if (outcome.step === "queue.add") {
        deps.log(QUEUE_STOP_LINE);
        stopped = true;
      }
    } else if (outcome.kind !== "NOT_STARTED") {
      states.set(outcome.runId, outcome.state);
    }
  }
  await waitUntilAtMost(0);

  const finalStates = outcomes.map((outcome): ScoreRunStatus | null => {
    if (outcome.kind === "PREPARE_FAILED") return "FAILED";
    if (outcome.kind === "NOT_STARTED") return null;
    return states.get(outcome.runId) ?? outcome.state;
  });
  outcomes.forEach((outcome, index) => {
    if (outcome.kind !== "PREPARE_FAILED" && finalStates[index] === "FAILED") {
      deps.log(`it-batch: ${outcome.target.bidId} FAILED`);
    }
  });
  const count = (state: ScoreRunStatus) => finalStates.filter((item) => item === state).length;
  const kindCount = (kind: Outcome["kind"]) => outcomes.filter((item) => item.kind === kind).length;
  const completed = count("COMPLETED");
  const partial = count("PARTIAL");
  const failed = count("FAILED");
  // 기다리는 시간 안에 끝나지 않았거나(QUEUED·RUNNING) 넣지 않은 대상.
  const unfinished = targets.length - completed - partial - failed;
  return end(
    failed === 0 && unfinished === 0 ? 0 : 1,
    `it-batch: ${counted} enqueued=${kindCount("ENQUEUED")} existing=${kindCount("EXISTING")} ` +
      `completed=${completed} partial=${partial} failed=${failed} unfinished=${unfinished}`,
  );
}

// ── 인자 ──

const ORG_SLUG_FLAG = "--org-slug";
const MAX_IN_FLIGHT_FLAG = "--max-in-flight";
const LIMIT_FLAG = "--limit";
const DEADLINE_FLAG = "--deadline-min";
const DRY_RUN_FLAG = "--dry-run";
const VALUE_FLAGS: readonly string[] = [
  ORG_SLUG_FLAG,
  MAX_IN_FLIGHT_FLAG,
  LIMIT_FLAG,
  DEADLINE_FLAG,
];
const USAGE =
  `사용법: it-batch-analyze.ts ${ORG_SLUG_FLAG} <slug> [${MAX_IN_FLIGHT_FLAG} <1~${MAX_IN_FLIGHT_LIMIT}>] ` +
  `[${LIMIT_FLAG} <1 이상>] [${DRY_RUN_FLAG}] [${DEADLINE_FLAG} <1~${MAX_DEADLINE_MIN}>]`;
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** value 가 없으면 fallback, 있으면 min~max 정수여야 한다. */
function intOption(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : 0;
  if (parsed < min || parsed > max) throw new Error(USAGE);
  return parsed;
}

/** pnpm 이 넘기는 `--` 는 건너뛴다. 인자 값은 오류에 싣지 않는다. 틀리면 사용법만 알린다. */
export function parseItBatchArgs(argv: readonly string[]): ItBatchOptions {
  const args = argv.filter((arg) => arg !== "--");
  const values = new Map<string, string>();
  let dryRun = false;
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === DRY_RUN_FLAG && !dryRun) {
      dryRun = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!VALUE_FLAGS.includes(arg) || values.has(arg) || value === undefined) {
      throw new Error(USAGE);
    }
    values.set(arg, value);
    index += 2;
  }
  const orgSlug = values.get(ORG_SLUG_FLAG);
  if (orgSlug === undefined || !SLUG_PATTERN.test(orgSlug)) throw new Error(USAGE);
  const limit = values.get(LIMIT_FLAG);
  return {
    orgSlug,
    maxInFlight: intOption(
      values.get(MAX_IN_FLIGHT_FLAG),
      DEFAULT_MAX_IN_FLIGHT,
      1,
      MAX_IN_FLIGHT_LIMIT,
    ),
    limit: limit === undefined ? null : intOption(limit, 0, 1, Number.MAX_SAFE_INTEGER),
    dryRun,
    deadlineMs:
      intOption(values.get(DEADLINE_FLAG), DEFAULT_DEADLINE_MIN, 1, MAX_DEADLINE_MIN) * MINUTE_MS,
  };
}

// ── 실행 ──

/** 실패 줄의 오류 이름(+ 코드). 이름은 공용 규칙으로 거른다. message 는 싣지 않는다. */
function errorLabel(error: unknown): string {
  const name = errorNameOf(error);
  const code = errorCode(error);
  return code === null ? name : `${name} ${code}`;
}

type Setup = { redisUrl: string | null; gateway: GatewayClient; store: ItBatchStore };

/** env 를 읽고 gateway·저장소를 만든다. dry-run 은 Redis 에 붙지 않는다. 오류 message 는 키 이름만 담는다. */
function readSetup(env: Record<string, string | undefined>, dryRun: boolean): Setup {
  const redisUrl = env.REDIS_URL?.trim() ?? "";
  if (!dryRun && redisUrl === "") throw new Error("worker env 누락: REDIS_URL");
  return {
    redisUrl: redisUrl === "" ? null : redisUrl,
    gateway: createGatewayClient(readGatewayConfig(env)),
    store: createItBatchStore(getSupabaseAdmin()),
  };
}

/** dry-run 이 쓰는 큐. runItBatch 는 dry-run 에서 add 를 부르지 않는다. */
const DRY_RUN_QUEUE: ItBatchQueue = {
  add: () => Promise.reject(new Error("it-batch: dry-run 은 큐에 넣지 않는다")),
};

async function runWith(
  setup: Setup,
  queue: ItBatchQueue,
  options: ItBatchOptions,
): Promise<number> {
  try {
    const result = await runItBatch(
      {
        gateway: setup.gateway,
        store: setup.store,
        queue,
        now: () => new Date(),
        sleep: (ms) => delay(ms),
        log: (line) => {
          console.log(line);
        },
        pollMs: IT_BATCH_POLL_MS,
      },
      options,
    );
    return result.exitCode;
  } catch (error) {
    // 저장소·큐 오류. 넣은 run 은 그대로 두고 다시 돌리면 같은 키로 이어 간다.
    console.error(
      `it-batch: 멈췄다(${errorLabel(error)}) — Supabase·Redis 를 확인하고 다시 돌린다`,
    );
    return 1;
  }
}

async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  let options: ItBatchOptions;
  let setup: Setup;
  try {
    options = parseItBatchArgs(argv);
    setup = readSetup(env, options.dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "it-batch: 설정 오류");
    return 1;
  }
  // dry-run 은 REDIS_URL 이 있어도 Redis 에 붙지 않는다(readSetup 이 dry-run 이 아니면 REDIS_URL 을 요구한다).
  const redisUrl = setup.redisUrl;
  if (options.dryRun || redisUrl === null) return runWith(setup, DRY_RUN_QUEUE, options);

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(ANALYSIS_QUEUE, { connection });
  // 연결 오류는 'error' 로 온다. 듣는 쪽이 없으면 프로세스가 죽는다. message 는 접속 문자열을 담을 수 있어 쓰지 않는다.
  queue.on("error", (error) => {
    console.error(`it-batch: analysis queue 오류 ${errorLabel(error)}`);
  });
  try {
    return await runWith(setup, queue, options);
  } finally {
    try {
      await queue.close();
    } catch (error) {
      console.error(`it-batch: queue 닫기 실패 ${errorLabel(error)}`);
    }
    connection.disconnect();
  }
}

// 시험이 불러올 때는 돌지 않는다(worker/main.ts 와 같은 argv 검사).
if (/[\\/]worker[\\/]it-batch-analyze\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      console.error("it-batch: 예기치 않은 오류로 멈췄다");
      process.exitCode = 1;
    },
  );
}
