import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/server/calendar";
import {
  exportDescriptionOf,
  exportSummaryOf,
  googleCalendarUrl,
  icsCalendar,
  siteOriginOf,
} from "./calendar-export";

// 일정 내보내기 글자(구글 캘린더 링크·.ics). 화면과 Route Handler 가 같이 쓰는 순수 함수다.

const NOW = "2026-10-30T03:04:05.000Z";

type EventExtra = Partial<Omit<CalendarEvent, "bid">> & Partial<CalendarEvent["bid"]>;

const event = ({
  title = "가상 정보시스템 구축",
  agency = "조달청",
  isDemo = false,
  cancelled = false,
  ...extra
}: EventExtra = {}): CalendarEvent => ({
  key: "BID_DEADLINE:b1",
  kind: "BID_DEADLINE",
  at: "2026-11-03T01:00:00.000Z",
  date: "2026-11-03",
  bid: { id: "b1", title, agency, isDemo, cancelled },
  watched: false,
  project: null,
  dueOverridden: false,
  place: null,
  href: "/bids/b1?origin=live",
  ...extra,
});

describe("구글 캘린더 링크", () => {
  it("구글 링크는 TEMPLATE·UTC 30분·설명을 싣는다", () => {
    const url = new URL(
      googleCalendarUrl(event({ at: "2026-11-03T01:00:00.000Z" }), "https://sol.example"),
    );
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261103T010000Z/20261103T013000Z");
    expect(url.searchParams.get("text")).toBe("[공고 마감] 가상 정보시스템 구축");
    expect(url.searchParams.get("details")).toContain("SOL RADAR: https://sol.example/bids/");
    expect(url.searchParams.has("location")).toBe(false);
  });

  // 구성원 이름은 구글로 나가므로(최소 정보) 프로젝트 담당자가 있어도 싣지 않는다.
  it("장소가 있으면 location 을 싣고, 설명은 기관·장소·주소 줄이며 담당자 이름은 없다", () => {
    const site = event({
      kind: "SITE_BRIEFING",
      agency: null,
      place: "조달청 본관 3층",
      project: { id: "p1", status: "PREPARING", ownerName: "김담당", isMine: false },
    });
    const url = new URL(googleCalendarUrl(site, null));
    expect(url.searchParams.get("location")).toBe("조달청 본관 3층");
    expect(exportDescriptionOf(site, null)).toBe("기관: 기관 미정\n장소: 조달청 본관 3층");
    expect(url.toString()).not.toContain(encodeURIComponent("김담당"));
    expect(icsCalendar([site], { siteOrigin: null, now: NOW, name: "x" })).not.toContain("김담당");
    expect(exportDescriptionOf(event(), "https://sol.example")).toBe(
      "기관: 조달청\nSOL RADAR: https://sol.example/bids/b1?origin=live",
    );
  });
});

describe(".ics", () => {
  it(".ics 는 CRLF·필수 칸·이스케이프를 지킨다", () => {
    const text = icsCalendar([event({ title: "가상; 정보,시스템\\구축" })], {
      siteOrigin: null,
      now: NOW,
      name: "SOL RADAR 입찰 일정",
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("SUMMARY:[공고 마감] 가상\\; 정보\\,시스템\\\\구축");
    expect(text).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
    expect(text).not.toContain("URL:");
    // CRLF 가 아닌 줄바꿈은 없다.
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  it("일정마다 UID·시각·설명 줄바꿈 이스케이프·장소·주소를 싣는다", () => {
    const text = icsCalendar(
      [event({ kind: "SITE_BRIEFING", key: "SITE_BRIEFING:b1", place: "본관, 3층" })],
      { siteOrigin: "https://sol.example", now: NOW, name: "x" },
    );
    const lines = text.replaceAll("\r\n ", "").split("\r\n");
    expect(lines).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SOL RADAR//입찰 일정//KO",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:x",
      "X-WR-TIMEZONE:Asia/Seoul",
      "BEGIN:VEVENT",
      "UID:SITE_BRIEFING:b1@sol-radar",
      "DTSTAMP:20261030T030405Z",
      "DTSTART:20261103T010000Z",
      "DTEND:20261103T013000Z",
      "SUMMARY:[현장설명회] 가상 정보시스템 구축",
      "DESCRIPTION:기관: 조달청\\n장소: 본관\\, 3층\\nSOL RADAR: https://sol.example/bids/b1?origin=live",
      "LOCATION:본관\\, 3층",
      "URL:https://sol.example/bids/b1?origin=live",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("일정이 없어도 달력 머리와 끝은 있다", () => {
    const text = icsCalendar([], { siteOrigin: null, now: NOW, name: "x" });
    expect(text).not.toContain("BEGIN:VEVENT");
    expect(text.endsWith("X-WR-TIMEZONE:Asia/Seoul\r\nEND:VCALENDAR\r\n")).toBe(true);
  });

  it("긴 한글 줄은 75옥텟 이하로 글자 경계에서 접는다", () => {
    const text = icsCalendar([event({ title: "가".repeat(80) })], {
      siteOrigin: null,
      now: NOW,
      name: "x",
    });
    const lines = text.split("\r\n");
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    // 접은 줄을 이으면 원래 줄이다(글자 가운데를 자르지 않는다).
    expect(text.replaceAll("\r\n ", "")).toContain(`SUMMARY:[공고 마감] ${"가".repeat(80)}`);
    expect(text).not.toContain("�");
  });

  it("4바이트 글자(이모지)도 가운데를 자르지 않는다", () => {
    const title = "🚀".repeat(40);
    const text = icsCalendar([event({ title })], { siteOrigin: null, now: NOW, name: "x" });
    const lines = text.split("\r\n");
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    // 줄마다 UTF-8 로 그대로 오간다(UTF-16 짝 가운데를 자르면 깨진 글자가 된다).
    const roundTrip = (line: string) => new TextDecoder().decode(new TextEncoder().encode(line));
    expect(lines.every((line) => roundTrip(line) === line)).toBe(true);
    expect(text.replaceAll("\r\n ", "")).toContain(`SUMMARY:[공고 마감] ${title}`);
  });
});

describe("요약·주소", () => {
  it("취소 공고·장소·호스트 헤더", () => {
    expect(exportSummaryOf(event({ cancelled: true }))).toMatch(/^\(공고 취소\) \[/);
    expect(siteOriginOf(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(siteOriginOf(new Headers({ host: "127.0.0.1:3100" }))).toBe("http://127.0.0.1:3100");
    expect(siteOriginOf(new Headers({ host: "sol.example" }))).toBe("https://sol.example");
    expect(
      siteOriginOf(
        new Headers({ "x-forwarded-host": "sol.example", "x-forwarded-proto": "https", host: "x" }),
      ),
    ).toBe("https://sol.example");
    expect(siteOriginOf(new Headers())).toBeNull();
  });
});
