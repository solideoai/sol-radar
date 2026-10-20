// 수집 화면의 시각·걸린 시간·건수 서식(N8 스펙 §3.4). 분 단위 시각은 components/bids/format.ts 의 formatKst 를 쓰고,
// 여기에는 이 화면만 쓰는 초 단위 시각·시:분·걸린 시간·건수만 둔다. 서버 모듈을 부르지 않는다(클라이언트 부품에서도 쓴다).

const EMPTY = "—";
const TIME_ZONE = "Asia/Seoul";
const COMPACT_FROM = 100_000;

const kstSecondParts = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const countFull = new Intl.NumberFormat("ko-KR");
const countCompact = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function kstFields(iso: string): Record<string, string> | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return Object.fromEntries(
    kstSecondParts.formatToParts(at).map((part) => [part.type, part.value]),
  );
}

/** 서랍의 시각 `2026-10-20 14:03:05`(서울). */
export function formatKstSeconds(iso: string): string {
  const f = kstFields(iso);
  return f === null ? EMPTY : `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}:${f.second}`;
}

/** 상태 줄의 `14:03`(서울). */
export function formatKstClock(iso: string): string {
  const f = kstFields(iso);
  return f === null ? EMPTY : `${f.hour}:${f.minute}`;
}

/** 걸린 시간 `12초`·`3분 4초`·`1시간 2분`. 끝나지 않았거나 시각이 틀리면 null 이다. */
export function formatDuration(startedAt: string, finishedAt: string | null): string | null {
  if (finishedAt === null) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}분` : `${minutes}분 ${seconds % 60}초`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`;
}

/** 표·제목의 run id 앞 8자리. 서랍 아래에는 전체를 보인다. */
export const shortRunId = (id: string): string => id.slice(0, 8);

/**
 * 건수. 72px 숫자 칸에 6자리 이상이 들어가지 않아 100,000 이상은 `12.3만`으로 줄이고 full 에 전체 수를 둔다(§9).
 * full 은 title·스크린 리더용이다.
 */
export function formatCount(count: number): { text: string; full: string } {
  const full = countFull.format(count);
  return { text: count >= COMPACT_FROM ? countCompact.format(count) : full, full };
}
