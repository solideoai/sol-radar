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

export async function fetchPageWithRetry(
  connector: BidSourceConnector,
  input: FetchPageInput,
  deps: RetryDeps,
): Promise<RetryOutcome> {
  const attempts: RetryAttemptLog[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await connector.fetchPage(input);
    const retried = attempt - 1;
    if (outcome.ok || !isRetryableFailure(outcome.failure) || retried >= RETRY_MAX_RETRIES) {
      return { outcome, retried, attempts };
    }
    const waitMs = retryDelayMs(outcome.failure, retried, deps.random);
    // 기다린 실패만 남긴다. 포기한 마지막 실패는 outcome 이 말한다.
    attempts.push({ attempt, failureKind: outcome.failure.kind, waitMs });
    await deps.sleep(waitMs);
  }
}
