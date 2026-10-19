import "server-only";

// ── 07 §3 날짜: 원문(Asia/Seoul)을 UTC ISO 문자열로. 현재 시각은 anchor 로만 받는다(ADR-014) ──
export const KST_OFFSET_MINUTES = 540;
export const ASSUMED_HOUR_KST = 18;

export type DateParse = { ok: true; value: string; assumedTime: boolean } | { ok: false };

export type CalendarDate = { year: number; month: number; day: number };

type WallClock = CalendarDate & {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const MINUTE_MS = 60_000;
const KST_OFFSET_MS = KST_OFFSET_MINUTES * MINUTE_MS;

const RELATIVE_DAYS = /^([+-])(\d+)d$/;
const DATE_ONLY = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{4})\.(\d{2})\.(\d{2})$/,
  /^(\d{4})(\d{2})(\d{2})$/,
] as const;
const LOCAL_DATE_TIME = [
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/,
] as const;
const OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

const failure = (): DateParse => ({ ok: false });

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

// Date.UTC 는 2월 30일을 3월 2일로 넘겨 버리므로 달력에 없는 값은 계산 전에 거른다.
const isValidWallClock = (clock: WallClock): boolean =>
  clock.month >= 1 &&
  clock.month <= 12 &&
  clock.day >= 1 &&
  clock.day <= daysInMonth(clock.year, clock.month) &&
  clock.hour <= 23 &&
  clock.minute <= 59 &&
  clock.second <= 59;

const toInstant = (clock: WallClock, offsetMinutes: number): number =>
  Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.millisecond,
  ) -
  offsetMinutes * MINUTE_MS;

// 범위를 넘는 상대 일수는 Invalid Date 가 되어 toISOString 이 던지므로 결과로 거른다.
const fromInstant = (instant: number, assumedTime: boolean): DateParse =>
  Number.isFinite(instant) && Math.abs(instant) <= 8.64e15
    ? { ok: true, value: new Date(instant).toISOString(), assumedTime }
    : failure();

const clockOf = (
  [year, month, day, hour = "0", minute = "0", second = "0"]: readonly string[],
  millisecond = 0,
): WallClock => ({
  year: Number(year),
  month: Number(month),
  day: Number(day),
  hour: Number(hour),
  minute: Number(minute),
  second: Number(second),
  millisecond,
});

const parseKstClock = (clock: WallClock, assumedTime: boolean): DateParse =>
  isValidWallClock(clock)
    ? fromInstant(toInstant(clock, KST_OFFSET_MINUTES), assumedTime)
    : failure();

/** 순간(instant)이 KST 로 어느 날짜인지. 상대 날짜·일일 호출 예산이 같은 날짜 경계를 쓴다. */
export function kstCalendarDate(instant: Date): CalendarDate {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseRelative(sign: string, days: string, anchor: Date): DateParse {
  const { year, month, day } = kstCalendarDate(anchor);
  const offsetDays = (sign === "-" ? -1 : 1) * Number(days);
  // 일수 넘침(10월 40일 등)은 Date.UTC 가 다음 달로 넘겨 준다.
  const instant = Date.UTC(year, month - 1, day + offsetDays, ASSUMED_HOUR_KST) - KST_OFFSET_MS;
  return fromInstant(instant, true);
}

function parseOffsetDateTime(match: RegExpExecArray): DateParse {
  const [, year, month, day, hour, minute, second = "0", fraction = "", zone, sign, offH, offM] =
    match;
  const clock = clockOf([year, month, day, hour, minute, second], Number(fraction.padEnd(3, "0")));
  if (!isValidWallClock(clock)) return failure();
  if (zone === "Z") return fromInstant(toInstant(clock, 0), false);
  const offsetHours = Number(offH);
  const offsetMinutes = Number(offM);
  if (offsetHours > 23 || offsetMinutes > 59) return failure();
  const offset = (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  return fromInstant(toInstant(clock, offset), false);
}

export function parseKstDateTime(raw: string, anchor: Date): DateParse {
  const text = raw.trim();

  const relative = RELATIVE_DAYS.exec(text);
  if (relative) return parseRelative(relative[1], relative[2], anchor);

  for (const pattern of DATE_ONLY) {
    const match = pattern.exec(text);
    if (match)
      return parseKstClock(clockOf([match[1], match[2], match[3], `${ASSUMED_HOUR_KST}`]), true);
  }

  for (const pattern of LOCAL_DATE_TIME) {
    const match = pattern.exec(text);
    if (match) return parseKstClock(clockOf(match.slice(1)), false);
  }

  const withOffset = OFFSET_DATE_TIME.exec(text);
  return withOffset ? parseOffsetDateTime(withOffset) : failure();
}
