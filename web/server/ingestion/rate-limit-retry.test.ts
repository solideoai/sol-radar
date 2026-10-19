import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_TIMEOUT_MS,
  isRetryableFailure,
  type BidSourceConnector,
  type ConnectorFailure,
  type FetchPageInput,
  type FetchPageOutcome,
} from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureManifest } from "./fixture.model";
import type { StartRunInput } from "./ingestion.repo";
import { createMemoryIngestionRepo, memoryRevisionsOf } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import {
  fetchPageWithRetry,
  RETRY_BASE_DELAY_MS,
  RETRY_AFTER_MAX_MS,
  RETRY_JITTER_MAX_MS,
  RETRY_MAX_RETRIES,
  retryDelayMs,
  type RetryDeps,
} from "./retry";

// G7: API 429 → 지수 재시도 후 성공, Retry-After 대기 준수, 체크포인트(ingest_runs.cursor) 복구, 적재 1건(11 §3).
// 대기는 sleep 을 주입해 값만 기록한다(실제로 기다리지 않는다). 난수도 주입한다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const NOW = new Date("2026-10-19T09:00:00.000Z");

const fail = (failure: ConnectorFailure): FetchPageOutcome => ({ ok: false, failure });
const OK_PAGE: FetchPageOutcome = {
  ok: true,
  page: { records: [], nextCursor: null, rateLimitInfo: null },
};

const RATE_LIMITED_2S: ConnectorFailure = {
  kind: "RATE_LIMITED",
  status: 429,
  retryAfterSec: 2,
  detail: "429",
};
const RATE_LIMITED_NO_HEADER: ConnectorFailure = {
  kind: "RATE_LIMITED",
  status: 429,
  detail: "429",
};
const timeout = (detail = "timeout"): ConnectorFailure => ({ kind: "TIMEOUT", detail });
const HTTP_500: ConnectorFailure = { kind: "HTTP_ERROR", status: 500, detail: "500" };
const HTTP_503: ConnectorFailure = { kind: "HTTP_ERROR", status: 503, detail: "503" };
const HTTP_404: ConnectorFailure = { kind: "HTTP_ERROR", status: 404, detail: "404" };
const RESULT_CODE: ConnectorFailure = {
  kind: "RESULT_CODE",
  resultCode: "99",
  detail: "resultCode 99",
};
const QUOTA: ConnectorFailure = { kind: "QUOTA_EXCEEDED", resultCode: "22", detail: "quota" };
const FIXTURE_INVALID: ConnectorFailure = {
  kind: "FIXTURE_INVALID",
  detail: "fixture FX-01: invalid",
};

const INPUT: FetchPageInput = { from: null, to: null, cursor: "3" };

// 정해 둔 결과를 차례로 돌려주는 가짜 connector. 준비한 것보다 많이 부르면 던진다.
const scripted = (outcomes: readonly FetchPageOutcome[], log: string[] = []) => {
  const inputs: FetchPageInput[] = [];
  const connector: BidSourceConnector = {
    source: "g2b",
    fetchPage: async (input) => {
      inputs.push(input);
      log.push("fetch");
      const next = outcomes[inputs.length - 1];
      if (!next) throw new Error("준비한 결과보다 많이 불렀다");
      return next;
    },
  };
  return { connector, inputs };
};

const deps = (random = 0, log: string[] = []) => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async (ms) => {
    log.push(`sleep:${ms}`);
  });
  const retry: RetryDeps = { sleep, random: () => random };
  return { sleep, retry };
};

const sleptMs = (sleep: ReturnType<typeof deps>["sleep"]) => sleep.mock.calls.map(([ms]) => ms);

describe("상수 (07 §2 Connector 계약)", () => {
  it("요청 timeout 은 15초다", () => {
    expect(CONNECTOR_TIMEOUT_MS).toBe(15_000);
  });

  it("backoff 기본 대기는 1초다", () => {
    expect(RETRY_BASE_DELAY_MS).toBe(1000);
  });

  it("최대 재시도는 3회다", () => {
    expect(RETRY_MAX_RETRIES).toBe(3);
  });

  it("jitter 상한은 250ms 다", () => {
    expect(RETRY_JITTER_MAX_MS).toBe(250);
  });
});

