import path from "node:path";
import {
  createSupabaseProgramNoticesStore,
  loadProgramNoticesConfig,
  runProgramNoticeRound,
  type CollectRunMode,
  type RoundDeps,
} from "@/server/program-notices";
import { getSupabaseAdmin } from "@/server/supabase";
import { errorNameOf } from "@/worker/error-name";
import { readRunMode } from "@/worker/ingest-queue";

// ── 부처 지원사업 공고 주기 수집(ADR-040, 스펙 polaris/specs/done/2026-10-21-agency-program-notices.md §5) ──
// 기동 때 한 번, 그 뒤 PROGRAM_NOTICES_INTERVAL_MINUTES(기본 60분)마다 runProgramNoticeRound 를 돈다. 규칙은 program-notices 도메인에 있고
// 여기는 설정 읽기와 타이머만 둔다. 모양은 notify-outbox 의 startNotifier 와 같다. Redis·큐를 쓰지 않는다.
// 부처 수집은 나라장터 수집을 막지 않는다. env·설정이 틀려도 등록 함수는 던지지 않고 program_notices.disabled 한 줄만 남긴다
// (다른 등록은 틀리면 기동을 멈추지만, 이것은 데모 핵심 경로가 아니라서 꺼진 채로 둔다).
// 회사 운영은 이 주기 수집을 쓰지 않는다. 전용 worker(program-notices-only-main.ts)가 KST 3시간 정각 일정으로 기업마당만 수집한다.

type Env = Record<string, string | undefined>;
type Closable = { close(): Promise<void> };

const INTERVAL_KEY = "PROGRAM_NOTICES_INTERVAL_MINUTES";
const CONFIG_FILE_KEY = "PROGRAM_NOTICES_CONFIG_FILE";
const DEFAULT_INTERVAL_MINUTES = 60;
const MAX_INTERVAL_MINUTES = 1440;
const DECIMAL_INTEGER = /^[0-9]+$/;
const CONFIG_FILE_NAME = "program-notices.yaml";
/** stop 이 진행 중 회차를 기다리는 최대 시간(notify-outbox 와 같다). */
const STOP_WAIT_MS = 5_000;

/** 실행 모드와 설정·녹음 경로. 전체 worker 의 주기 수집과 회사 전용 worker(program-notices-only-main.ts)가 같이 쓴다 */
export type ProgramNoticeRuntime =
  | { ok: true; runMode: CollectRunMode; configFile: string; recordingsDir: string }
  | { ok: false; reason: string };

export type ProgramNoticeSettings =
  | (Extract<ProgramNoticeRuntime, { ok: true }> & { intervalMs: number })
  | { ok: false; reason: string };

/** live 요청 재시도의 대기·난수(수집 worker 와 같다, main.ts ingestJobDepsOf) */
export const PROGRAM_NOTICE_RETRY: RoundDeps["retry"] = {
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

// worker 이미지에는 fixtures·infra/sources 가 없다. Compose 가 볼륨과 env 로 경로를 준다(main.ts 와 같은 기본값).
const configFileOf = (env: Env): string => {
  const explicit = env[CONFIG_FILE_KEY]?.trim();
  if (explicit) return explicit;
  const registry = env.SOURCES_REGISTRY_FILE?.trim();
  return registry
    ? path.join(path.dirname(registry), CONFIG_FILE_NAME)
    : path.resolve(process.cwd(), "../infra/sources", CONFIG_FILE_NAME);
};

const recordingsDirOf = (env: Env): string =>
  path.join(
    env.FIXTURES_DIR?.trim() || path.resolve(process.cwd(), "../fixtures"),
    "recorded",
    "program-notices",
  );

/** 던지지 않는다. 사유에는 키 이름만 싣고 값은 싣지 않는다. */
export function readProgramNoticeRuntime(env: Env): ProgramNoticeRuntime {
  let runMode: CollectRunMode;
  try {
    runMode = readRunMode(env);
  } catch {
    return { ok: false, reason: "worker env 오류: SOL_RUN_MODE" };
  }
  return { ok: true, runMode, configFile: configFileOf(env), recordingsDir: recordingsDirOf(env) };
}

/** 던지지 않는다. 사유에는 키 이름만 싣고 값은 싣지 않는다. */
export function readProgramNoticeSettings(env: Env): ProgramNoticeSettings {
  const raw = env[INTERVAL_KEY]?.trim() ?? "";
  const minutes =
    raw === "" ? DEFAULT_INTERVAL_MINUTES : DECIMAL_INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!(minutes >= 1 && minutes <= MAX_INTERVAL_MINUTES)) {
    return { ok: false, reason: `worker env 오류: ${INTERVAL_KEY}` };
  }
  const runtime = readProgramNoticeRuntime(env);
  return runtime.ok ? { ...runtime, intervalMs: minutes * 60 * 1000 } : runtime;
}

