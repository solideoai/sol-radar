import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CalendarDay, CalendarEvent, CalendarEventKind } from "@/server/calendar";
import {
  KIND_ORDER,
  MORE_MENU_MAX,
  moreMenuOverflow,
  UPCOMING_MAX,
  UPCOMING_VISIBLE,
  upcomingMore,
  upcomingOverflow,
} from "./calendar-copy";
import { BidCalendar, capUpcoming, MAX_CHIPS, type CalendarLinks } from "./calendar-view";

// 입찰 일정 화면 하나를 진짜 Chromium 에 그린다(데이터는 가짜). 일정 모으기 규칙은 calendar.model.test.ts 가 맡는다.
// 사이드바(256px)를 편 업무 틀과 같은 본문 폭에서 1440·1280 두 폭의 넘침을 재고 증거 스크린샷을 남긴다.

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const NOW = "2026-10-28T05:00:00.000Z"; // KST 10-28(수) 14:00
const TODAY = "2026-10-28";

// 2026년 10월: 월요일 9/28 부터 일요일 11/1 까지 5주
const WEEKS: CalendarDay[][] = Array.from({ length: 5 }, (_, week) =>
  Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(Date.UTC(2026, 8, 28 + week * 7 + weekday));
    return {
      date: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === 9,
    };
  }),
);

const event = (
  key: string,
  at: string,
  date: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  key,
  kind: "BID_DEADLINE",
  at,
  date,
  bid: {
    id: key,
    title: `${key} 차세대 정보시스템 구축 사업`,
    agency: "조달청",
    isDemo: false,
    cancelled: false,
  },
  watched: true,
  project: null,
  dueOverridden: false,
  place: null,
  href: `/bids/${key}?origin=live`,
  ...extra,
});

const PROJECT = { id: "p1", status: "PREPARING" as const, ownerName: "김소유", isMine: true };
const BUSY_DAY = "2026-10-30";
const EVENTS: Record<string, CalendarEvent[]> = {
  [TODAY]: [
    event("today", "2026-10-28T06:00:00.000Z", TODAY, {
      kind: "SUBMISSION_DUE",
      project: PROJECT,
      href: "/projects/p1",
    }),
  ],
  [BUSY_DAY]: [
    event("busy-1", "2026-10-30T00:00:00.000Z", BUSY_DAY, {
      bid: {
        id: "busy-1",
        title: "스마트 물관리 디지털트윈 플랫폼 고도화 (가상)",
        agency: "한국수자원공사",
        isDemo: true,
        cancelled: false,
      },
      href: "/bids/busy-1?origin=demo",
    }),
    event("busy-2", "2026-10-30T01:00:00.000Z", BUSY_DAY),
    event("busy-3", "2026-10-30T02:00:00.000Z", BUSY_DAY, { watched: false, project: PROJECT }),
    event("busy-4", "2026-10-30T08:00:00.000Z", BUSY_DAY),
  ],
};
const UPCOMING = [...(EVENTS[TODAY] ?? []), ...(EVENTS[BUSY_DAY] ?? [])];
const LINKS: CalendarLinks = {
  prev: "/calendar?month=2026-09",
  next: "/calendar?month=2026-11",
  today: "/calendar",
  views: { org: "/calendar?month=2026-10", mine: "/calendar?month=2026-10&view=mine" },
  kinds: Object.fromEntries(
    KIND_ORDER.map((kind) => [kind, `/calendar?month=2026-10&kinds=${kind}`]),
  ) as Record<CalendarEventKind, string>,
  allKinds: null,
};

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
});

type Props = React.ComponentProps<typeof BidCalendar>;

function show(overrides: Partial<Props> = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  flushSync(() =>
    root.render(
      // 펼친 사이드바(256px) 자리를 비워 업무 틀과 같은 본문 폭에서 그린다.
      <div className="flex min-h-svh">
        <div aria-hidden className="w-64 shrink-0 border-r border-border" />
        <div className="flex min-w-0 flex-1 flex-col">
          <BidCalendar
            monthLabel="2026년 10월"
            weeks={WEEKS}
            eventsByDate={EVENTS}
            upcoming={UPCOMING}
            upcomingHidden={0}
            today={TODAY}
            now={NOW}
            view="org"
            links={LINKS}
            kinds={KIND_ORDER}
            kindsFiltered={false}
            hasAnyEvents
            relevantFailed={false}
            {...overrides}
          />
        </div>
      </div>,
    ),
  );
}