describe("isRetryableFailure — 재시도 가능/불가 분류", () => {
  it.each<[string, ConnectorFailure, boolean]>([
    ["RATE_LIMITED", RATE_LIMITED_2S, true],
    ["TIMEOUT", timeout(), true],
    ["HTTP_ERROR 500", HTTP_500, true],
    ["HTTP_ERROR 503", HTTP_503, true],
    ["HTTP_ERROR 599", { kind: "HTTP_ERROR", status: 599, detail: "599" }, true],
    ["HTTP_ERROR 499", { kind: "HTTP_ERROR", status: 499, detail: "499" }, false],
    ["HTTP_ERROR 404", HTTP_404, false],
    ["HTTP_ERROR status 없음", { kind: "HTTP_ERROR", detail: "unknown" }, false],
    ["RESULT_CODE", RESULT_CODE, false],
    ["QUOTA_EXCEEDED", QUOTA, false],
    ["FIXTURE_INVALID", FIXTURE_INVALID, false],
  ])("%s → %s", (_name, failure, expected) => {
    expect(isRetryableFailure(failure)).toBe(expected);
  });
});

describe("retryDelayMs — 지수 backoff + jitter, Retry-After 존중", () => {
  it("RATE_LIMITED 에 retryAfterSec 가 있으면 정확히 그 초만큼 기다린다(jitter 없음)", () => {
    expect(retryDelayMs(RATE_LIMITED_2S, 0, () => 0.99)).toBe(2000);
  });

  it("Retry-After 는 retryIndex 와 무관하다: retryAfterSec 5, retryIndex 2 → 5000ms", () => {
    const failure: ConnectorFailure = { ...RATE_LIMITED_2S, retryAfterSec: 5 };
    expect(retryDelayMs(failure, 2, () => 0.5)).toBe(5000);
  });

  it("RATE_LIMITED 라도 retryAfterSec 가 없으면 지수 backoff 를 쓴다", () => {
    expect(retryDelayMs(RATE_LIMITED_NO_HEADER, 1, () => 0)).toBe(2000);
  });

  it.each([
    [0, 1000],
    [1, 2000],
    [2, 4000],
  ])("retryIndex %i 의 기본 대기는 %ims 다(random 0)", (retryIndex, expected) => {
    expect(retryDelayMs(timeout(), retryIndex, () => 0)).toBe(expected);
  });

  it("jitter 는 Math.floor(random() * 250) 이다: random 0.5 → 1125ms", () => {
    expect(retryDelayMs(timeout(), 0, () => 0.5)).toBe(1125);
  });

  it("jitter 는 250ms 미만이다: random 0.999999, retryIndex 2 → 4249ms", () => {
    expect(retryDelayMs(timeout(), 2, () => 0.999999)).toBe(4249);
  });

  it("HTTP 5xx 도 같은 backoff 를 쓴다: 503, retryIndex 1, random 0.1 → 2025ms", () => {
    expect(retryDelayMs(HTTP_503, 1, () => 0.1)).toBe(2025);
  });
});

