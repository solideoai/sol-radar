import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CalendarDay, CalendarEvent } from "@/server/calendar";
import { BidCalendar, type CalendarLinks } from "./calendar-view";

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
};

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
});

function show() {
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
            today={TODAY}
            now={NOW}
            view="org"
            links={LINKS}
            hasAnyEvents
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
      await page.screenshot({
        path: `../../../../test-results/vitest-screenshots/calendar-${width}-more-menu.png`,
      });
      await userEvent.keyboard("{Escape}");

      const upcoming = page.getByRole("region", { name: "다가오는 14일" });
      await expect.element(upcoming.getByText("D-Day")).toBeVisible();
      await expect.element(upcoming.getByText("D-2").first()).toBeVisible();
    });
  }
});
