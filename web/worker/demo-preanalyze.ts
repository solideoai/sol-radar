import { setTimeout as delay } from "node:timers/promises";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  ANALYSIS_JOB,
  ANALYSIS_JOB_OPTIONS,
  ANALYSIS_QUEUE,
  createGatewayClient,
  createPreanalyzeStore,
  preanalyzeIdempotencyKey,
  readGatewayConfig,
  selectPreanalyzeTargets,
  summarize,
  summaryLine,
  toAnalysisJobId,
  type AnalysisJobData,
  type GatewayClient,
  type PreanalyzeStore,
  type PreanalyzeTarget,
  type RunState,
} from "@/server/analysis";
import { getSupabaseAdmin } from "@/server/supabase";
import { errorNameOf } from "@/worker/error-name";
import { errorCode } from "@/worker/main";

// ── 사전 분석 CLI(`pnpm demo:preanalyze`, C5-B) ──
// 19 §3 사전 준비 5번: mock 모드에서 데모 적재 공고 가운데 FX-02 를 뺀 공고(seed 기준 18건)를 미리 분석한다.
// FX-02 는 미분석으로 남겨 S4 에서 라이브 분석한다. 대상은 DB 의 데모 공고에서 고르고 목록을 박지 않는다.
// 분석은 화면(C6)과 같은 enqueue 계약으로 analysis 큐에 넣고, worker 의 analysis Worker 가 처리한다.
// 로그에는 fixtureId·상태·건수만 싣는다. 공고 원문·제목·점수·설명·오류 message 는 싣지 않는다(docs/14).
// worker 컨테이너 안에서 돈다(REDIS_URL·service role·AI_GATEWAY_URL 이 거기 있다). 클라우드 DB 에 쓴다.

/** e8: 전체 상한 10분. */
export const PREANALYZE_DEADLINE_MS = 600_000;
export const PREANALYZE_POLL_MS = 2_000;

/** BullMQ Queue 가운데 사전 분석이 쓰는 것(analysis-reconcile 의 enqueue 와 같은 모양). */
export type PreanalyzeQueue = {
  add(
    name: string,
    data: AnalysisJobData,
    opts: { jobId: string } & typeof ANALYSIS_JOB_OPTIONS,
  ): Promise<unknown>;
};

export type PreanalyzeDeps = {
  gateway: Pick<GatewayClient, "health">;
  store: PreanalyzeStore;
  queue: PreanalyzeQueue;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** 한 줄. 마지막 줄은 늘 돌려주는 line 이다. */
  log: (line: string) => void;
  deadlineMs: number;
  pollMs: number;
};

export type PreanalyzeResult = { exitCode: 0 | 1 | 2; line: string };

const GATEWAY_DOWN_LINE = "preanalyze: gateway 응답 없음 — Compose 의 ai-gateway 를 먼저 띄운다";
const NO_DEMO_ORG_LINE = "preanalyze: 데모 조직이 없다 — pnpm demo:reset 을 먼저 돌린다";
const NO_PROFILE_LINE =
  "preanalyze: 데모 조직의 회사 프로필이 없다 — pnpm demo:reset 을 먼저 돌린다";
const NO_TARGETS_LINE = "preanalyze: 사전 분석할 데모 공고가 없다 — pnpm demo:reset 을 먼저 돌린다";
/** 결정 8: 같은 멱등 키의 기존 run 이 PARTIAL·FAILED 면 다시 넣지 않고 한 번만 안내한다. */
const NOT_COMPLETED_NOTICE =
  "preanalyze: 끝난 run 이 COMPLETED 가 아니다 — pnpm demo:reset 뒤 다시 돌린다";

const SETTLED_STATES: readonly RunState[] = ["COMPLETED", "PARTIAL", "FAILED"];

function isSettled(state: RunState | undefined): boolean {
  return state !== undefined && SETTLED_STATES.includes(state);
}

/** 대상 하나를 준비하다 실패한 단계. 로그에는 이 이름만 싣는다. */
type PrepareStep = "latestExtractionId" | "ensureQueuedRun" | "queue.add";

type Prepared =
  /** 결정 9: 준비 중에 던졌다. 실패로 세고 기다리지 않는다. */
  | { kind: "PREPARE_FAILED"; target: PreanalyzeTarget; step: PrepareStep }
  /** 같은 멱등 키의 run 이 이미 끝났다. 다시 넣지 않는다. */
  | { kind: "EXISTING"; target: PreanalyzeTarget; runId: string; state: RunState }
  /** 넣었다(QUEUED·RUNNING 이면 같은 jobId 라 BullMQ 가 중복을 무시한다). */
  | { kind: "ENQUEUED"; target: PreanalyzeTarget; runId: string; state: RunState };

