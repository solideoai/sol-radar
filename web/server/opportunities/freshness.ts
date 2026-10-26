import "server-only";
import { INGEST_SCHEDULE_INTERVAL_MINUTES } from "@/server/ingestion";

// 수집 신선도 기준(10-26 운영 전환). 정기 수집은 한국시간 3시간 정각마다 돈다(@/server/ingestion ingest-schedule).
// 마지막 성공이 정기 간격 + 30분보다 오래되면 "지연"이다. 한 번 거르면 바로 지연으로 보인다.
// 웹 env G2B_INGEST_INTERVAL_MINUTES 는 더 읽지 않는다(Vercel 에 없고, 일정은 코드가 정한다).

const MINUTE_MS = 60_000;
/** 정기 간격 위에 더 기다리는 시간(분). 수집 한 회차가 끝나는 데 걸리는 시간과 시계 차이를 덮는다 */
export const INGEST_STALE_GRACE_MINUTES = 30;
/** 지연 기준(ms). 정기 간격 180분 + 30분 = 210분 */
export const DEFAULT_INGEST_STALE_AFTER_MS =
  (INGEST_SCHEDULE_INTERVAL_MINUTES + INGEST_STALE_GRACE_MINUTES) * MINUTE_MS;

/** 마지막 성공이 이보다 오래되면 "지연"이다. 주기(분)를 주지 않으면(null) 정기 일정 간격이다 */
export const ingestStaleAfterMs = (intervalMinutes: number | null = null): number =>
  ((intervalMinutes ?? INGEST_SCHEDULE_INTERVAL_MINUTES) + INGEST_STALE_GRACE_MINUTES) * MINUTE_MS;

/**
 * 다음 정기 수집 예정 시각. 마지막 정기(SCHEDULED) 수집 시작 + 주기다.
 * worker 스케줄러의 실제 다음 실행이 아니라 그 추정이므로 화면은 "예정"으로 적는다. 둘 중 하나라도 모르면 null.
 * 웹은 주기를 넘기지 않으므로(app/_lib/run-mode.ts currentIngestIntervalMinutes) 지금 대시보드에서는 늘 null 이다.
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
