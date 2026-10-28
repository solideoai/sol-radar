import "server-only";
import { withRetry, type ConnectorFailure, type RetryDeps } from "@/server/ingestion";
import { buildBizinfoUrl, parseBizinfoBody, type ParseResult } from "./bizinfo";
import type { ProgramNoticesConfig } from "./config";
import { fetchProgramSource, type FetchLike, type FetchProgramResult } from "./http";
import { parseMssRss } from "./mss-rss";
import {
  PROGRAM_NOTICE_SOURCES,
  type NormalizedProgramNotice,
  type ProgramNoticeRunMode,
  type ProgramNoticeRunStatus,
  type ProgramNoticeSource,
  type ProgramRunErrorCode,
} from "./program-notice.model";
import type { ProgramNoticesStore, ProgramRun } from "./program-notices.store";
import { loadProgramRecordings } from "./recording";

// ── 부처 공고 수집 회차: 소스마다 가져오기 → 해석 → 저장 → run 기록 ──
// 소스끼리는 서로 막지 않는다. 한 소스가 어디서 던져도 그 소스만 FAILED 로 남고 다음 소스로 간다(스펙 §5).
// live 만 실호출한다. mock·fixture 는 녹음을 재생하고 네트워크를 부르지 않는다(스펙 §7).
// live 요청은 수집(ingestion/retry.ts)과 같은 재시도 규칙을 쓴다: 시간 초과·429·5xx 만 지수 backoff 로 최대 3번 더 부른다.
// 해석 실패·0건이면 저장하지 않는다. 마지막으로 성공한 데이터가 그대로 보인다.
// 로그·run 에는 상태와 건수·오류 코드만 남긴다. 요청 URL·키·응답 본문·예외 메시지는 남기지 않는다.

export type CollectRunMode = "live" | "fixture" | "mock";

export type RoundDeps = {
  config: ProgramNoticesConfig;
  runMode: CollectRunMode;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  store: ProgramNoticesStore;
  recordingsDir: string;
  now: () => Date;
  log: (line: string) => void;
  retry: RetryDeps;
  /** 주어지면 이 소스만 돈다(회사 전용 Worker 는 기업마당만). 없으면 PROGRAM_NOTICE_SOURCES 전부 */
  sources?: readonly ProgramNoticeSource[];
};

export type { ProgramRun };

const RUN_MODE_LABELS: Record<CollectRunMode, ProgramNoticeRunMode> = {
  live: "LIVE",
  fixture: "FIXTURE",
  mock: "MOCK",
};

type LiveRequest = { ok: true; url: string; secrets: readonly string[] } | { ok: false };

type SourcePlan = {
  enabled: boolean;
  liveRequest: (env: RoundDeps["env"]) => LiveRequest;
  parse: (body: string, fetchedAt: string) => ParseResult;
};

/** 설정에서 소스별 할 일을 만든다. 설정이 틀린 소스는 null. */
function planOf(source: ProgramNoticeSource, config: ProgramNoticesConfig): SourcePlan | null {
  if (source === "bizinfo") {
    if (!config.bizinfo.ok) return null;
    const settings = config.bizinfo.value;
    return {
      enabled: settings.enabled,
      parse: parseBizinfoBody,
      liveRequest: (env) => {
        const key = env[settings.keyEnv]?.trim() ?? "";
        if (key === "") return { ok: false };
        const url = buildBizinfoUrl({
          baseUrl: settings.baseUrl,
          key,
          categories: settings.categories,
          maxItems: settings.maxItems,
        });
        return { ok: true, url, secrets: [key] };
      },
    };
  }
  if (!config.mss.ok) return null;
  const settings = config.mss.value;
  return {
    enabled: settings.enabled,
    parse: parseMssRss,
    liveRequest: () => ({ ok: true, url: settings.baseUrl, secrets: [] }),
  };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; errorCode: ProgramRunErrorCode };

/** 예상 못 한 예외를 그 단계의 오류 코드로 바꾼다. 메시지는 버린다(키·URL 이 실릴 수 있다). */
async function attempt<T>(
  work: () => Promise<T>,
  errorCode: ProgramRunErrorCode,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch {
    return { ok: false, errorCode };
  }
}

type FetchFailure = Extract<FetchProgramResult, { ok: false }>;

/** 재시도 판정용 실패 값. 판정(isRetryableFailure)은 kind·status 만 본다. detail 에는 오류 코드만 둔다 */
const failureOf = ({ errorCode, status }: FetchFailure): ConnectorFailure => ({
  kind: errorCode === "TIMEOUT" ? "TIMEOUT" : status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
  ...(status === undefined ? {} : { status }),
  detail: errorCode,
});

type Fetched =
  | { ok: true; body: string; fetchedAt: string }
  | {
      ok: false;
      status: Extract<ProgramNoticeRunStatus, "SKIPPED" | "FAILED">;
      errorCode: ProgramRunErrorCode;
    };