type Finished = Prepared & { finalState: RunState };

async function prepareTarget(
  deps: PreanalyzeDeps,
  orgId: string,
  profile: { id: string; revision: number },
  target: PreanalyzeTarget,
): Promise<Prepared> {
  const idempotencyKey = preanalyzeIdempotencyKey(orgId, target);
  // 실패한 단계만 기억한다. 오류 message 는 값(제약 이름·접속 문자열)을 담을 수 있어 버린다.
  let step: PrepareStep = "latestExtractionId";
  try {
    const extractionId = await deps.store.latestExtractionId(target.revisionId);
    step = "ensureQueuedRun";
    const run = await deps.store.ensureQueuedRun({
      orgId,
      bidId: target.bidId,
      revisionId: target.revisionId,
      companyProfileId: profile.id,
      profileRevision: profile.revision,
      extractionId,
      idempotencyKey,
    });
    if (isSettled(run.status)) {
      return { kind: "EXISTING", target, runId: run.id, state: run.status };
    }
    step = "queue.add";
    const data: AnalysisJobData = { orgId, scoreRunId: run.id, idempotencyKey };
    await deps.queue.add(ANALYSIS_JOB, data, {
      ...ANALYSIS_JOB_OPTIONS,
      jobId: toAnalysisJobId(data),
    });
    return { kind: "ENQUEUED", target, runId: run.id, state: run.status };
  } catch {
    // 결정 9: 그 대상만 실패로 세고 다른 대상은 계속한다. queue.add 에서 실패하면 run 은 QUEUED 로 남고,
    // 다시 돌리면 같은 키의 run 을 같은 jobId 로 넣는다(worker 의 멈춘 run 복구도 다시 넣는다).
    return { kind: "PREPARE_FAILED", target, step };
  }
}

/** pollMs 마다 상태를 읽어 모두 끝나거나 시작부터 deadlineMs 가 지나면 멈춘다. 읽은 마지막 상태를 돌려준다. */
async function waitForRuns(
  deps: PreanalyzeDeps,
  orgId: string,
  runIds: readonly string[],
  startedAt: number,
): Promise<ReadonlyMap<string, RunState>> {
  const states = new Map<string, RunState>();
  let pending = [...runIds];
  while (pending.length > 0) {
    const requested = new Set(pending);
    for (const run of await deps.store.readStatuses(orgId, pending)) {
      if (requested.has(run.id)) states.set(run.id, run.status);
    }
    pending = pending.filter((id) => !isSettled(states.get(id)));
    if (pending.length === 0) break;
    if (deps.now().getTime() - startedAt >= deps.deadlineMs) break;
    await deps.sleep(deps.pollMs);
  }
  return states;
}

function finish(prepared: Prepared, states: ReadonlyMap<string, RunState>): Finished {
  if (prepared.kind === "PREPARE_FAILED") return { ...prepared, finalState: "FAILED" };
  if (prepared.kind === "EXISTING") return { ...prepared, finalState: prepared.state };
  return { ...prepared, finalState: states.get(prepared.runId) ?? prepared.state };
}

/** COMPLETED 가 아닌 대상의 줄. fixtureId 와 상태만 싣는다. */
function targetLine(result: Finished): string {
  const head = `preanalyze: ${result.target.fixtureId} ${result.finalState}`;
  if (result.kind === "PREPARE_FAILED") return `${head} — 준비 실패(${result.step}), 넣지 않았다`;
  if (result.kind === "EXISTING") return `${head} — 이미 끝난 run 이라 다시 넣지 않았다`;
  return isSettled(result.finalState) ? head : `${head} — 기다리는 시간 안에 끝나지 않았다`;
}

