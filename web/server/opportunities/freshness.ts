import "server-only";

// 수집 신선도 기준(10-25 계획 B2). 주기 env 는 부르는 쪽(app/_lib/run-mode.ts)이 읽어 넘긴다.
// worker 의 G2B_INGEST_INTERVAL_MINUTES 와 같은 이름·형식(양의 정수 분)이다. 화면은 값이 틀려도 멈추지 않고 기본값으로 돌아간다.

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const MINUTE_MS = 60_000;
/** 주기를 모를 때의 지연 기준. 주기 env 가 생기기 전 화면 기준(60분)과 같다 */
export const DEFAULT_INGEST_STALE_AFTER_MS = 60 * MINUTE_MS;

/** 수집 주기(분). 없거나 양의 정수가 아니면 null 이다 */
export function parseIngestIntervalMinutes(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (value === undefined || !POSITIVE_INTEGER.test(value)) return null;
  return Number(value);
}

/** 마지막 수집이 이보다 오래되면 "지연"이다. 주기의 2배, 주기를 모르면 60분 */
export const ingestStaleAfterMs = (intervalMinutes: number | null): number =>
  intervalMinutes === null ? DEFAULT_INGEST_STALE_AFTER_MS : intervalMinutes * 2 * MINUTE_MS;

/**
 * 다음 정기 수집 예정 시각. 마지막 정기(SCHEDULED) 수집 시작 + 주기다.
 * worker 스케줄러의 실제 다음 실행이 아니라 그 추정이므로 화면은 "예정"으로 적는다. 둘 중 하나라도 모르면 null.
 */
export function nextScheduledIngestAt(
  lastScheduledAt: string | null,
  intervalMinutes: number | null,
): string | null {
  if (lastScheduledAt === null || intervalMinutes === null) return null;
  const started = Date.parse(lastScheduledAt);
  return Number.isNaN(started)
    ? null
    : new Date(started + intervalMinutes * MINUTE_MS).toISOString();
}
