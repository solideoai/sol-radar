import { formatKstMoment } from "./ingest-format";
import { isUuid } from "./ingest-runs";
import type { ManualGate } from "./ingestion-api";
import { IN_PROGRESS_NOTICE, SCHEDULE_OFF, type IngestRun } from "./ingestion-copy";

// [지금 불러오기] 곁 안내와 막힘 여부(10-26 운영 전환). 상태를 바꾸지 않는 순수 함수만 둔다.
// 판정의 정본은 서버(GET manual-gate, POST 의 429·409)다. 화면은 서버가 준 시각을 checkedAt(그 응답을 받은 때)과
// 견주어 아직 지나지 않았는지만 본다. 쿨다운 길이를 화면 시계로 더해 계산하지 않는다.

export const joinNotice = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" · ");

/** "다음 불러오기 가능: 15:05"(날이 다르면 "10월 27일 15:05"). 서버가 시각을 주지 않았으면 null. */
export const nextAvailableText = (iso: string | null, now: Date): string | null =>
  iso === null ? null : `다음 불러오기 가능: ${formatKstMoment(iso, now)}`;

/** "다른 관리자가 14:05 에 요청한 수집이 진행 중입니다". */
export const sharedRunText = (requestedAt: string, now: Date): string =>
  `다른 관리자가 ${formatKstMoment(requestedAt, now)} 에 요청한 수집이 진행 중입니다`;

/** "오늘 수동 불러오기 한도(5회)를 다 썼습니다 · 00:00 이후 가능". 한도를 모르면 괄호를 뺀다. */
export const dailyLimitText = (limit: number | null): string =>
  `오늘 수동 불러오기 한도${limit === null ? "" : `(${limit}회)`}를 다 썼습니다 · 00:00 이후 가능`;

const pad2 = (hour: number): string => String(hour).padStart(2, "0");

/** "정기 수집: 매일 00·03·06·09·12·15·18·21시(KST) · 다음 15:00" / "정기 수집: 꺼짐". */
export function scheduleText(schedule: ManualGate["schedule"], now: Date): string {
  if (!schedule.active) return SCHEDULE_OFF;
  const hours =
    schedule.slotHoursKst.length === 0
      ? null
      : `매일 ${schedule.slotHoursKst.map(pad2).join("·")}시(KST)`;
  const next =
    schedule.nextRunAt === null ? null : `다음 ${formatKstMoment(schedule.nextRunAt, now)}`;
  const body = joinNotice(hours, next);
  return `정기 수집: ${body === "" ? "켜짐" : body}`;
}

const isLater = (iso: string | null, at: number): boolean => {
  if (iso === null) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time > at;
};

const isDailyExhausted = (daily: ManualGate["daily"]): boolean => daily.used >= daily.limit;

export type GateNotice = { text: string; showRunId: string | null };
export type LiveControlView = {
  /** 단추를 막는다(요청 중 여부는 단추 쪽이 더한다). */
  blocked: boolean;
  /** 막은 이유 또는 진행 안내. 없으면 null. */
  notice: GateNotice | null;
  schedule: string;
};

const latestOf = (times: (string | null)[]): string | null =>
  times.reduce<string | null>(
    (latest, iso) =>
      iso === null || (latest !== null && Date.parse(latest) >= Date.parse(iso)) ? latest : iso,
    null,
  );

/**
 * 판정 응답과 화면의 run 들로 [지금 불러오기]를 막을지와 곁 안내를 정한다.
 * - ownRunIds: 이 화면이 접수한 run. 공유 run 이 내 것이면 "다른 관리자" 안내를 하지 않는다.
 * - inProgress: 실수집 run 이 실행 중이거나 접수 행이 있다(isRunBlocked, D9).
 * 우선순위: 다른 관리자의 실행 중 공유 run → 실행 중 → 하루 한도 → 다음 가능 시각(쿨다운·공유 창) → 정기 수집 꺼짐.
 */
export function liveControlViewOf({
  gate,
  checkedAt,
  inProgress,
  ownRunIds,
  rows,
}: {
  gate: ManualGate;
  checkedAt: number;
  inProgress: boolean;
  ownRunIds: ReadonlySet<string>;
  rows: readonly IngestRun[];
}): LiveControlView {
  const now = new Date(checkedAt);
  const schedule = scheduleText(gate.schedule, now);
  const sharedRun =
    gate.sharedRun !== null && isLater(gate.sharedRun.until, checkedAt) ? gate.sharedRun : null;
  // 다음 가능 시각은 서버가 준 시각 중 늦은 것이다(내 쿨다운 끝·공유 창 끝).
  const nextAt = latestOf([
    isLater(gate.nextAvailableAt, checkedAt) ? gate.nextAvailableAt : null,
    sharedRun?.until ?? null,
  ]);
  const next = nextAvailableText(nextAt, now);
  const block = (notice: GateNotice | null): LiveControlView => ({
    blocked: true,
    notice,
    schedule,
  });

  if (sharedRun !== null) {
    const listed = rows.find((run) => run.id === sharedRun.runId);
    const othersRunning =
      !ownRunIds.has(sharedRun.runId) &&
      !sharedRun.mine &&
      (listed === undefined || listed.status === "RUNNING");
    if (othersRunning)
      return block({
        text: joinNotice(sharedRunText(sharedRun.requestedAt, now), next),
        showRunId: isUuid(sharedRun.runId) ? sharedRun.runId : null,
      });
  }
  if (inProgress) return block({ text: IN_PROGRESS_NOTICE, showRunId: null });
  if (isDailyExhausted(gate.daily))
    return block({
      text: dailyLimitText(gate.daily.limit > 0 ? gate.daily.limit : null),
      showRunId: null,
    });
  if (next !== null) return block({ text: next, showRunId: null });
  // 정기 수집이 꺼져 있으면 서버도 같은 이유(SCHEDULER_INACTIVE)로 거절한다. 이유는 곁의 일정 줄이 말한다.
  if (!gate.schedule.active) return block(null);
  return { blocked: false, notice: null, schedule };
}

/**
 * 판정을 다시 읽을 때(ms). 서버가 준 시각 중 checkedAt 뒤의 가장 이른 것: 쿨다운 끝·공유 run 끝·다음 정기 수집·
 * (하루 한도를 다 썼으면) 한도가 풀리는 때. 없으면 null.
 */
export function gateWakeAt(gate: ManualGate, checkedAt: number): number | null {
  const times = [
    gate.nextAvailableAt,
    gate.sharedRun?.until ?? null,
    gate.schedule.nextRunAt,
    isDailyExhausted(gate.daily) ? gate.daily.resetsAt : null,
  ]
    .filter((iso): iso is string => isLater(iso, checkedAt))
    .map((iso) => Date.parse(iso));
  return times.length === 0 ? null : Math.min(...times);
}
