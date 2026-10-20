#!/usr/bin/env node
// ops/close-stale-ingest-runs.mjs — 오래 남은 g2b RUNNING 수집 run 을 FAILED 로 닫는 운영자 명령.
//
//   pnpm ops:close-stale-runs -- --env-file <path>                         대상만 보여 준다(dry-run, 기본)
//   pnpm ops:close-stale-runs -- --env-file <path> --apply                 대상을 FAILED 로 닫는다
//   pnpm ops:close-stale-runs -- --env-file <path> --older-than-minutes 60 기준 분(기본 30, 30 미만은 거부)
//
// 왜: worker 가 g2b run 을 끝내지 못하면 ingest_runs 행이 RUNNING 으로 남고, 같은 소스의 수동 수집이
// 409 INGESTION_IN_PROGRESS 로 막힌다. 근거: docs/16-DECISIONS.md 미결정 25번, docs/07 §2.7, docs/06 §5.8.
//
// --env-file 은 기본값이 없다. 루트 .env.local 은 클라우드를 가리킬 수 있어서, 어느 DB 를 바꿀지 매번 파일로 정한다.
// 값은 그 파일에서만 읽는다(셸 환경 변수로 덮지 않는다). 읽는 키는 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY
// 둘이고, 키 값은 출력하지 않는다. 대상 호스트만 출력한다.
// 인자 앞에 "--" 를 둔다(pnpm 이 그대로 넘긴다). 없으면 Node 24 가 --env-file 을 자기 옵션으로 보고, 파일이 없을 때
// 이 명령 대신 "node: <path>: not found" 로 exit 9 를 낸다. 어느 쪽이든 요청 전에 끝난다.
//
// 닫을 때는 행마다 id 와 status=RUNNING 을 함께 조건으로 건다. 그 사이 worker 가 끝낸 run 은 덮지 않고 건너뛴다.
// fixture run 과 RUNNING 이 아닌 run 은 건드리지 않는다. 오류 코드·ingest_errors 행·summary 는 바꾸지 않는다.
//
// 마지막 줄: stale-runs: found=N closed=M apply=true|false
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { createRestClient } from "../demo/rest-client.mjs";
import {
  DEFAULT_OLDER_THAN_MINUTES,
  MIN_OLDER_THAN_MINUTES,
  selectStaleRuns,
} from "./stale-runs.mjs";

const USAGE =
  "사용법: pnpm ops:close-stale-runs -- --env-file <path> [--older-than-minutes N] [--apply]";
const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
// source·status 도 함께 읽어 서버 필터와 별개로 selectStaleRuns 가 다시 확인하게 한다.
const RUN_COLUMNS = "id,source,status,started_at,run_mode,trigger";

class UsageError extends Error {}

const parseMinutes = (value) => {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < MIN_OLDER_THAN_MINUTES)
    throw new UsageError(
      `--older-than-minutes 는 ${MIN_OLDER_THAN_MINUTES} 이상의 정수여야 합니다`,
    );
  return Number(value);
};

export const parseArgs = (argv) => {
  const options = { envFile: null, olderThanMinutes: DEFAULT_OLDER_THAN_MINUTES, apply: false };
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--env-file") {
      if (value === undefined || value.startsWith("--"))
        throw new UsageError("--env-file 에 경로가 필요합니다");
      options.envFile = value;
    } else if (arg === "--older-than-minutes") {
      options.olderThanMinutes = parseMinutes(value);
    } else {
      throw new UsageError(`모르는 인자입니다: ${arg}`);
    }
    index += 1;
  }
  if (options.envFile === null)
    throw new UsageError("--env-file 이 필요합니다(기본값 없음, 대상 DB 를 파일로 정합니다)");
  return options;
};

// env 파일 값만 쓴다. 없는 키는 이름만 알린다.
export const resolveOpsEnv = (fileValues) => {
  const values = Object.fromEntries(
    ENV_KEYS.map((key) => [key, String(fileValues[key] ?? "").trim()]),
  );
  const missing = ENV_KEYS.filter((key) => values[key] === "");
  if (missing.length > 0) throw new Error(`env 파일에 값이 없습니다: ${missing.join(", ")}`);
  let apiUrl;
  try {
    apiUrl = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 이 URL 이 아닙니다");
  }
  if (!["http:", "https:"].includes(apiUrl.protocol))
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 은 http(s) 주소여야 합니다");
  return { apiUrl: apiUrl.origin, host: apiUrl.host, serviceKey: values.SUPABASE_SERVICE_ROLE_KEY };
};

const readEnvFile = async (readText, file) => {
  try {
    return parseEnv(await readText(file));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`env 파일이 없습니다: ${file}`);
    throw error;
  }
};

const describeRun = (run) =>
  `${run.id} started_at=${run.startedAt} 경과 ${run.elapsedMinutes}분 run_mode=${run.runMode ?? "-"} trigger=${run.trigger ?? "-"}`;

const summaryLine = ({ found, closed, apply }) =>
  `stale-runs: found=${found} closed=${closed} apply=${apply}`;

/**
 * 명령 본체. 종료 코드를 돌려준다. 시험은 now·fetchImpl·readText·out·err 를 바꿔 끼운다.
 */
export const run = async (
  argv,
  {
    now = () => new Date(),
    fetchImpl = globalThis.fetch,
    readText = (file) => readFile(file, "utf8"),
    out = console.log,
    err = console.error,
  } = {},
) => {
  let serviceKey = null;
  // 서버가 되돌린 사유에 키가 섞여도 출력하지 않는다(rest-client 는 JWT 모양만 가린다).
  const redact = (text) =>
    serviceKey ? String(text).replaceAll(serviceKey, "[redacted]") : String(text);
  try {
    const options = parseArgs(argv);
    const envFile = path.resolve(options.envFile);
    const env = resolveOpsEnv(await readEnvFile(readText, envFile));
    serviceKey = env.serviceKey;
    const startedAt = now();
    out(
      `▶ 오래 남은 g2b 수집 run 정리 (대상: ${env.host}, ${options.olderThanMinutes}분 이상, ${options.apply ? "적용" : "dry-run"})`,
    );
    const client = createRestClient({ apiUrl: env.apiUrl, serviceKey: env.serviceKey, fetchImpl });
    const rows = await client.select("ingest_runs", {
      columns: RUN_COLUMNS,
      filters: { source: "g2b", status: "RUNNING" },
    });
    const stale = selectStaleRuns(rows ?? [], startedAt, options.olderThanMinutes);
    for (const staleRun of stale) out(`  - ${describeRun(staleRun)}`);
    let closed = 0;
    if (options.apply) {
      const finishedAt = startedAt.toISOString();
      for (const staleRun of stale) {
        const changed = await client.update(
          "ingest_runs",
          { id: staleRun.id, status: "RUNNING" },
          { status: "FAILED", finished_at: finishedAt },
          { returning: true },
        );
        if (changed.length > 0) {
          closed += 1;
          out(`  ✓ ${staleRun.id} FAILED 로 닫음`);
        } else {
          out(`  · ${staleRun.id} 그 사이 RUNNING 이 아니게 되어 건너뜀`);
        }
      }
    } else if (stale.length > 0) {
      out("  (dry-run: 닫으려면 --apply 를 붙입니다)");
    }
    out(summaryLine({ found: stale.length, closed, apply: options.apply }));
    return 0;
  } catch (error) {
    err(`❌ stale-runs 실패: ${redact(error.message)}`);
    if (error instanceof UsageError) err(USAGE);
    return 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2));
}