type CollectorDeps = {
  runRound: () => Promise<unknown>;
  /** JSON 한 줄. */
  log: (line: string) => void;
  intervalMs: number;
};

type CollectorTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/**
 * 기동 때 한 번, 그 뒤 intervalMs 마다 돈다. 앞 회차가 안 끝났으면 이번 틱은 건너뛴다(겹치지 않는다).
 * 회차 오류는 삼키고 오류 이름만 로그 한 줄로 남긴다(메시지에는 요청 URL 이 실릴 수 있다).
 * stop 은 타이머를 멈추고 진행 중 회차를 최대 STOP_WAIT_MS 기다린다. 넘으면 stop_timeout 한 줄을 남기고 돌아온다.
 */
export function startProgramNoticeCollector(
  deps: CollectorDeps,
  timers: CollectorTimers = { setInterval, clearInterval, setTimeout, clearTimeout },
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  let isStopped = false;

  const round = () => {
    if (isStopped || running !== null) return;
    running = deps.runRound().then(
      () => undefined,
      (error: unknown) => {
        deps.log(
          JSON.stringify({ event: "program_notices.round_failed", errorName: errorNameOf(error) }),
        );
      },
    );
    void running.finally(() => {
      running = null;
    });
  };

  round();
  const handle = timers.setInterval(round, deps.intervalMs);

  return {
    async stop() {
      isStopped = true;
      timers.clearInterval(handle);
      const current = running;
      if (current === null) return;
      const isSettled = await new Promise<boolean>((resolve) => {
        const waitHandle = timers.setTimeout(() => resolve(false), STOP_WAIT_MS);
        void current.then(() => {
          timers.clearTimeout(waitHandle);
          resolve(true);
        });
      });
      if (!isSettled) deps.log(JSON.stringify({ event: "program_notices.stop_timeout" }));
    },
  };
}

const logLine = (line: string) => {
  console.log(line);
};

const disabled = (reason: string) => {
  logLine(JSON.stringify({ event: "program_notices.disabled", reason }));
  return async (): Promise<Closable> => ({ close: async () => {} });
};

/**
 * worker 등록(main.ts WORKER_REGISTRATIONS). 1단계는 env·설정만 읽고 던지지 않는다. 2단계는 service role 저장으로 주기 수집을 시작한다.
 * 공유 Redis 연결은 쓰지 않는다. close 는 타이머를 멈추고 진행 중 회차를 최대 5초 기다린다.
 */
export const programNoticesWorkerRegistration = async (
  rawEnv: Env,
): Promise<(connection: unknown) => Promise<Closable>> => {
  const settings = readProgramNoticeSettings(rawEnv);
  if (!settings.ok) return disabled(settings.reason);
  const loaded = await loadProgramNoticesConfig(settings.configFile);
  if (!loaded.ok) return disabled(loaded.reason);
  return async () => {
    const store = createSupabaseProgramNoticesStore(getSupabaseAdmin());
    logLine(
      JSON.stringify({
        event: "program_notices.enabled",
        runMode: settings.runMode,
        intervalMinutes: settings.intervalMs / 60_000,
      }),
    );
    const collector = startProgramNoticeCollector({
      runRound: () =>
        runProgramNoticeRound({
          config: loaded.config,
          runMode: settings.runMode,
          env: rawEnv,
          fetch: (url, init) => fetch(url, init),
          store,
          recordingsDir: settings.recordingsDir,
          now: () => new Date(),
          log: logLine,
          retry: PROGRAM_NOTICE_RETRY,
        }),
      log: logLine,
      intervalMs: settings.intervalMs,
    });
    return { close: () => collector.stop() };
  };
};
