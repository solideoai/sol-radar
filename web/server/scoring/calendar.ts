import "server-only";

// 날짜 계산은 전부 입력 값으로만 한다. Date.now()·환경 시간대를 쓰지 않는다(재현성, 08 §8).
// 공고 날짜는 ISO8601 UTC 로 오고 업무 기준은 Asia/Seoul(KST, UTC+9, DST 없음)이라 오프셋 덧셈으로 달력 날짜를 얻는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarDate = { year: number; month: number; day: number }; // month 1~12

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid date: ${value}`);
  return parsed;
}

function fromUtcMs(ms: number): CalendarDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function toUtcMs(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** ISO 시각을 KST 달력 날짜로. */
export function kstDate(iso: string): CalendarDate {
  return fromUtcMs(instant(iso) + KST_OFFSET_MS);
}

/** "YYYY-MM-DD" 를 달력 날짜로. */
export function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDate(date: CalendarDate): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function addMonths(date: CalendarDate, months: number): CalendarDate {
  return fromUtcMs(Date.UTC(date.year, date.month - 1 + months, date.day));
}

/** 그 달 1일이면 그대로, 아니면 다음 달 1일. */
export function ceilToMonthStart(date: CalendarDate): CalendarDate {
  if (date.day === 1) return date;
  return fromUtcMs(Date.UTC(date.year, date.month, 1));
}

/** 두 날짜 사이 연수(365.25일 기준). from 이 to 보다 뒤면 0. */
export function yearsBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.max(0, (toUtcMs(to) - toUtcMs(from)) / (365.25 * DAY_MS));
}

/**
 * 제안 준비 영업일: [from, to) 반열림 구간의 월~금 날짜 수. 공휴일 표는 없다(v0.1).
 * 08 §6 worked example 의 15/7/11 은 달력일 × 5/7 근사값이라 이 계산(15/6/11)과 FX-02 가 1일 다르다. 일정 계수 구간(≥10·≥5)은 같다.
 */
export function businessDaysBetween(from: CalendarDate, to: CalendarDate): number {
  const start = toUtcMs(from);
  const end = toUtcMs(to);
  if (end <= start) return 0;
  const days = Math.round((end - start) / DAY_MS);
  return Array.from({ length: days }, (_, offset) =>
    new Date(start + offset * DAY_MS).getUTCDay(),
  ).filter((weekday) => weekday !== 0 && weekday !== 6).length;
}

/**
 * 기간 미상일 때의 수행 기간(08 §3.3 "마감 +1개월부터 6개월").
 * 시작은 (기준일 + 1개월) 이후 첫 월초로 맞춘다 — 공공 SI 투입 기간과 인력 가용성 창(team.availability)이 월 단위라서다.
 * 마감이 없으면 계산 기준일(config.today)을 기준으로 한다.
 */
export function defaultProjectPeriod(anchor: CalendarDate): { startsAt: string; endsAt: string } {
  const startsAt = ceilToMonthStart(addMonths(anchor, 1));
  return { startsAt: formatDate(startsAt), endsAt: formatDate(addMonths(startsAt, 6)) };
}
