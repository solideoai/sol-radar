import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/server/calendar";
import {
  exportDescriptionOf,
  exportPlaceOf,
  exportSummaryOf,
  googleCalendarUrl,
  siteOriginOf,
} from "./calendar-export";

// 일정 내보내기 글자(구글 캘린더 링크·구글 캘린더 연동 본문). 화면과 Route Handler 가 같이 쓰는 순수 함수다.

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
  bid: { id: "b1", title, agency, isDemo, cancelled, field: null },
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
    expect(exportSummaryOf(site) + exportDescriptionOf(site, null)).not.toContain("김담당");
    expect(exportDescriptionOf(event(), "https://sol.example")).toBe(
      "기관: 조달청\nSOL RADAR: https://sol.example/bids/b1?origin=live",
    );
  });
});

describe("가상 공고 표시·꺾쇠", () => {
  // 보안 리뷰 A: 구글로 나간 가상 공고를 실제 공고로 오해하지 않게 한다. 링크와 연동이 같은 글자를 쓴다.
  it("가상 공고는 제목 맨 앞에 [DEMO], 설명 첫 줄에 가상 데이터(DEMO)를 붙인다", () => {
    const demo = event({ isDemo: true, cancelled: true, href: "/bids/b1?origin=demo" });
    expect(exportSummaryOf(demo)).toBe("[DEMO] (공고 취소) [공고 마감] 가상 정보시스템 구축");
    expect(exportDescriptionOf(demo, "https://sol.example")).toBe(
      "가상 데이터(DEMO)\n기관: 조달청\nSOL RADAR: https://sol.example/bids/b1?origin=demo",
    );
    const url = new URL(googleCalendarUrl(demo, null));
    expect(url.searchParams.get("text")).toMatch(/^\[DEMO\] /);
    expect(url.searchParams.get("details")?.split("\n")[0]).toBe("가상 데이터(DEMO)");
    expect(exportSummaryOf(event())).not.toContain("DEMO");
    expect(exportDescriptionOf(event(), null)).not.toContain("DEMO");
  });

  // 보안 리뷰 D: 구글 캘린더는 설명의 HTML 일부를 서식으로 그린다. 수집한 글자의 꺾쇠를 빼 태그로 읽히지 않게 한다.
  it("공고명·기관명·장소의 < > 를 빼고 제목·설명·장소·링크에 같이 적용한다", () => {
    const tagged = event({
      kind: "SITE_BRIEFING",
      title: '<a href="https://evil.example">긴급</a> 공고',
      agency: "<b>조달청</b>",
      place: "<script>본관</script>",
    });
    expect(exportSummaryOf(tagged)).toBe('[현장설명회] a href="https://evil.example"긴급/a 공고');
    expect(exportDescriptionOf(tagged, null)).toBe("기관: b조달청/b\n장소: script본관/script");
    expect(exportPlaceOf(tagged)).toBe("script본관/script");
    expect(exportPlaceOf(event({ place: "<>" }))).toBeNull();
    const url = new URL(googleCalendarUrl(tagged, null));
    for (const field of ["text", "details", "location"]) {
      expect(url.searchParams.get(field)).not.toMatch(/[<>]/);
    }
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
