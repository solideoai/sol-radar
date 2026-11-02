import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  AwardHistoryWriteFailed,
  BACKFILL_MAX_MONTHS,
  BACKFILL_MIN_MONTHS,
  BackfillFetchFailed,
  backfillWindowsOf,
  buildAwardHistory,
  collectBackfill,
  countAwardPages,
  createAwardBackfillFetcher,
  createAwardHistoryRepo,
  estimatedCallsOf,
  suggestedMonthsOf,
  type AwardBackfillFetcher,
  type AwardHistoryBuild,
  type AwardHistoryRepo,
  type BackfillWindows,
} from "@/server/award-history";
import { readG2bServiceKey } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { createWorkerStorageClient } from "@/worker/storage-client";

// ── 낙찰 이력 한 번 채우기 CLI(`pnpm award:backfill`, 스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md §4) ──
// 조달청 낙찰정보(15129397)에서 지난 낙찰을, 입찰공고정보(15129394)에서 지난 공고를 받아 이어
// procurement_award_history 에 넣는다. 사람이 로컬에서 `!` 로 돌린다(운영자 CLI, service role 은 --apply 만 쓴다).
//
//   pnpm -C web award:backfill -- --env-file <DB env> --env-file <API 키 env> --check
//   pnpm -C web award:backfill -- --env-file <DB env> --env-file <API 키 env> --dry-run [--months 12] [--max-calls 400]
//   pnpm -C web award:backfill -- --env-file <DB env> --env-file <API 키 env> --apply   [--months 12] [--max-calls 400]
//
// --env-file 은 기본값이 없고 여러 번 받는다. 뒤 파일 값이 앞을 덮는다. 값은 그 파일에서만 읽는다(셸 환경 변수 안 씀).
// 인자 앞에 "--" 를 둔다. 없으면 Node 24 가 --env-file 을 자기 옵션으로 가로챈다.
// 출력에는 키 이름·DB 호스트·건수만 싣는다. 키 값·요청 URL 은 싣지 않는다(요청 오류는 createG2bHttp 가 키를 가린 문구다).
// --dry-run 은 쓰지 않는다. 예상 호출 수를 먼저 내고, 상한을 넘으면 받지 않고 줄일 개월 수를 알린다.
// 호출 상한(재시도 포함)에 닿으면 "중단: 호출 상한" 을 내고 받은 데까지만 잇는다(--apply 는 그만큼 쓴다, exit 1).

const PREFIX = "award-backfill:";
// 읽는 env 이름(값이 아니다). 앞 둘은 조달청 서비스키, 뒤 둘은 --apply 의 Supabase 접속(worker/storage-client.ts)이다.
const API_KEY_NAMES = ["G2B_AWARD_SERVICE_KEY", "G2B_BID_NOTICE_SERVICE_KEY"] as const;
const DB_KEY_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const [AWARD_KEY_NAME, NOTICE_KEY_NAME] = API_KEY_NAMES;
const [DB_URL_NAME] = DB_KEY_NAMES;
const ALL_KEY_NAMES = [...API_KEY_NAMES, ...DB_KEY_NAMES];

export const DEFAULT_MAX_CALLS = 400;
// 서비스키 하나의 하루 한도(1,000회)다. 공고 키는 정기 수집과 같이 쓰므로 이보다 크게 받지 않는다.
export const MAX_CALLS_LIMIT = 1000;

// ── 인자 ──

export type BackfillMode = "check" | "dry-run" | "apply";
export type BackfillArgs = {
  envFiles: string[];
  mode: BackfillMode;
  months: number;
  maxCalls: number;
};

const USAGE = `사용법: pnpm -C web award:backfill -- --env-file <path> [--env-file <path>] (--check | --dry-run | --apply) [--months ${BACKFILL_MIN_MONTHS}~${BACKFILL_MAX_MONTHS}] [--max-calls 1~${MAX_CALLS_LIMIT}]`;
const MODE_FLAGS = new Map<string, BackfillMode>([
  ["--check", "check"],
  ["--dry-run", "dry-run"],
  ["--apply", "apply"],
]);
const POSITIVE_INT = /^[1-9]\d*$/;

