import type { CalendarEvent } from "@/server/calendar";
import { KIND_LABELS } from "./calendar-copy";

// ── 일정 내보내기 글자: 구글 캘린더 일정 만들기 링크와 일정 제목·설명 ──
// 화면(calendar-view)의 일정별 "구글 캘린더에 추가" 링크와 구글 캘린더 연동(POST /api/v1/calendar/google/sync, ADR-073)이
// 같은 글자를 쓴다. 화면 부품이 부르므로 서버 모듈을 값으로 부르지 않는다. 링크는 OAuth 없이 사용자가 직접 저장한다.

// 원본 일정은 시각 하나뿐이라 길이를 30분으로 잡는다(캘린더 앱이 0분 일정을 잘 보이지 않는다).
export const EVENT_DURATION_MS = 30 * 60 * 1000;

const GOOGLE_TEMPLATE_URL = "https://calendar.google.com/calendar/render";

// "2026-11-03T01:00:00.000Z" → "20261103T010000Z"(UTC). 원래 일정은 KST 지만 UTC 로 실어 받는 쪽 시간대가 바꿔 보인다.
const utcStamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(/[-:]/g, "");

const startEndOf = (event: CalendarEvent) => {
  const start = Date.parse(event.at);
  return { start: utcStamp(start), end: utcStamp(start + EVENT_DURATION_MS) };
};

const siteUrlOf = (event: CalendarEvent, siteOrigin: string | null) =>
  siteOrigin === null ? null : `${siteOrigin}${event.href}`;

/** 가상(데모) 공고의 설명 첫 줄. 구글 캘린더로 나간 뒤에도 실제 공고로 오해하지 않게 한다. */
export const DEMO_DESCRIPTION_LINE = "가상 데이터(DEMO)";

/**
 * 수집한 글자(공고명·기관명·장소)에서 꺾쇠(<·>)를 뺀다. 구글 캘린더는 설명의 HTML 일부를 서식으로 그리므로
 * 공고 원문의 태그 모양 글자가 링크·서식으로 바뀌지 않게 한다. 링크와 연동이 같이 쓴다.
 */
const exportTextOf = (value: string): string => value.replaceAll(/[<>]/g, "");

/** 캘린더 일정 장소. 꺾쇠를 뺀 값이고, 없거나 비면 null 이다. */
export const exportPlaceOf = (event: CalendarEvent): string | null => {
  const place = event.place === null ? "" : exportTextOf(event.place).trim();
  return place === "" ? null : place;
};

/** 캘린더 일정 제목. 가상 공고는 맨 앞에 [DEMO], 취소 공고는 그 뒤에 (공고 취소)를 붙인다. */
export const exportSummaryOf = (event: CalendarEvent): string =>
  `${event.bid.isDemo ? "[DEMO] " : ""}${event.bid.cancelled ? "(공고 취소) " : ""}[${KIND_LABELS[event.kind]}] ${exportTextOf(event.bid.title)}`;

/**
 * 캘린더 일정 설명. 줄마다 가상 데이터 표시(가상 공고일 때)·기관·장소(있을 때)·SOL RADAR 주소(알 때)다.
 * 프로젝트 담당자 이름은 싣지 않는다. 링크·연동으로 구글에 나가므로 일정에 꼭 필요한 정보만 둔다(최소 정보).
 */
export const exportDescriptionOf = (event: CalendarEvent, siteOrigin: string | null): string => {
  const siteUrl = siteUrlOf(event, siteOrigin);
  const place = exportPlaceOf(event);
  return [
    event.bid.isDemo ? DEMO_DESCRIPTION_LINE : null,
    `기관: ${event.bid.agency === null ? "기관 미정" : exportTextOf(event.bid.agency)}`,
    place === null ? null : `장소: ${place}`,
    siteUrl === null ? null : `SOL RADAR: ${siteUrl}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
};

/** 구글 캘린더 "일정 만들기" 주소. 누르면 사용자의 구글 캘린더에 채워진 새 일정 화면이 열린다. */
export const googleCalendarUrl = (event: CalendarEvent, siteOrigin: string | null): string => {
  const { start, end } = startEndOf(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: exportSummaryOf(event),
    dates: `${start}/${end}`,
    details: exportDescriptionOf(event, siteOrigin),
  });
  const place = exportPlaceOf(event);
  if (place !== null) params.set("location", place);
  return `${GOOGLE_TEMPLATE_URL}?${params}`;
};

// 로컬 개발 주소는 TLS 가 없다. 그 밖의 호스트는 https 로 본다(운영은 Vercel 이 x-forwarded-proto 를 준다).
const isLocalHost = (host: string) => host.startsWith("localhost") || host.startsWith("127.0.0.1");

/** 요청 헤더의 사이트 주소(구글 일정 설명에 SOL RADAR 링크를 싣는다). 호스트를 모르면 null 이다. */
export function siteOriginOf(headers: { get(name: string): string | null }): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host === null || host === "") return null;
  const protocol = headers.get("x-forwarded-proto") ?? (isLocalHost(host) ? "http" : "https");
  return `${protocol}://${host}`;
}
