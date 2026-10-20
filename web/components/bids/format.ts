// 스펙 §3.4. 금액·마감·시각·숫자 서식. 서버 모듈을 부르지 않는다(클라이언트 부품에서도 쓴다).

const EMPTY = "—";
const TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

const krwFull = new Intl.NumberFormat("ko-KR");
const krwCompact = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const kstParts = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseKrw(v: string | null): bigint | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  return BigInt(v);
}

export function formatKrwFull(v: string | null): string {
  const n = parseKrw(v);
  return n === null ? EMPTY : `${krwFull.format(n)}원`;
}

export function formatKrwCompact(v: string | null): { text: string; full: string } {
  const n = parseKrw(v);
  if (n === null) return { text: EMPTY, full: "미공개" };
  return { text: krwCompact.format(n), full: `${krwFull.format(n)}원` };
}

function kstFields(date: Date): Record<string, string> | null {
  if (Number.isNaN(date.getTime())) return null;
  const fields: Record<string, string> = {};
  for (const part of kstParts.formatToParts(date)) fields[part.type] = part.value;
  return fields;
}

// 서울 날짜(자정 기준)를 UTC 자정 ms 로 바꾼다. 두 날짜의 차가 일수다.
function seoulDayNumber(date: Date): number | null {
  const f = kstFields(date);
  if (!f) return null;
  return Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day));
}

export function dDay(
  deadlineAt: string | null,
  now: Date,
): { label: string; past: boolean } | null {
  if (deadlineAt === null) return null;
  const deadline = new Date(deadlineAt);
  const a = seoulDayNumber(deadline);
  const b = seoulDayNumber(now);
  if (a === null || b === null) return null;
  if (deadline.getTime() < now.getTime()) return { label: "마감", past: true };
  const days = Math.round((a - b) / DAY_MS);
  return { label: days === 0 ? "D-Day" : `D-${days}`, past: false };
}

export function formatKst(iso: string): string {
  const f = kstFields(new Date(iso));
  if (!f) return EMPTY;
  return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}`;
}

const kstShort = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  month: "numeric",
  day: "numeric",
});

// 표 칸용 짧은 날짜 `11. 6.`(서울 날짜).
export function formatKstShort(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? EMPTY : kstShort.format(at);
}

export function formatRelative(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return EMPTY;
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return formatKst(iso);
}

export function formatPoints(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : EMPTY;
}

export function formatPercent(p: number): string {
  return Number.isFinite(p) ? `${Math.round(p * 100)}%` : EMPTY;
}

export function formatSignal(p: number): string {
  return Number.isFinite(p) ? p.toFixed(2) : EMPTY;
}

// Kev 적합도 wire 값(0~4)을 표시 n/5(1~5)로 바꾼다. 08 §5.3: floor + 1, 범위 밖은 자른다.
export function fitOutOfFive(score: number): number {
  if (!Number.isFinite(score)) return 1;
  return Math.min(5, Math.max(1, Math.floor(score) + 1));
}