const usageError = (reason: string): Error => new Error(`${PREFIX} ${reason}\n${USAGE}`);

const intIn = (value: string, min: number, max: number, reason: string): number => {
  if (!POSITIVE_INT.test(value) || Number(value) < min || Number(value) > max)
    throw usageError(reason);
  return Number(value);
};

/** pnpm 이 넘기는 `--` 는 건너뛴다. 인자 값은 오류에 싣지 않는다(키를 잘못 붙여 넣어도 출력되지 않게). */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const args = argv.filter((arg) => arg !== "--");
  const envFiles: string[] = [];
  let mode: BackfillMode | null = null;
  let months: number | null = null;
  let maxCalls: number | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const flagMode = MODE_FLAGS.get(arg);
    if (flagMode !== undefined) {
      if (mode !== null) throw usageError("--check·--dry-run·--apply 는 하나만 준다");
      mode = flagMode;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--env-file" && value !== undefined && !value.startsWith("--")) {
      envFiles.push(value);
    } else if (arg === "--months" && value !== undefined && months === null) {
      months = intIn(
        value,
        BACKFILL_MIN_MONTHS,
        BACKFILL_MAX_MONTHS,
        `--months 는 ${BACKFILL_MIN_MONTHS}~${BACKFILL_MAX_MONTHS} 정수다(${BACKFILL_MIN_MONTHS}개월보다 짧으면 표본이 적어 받지 않는다)`,
      );
    } else if (arg === "--max-calls" && value !== undefined && maxCalls === null) {
      maxCalls = intIn(value, 1, MAX_CALLS_LIMIT, `--max-calls 는 1~${MAX_CALLS_LIMIT} 정수다`);
    } else {
      throw usageError("모르는 인자이거나 값이 없다");
    }
    index += 1;
  }
  if (envFiles.length === 0) throw usageError("--env-file 이 필요하다(기본값 없음)");
  if (mode === null) throw usageError("--check·--dry-run·--apply 가운데 하나가 필요하다");
  return {
    envFiles,
    mode,
    months: months ?? BACKFILL_MAX_MONTHS,
    maxCalls: maxCalls ?? DEFAULT_MAX_CALLS,
  };
}

// ── env ──

type Env = Record<string, string | undefined>;