async function bodyOf(
  source: ProgramNoticeSource,
  plan: SourcePlan,
  deps: RoundDeps,
): Promise<Fetched> {
  if (deps.runMode !== "live") {
    const loaded = await attempt(
      () => loadProgramRecordings(deps.recordingsDir, source),
      "NO_RECORDING",
    );
    if (!loaded.ok) return { ok: false, status: "SKIPPED", errorCode: "NO_RECORDING" };
    const { recordings, skipped } = loaded.value;
    if (skipped > 0) {
      deps.log(JSON.stringify({ event: "program_notices.recordings_skipped", source, skipped }));
    }
    const latest = recordings[0];
    if (latest === undefined) return { ok: false, status: "SKIPPED", errorCode: "NO_RECORDING" };
    if (latest.httpStatus < 200 || latest.httpStatus >= 300) {
      return { ok: false, status: "FAILED", errorCode: "HTTP_ERROR" };
    }
    return { ok: true, body: latest.body, fetchedAt: latest.fetchedAt };
  }
  const request = plan.liveRequest(deps.env);
  if (!request.ok) return { ok: false, status: "SKIPPED", errorCode: "KEY_MISSING" };
  const fetchedAt = deps.now().toISOString();
  const response = await attempt(
    () =>
      withRetry(async () => {
        const result = await fetchProgramSource(request.url, {
          fetch: deps.fetch,
          secrets: request.secrets,
        });
        return result.ok
          ? { ok: true as const, result }
          : { ok: false as const, failure: failureOf(result), result };
      }, deps.retry),
    "HTTP_ERROR",
  );
  if (!response.ok) return { ok: false, status: "FAILED", errorCode: response.errorCode };
  const { outcome, retried } = response.value;
  if (retried > 0) {
    deps.log(JSON.stringify({ event: "program_notices.retried", source, retried }));
  }
  if (!outcome.result.ok)
    return { ok: false, status: "FAILED", errorCode: outcome.result.errorCode };
  return { ok: true, body: outcome.result.body, fetchedAt };
}

/** 같은 회차 안에서 같은 공고 id 가 두 번 오면 뒤의 것을 남긴다(한 upsert 문장 안의 키 중복은 DB 가 거부한다). */
const uniqueById = (notices: NormalizedProgramNotice[]): NormalizedProgramNotice[] => [
  ...new Map(notices.map((notice) => [notice.sourceNoticeId, notice])).values(),
];

type Counts = { fetchedCount: number; savedCount: number; droppedCount: number };
const NO_COUNTS: Counts = { fetchedCount: 0, savedCount: 0, droppedCount: 0 };

async function collectSource(
  source: ProgramNoticeSource,
  deps: RoundDeps,
): Promise<ProgramRun | null> {
  const startedAt = deps.now().toISOString();
  const finish = (
    status: ProgramNoticeRunStatus,
    errorCode: ProgramRunErrorCode | null,
    counts: Counts = NO_COUNTS,
  ): ProgramRun => ({
    source,
    runMode: RUN_MODE_LABELS[deps.runMode],
    status,
    errorCode,
    ...counts,
    startedAt,
    finishedAt: deps.now().toISOString(),
  });

  const plan = planOf(source, deps.config);
  if (plan === null) return finish("SKIPPED", "CONFIG_INVALID");
  if (!plan.enabled) return null;

  const fetched = await bodyOf(source, plan, deps);
  if (!fetched.ok) return finish(fetched.status, fetched.errorCode);

  const parsed = await attempt(
    async () => plan.parse(fetched.body, fetched.fetchedAt),
    "RESPONSE_SHAPE",
  );
  if (!parsed.ok) return finish("FAILED", parsed.errorCode);
  if (!parsed.value.ok) return finish("FAILED", parsed.value.errorCode);

  const { notices, dropped } = parsed.value;
  const counts: Counts = {
    fetchedCount: notices.length + dropped,
    savedCount: 0,
    droppedCount: dropped,
  };
  const status: ProgramNoticeRunStatus = dropped > 0 ? "PARTIAL" : "SUCCEEDED";
  if (notices.length === 0) return finish(status, null, counts);

  const saved = await attempt(() => deps.store.upsertNotices(uniqueById(notices)), "STORE_FAILED");
  if (!saved.ok) return finish("FAILED", saved.errorCode, counts);
  return finish(status, null, { ...counts, savedCount: saved.value });
}

/** 한 회차. 켜 둔 소스마다 run 하나를 기록하고 돌려준다. 던지지 않는다. */
export async function runProgramNoticeRound(deps: RoundDeps): Promise<ProgramRun[]> {
  const runs: ProgramRun[] = [];
  for (const source of deps.sources ?? PROGRAM_NOTICE_SOURCES) {
    // collectSource 는 단계마다 예외를 오류 코드로 바꾼다. 그 밖(시계 등)에서 던지면 이 소스만 건너뛰고 한 줄 남긴다.
    const outcome = await attempt(() => collectSource(source, deps), "HTTP_ERROR");
    if (!outcome.ok) {
      deps.log(JSON.stringify({ event: "program_notices.source_failed", source }));
      continue;
    }
    const run = outcome.value;
    if (run === null) continue;
    runs.push(run);
    deps.log(
      JSON.stringify({
        event: "program_notices.round",
        source,
        runMode: run.runMode,
        status: run.status,
        errorCode: run.errorCode,
        saved: run.savedCount,
        dropped: run.droppedCount,
      }),
    );
    const recorded = await attempt(() => deps.store.recordRun(run), "STORE_FAILED");
    if (!recorded.ok)
      deps.log(JSON.stringify({ event: "program_notices.run_record_failed", source }));
  }
  return runs;
}