describe("입찰 일정 화면", () => {
  for (const width of [1440, 1280]) {
    it(`${width}px: 달력·겹침·더 보기·다가오는 14일을 그리고 가로로 넘치지 않는다`, async () => {
      // 1280px 는 다가오는 14일이 달력 아래로 내려가 화면이 길다. 사진에 다 담기게 높이를 잡는다.
      await page.viewport(width, width === 1280 ? 1500 : 1000);
      show();

      const calendar = page.getByRole("table", { name: "월간 입찰 일정 2026년 10월" });
      await expect.element(calendar).toBeVisible();
      await expect.element(calendar.getByRole("columnheader")).toHaveLength(7);
      expect(document.querySelector('td[aria-current="date"]')?.textContent).toContain("오늘");

      // 칩의 이름은 종류·시각·관심·DEMO 를 글자로 싣는다(색만으로 알리지 않는다).
      await expect
        .element(calendar.getByRole("link", { name: /^제출 마감 15:00 today/ }))
        .toHaveAttribute("href", "/projects/p1");
      const demoChip = calendar.getByRole("link", { name: /스마트 물관리.*내 관심 DEMO$/ });
      await expect.element(demoChip).toHaveAttribute("href", "/bids/busy-1?origin=demo");
      // DEMO 는 칩에 글자로도 보인다(색·아이콘만으로 알리지 않는다). DEMO 가 아닌 칩에는 없다.
      await expect.element(demoChip.getByText("DEMO", { exact: true })).toBeVisible();
      await expect
        .element(
          calendar
            .getByRole("link", { name: /^공고 마감 10:00 busy-2/ })
            .getByText("DEMO", { exact: true }),
        )
        .not.toBeInTheDocument();
      // 제목 줄은 칩 폭을 다 쓴다(아이콘·표시 옆에 끼어 서너 글자만 남지 않게).
      const chipWidth = demoChip.element().clientWidth;
      const titleWidth = demoChip
        .getByText("스마트 물관리 디지털트윈 플랫폼 고도화 (가상)")
        .element()
        .getBoundingClientRect().width;
      expect(titleWidth).toBeGreaterThanOrEqual(chipWidth - 12);

      // 메뉴를 열기 전에 찍는다(닫히는 메뉴가 사진에 남지 않게). 앞 시험의 마우스 자리에 걸린 링크 hover 도 치운다.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await userEvent.hover(page.getByRole("heading", { level: 1 }));
      await page.screenshot({
        path: `../../../../test-results/vitest-screenshots/calendar-${width}.png`,
      });

      // 4건인 날은 겹침 건수를 보이고 칩 둘 뒤 나머지는 메뉴로 연다.
      await expect.element(calendar.getByText("4건")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: /\+2건 더/ }));
      await expect
        .element(page.getByRole("menuitem", { name: /busy-3/ }))
        .toHaveAttribute("href", "/bids/busy-3?origin=live");
      const busy4 = page.getByRole("menuitem", { name: /busy-4/ });
      await expect.element(busy4).toHaveAttribute("href", "/bids/busy-4?origin=live");
      // 날짜는 메뉴 머리에만 있다. 항목은 시각·제목만 보여 제목이 날짜에 밀려 잘리지 않는다.
      await expect.element(busy4.getByText("busy-4 차세대 정보시스템 구축 사업")).toBeVisible();
      expect(busy4.element().textContent).not.toContain("2026-10-30");
      expect(busy4.element().textContent).toContain("17:00 공고 마감");
      await page.screenshot({
        path: `../../../../test-results/vitest-screenshots/calendar-${width}-more-menu.png`,
      });
      await userEvent.keyboard("{Escape}");

      const upcoming = page.getByRole("region", { name: "다가오는 14일" });
      await expect.element(upcoming.getByText("D-Day")).toBeVisible();
      await expect.element(upcoming.getByText("D-2").first()).toBeVisible();
    });
  }

  it("원본 일정 종류: 칩 글자는 짧은 이름, 접근 이름·title·다가오는 목록은 정식 이름과 현장설명회 장소", async () => {
    // 칩에 종류 이름이 보이는 폭(사이드바를 편 1280px)에서 본다.
    await page.viewport(1280, 1000);
    const day = "2026-10-29";
    const site = event("site", "2026-10-29T01:00:00.000Z", day, {
      kind: "SITE_BRIEFING",
      watched: false,
      place: "조달청 본관 3층 회의실",
    });
    const begin = event("begin", "2026-10-29T09:00:00.000Z", day, {
      kind: "BID_BEGIN",
      watched: false,
    });
    const opening = event("opening", "2026-10-31T02:00:00.000Z", "2026-10-31", {
      kind: "OPENING",
      watched: false,
    });
    show({
      eventsByDate: { [day]: [site, begin], "2026-10-31": [opening] },
      upcoming: [site, begin, opening],
    });

    const calendar = page.getByRole("table", { name: "월간 입찰 일정 2026년 10월" });
    const siteChip = calendar.getByRole("link", {
      name: "현장설명회 10:00 장소 조달청 본관 3층 회의실 site 차세대 정보시스템 구축 사업",
    });
    await expect.element(siteChip).toHaveAttribute("href", "/bids/site?origin=live");
    await expect
      .element(siteChip)
      .toHaveAttribute(
        "title",
        "현장설명회 2026-10-29 10:00 · 장소 조달청 본관 3층 회의실 · site 차세대 정보시스템 구축 사업",
      );
    // 칩 글자는 짧은 이름(제출 시작), 접근 이름은 정식 이름(입찰서 제출 시작)이다.
    const beginChip = calendar.getByRole("link", { name: /^입찰서 제출 시작 18:00 begin/ });
    await expect.element(beginChip.getByText("제출 시작", { exact: true })).toBeVisible();
    await expect.element(calendar.getByRole("link", { name: /^개찰 11:00 opening/ })).toBeVisible();

    const upcoming = page.getByRole("region", { name: "다가오는 14일" });
    await expect
      .element(upcoming.getByText("현장설명회 · 2026-10-29 10:00 · 장소 조달청 본관 3층 회의실"))
      .toBeVisible();
    await expect.element(upcoming.getByText("입찰서 제출 시작 · 2026-10-29 18:00")).toBeVisible();
  });

  it("종류 거르기: 칩은 켜짐·꺼짐을 글자로 알리고, 고른 종류가 이 달에 0건이면 전체 보기로 돌아간다", async () => {
    await page.viewport(1440, 1000);
    const allKinds = "/calendar?month=2026-10";
    show({
      eventsByDate: {},
      upcoming: [],
      kinds: ["SITE_BRIEFING", "OPENING"],
      kindsFiltered: true,
      links: { ...LINKS, allKinds },
    });

    const filter = page.getByRole("navigation", { name: "일정 종류" });
    await expect
      .element(filter.getByRole("link", { name: "현장설명회 보는 중" }))
      .toHaveAttribute("href", LINKS.kinds.SITE_BRIEFING);
    await expect
      .element(filter.getByRole("link", { name: "제출 시작 숨김" }))
      .toHaveAttribute("href", LINKS.kinds.BID_BEGIN);
    await expect
      .element(filter.getByRole("link", { name: "전체 보기" }))
      .toHaveAttribute("href", allKinds);
    // 종류는 거르기 칩이 보인다. 표시 설명에는 종류가 아닌 표시만 남는다.
    const legend = page.getByRole("list", { name: "표시 설명" });
    await expect.element(legend.getByText("내 관심")).toBeVisible();
    expect(legend.element().textContent).not.toContain("공고 마감");

    // 거른 결과가 0건이면 빈 달 문구 대신 거르기 문구와 전체 보기 링크다(거르기 전에는 일정이 있다).
    const month = page.getByRole("region", { name: "2026년 10월 달력" });
    await expect.element(month.getByText("이 달에는 고른 종류의 일정이 없습니다.")).toBeVisible();
    await expect
      .element(month.getByRole("link", { name: "전체 보기" }))
      .toHaveAttribute("href", allKinds);
    await expect.element(month.getByText("이 달에는 일정이 없습니다.")).not.toBeInTheDocument();
    await expect.element(page.getByText("아직 일정이 없습니다")).not.toBeInTheDocument();
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/calendar-1440-kinds-empty.png",
    });
  });

  it("종류 거르기 전에도 일정이 없으면 기존 빈 상태를 쓴다", async () => {
    await page.viewport(1440, 1000);
    show({
      eventsByDate: {},
      upcoming: [],
      kinds: ["OPENING"],
      kindsFiltered: true,
      hasAnyEvents: false,
      links: { ...LINKS, allKinds: "/calendar?month=2026-10" },
    });

    await expect.element(page.getByText("아직 일정이 없습니다")).toBeVisible();
    await expect
      .element(page.getByText("이 달에는 고른 종류의 일정이 없습니다."))
      .not.toBeInTheDocument();
  });

  const upcomingMany = (total: number) =>
    Array.from({ length: total }, (_, index) =>
      event(`up-${index + 1}`, `2026-11-0${1 + (index % 9)}T01:00:00.000Z`, "2026-11-01", {
        watched: false,
      }),
    );

  it("다가오는 14일은 앞 UPCOMING_VISIBLE 건만 보이고 나머지는 펼쳐 본다", async () => {
    await page.viewport(1440, 1000);
    const total = 23;
    show(capUpcoming(upcomingMany(total)));

    const upcoming = page.getByRole("region", { name: "다가오는 14일" });
    await expect.element(upcoming.getByRole("listitem")).toHaveLength(UPCOMING_VISIBLE);
    await userEvent.click(upcoming.getByText(upcomingMore(total - UPCOMING_VISIBLE)));
    await expect.element(upcoming.getByRole("listitem")).toHaveLength(total);
    // 접힌 목록은 앞 목록 다음 번호부터 센다.
    expect(upcoming.element().querySelector("details ol")?.getAttribute("start")).toBe(
      String(UPCOMING_VISIBLE + 1),
    );
    await expect
      .element(upcoming.getByRole("link", { name: /^up-23 / }))
      .toHaveAttribute("href", "/bids/up-23?origin=live");
    // 상한 안이면 넘친 건수 줄이 없다.
    expect(upcoming.element().textContent).not.toContain("그 밖에");
  });

  it("다가오는 14일은 UPCOMING_MAX 건까지만 그리고, 넘친 건수는 글자 한 줄로 알린다", async () => {
    await page.viewport(1440, 1000);
    const total = UPCOMING_MAX + 10;
    const capped = capUpcoming(upcomingMany(total));
    // page 는 상한 너머의 일정을 넘기지 않는다(건수만 넘긴다).
    expect(capped.upcoming).toHaveLength(UPCOMING_MAX);
    show(capped);

    const upcoming = page.getByRole("region", { name: "다가오는 14일" });
    await expect.element(upcoming.getByRole("listitem")).toHaveLength(UPCOMING_VISIBLE);
    await userEvent.click(upcoming.getByText(upcomingMore(UPCOMING_MAX - UPCOMING_VISIBLE)));
    await expect.element(upcoming.getByRole("listitem")).toHaveLength(UPCOMING_MAX);
    await expect.element(upcoming.getByText(upcomingOverflow(total - UPCOMING_MAX))).toBeVisible();
  });

  it("칸의 더 보기 메뉴는 MORE_MENU_MAX 건까지만 그리고, 칸 머리의 건수는 전체다", async () => {
    await page.viewport(1440, 1000);
    const day = "2026-10-29";
    const total = MAX_CHIPS + MORE_MENU_MAX + 5;
    const crowded = Array.from({ length: total }, (_, index) =>
      event(
        `crowd-${String(index + 1).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 9, 29, 0, index)).toISOString(),
        day,
        { watched: false },
      ),
    );
    show({ eventsByDate: { [day]: crowded }, upcoming: [] });

    const calendar = page.getByRole("table", { name: "월간 입찰 일정 2026년 10월" });
    await expect.element(calendar.getByText(`${total}건`)).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: new RegExp(`^\\+${total - MAX_CHIPS}건 더`) }),
    );
    await expect.element(page.getByRole("menuitem")).toHaveLength(MORE_MENU_MAX);
    await expect
      .element(page.getByText(moreMenuOverflow(total - MAX_CHIPS - MORE_MENU_MAX)))
      .toBeVisible();
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/calendar-1440-more-menu-cap.png",
    });
    await userEvent.keyboard("{Escape}");
  });

  it("관련 업종 공고를 읽지 못하면 출처 줄 아래에 아이콘과 글자로 알린다", async () => {
    await page.viewport(1440, 1000);
    show({ relevantFailed: true });

    const notice = page.getByRole("status");
    await expect
      .element(notice)
      .toHaveTextContent(
        "관련 업종 공고 일정을 불러오지 못했습니다. 관심·프로젝트 일정만 보입니다.",
      );
    expect(notice.element().querySelector("svg")).not.toBeNull();
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/calendar-1440-relevant-failed.png",
    });
    // 관심·프로젝트 일정은 그대로 그린다.
    await expect
      .element(page.getByRole("link", { name: /^제출 마감 15:00 today/ }))
      .toHaveAttribute("href", "/projects/p1");
  });
});
