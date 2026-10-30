import type { CalendarEvent } from "@/server/calendar";
import { KIND_LABELS } from "./calendar-copy";

// ── 일정 내보내기 글자: 구글 캘린더 일정 만들기 링크와 .ics(RFC 5545) ──
// 화면(calendar-view)과 Route Handler(/api/v1/calendar/ics)가 같이 쓴다. 화면 부품이 부르므로 서버 모듈을 값으로 부르지 않는다.
// OAuth·Google API 를 쓰지 않는다. 링크는 사용자가 눌러 자기 캘린더에 직접 저장하고, .ics 는 내려받아 가져오기로 넣는다.

// 원본 일정은 시각 하나뿐이라 길이를 30분으로 잡는다(캘린더 앱이 0분 일정을 잘 보이지 않는다).
export const EVENT_DURATION_MS = 30 * 60 * 1000;

const GOOGLE_TEMPLATE_URL = "https://calendar.google.com/calendar/render";
const ICS_LINE_OCTETS = 75;
const CRLF = "\r\n";

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

/** 캘린더 일정 제목. 취소 공고는 앞에 표시한다. */
export const exportSummaryOf = (event: CalendarEvent): string =>
  `${event.bid.cancelled ? "(공고 취소) " : ""}[${KIND_LABELS[event.kind]}] ${event.bid.title}`;

/**
 * 캘린더 일정 설명. 줄마다 기관·장소(있을 때)·SOL RADAR 주소(알 때)다.
 * 프로젝트 담당자 이름은 싣지 않는다. 링크·.ics 로 구글 등 바깥에 나가므로 일정에 꼭 필요한 정보만 둔다(최소 정보).
 */
export const exportDescriptionOf = (event: CalendarEvent, siteOrigin: string | null): string => {
  const siteUrl = siteUrlOf(event, siteOrigin);
  return [
    `기관: ${event.bid.agency ?? "기관 미정"}`,
    event.place === null ? null : `장소: ${event.place}`,
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
  if (event.place !== null) params.set("location", event.place);
  return `${GOOGLE_TEMPLATE_URL}?${params}`;
};

// RFC 5545 TEXT: 역슬래시를 먼저, 그다음 ; , 와 줄바꿈을 이스케이프한다(캘린더 앱이 칸을 잘못 나누지 않게).
const escapeText = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");

const encoder = new TextEncoder();
const octetsOf = (text: string) => encoder.encode(text).length;

// 75옥텟을 넘는 줄은 글자(코드 포인트) 경계에서 끊고, 이어진 줄은 공백 한 칸으로 시작한다(공백 포함 75옥텟 이하).
// 바이트로 자르면 한글(3바이트)·이모지(4바이트) 가운데가 잘려 깨진다.
function foldLine(line: string): string[] {
  if (octetsOf(line) <= ICS_LINE_OCTETS) return [line];
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  for (const char of Array.from(line)) {
    const charOctets = octetsOf(char);
    if (currentOctets + charOctets > ICS_LINE_OCTETS) {
      parts.push(current);
      current = " ";
      currentOctets = 1;
    }
    current += char;
    currentOctets += charOctets;
  }
  return [...parts, current];
}

function veventLines(event: CalendarEvent, siteOrigin: string | null, dtstamp: string): string[] {
  const { start, end } = startEndOf(event);
  const siteUrl = siteUrlOf(event, siteOrigin);
  return [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.key)}@sol-radar`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(exportSummaryOf(event))}`,
    `DESCRIPTION:${escapeText(exportDescriptionOf(event, siteOrigin))}`,
    ...(event.place === null ? [] : [`LOCATION:${escapeText(event.place)}`]),
    // URL 은 URI 값이라 TEXT 이스케이프를 하지 않는다.
    ...(siteUrl === null ? [] : [`URL:${siteUrl}`]),
    "END:VEVENT",
  ];
}

/**
 * 일정 목록 → .ics 본문. 줄 끝은 CRLF(마지막 줄도), 긴 줄은 접는다.
 * now 는 DTSTAMP(파일을 만든 시각, ISO), name 은 캘린더 앱이 보일 달력 이름이다.
 */
export function icsCalendar(
  events: readonly CalendarEvent[],
  { siteOrigin, now, name }: { siteOrigin: string | null; now: string; name: string },
): string {
  const dtstamp = utcStamp(Date.parse(now));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SOL RADAR//입찰 일정//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Asia/Seoul",
    ...events.flatMap((event) => veventLines(event, siteOrigin, dtstamp)),
    "END:VCALENDAR",
  ];
  return lines.flatMap(foldLine).join(CRLF) + CRLF;
}

// 로컬 개발 주소는 TLS 가 없다. 그 밖의 호스트는 https 로 본다(운영은 Vercel 이 x-forwarded-proto 를 준다).
const isLocalHost = (host: string) => host.startsWith("localhost") || host.startsWith("127.0.0.1");

/** 요청 헤더의 사이트 주소(구글 일정 설명에 SOL RADAR 링크를 싣는다). 호스트를 모르면 null 이다. */
export function siteOriginOf(headers: { get(name: string): string | null }): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host === null || host === "") return null;
  const protocol = headers.get("x-forwarded-proto") ?? (isLocalHost(host) ? "http" : "https");
  return `${protocol}://${host}`;
}