/** env 파일들을 순서대로 합친다(뒤가 앞을 덮는다). 실패하면 몇 번째 파일인지만 알린다. */
export async function loadEnvFiles(
  paths: readonly string[],
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<Env> {
  const merged: Env = {};
  for (const [index, path] of paths.entries()) {
    let text: string;
    try {
      text = await read(path);
    } catch {
      throw new Error(`${PREFIX} env 파일을 읽지 못했다(${index + 1}번째 --env-file)`);
    }
    Object.assign(merged, parseEnv(text));
  }
  return merged;
}

const hasValue = (env: Env, name: string): boolean => (env[name]?.trim() ?? "") !== "";

const hostOf = (url: string | undefined): string | null => {
  const text = url?.trim() ?? "";
  if (text === "") return null;
  try {
    return new URL(text).host;
  } catch {
    return null;
  }
};

export type CheckReport = {
  mode: "check";
  /** env 이름 → 값이 있는지 */
  keys: Record<string, boolean>;
  dbHost: string | null;
  ok: boolean;
};

/** 키 이름별 있음/없음과 DB 호스트만. 값은 싣지 않는다. */
export function checkReport(env: Env): CheckReport {
  const keys = Object.fromEntries(ALL_KEY_NAMES.map((name) => [name, hasValue(env, name)]));
  const dbHost = hostOf(env[DB_URL_NAME]);
  return { mode: "check", keys, dbHost, ok: Object.values(keys).every(Boolean) && dbHost !== null };
}

// ── 실행 ──

export type BackfillRunOptions = { mode: "dry-run" | "apply"; months: number; maxCalls: number };
export type BackfillDeps = {
  fetcher: AwardBackfillFetcher;
  /** --apply 때만 있다 */
  repo: AwardHistoryRepo | null;
  now: () => Date;
  log: (line: string) => void;
};

type Span = { from: string; to: string } | null;
export type BackfillStop = "OVER_LIMIT" | "CALL_LIMIT";
export type BackfillReport = {
  mode: "dry-run" | "apply";
  months: number;
  periods: { award: Span; notice: Span };
  calls: { max: number; estimated: number; used: number };
  stopped: BackfillStop | null;
  /** OVER_LIMIT 때만. 상한 안에 드는 가장 긴 기간(6개월로도 넘으면 null) */
  suggestedMonths?: number | null;
  /** 낙찰 등록 건수(세기), 받은 낙찰 행, 받은 낙찰과 이어지는 공고 행 */
  fetched: { awardTotal: number; awards: number; notices: number } | null;
  save: number;
  groups: AwardHistoryBuild["groups"] | null;
  skipped: AwardHistoryBuild["skipped"] | null;
  topClasses: AwardHistoryBuild["topClasses"];
  /** --apply 로 쓴 행 수. dry-run 은 null */
  written: number | null;
};

const spanOf = (slices: BackfillWindows["award"]): Span => {
  const first = slices[0];
  const last = slices.at(-1);
  return first === undefined || last === undefined
    ? null
    : { from: first.from.toISOString(), to: last.to.toISOString() };
};

const reduceHint = (suggested: number | null): string =>
  suggested === null
    ? `${BACKFILL_MIN_MONTHS}개월로도 넘는다. --max-calls 를 올리거나 다음 날 나눠 돌린다`
    : `--months ${suggested} 로 줄인다`;

/** 채우기 한 번. 마지막 줄(한 줄 JSON)을 log 로 찍고 함께 돌려준다. 받기·쓰기 오류는 던진다. */
export async function runBackfill(
  deps: BackfillDeps,
  options: BackfillRunOptions,
): Promise<{ exitCode: 0 | 1; report: BackfillReport }> {
  const now = deps.now();
  const windows = backfillWindowsOf(now, options.months);
  const empty = {
    mode: options.mode,
    months: options.months,
    periods: { award: spanOf(windows.award), notice: spanOf(windows.notice) },
    fetched: null,
    save: 0,
    groups: null,
    skipped: null,
    topClasses: [],
    written: null,
  };
  const end = (exitCode: 0 | 1, report: BackfillReport) => {
    deps.log(JSON.stringify(report));
    return { exitCode, report };
  };
  const overLimit = (estimated: number, awardPages: number) => {
    const suggestedMonths = suggestedMonthsOf({
      now,
      months: options.months,
      maxCalls: options.maxCalls,
      awardPages,
    });
    deps.log(
      `${PREFIX} 중단: 예상 호출 ${estimated} 이 상한 ${options.maxCalls} 을 넘는다 — ${reduceHint(suggestedMonths)}`,
    );
    return end(1, {
      ...empty,
      calls: { max: options.maxCalls, estimated, used: deps.fetcher.callsUsed() },
      stopped: "OVER_LIMIT",
      suggestedMonths,
    });
  };

  // 세기 전에 하한(낙찰 조각 수 + 공고 일수)만으로 넘으면 한 번도 부르지 않는다.
  const floor = estimatedCallsOf(windows, 0);
  if (floor > options.maxCalls) return overLimit(floor, 0);

  const counted = await countAwardPages(deps.fetcher, windows);
  const estimated = estimatedCallsOf(windows, counted.awardPages);
  deps.log(
    `${PREFIX} 예상 호출 ${estimated}/${options.maxCalls}(낙찰 세기 ${windows.award.length}·쪽 ${counted.awardPages}, 공고 ${windows.notice.length}일 — 999건 넘는 날은 더 든다)`,
  );
  if (estimated > options.maxCalls) return overLimit(estimated, counted.awardPages);

  const collected = await collectBackfill(deps.fetcher, windows, counted.counts);
  if (collected.callLimitReached) deps.log(`${PREFIX} 중단: 호출 상한`);
  const build = buildAwardHistory(collected.awards, collected.notices);
  let written: number | null = null;
  if (options.mode === "apply") {
    if (deps.repo === null) throw new Error("apply 에는 저장소가 필요하다");
    written = await deps.repo.upsert(build.rows, now.toISOString());
  }
  return end(collected.callLimitReached ? 1 : 0, {
    ...empty,
    calls: { max: options.maxCalls, estimated, used: deps.fetcher.callsUsed() },
    stopped: collected.callLimitReached ? "CALL_LIMIT" : null,
    fetched: {
      awardTotal: counted.awardCount,
      awards: collected.awards.length,
      notices: collected.notices.length,
    },
    save: build.rows.length,
    groups: build.groups,
    skipped: build.skipped,
    topClasses: build.topClasses,
    written,
  });
}

// ── 진입점 ──

/** 실패 줄. 키를 가린 문구(받기)와 오류 코드(쓰기)만 싣고, 그 밖은 오류 이름만 싣는다. */
function failureLabel(error: unknown): string {
  if (error instanceof BackfillFetchFailed || error instanceof AwardHistoryWriteFailed)
    return `${error.name}: ${error.message}`;
  return errorNameOf(error);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: BackfillArgs;
  let env: Env;
  try {
    args = parseBackfillArgs(argv);
    env = await loadEnvFiles(args.envFiles);
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE);
    return 1;
  }
  if (args.mode === "check") {
    const report = checkReport(env);
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  const required = args.mode === "apply" ? ALL_KEY_NAMES : API_KEY_NAMES;
  const missing = required.filter((name) => !hasValue(env, name));
  if (missing.length > 0) {
    console.error(`${PREFIX} env 값이 없다: ${missing.join(", ")}`);
    return 1;
  }
  let fetcher: AwardBackfillFetcher;
  try {
    // 오류 문구에는 env 이름만 있다(readG2bServiceKey).
    fetcher = createAwardBackfillFetcher({
      fetch: (url, init) => globalThis.fetch(url, init),
      awardServiceKey: readG2bServiceKey(env, AWARD_KEY_NAME),
      noticeServiceKey: readG2bServiceKey(env, NOTICE_KEY_NAME),
      maxCalls: args.maxCalls,
      retry: { sleep, random: Math.random },
    });
  } catch (error) {
    console.error(`${PREFIX} ${error instanceof Error ? error.message : "서비스키를 읽지 못했다"}`);
    return 1;
  }
  try {
    const repo =
      args.mode === "apply" ? createAwardHistoryRepo(createWorkerStorageClient(env)) : null;
    const { exitCode } = await runBackfill(
      {
        fetcher,
        repo,
        now: () => new Date(),
        log: (line) => {
          console.log(line);
        },
      },
      { mode: args.mode, months: args.months, maxCalls: args.maxCalls },
    );
    return exitCode;
  } catch (error) {
    // 쓰기 도중 멈춰도 upsert 라 다시 돌리면 같은 행을 덮는다. 받기 실패는 쓰기 전이다.
    console.error(`${PREFIX} 멈췄다(${failureLabel(error)}) — 호출 ${fetcher.callsUsed()}회`);
    return 1;
  }
}

// 시험이 불러올 때는 돌지 않는다(worker/main.ts 와 같은 argv 검사).
if (/[\\/]worker[\\/]award-backfill\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      console.error(`${PREFIX} 예기치 않은 오류로 멈췄다`);
      process.exitCode = 1;
    },
  );
}
