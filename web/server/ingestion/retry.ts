import "server-only";
import {
  isRetryableFailure,
  type BidSourceConnector,
  type ConnectorFailure,
  type ConnectorFailureKind,
  type FetchPageInput,
  type FetchPageOutcome,
} from "./connector.model";

// ── G7 재시도: 지수 backoff + jitter, 429 는 Retry-After 를 그대로 지킨다. 대기·난수는 주입받는다 ──
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_RETRIES = 3;
export const RETRY_JITTER_MAX_MS = 250;
/** 서버가 정한 Retry-After 가 이보다 길면 기다리지 않는다. worker 가 한 job 에 오래 묶이지 않게 한다(7-2). */
export const RETRY_AFTER_MAX_MS = 60_000;

export type RetryDeps = { sleep: (ms: number) => Promise<void>; random: () => number };
export type RetryAttemptLog = {
  attempt: number;
  failureKind: ConnectorFailureKind;
  waitMs: number;
};
export type RetryOutcome = {
  outcome: FetchPageOutcome;
  retried: number;
  attempts: RetryAttemptLog[];
};

export function retryDelayMs(
  failure: ConnectorFailure,
  retryIndex: number,
  random: () => number,
): number {
  // 서버가 기다릴 시간을 정해 줬으면 더 짧게도 길게도 기다리지 않는다(jitter 없음).
  if (failure.kind === "RATE_LIMITED" && failure.retryAfterSec !== undefined) {
    return failure.retryAfterSec * 1000;
  }
  return RETRY_BASE_DELAY_MS * 2 ** retryIndex + Math.floor(random() * RETRY_JITTER_MAX_MS);
}

const isServerRequestedWait = (failure: ConnectorFailure): boolean =>
  failure.kind === "RATE_LIMITED" && failure.retryAfterSec !== undefined;

/** 값으로 돌아오는 실패(ConnectorFailure)를 가진 결과. 목록 페이지와 보조 조회가 같은 재시도 규칙을 쓴다 */
export type RetryableOutcome = { ok: true } | { ok: false; failure: ConnectorFailure };

export type RetryResult<T extends RetryableOutcome> = {
  outcome: T;
  retried: number;
  attempts: RetryAttemptLog[];
};

export async function withRetry<T extends RetryableOutcome>(
  attempt: () => Promise<T>,
  deps: RetryDeps,
): Promise<RetryResult<T>> {
  const attempts: RetryAttemptLog[] = [];
  for (let attemptNo = 1; ; attemptNo += 1) {
    const outcome = await attempt();
    const retried = attemptNo - 1;
    if (outcome.ok || !isRetryableFailure(outcome.failure) || retried >= RETRY_MAX_RETRIES) {
      return { outcome, retried, attempts };
    }
    const waitMs = retryDelayMs(outcome.failure, retried, deps.random);
    // 터무니없이 긴 Retry-After 는 기다리지 않고 그 실패를 돌려준다. 다음 일정 수집이나 같은 jobKey 재실행이 잇는다.
    if (isServerRequestedWait(outcome.failure) && waitMs > RETRY_AFTER_MAX_MS) {
      return { outcome, retried, attempts };
    }
    // 기다린 실패만 남긴다. 포기한 마지막 실패는 outcome 이 말한다.
    attempts.push({ attempt: attemptNo, failureKind: outcome.failure.kind, waitMs });
    await deps.sleep(waitMs);
  }
}

export function fetchPageWithRetry(
  connector: BidSourceConnector,
  input: FetchPageInput,
  deps: RetryDeps,
): Promise<RetryOutcome> {
  return withRetry(() => connector.fetchPage(input), deps);
}
