import "server-only";

// ── 부처 공고 날짜: 원문 시각은 KST 다. 신청기간은 날짜(YYYY-MM-DD)로, 등록일은 UTC ISO 로 둔다 ──
// 못 읽는 값(상시·예산 소진시까지·빈 값)은 null 이다. 행을 버리지 않고 화면이 "기간 미표기"로 보인다(스펙 §9).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_PART = /^(\d{4})[-.]?(\d{2})[-.]?(\d{2})$/;
const COMPACT_DATE_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const DASHED_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DASHED_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

function isRealWall({ year, month, day, hour, minute, second }: Wall): boolean {
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

// 날짜만 읽힌 경우 시·분·초 칸이 없으므로 빈 칸은 0 으로 채운다.
const wallOf = (parts: readonly (string | undefined)[]): Wall => {
  const at = (index: number): number => Number(parts[index] ?? "0");
  return { year: at(0), month: at(1), day: at(2), hour: at(3), minute: at(4), second: at(5) };
};

function dateOnly(raw: string): string | null {
  const match = DATE_PART.exec(raw.trim());
  if (match === null) return null;
  const wall = wallOf([match[1], match[2], match[3]]);
  return isRealWall(wall) ? `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` : null;
}

/** "YYYYMMDD ~ YYYYMMDD"(구분자 - . 허용). 한쪽만 읽히면 그쪽만, 물결표가 없거나 못 읽으면 둘 다 null. */
export function parseApplyPeriod(raw: unknown): { startOn: string | null; endOn: string | null } {
  if (typeof raw !== "string" || !raw.includes("~")) return { startOn: null, endOn: null };
  const [start = "", end = ""] = raw.split("~");
  return { startOn: dateOnly(start), endOn: dateOnly(end) };
}

/** KST 원문 시각 → UTC ISO. YYYYMMDDHHMMSS·YYYY-MM-DD HH:MM(:SS)·YYYY-MM-DD(자정). 못 읽으면 null. */
export function parseKstDateTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const match =
    COMPACT_DATE_TIME.exec(text) ?? DASHED_DATE_TIME.exec(text) ?? DASHED_DATE.exec(text);
  if (match === null) return null;
  const wall = wallOf(match.slice(1));
  if (!isRealWall(wall)) return null;
  const utcMs =
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
    KST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/** 마감 판정의 "오늘"(KST 날짜, YYYY-MM-DD). */
export const kstToday = (now: Date): string =>
  new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