/** 사전 분석 한 번. 마지막 줄을 log 로 찍고 함께 돌려준다. 예상하지 못한 저장 오류는 던진다. */
export async function runPreanalyze(deps: PreanalyzeDeps): Promise<PreanalyzeResult> {
  const startedAt = deps.now().getTime();
  const end = (exitCode: PreanalyzeResult["exitCode"], line: string): PreanalyzeResult => {
    deps.log(line);
    return { exitCode, line };
  };

  const health = await deps.gateway.health();
  if (!health.ok) return end(1, GATEWAY_DOWN_LINE);
  // runMode·provider 는 enum 값이라 줄에 실어도 된다.
  // runMode=mock 인데 provider 가 local·hosted 인 설정 모순이면 실모델을 부를 수 있어 둘 다 본다(보안 후속 c).
  const { runMode, provider } = health.value;
  if (runMode !== "mock" || provider !== "mock") {
    return end(
      2,
      `preanalyze: mock 모드가 아니다(runMode=${runMode}, provider=${provider}) — 사전 분석은 mock 에서만 한다`,
    );
  }

  const orgId = await deps.store.findDemoOrg();
  if (orgId === null) return end(1, NO_DEMO_ORG_LINE);
  const profile = await deps.store.latestProfile(orgId);
  if (profile === null) return end(1, NO_PROFILE_LINE);
  const targets = selectPreanalyzeTargets(await deps.store.listDemoBids());
  if (targets.length === 0) return end(1, NO_TARGETS_LINE);

  // 하나씩 넣는다. Supabase·Redis 에 몰아 보내지 않는다.
  const prepared: Prepared[] = [];
  for (const target of targets) prepared.push(await prepareTarget(deps, orgId, profile, target));

  const enqueued = prepared.flatMap((item) => (item.kind === "ENQUEUED" ? [item.runId] : []));
  if (enqueued.length > 0) {
    deps.log(
      `preanalyze: run ${enqueued.length}건을 넣었다 — 끝날 때까지 기다린다(최대 ${Math.round(deps.deadlineMs / 1000)}초)`,
    );
  }
  const states = await waitForRuns(deps, orgId, enqueued, startedAt);
  const results = prepared.map((item) => finish(item, states));

  for (const result of results) {
    if (result.finalState !== "COMPLETED") deps.log(targetLine(result));
  }
  if (results.some((result) => result.kind === "EXISTING" && result.finalState !== "COMPLETED")) {
    deps.log(NOT_COMPLETED_NOTICE);
  }
  const summary = summarize(results.map((result) => result.finalState));
  return end(summary.completed === summary.targets ? 0 : 1, summaryLine(summary));
}

// ── 실행 ──

/** 실패 줄의 오류 이름(+ 코드). 이름은 공용 규칙으로 거른다. message 는 싣지 않는다. */
function errorLabel(error: unknown): string {
  const name = errorNameOf(error);
  const code = errorCode(error);
  return code === null ? name : `${name} ${code}`;
}

type Setup = { redisUrl: string; gateway: GatewayClient; store: PreanalyzeStore };

/** env 를 읽고 gateway·저장소를 만든다. 오류 message 는 키 이름만 담는다(readGatewayConfig·getSupabaseAdmin). */
function readSetup(env: Record<string, string | undefined>): Setup {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("worker env 누락: REDIS_URL");
  return {
    redisUrl,
    gateway: createGatewayClient(readGatewayConfig(env)),
    store: createPreanalyzeStore(getSupabaseAdmin()),
  };
}

async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  let setup: Setup;
  try {
    setup = readSetup(env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "preanalyze: 설정 오류");
    return 1;
  }

  const connection = new IORedis(setup.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(ANALYSIS_QUEUE, { connection });
  // 연결 오류는 'error' 로 온다. 듣는 쪽이 없으면 프로세스가 죽는다. message 는 접속 문자열을 담을 수 있어 쓰지 않는다.
  queue.on("error", (error) => {
    console.error(`preanalyze: analysis queue 오류 ${errorLabel(error)}`);
  });

  try {
    const result = await runPreanalyze({
      gateway: setup.gateway,
      store: setup.store,
      queue,
      now: () => new Date(),
      sleep: (ms) => delay(ms),
      log: (line) => {
        console.log(line);
      },
      deadlineMs: PREANALYZE_DEADLINE_MS,
      pollMs: PREANALYZE_POLL_MS,
    });
    return result.exitCode;
  } catch (error) {
    // 저장소·큐 오류. 넣은 run 은 그대로 두고 다시 돌리면 같은 키로 이어 간다.
    console.error(
      `preanalyze: 멈췄다(${errorLabel(error)}) — Supabase·Redis 를 확인하고 다시 돌린다`,
    );
    return 1;
  } finally {
    try {
      await queue.close();
    } catch (error) {
      console.error(`preanalyze: queue 닫기 실패 ${errorLabel(error)}`);
    }
    connection.disconnect();
  }
}

// 시험이 불러올 때는 돌지 않는다(worker/main.ts 와 같은 argv 검사).
if (/[\\/]worker[\\/]demo-preanalyze\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      console.error("preanalyze: 예기치 않은 오류로 멈췄다");
      process.exitCode = 1;
    },
  );
}
