// 부처 공고의 날짜·마감 표기(디자인 스펙 §3.3). 서버 모듈을 부르지 않는다(클라이언트 부품에서도 쓴다).
// 신청 기간은 시각 없는 서울 날짜(YYYY-MM-DD)다. 나라장터의 dDay(시각 비교)에 넘기면 UTC 자정(서울 09:00)부터
// "마감"으로 보여 목록 거르기(서울 날짜 비교)와 어긋난다. 그래서 날짜 차이로 센다. "오늘"은 서버가 목록을 거른 값을 받는다.
import { NO_PERIOD } from "./programs-copy";

const EMPTY = "—";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const kstParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD → 그날의 UTC 자정 ms. 날짜가 아니면 null. */
function dayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = Date.UTC(year, month - 1, day);
  const back = new Date(value);
  // 2026-13-01·2026-02-30 같은 날짜는 Date.UTC 가 다음 달로 넘긴다. 되돌려 보아 다르면 날짜가 아니다.
  return back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? value : null;
}

/** ISO 시각 → 서울 날짜 YYYY-MM-DD. 없거나 시각이 아니면 —. */
export function kstDate(iso: string | null): string {
  if (iso === null) return EMPTY;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return EMPTY;
  const parts = Object.fromEntries(
    kstParts.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type Deadline = {
  /** 표 칸 1줄: D-n · D-Day · 마감 */
  label: string;
  past: boolean;
  /** 화면 낭독 글자(보이는 D-n 은 숨긴다) */
  srText: string;
  /** 표 칸 2줄: `10. 31.` */
  short: string;
};

/** 신청 마감(YYYY-MM-DD)과 서울 오늘 → 표기. 마감이 없거나 날짜가 아니면 null(기간 미표기). */
export function deadlineOf(applyEndOn: string | null, today: string): Deadline | null {
  if (applyEndOn === null) return null;
  const end = dayNumber(applyEndOn);
  const now = dayNumber(today);
  if (end === null || now === null) return null;
  const days = Math.round((end - now) / DAY_MS);
  const endDate = new Date(end);
  // 표 칸의 짧은 날짜는 formatKstShort 와 같은 모양(월·일 숫자, 점 뒤 한 칸)이다.
  const short = `${endDate.getUTCMonth() + 1}. ${endDate.getUTCDate()}.`;
  if (days < 0) return { label: "마감", past: true, srText: "마감 지남", short };
  if (days === 0) return { label: "D-Day", past: false, srText: "오늘 마감", short };
  return { label: `D-${days}`, past: false, srText: `${days}일 남음`, short };
}

/** 서랍의 신청 기간 한 줄. */
export function periodText(
  applyStartOn: string | null,
  applyEndOn: string | null,
  today: string,
): string {
  const deadline = deadlineOf(applyEndOn, today);
  if (applyEndOn === null || deadline === null)
    return applyStartOn === null ? NO_PERIOD : `${applyStartOn} ~ 미표기`;
  const range = applyStartOn === null ? `~ ${applyEndOn}` : `${applyStartOn} ~ ${applyEndOn}`;
  return `${range} (${deadline.label})`;
}