describe("fetchPageWithRetry — 성공·재시도 불가", () => {
  it("첫 시도가 성공하면 그 결과를 retried 0, attempts [] 로 돌려준다", async () => {
    const { connector } = scripted([OK_PAGE]);
    const { retry } = deps();
    await expect(fetchPageWithRetry(connector, INPUT, retry)).resolves.toEqual({
      outcome: OK_PAGE,
      retried: 0,
      attempts: [],
    });
  });

  it("첫 시도가 성공하면 sleep 을 부르지 않는다", async () => {
    const { connector } = scripted([OK_PAGE]);
    const { sleep, retry } = deps();
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each<[string, ConnectorFailure]>([
    ["RESULT_CODE", RESULT_CODE],
    ["QUOTA_EXCEEDED", QUOTA],
    ["FIXTURE_INVALID", FIXTURE_INVALID],
    ["HTTP_ERROR 404", HTTP_404],
  ])("재시도할 수 없는 %s 는 한 번만 부르고 그 실패를 바로 돌려준다", async (_name, failure) => {
    const { connector, inputs } = scripted([fail(failure), OK_PAGE]);
    const { sleep, retry } = deps();
    await expect(fetchPageWithRetry(connector, INPUT, retry)).resolves.toEqual({
      outcome: fail(failure),
      retried: 0,
      attempts: [],
    });
    expect(inputs).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("fetchPageWithRetry — 재시도", () => {
  it("HTTP 500 뒤 성공하면 두 번 부르고 retried 1 이다", async () => {
    const { connector, inputs } = scripted([fail(HTTP_500), OK_PAGE]);
    const { retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.outcome).toEqual(OK_PAGE);
    expect(result.retried).toBe(1);
    expect(inputs).toHaveLength(2);
  });

  it("429 두 번 뒤 성공하면 Retry-After 대로 2000ms 를 두 번 기다린다", async () => {
    const { connector } = scripted([fail(RATE_LIMITED_2S), fail(RATE_LIMITED_2S), OK_PAGE]);
    const { sleep, retry } = deps(0.7);
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleptMs(sleep)).toEqual([2000, 2000]);
  });

  it("429 두 번 뒤 성공하면 attempts 에 실패한 시도 번호·종류·기다린 시간을 남긴다", async () => {
    const { connector } = scripted([fail(RATE_LIMITED_2S), fail(RATE_LIMITED_2S), OK_PAGE]);
    const { retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result).toEqual({
      outcome: OK_PAGE,
      retried: 2,
      attempts: [
        { attempt: 1, failureKind: "RATE_LIMITED", waitMs: 2000 },
        { attempt: 2, failureKind: "RATE_LIMITED", waitMs: 2000 },
      ],
    });
  });

  it("기다린 뒤에 다시 부른다(sleep 이 다음 호출보다 먼저다)", async () => {
    const log: string[] = [];
    const { connector } = scripted([fail(timeout()), OK_PAGE], log);
    const { retry } = deps(0, log);
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(log).toEqual(["fetch", "sleep:1000", "fetch"]);
  });

  it("재시도마다 같은 입력(from·to·cursor)으로 부른다", async () => {
    const { connector, inputs } = scripted([fail(timeout()), fail(HTTP_503), OK_PAGE]);
    const { retry } = deps();
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(inputs).toEqual([INPUT, INPUT, INPUT]);
  });

  it("주입한 random 으로 jitter 를 정한다: random 0.5 → 첫 대기 1125ms", async () => {
    const { connector } = scripted([fail(timeout()), OK_PAGE]);
    const { sleep, retry } = deps(0.5);
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleptMs(sleep)).toEqual([1125]);
  });

  it("세 번 재시도 뒤 네 번째에 성공하면 성공을 돌려주고 retried 3 이다", async () => {
    const { connector, inputs } = scripted([
      fail(timeout()),
      fail(timeout()),
      fail(timeout()),
      OK_PAGE,
    ]);
    const { retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.outcome).toEqual(OK_PAGE);
    expect(result.retried).toBe(3);
    expect(inputs).toHaveLength(4);
  });

  it("최대 3회 재시도: 계속 실패하면 네 번 부르고 멈춘다", async () => {
    const { connector, inputs } = scripted([
      fail(timeout("t1")),
      fail(timeout("t2")),
      fail(timeout("t3")),
      fail(timeout("t4")),
      OK_PAGE,
    ]);
    const { retry } = deps();
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(inputs).toHaveLength(4);
  });

  it("3회 재시도 뒤에도 실패하면 마지막 실패를 돌려준다", async () => {
    const { connector } = scripted([
      fail(timeout("t1")),
      fail(timeout("t2")),
      fail(timeout("t3")),
      fail(timeout("t4")),
    ]);
    const { retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.outcome).toEqual(fail(timeout("t4")));
    expect(result.retried).toBe(3);
  });

  it("포기한 마지막 실패는 attempts 에 남기지 않는다: 기다린 3번만 1s·2s·4s 로 남는다", async () => {
    const { connector } = scripted([
      fail(timeout()),
      fail(timeout()),
      fail(timeout()),
      fail(timeout()),
    ]);
    const { sleep, retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.attempts).toEqual([
      { attempt: 1, failureKind: "TIMEOUT", waitMs: 1000 },
      { attempt: 2, failureKind: "TIMEOUT", waitMs: 2000 },
      { attempt: 3, failureKind: "TIMEOUT", waitMs: 4000 },
    ]);
    expect(sleptMs(sleep)).toEqual([1000, 2000, 4000]);
  });

  it("재시도 중 재시도할 수 없는 실패가 오면 그 실패를 바로 돌려주고 retried 는 그때까지의 값이다", async () => {
    const { connector, inputs } = scripted([fail(timeout()), fail(RESULT_CODE), OK_PAGE]);
    const { retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.outcome).toEqual(fail(RESULT_CODE));
    expect(result.retried).toBe(1);
    expect(result.attempts).toEqual([{ attempt: 1, failureKind: "TIMEOUT", waitMs: 1000 }]);
    expect(inputs).toHaveLength(2);
  });
});

// 7-2(security-auditor 낮음): 서버가 터무니없이 긴 Retry-After 를 주면 worker 가 그만큼 묶인다. 상한을 넘으면 기다리지 않는다.
describe("fetchPageWithRetry — Retry-After 상한(C3 계약 7-2)", () => {
  const rateLimited = (retryAfterSec: number): ConnectorFailure => ({
    kind: "RATE_LIMITED",
    status: 429,
    retryAfterSec,
    detail: "429",
  });

  it("Retry-After 상한은 60초(60000ms)다", () => {
    expect(RETRY_AFTER_MAX_MS).toBe(60_000);
  });

  it("Retry-After 61초면 기다리지 않고 그 실패를 바로 돌려준다(retried 0, attempts 빈 배열)", async () => {
    const { connector } = scripted([fail(rateLimited(61)), OK_PAGE]);
    const { retry } = deps();
    await expect(fetchPageWithRetry(connector, INPUT, retry)).resolves.toEqual({
      outcome: fail(rateLimited(61)),
      retried: 0,
      attempts: [],
    });
  });

  it("Retry-After 61초면 sleep 을 부르지 않고 connector 도 다시 부르지 않는다", async () => {
    const { connector, inputs } = scripted([fail(rateLimited(61)), OK_PAGE]);
    const { sleep, retry } = deps();
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleep).not.toHaveBeenCalled();
    expect(inputs).toHaveLength(1);
  });

  it("Retry-After 가 상한을 크게 넘어도(3600초) 기다리지 않는다", async () => {
    const { connector } = scripted([fail(rateLimited(3600)), OK_PAGE]);
    const { sleep, retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result.outcome).toEqual(fail(rateLimited(3600)));
    expect(sleep).not.toHaveBeenCalled();
  });

  it("Retry-After 정확히 60초는 상한 안이라 60000ms 기다린 뒤 다시 부른다", async () => {
    const { connector, inputs } = scripted([fail(rateLimited(60)), OK_PAGE]);
    const { sleep, retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleptMs(sleep)).toEqual([60_000]);
    expect(inputs).toHaveLength(2);
    expect(result).toEqual({
      outcome: OK_PAGE,
      retried: 1,
      attempts: [{ attempt: 1, failureKind: "RATE_LIMITED", waitMs: 60_000 }],
    });
  });

  it("앞서 기다린 뒤 상한을 넘는 Retry-After 가 오면 그때 멈춘다(그때까지의 retried·attempts 는 남는다)", async () => {
    const { connector, inputs } = scripted([fail(rateLimited(2)), fail(rateLimited(61)), OK_PAGE]);
    const { sleep, retry } = deps();
    const result = await fetchPageWithRetry(connector, INPUT, retry);
    expect(result).toEqual({
      outcome: fail(rateLimited(61)),
      retried: 1,
      attempts: [{ attempt: 1, failureKind: "RATE_LIMITED", waitMs: 2000 }],
    });
    expect(sleptMs(sleep)).toEqual([2000]);
    expect(inputs).toHaveLength(2);
  });

  it("상한은 Retry-After 에만 건다: Retry-After 없는 429 는 지금처럼 지수 backoff 로 재시도한다", async () => {
    const { connector } = scripted([fail(RATE_LIMITED_NO_HEADER), OK_PAGE]);
    const { sleep, retry } = deps();
    await fetchPageWithRetry(connector, INPUT, retry);
    expect(sleptMs(sleep)).toEqual([1000]);
  });

  it("상한을 넘는 Retry-After 로 끝난 수집은 RATE_LIMITED 로 기록하고 FAILED, retried 0 이다", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector } = scripted([fail(rateLimited(120))]);
    const { sleep, retry } = deps();
    const result = await runIngest({
      connector,
      repo,
      run: {
        source: "g2b",
        runMode: "LIVE",
        jobKey: "g2b:retry-after-cap",
        trigger: "MANUAL",
        batch: null,
        params: { window: { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" } },
      },
      now: () => NOW,
      retry,
    });
    expect(result.status).toBe("FAILED");
    expect(result.summary.retried).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
    expect(repo.state.errors.map((error) => error.errorCode)).toEqual(["RATE_LIMITED"]);
  });
});

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const seedRun = (jobKey: string): StartRunInput => ({
  source: "fixture",
  runMode: "FIXTURE",
  jobKey,
  trigger: "DEMO",
  batch: "SEED",
  params: null,
});

const seedConnector = () =>
  createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "SEED", manifest });

describe("G7 — FixtureConnector 의 FX-20 429 를 재시도로 넘긴다", () => {
  it("FX-20 페이지를 fetchPageWithRetry 로 부르면 RATE_LIMITED 2회를 2000ms 씩 기다린 뒤 성공한다", async () => {
    const { retry } = deps();
    const result = await fetchPageWithRetry(
      seedConnector(),
      { from: null, to: null, cursor: "19" },
      retry,
    );
    expect(result.retried).toBe(2);
    expect(result.attempts).toEqual([
      { attempt: 1, failureKind: "RATE_LIMITED", waitMs: 2000 },
      { attempt: 2, failureKind: "RATE_LIMITED", waitMs: 2000 },
    ]);
    expect(result.outcome.ok).toBe(true);
  });

  const runSeed = async () => {
    const repo = createMemoryIngestionRepo();
    const { sleep, retry } = deps();
    const result = await runIngest({
      connector: seedConnector(),
      repo,
      run: seedRun("g7-seed"),
      anchor: ANCHOR,
      now: () => NOW,
      retry,
    });
    return { repo, sleep, result };
  };

  it("SEED 수집은 Retry-After 를 지켜 2000ms 를 정확히 두 번만 기다린다", async () => {
    const { sleep } = await runSeed();
    expect(sleptMs(sleep)).toEqual([2000, 2000]);
  });

  it("SEED 수집의 summary.retried 는 2 다", async () => {
    const { result } = await runSeed();
    expect(result.summary.retried).toBe(2);
  });

  it("재시도 뒤 FX-20 은 revision 1 로 정확히 1건 적재된다", async () => {
    const { repo } = await runSeed();
    expect(memoryRevisionsOf(repo, "fixture", "DEMO-2026-0020").map((r) => r.revision)).toEqual([
      1,
    ]);
  });

  it("재시도로 넘긴 429 는 run 을 실패시키지 않는다: FX-12 격리 때문에 PARTIAL 이지 FAILED 가 아니다", async () => {
    const { result } = await runSeed();
    expect(result.status).toBe("PARTIAL");
  });

  it("재시도로 넘긴 429 는 오류 기록에 RATE_LIMITED 를 남기지 않는다", async () => {
    const { repo } = await runSeed();
    expect(repo.state.errors.map((error) => error.errorCode)).not.toContain("RATE_LIMITED");
  });
});

describe("G7 — 체크포인트 복구(ingest_runs.cursor)", () => {
  const JOB_KEY = "g7-checkpoint";
  const FAIL_CURSOR = "10"; // FX-11 페이지

  // 정해 둔 cursor 에서 재시도할 수 없는 실패를 정해 둔 횟수만큼 낸 뒤 원래 connector 로 넘긴다.
  const failingAt = (inner: BidSourceConnector, cursor: string, times: number) => {
    const state = { remaining: times };
    const requested: (string | null)[] = [];
    const connector: BidSourceConnector = {
      source: inner.source,
      fetchPage: async (input) => {
        requested.push(input.cursor);
        if (input.cursor === cursor && state.remaining > 0) {
          state.remaining -= 1;
          return fail({ kind: "RESULT_CODE", resultCode: "99", detail: "fixture 중단 흉내" });
        }
        return inner.fetchPage(input);
      },
    };
    return { connector, requested };
  };

  const scenario = async () => {
    const repo = createMemoryIngestionRepo();
    const { connector, requested } = failingAt(seedConnector(), FAIL_CURSOR, 1);
    const input = (retry: RetryDeps) => ({
      connector,
      repo,
      run: seedRun(JOB_KEY),
      anchor: ANCHOR,
      now: () => NOW,
      retry,
    });
    const firstResult = await runIngest(input(deps().retry));
    const afterFirst = {
      cursor: repo.state.runs.get(JOB_KEY)?.cursor,
      status: repo.state.runs.get(JOB_KEY)?.status,
      bids: repo.state.bids.size,
      revisions: repo.state.revisions.length,
      requested: requested.length,
    };
    const secondResult = await runIngest(input(deps().retry));
    const secondRequested = requested.slice(afterFirst.requested);
    return { repo, firstResult, afterFirst, secondResult, secondRequested };
  };

  it("1차 실행은 처리한 페이지가 있어도 connector 실패로 중단했으므로 FAILED 다", async () => {
    const { firstResult } = await scenario();
    expect(firstResult.status).toBe("FAILED");
  });

  it("1차 실행은 실패한 페이지의 cursor 10 을 run 에 저장하고 FAILED 로 끝낸다", async () => {
    const { afterFirst } = await scenario();
    expect(afterFirst.cursor).toBe(FAIL_CURSOR);
    expect(afterFirst.status).toBe("FAILED");
  });

  it("1차 실행은 실패 전 10페이지(FX-01~FX-10)만 적재한다", async () => {
    const { afterFirst } = await scenario();
    expect(afterFirst.bids).toBe(10);
    expect(afterFirst.revisions).toBe(10);
  });

  it("같은 jobKey 의 2차 실행은 같은 run 을 이어 받는다(runId 같음)", async () => {
    const { firstResult, secondResult } = await scenario();
    expect(secondResult.runId).toBe(firstResult.runId);
    expect(secondResult.alreadyFinished).toBe(false);
  });

  it("2차 실행은 저장된 cursor 10 부터 이어 간다(resumedFromCursor)", async () => {
    const { secondResult } = await scenario();
    expect(secondResult.resumedFromCursor).toBe(FAIL_CURSOR);
  });

  it("2차 실행은 처음(cursor null)부터 다시 부르지 않고 cursor 10 부터 부른다", async () => {
    const { secondRequested } = await scenario();
    expect(secondRequested[0]).toBe(FAIL_CURSOR);
    expect(secondRequested).not.toContain(null);
    expect(secondRequested).not.toContain("9");
  });

  it("2차 실행은 끝까지 가서 FX-12 격리 때문에 PARTIAL 로 끝나고 run 의 상태도 PARTIAL 이다", async () => {
    const { repo, secondResult } = await scenario();
    expect(secondResult.status).toBe("PARTIAL");
    expect(repo.state.runs.get(JOB_KEY)?.status).toBe("PARTIAL");
  });

  it("복구가 끝난(PARTIAL) jobKey 의 3차 실행은 alreadyFinished 이고 connector 를 부르지 않는다", async () => {
    const { repo, secondResult } = await scenario();
    const inner = seedConnector();
    const fetchPage = vi.fn((input: FetchPageInput) => inner.fetchPage(input));
    const third = await runIngest({
      connector: { source: inner.source, fetchPage },
      repo,
      run: seedRun(JOB_KEY),
      anchor: ANCHOR,
      now: () => NOW,
      retry: deps().retry,
    });
    expect(third.alreadyFinished).toBe(true);
    expect(third.summary).toEqual(secondResult.summary);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("2차 실행의 summary 는 1차 summary 에 이어 쌓여 SEED 기대값과 같다", async () => {
    const { secondResult } = await scenario();
    expect(secondResult.summary).toEqual({
      created: 19,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 1,
      retried: 2,
    });
  });

  it("복구 뒤 공고 19건이 revision 1 하나씩만 가진다(중복 revision 0)", async () => {
    const { repo } = await scenario();
    expect(repo.state.bids.size).toBe(19);
    expect(repo.state.revisions).toHaveLength(19);
    expect(new Set(repo.state.revisions.map((revision) => revision.bidId)).size).toBe(19);
    expect(repo.state.revisions.every((revision) => revision.revision === 1)).toBe(true);
  });

  it("복구 실행은 이미 적재한 페이지를 다시 세지 않는다(2차 실행이 만든 revision 은 9건)", async () => {
    const { repo, afterFirst } = await scenario();
    expect(repo.state.revisions.length - afterFirst.revisions).toBe(9);
  });
});
