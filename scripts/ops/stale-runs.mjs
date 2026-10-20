// ops/stale-runs.mjs — 오래 남은 g2b 수집 run 을 고르는 순수 함수. DB·네트워크·현재 시각에 기대지 않는다.
//
// worker 가 g2b run 을 끝내지 못하면 ingest_runs 행이 RUNNING 으로 남고, 같은 소스의 수동 수집이
// 409 INGESTION_IN_PROGRESS 로 막힌다(web/server/ingestion/ingestion-admin.service.ts 의 findRunningRun).
// 운영자 명령(close-stale-ingest-runs.mjs)이 이 함수로 대상만 고르고 닫는다. 근거: docs/16-DECISIONS.md 미결정 25번,
// docs/07 §2.7, docs/06 §5.8(30분이 넘으면 화면 경고). fixture run 과 RUNNING 이 아닌 run 은 고르지 않는다.

export const MIN_OLDER_THAN_MINUTES = 30;
export const DEFAULT_OLDER_THAN_MINUTES = 30;

const MINUTE_MS = 60_000;

// PostgREST 가 주는 timestamptz 모양. 시간대를 꼭 요구한다 — 없으면 Date.parse 가 기계의 지역 시각으로 읽는다.
const TIMESTAMPTZ =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

// 달력에 없는 날(2월 30일·13월·24시)은 Date 가 다음 날로 넘겨 버리므로 성분을 다시 맞춰 본다.
const isCalendarTime = ([year, month, day, hour, minute, second]) => {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
};

/** started_at 문자열을 epoch 밀리초로 읽는다. 깨진 값이면 null 이다. */
export const parseStartedAt = (value) => {
  if (typeof value !== "string") return null;
  const match = TIMESTAMPTZ.exec(value);
  if (match === null) return null;
  const parts = match.slice(1, 7).map((part) => Number(part ?? "0"));
  if (!isCalendarTime(parts)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const isStaleCandidate = (row) =>
  typeof row === "object" && row !== null && row.source === "g2b" && row.status === "RUNNING";

/**
 * source='g2b' 이고 status='RUNNING' 이며 started_at 이 now − olderThanMinutes 분 이하인 행만 고른다.
 * 정확히 기준 분이 지난 행은 고른다. 날짜가 깨졌거나 미래인 행은 고르지 않는다.
 * 돌려주는 값: { id, startedAt(원래 문자열), elapsedMinutes(내림), runMode, trigger }
 */
export const selectStaleRuns = (rows, now, olderThanMinutes) => {
  if (!Array.isArray(rows)) throw new Error("rows 는 배열이어야 합니다");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("now 는 올바른 Date 여야 합니다");
  if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < MIN_OLDER_THAN_MINUTES)
    throw new Error(`기준 분은 ${MIN_OLDER_THAN_MINUTES} 이상의 정수여야 합니다`);
  const nowMs = now.getTime();
  const cutoffMs = nowMs - olderThanMinutes * MINUTE_MS;
  return rows.flatMap((row) => {
    if (!isStaleCandidate(row)) return [];
    const startedMs = parseStartedAt(row.started_at);
    if (startedMs === null || startedMs > cutoffMs) return [];
    return [
      {
        id: row.id,
        startedAt: row.started_at,
        elapsedMinutes: Math.floor((nowMs - startedMs) / MINUTE_MS),
        runMode: row.run_mode ?? null,
        trigger: row.trigger ?? null,
      },
    ];
  });
};
