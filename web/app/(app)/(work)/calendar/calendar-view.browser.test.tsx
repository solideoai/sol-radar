import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CalendarDay, CalendarEvent, CalendarEventKind } from "@/server/calendar";
import {
  GOOGLE_CONNECT_NOTICES,
  GOOGLE_SYNC_ERRORS,
  googleSynced,
  googleSyncedEmpty,
  KIND_ORDER,
  MORE_MENU_MAX,
  moreMenuOverflow,
  UPCOMING_MAX,
  UPCOMING_VISIBLE,
  upcomingMore,
  upcomingOverflow,
} from "./calendar-copy";
import { BidCalendar, capUpcoming, MAX_CHIPS, type CalendarLinks } from "./calendar-view";
import { syncResultOf, type GoogleCalendarToolbar } from "./google-connect";

// 입찰 일정 화면 하나를 진짜 Chromium 에 그린다(데이터는 가짜). 일정 모으기 규칙은 calendar.model.test.ts 가 맡는다.
// 사이드바(256px)를 편 업무 틀과 같은 본문 폭에서 1440·1280 두 폭의 넘침을 재고 증거 스크린샷을 남긴다.

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
// 구글 연동 툴바는 돌아온 결과(?google=)를 알린 뒤 주소에서 지운다(router.replace).
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
    field: null,
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
      bid: {
        id: "today",
        title: "today 차세대 정보시스템 구축 사업",
        agency: "조달청",
        isDemo: false,
        cancelled: false,
        field: "AI_AX",
      },
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
        field: "DIGITAL_TWIN",
      },
      href: "/bids/busy-1?origin=demo",
    }),
    event("busy-2", "2026-10-30T01:00:00.000Z", BUSY_DAY),
    event("busy-3", "2026-10-30T02:00:00.000Z", BUSY_DAY, {
      bid: {
        id: "busy-3",
        title: "busy-3 차세대 정보시스템 구축 사업",
        agency: "조달청",
        isDemo: false,
        cancelled: false,
        field: "SECURITY",
      },
      watched: false,
      project: PROJECT,
    }),
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
const GOOGLE: GoogleCalendarToolbar = {
  state: "CONNECTED",
  outcome: null,
  returnPath: "/calendar?month=2026-10&view=mine",
  sync: { month: "2026-10", view: "mine", kinds: "BID_DEADLINE,OPENING" },
};

const mounted: Root[] = [];
beforeEach(() => {
  router.replace.mockReset();
});
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

type Props = React.ComponentProps<typeof BidCalendar>;

// 화면에 실제로 보이는 폭. 요소 상자를 overflow 로 자르는 조상 상자들과 겹친 넓이다(다 가려지면 0).
const shownWidth = (element: Element) => {
  let { left, right, top, bottom } = element.getBoundingClientRect();
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflow === "visible") continue;
    const clip = node.getBoundingClientRect();
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return right > left && bottom > top ? right - left : 0;
};

function show(overrides: Partial<Props> = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  flushSync(() =>
    root.render(
      // 펼친 사이드바(256px) 자리를 비워 업무 틀과 같은 본문 폭에서 그린다.
      <div className="flex min-h-svh">
        <div aria-hidden className="hidden w-64 shrink-0 border-r border-border md:block" />
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
            siteOrigin="https://sol.example"
            google={null}
            {...overrides}
          />
        </div>
      </div>,
    ),
  );
}

describe("입찰 일정 화면", () => {
  it("390px: 선택한 달 전체를 일정 목록으로 표시하고 달 이동과 상세 링크가 화면 안에 있다", async () => {
    await page.viewport(390, 900);
    const laterDate = "2026-10-31";
    const later = event("month-end", "2026-10-31T06:00:00.000Z", laterDate);
    show({ eventsByDate: { ...EVENTS, [laterDate]: [later] }, upcoming: [] });

    const agenda = page.getByRole("region", { name: "2026년 10월 일정 목록" });
    await expect.element(agenda).toBeVisible();
    await expect
      .element(agenda.getByRole("link", { name: later.bid.title, exact: true }))
      .toHaveAttribute("href", later.href);
    expect(page.getByRole("table", { name: "월간 입찰 일정 2026년 10월" }).elements()).toHaveLength(
      0,
    );
    const previous = page.getByRole("link", { name: "이전 달", exact: true });
    await expect.element(previous).toHaveAttribute("href", LINKS.prev);
    expect(previous.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(
      agenda
        .getByRole("link", { name: later.bid.title, exact: true })
        .element()
        .getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(
      agenda
        .getByRole("link", { name: /month-end.*구글.*새 창/ })
        .element()
        .getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    // 모바일 일정 목록도 분야 이름을 보인다.
    await expect.element(agenda.getByText("AI·AX", { exact: true })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "../../../../test-results/vitest-screenshots/calendar-390.png" });
  });

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
      // 분야 이름은 제목 뒤, 표시 앞이다.
      const demoChip = calendar.getByRole("link", {
        name: /스마트 물관리.*디지털트윈 내 관심 DEMO$/,
      });
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
      // 공고 분야는 왼쪽 색 띠와 분야 이름 글자다(색만으로 알리지 않는다). 분야 없는 칩은 회색(input) 띠만 있다.
      // 관심 공고라도 분야 이름은 잘리지 않는다(★ 는 제목 줄 앞에 있어 윗줄 자리를 쓰지 않는다).
      const todayChip = calendar.getByRole("link", { name: /^제출 마감 15:00 today/ });
      const todayField = todayChip.getByText("AI·AX", { exact: true });
      await expect.element(todayField).toBeVisible();
      expect(todayField.element().scrollWidth).toBeLessThanOrEqual(
        todayField.element().clientWidth,
      );
      const todayTitle = todayChip.getByText("today 차세대 정보시스템 구축 사업").element();
      const star = todayTitle.parentElement?.querySelector("svg");
      expect(star).toBeTruthy();
      expect(star?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        todayField.element().getBoundingClientRect().bottom - 1,
      );
      expect(star?.getBoundingClientRect().right).toBeLessThanOrEqual(
        todayTitle.getBoundingClientRect().left,
      );
      const fieldLabel = demoChip.getByText("디지털트윈", { exact: true });
      const demoStyle = getComputedStyle(demoChip.element());
      expect(demoStyle.borderLeftWidth).toBe("4px");
      expect(demoStyle.borderLeftColor).toBe("rgb(4, 120, 87)");
      const plainChip = calendar.getByRole("link", { name: /^공고 마감 10:00 busy-2/ });
      expect(getComputedStyle(plainChip.element()).borderLeftColor).toBe("rgb(209, 214, 219)");
      expect(plainChip.element().textContent).not.toMatch(
        /AI·AX|SI·SW|클라우드|데이터|보안|디지털트윈 /,
      );
      // 좁은 칩에 가장 긴 분야 이름·DEMO 가 함께 있으면 DEMO 가 온전히 남고, 분야 이름은 말줄임되거나 가려진다.
      // 어느 쪽도 칩 밖으로 넘치지 않는다(분야는 띠 색·title·접근 이름에 남는다).
      // 자리가 모자라도 글자 조각(몇 px·"제…")만 남지 않는다. 분야 이름 상자는 두 글자 폭 아래로 눌리지 않고
      // (폭 0 상자도 경계에서 글자 한 줄이 그려진다) 그만큼 보이거나 통째로 가려진다. 짧은 종류 이름은 다 보이거나 가려진다.
      expect(fieldLabel.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(20);
      const fieldShown = shownWidth(fieldLabel.element());
      expect(fieldShown === 0 || fieldShown >= 20).toBe(true);
      const todayKind = todayChip.getByText("제출 마감", { exact: true }).element();
      const kindShown = shownWidth(todayKind);
      expect(kindShown === 0 || kindShown >= todayKind.getBoundingClientRect().width - 0.5).toBe(
        true,
      );
      const chipRight = demoChip.element().getBoundingClientRect().right;
      expect(fieldLabel.element().getBoundingClientRect().right).toBeLessThanOrEqual(chipRight);
      const demoBadge = demoChip.getByText("DEMO", { exact: true }).element();
      expect(demoBadge.getBoundingClientRect().right).toBeLessThanOrEqual(chipRight);
      expect(shownWidth(demoBadge)).toBeGreaterThanOrEqual(
        demoBadge.getBoundingClientRect().width - 0.5,
      );
      // 제목 줄은 칩 폭을 다 쓴다(아이콘·표시 옆에 끼어 서너 글자만 남지 않게). 관심 ★ 만 제목 앞에 붙는다.
      const chipWidth = demoChip.element().clientWidth;
      const titleLine = demoChip
        .getByText("스마트 물관리 디지털트윈 플랫폼 고도화 (가상)")
        .element().parentElement;
      expect(titleLine?.getBoundingClientRect().width).toBeGreaterThanOrEqual(chipWidth - 12);

      // 메뉴를 열기 전에 찍는다(닫히는 메뉴가 사진에 남지 않게). 앞 시험의 마우스 자리에 걸린 링크 hover 도 치운다.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await userEvent.hover(page.getByRole("heading", { level: 1 }));
      await page.screenshot({
        path: `../../../../test-results/vitest-screenshots/calendar-${width}.png`,
      });

      // 4건인 날은 겹침 건수를 보이고 칩 둘 뒤 나머지는 메뉴로 연다.
      await expect.element(calendar.getByText("4건")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: /\+2건 더/ }));
      const busy3 = page.getByRole("menuitem", { name: /busy-3/ });
      await expect.element(busy3).toHaveAttribute("href", "/bids/busy-3?origin=live");
      await expect.element(busy3.getByText("보안", { exact: true })).toBeVisible();
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
      await expect.element(upcoming.getByText("AI·AX", { exact: true })).toBeVisible();
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
    // 범례에는 공고 분야 색을 두고 DEMO 설명은 두지 않는다(2026-11-03 사용자 결정).
    await expect.element(legend.getByText("AI·AX", { exact: true })).toBeVisible();
    await expect.element(legend.getByText("분야 없음", { exact: true })).toBeVisible();
    expect(legend.element().textContent).not.toContain("데모용 가상 공고");
    expect(legend.element().textContent).not.toContain("DEMO");

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
      .element(
        upcoming.getByRole("link", { name: "up-23 차세대 정보시스템 구축 사업", exact: true }),
      )
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

  it("다가오는 일정마다 구글 캘린더에 추가 링크가 새 창으로 열린다", async () => {
    await page.viewport(1440, 1000);
    const site = event("site", "2026-10-29T01:00:00.000Z", "2026-10-29", {
      kind: "SITE_BRIEFING",
      watched: false,
      place: "조달청 본관 3층 회의실",
    });
    show({ eventsByDate: { "2026-10-29": [site] }, upcoming: [site] });

    const upcoming = page.getByRole("region", { name: "다가오는 14일" });
    const google = upcoming.getByRole("link", {
      name: "site 차세대 정보시스템 구축 사업 현장설명회 구글 캘린더에 추가(새 창)",
    });
    await expect.element(google).toHaveAttribute("target", "_blank");
    expect(google.element().getAttribute("rel")).toContain("noopener");
    const href = new URL(google.element().getAttribute("href") ?? "");
    expect(href.origin + href.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(href.searchParams.get("action")).toBe("TEMPLATE");
    // 달력 칸 칩에는 넣지 않는다(칸 높이).
    const calendar = page.getByRole("table", { name: "월간 입찰 일정 2026년 10월" });
    expect(calendar.element().querySelector('a[href^="https://calendar.google.com"]')).toBeNull();
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/calendar-1440-google-link.png",
    });
  });

  it("IT 공고를 읽지 못하면 출처 줄 아래에 아이콘과 글자로 알린다", async () => {
    await page.viewport(1440, 1000);
    show({ relevantFailed: true });

    const notice = page.getByRole("status");
    await expect
      .element(notice)
      .toHaveTextContent("IT 공고 일정을 불러오지 못했습니다. 관심·프로젝트 일정만 보입니다.");
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

// ── 구글 캘린더 연동 툴바(ADR-073): 버튼 셋, 결과 띠, 돌아온 결과. 요청은 가짜 fetch 다 ──
describe("구글 캘린더 연동 툴바", () => {
  const shot = (name: string) =>
    page.screenshot({ path: `../../../../test-results/google-calendar/${name}.png` });
  const status = () => page.getByRole("status");

  it("서버에 연동 설정이 없으면(google=null) 버튼을 두지 않는다", async () => {
    await page.viewport(1440, 1000);
    show();
    await expect.element(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(document.body.textContent).not.toContain("구글 캘린더 연동");
    expect(document.body.textContent).not.toContain("구글 캘린더에 넣기");
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("연결 전은 [구글 캘린더 연동], 만료는 [다시 연결] 링크이고 지금 보는 화면으로 돌아오게 연결을 시작한다", async () => {
    await page.viewport(1440, 1000);
    show({ google: { ...GOOGLE, state: "DISCONNECTED" } });
    const connect = page.getByRole("link", { name: "구글 캘린더 연동", exact: true });
    await expect
      .element(connect)
      .toHaveAttribute(
        "href",
        "/api/v1/me/google-calendar/connect?next=%2Fcalendar%3Fmonth%3D2026-10%26view%3Dmine",
      );
    await expect
      .element(connect)
      .toHaveAttribute("title", "구글 계정을 연결하고 이 달 일정을 보조 캘린더에 넣습니다");
    await expect
      .element(page.getByRole("button", { name: "구글 캘린더에 넣기" }))
      .not.toBeInTheDocument();
    await userEvent.hover(page.getByRole("heading", { level: 1 }));
    await shot("calendar-1440-disconnected");

    for (const root of mounted.splice(0)) root.unmount();
    document.body.replaceChildren();
    show({ google: { ...GOOGLE, state: "EXPIRED" } });
    await expect
      .element(page.getByRole("link", { name: "다시 연결", exact: true }))
      .toHaveAttribute(
        "href",
        "/api/v1/me/google-calendar/connect?next=%2Fcalendar%3Fmonth%3D2026-10%26view%3Dmine",
      );
  });

  it("[구글 캘린더에 넣기]는 지금 보는 범위를 확인 헤더로 보내고, 넣는 동안 비활성·aria-busy, 끝나면 건수와 [구글 캘린더 열기](새 창)를 띠에 보인다", async () => {
    await page.viewport(1440, 1000);
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const reply = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply.promise;
    });
    show({ google: GOOGLE });

    const sync = page.getByRole("button", { name: "구글 캘린더에 넣기" });
    await expect
      .element(sync)
      .toHaveAttribute(
        "title",
        "지금 보는 달·보기·종류의 일정을 구글 보조 캘린더 'SOL RADAR 입찰 일정'에 넣습니다. 조직 전체 보기에서는 고른 종류 가운데 없어진 일정을 지웁니다.",
      );
    await userEvent.click(sync);
    await expect.element(sync).toBeDisabled();
    await expect.element(sync).toHaveAttribute("aria-busy", "true");
    await expect.element(status()).toHaveTextContent("구글 캘린더에 넣는 중…");
    await expect.element(status()).toHaveAttribute("aria-busy", "true");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/calendar/google/sync");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ "X-Requested-With": "sol-radar" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      month: "2026-10",
      view: "mine",
      kinds: "BID_DEADLINE,OPENING",
    });

    reply.resolve(
      Response.json({ month: "2026-10", calendarId: "c", created: 3, updated: 1, deleted: 2 }),
    );
    await expect
      .element(status())
      .toHaveTextContent(googleSynced({ created: 3, updated: 1, deleted: 2 }));
    await expect.element(sync).toBeEnabled();
    await expect.element(status()).toHaveAttribute("aria-busy", "false");
    const open = page.getByRole("link", { name: "구글 캘린더 열기(새 창)" });
    await expect.element(open).toHaveAttribute("href", "https://calendar.google.com/calendar/");
    await expect.element(open).toHaveAttribute("target", "_blank");
    await expect.element(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.hover(page.getByRole("heading", { level: 1 }));
    await shot("calendar-1440-synced");
  });

  it("만료(409 GOOGLE_EXPIRED)면 띠가 다시 연결을 안내하고 버튼이 [다시 연결]로 바뀐다", async () => {
    await page.viewport(1280, 1000);
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { error: { code: "GOOGLE_EXPIRED", message: "만료", details: null } },
        { status: 409 },
      ),
    );
    show({ google: GOOGLE });
    await userEvent.click(page.getByRole("button", { name: "구글 캘린더에 넣기" }));
    await expect.element(status()).toHaveTextContent(GOOGLE_SYNC_ERRORS.expired);
    await expect.element(page.getByRole("link", { name: "다시 연결", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "구글 캘린더에 넣기" }))
      .not.toBeInTheDocument();
    // 1280px 에서 툴바가 줄을 바꿔도 가로로 넘치지 않는다.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.hover(page.getByRole("heading", { level: 1 }));
    await shot("calendar-1280-expired");
  });

  it("응답마다 띠 문구가 스펙 상태 표와 같다(빈 달·일부 실패·IT 공고 실패·연결 없음·준비 전)", () => {
    const error = (status: number, code: string, component: string | null = null) =>
      syncResultOf(status, { error: { code, message: "서버 글자", details: { component } } });
    expect(syncResultOf(200, { created: 0, updated: 0, deleted: 0 }).band).toEqual({
      tone: "ok",
      message: "이 달에는 넣을 일정이 없습니다.",
      showOpen: false,
    });
    expect(syncResultOf(200, { created: 0, updated: 0, deleted: 2 }).band.message).toBe(
      googleSyncedEmpty(2),
    );
    expect(error(502, "UPSTREAM_ERROR", "google-calendar").band.message).toBe(
      "구글 캘린더 오류로 일부를 넣지 못했습니다. 다시 눌러 주세요.",
    );
    expect(error(503, "SERVICE_UNAVAILABLE", "calendar-relevant").band.message).toBe(
      "IT 공고 일정을 불러오지 못해 넣지 않았습니다. 새로 고친 뒤 다시 시도하세요.",
    );
    expect(error(503, "SERVICE_UNAVAILABLE", "google-calendar").band.message).toBe(
      GOOGLE_SYNC_ERRORS.notReady,
    );
    expect(error(409, "GOOGLE_NOT_CONNECTED")).toEqual({
      band: { tone: "error", message: GOOGLE_SYNC_ERRORS.notConnected },
      state: "DISCONNECTED",
    });
    expect(error(409, "GOOGLE_EXPIRED").state).toBe("EXPIRED");
    // 500건 상한(보안 리뷰 C). 다른 400 은 알 수 없는 오류 문구다.
    expect(error(400, "VALIDATION_ERROR", "google-calendar-limit").band.message).toBe(
      "한 번에 넣을 수 있는 일정은 500건까지입니다. 일정 종류를 줄여 주세요.",
    );
    expect(error(400, "VALIDATION_ERROR").band.message).toBe(GOOGLE_SYNC_ERRORS.unknown);
    // 모양이 틀린 200 은 성공으로 보이지 않는다.
    expect(syncResultOf(200, { created: "3" }).band.tone).toBe("error");
    expect(syncResultOf(500, null).band.message).toBe(GOOGLE_SYNC_ERRORS.unknown);
  });

  it("연결하고 돌아오면 결과를 띠에 한 번 알리고 주소에서 ?google= 을 지운다", async () => {
    await page.viewport(1440, 1000);
    show({ google: { ...GOOGLE, outcome: "connected" } });
    await expect.element(status()).toHaveTextContent(GOOGLE_CONNECT_NOTICES.connected);
    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/calendar?month=2026-10&view=mine", {
        scroll: false,
      }),
    );
    expect(router.replace).toHaveBeenCalledTimes(1);

    for (const root of mounted.splice(0)) root.unmount();
    document.body.replaceChildren();
    show({ google: { ...GOOGLE, state: "DISCONNECTED", outcome: "no_refresh_token" } });
    await expect
      .element(status())
      .toHaveTextContent(
        "구글이 갱신 토큰을 주지 않았습니다. 구글 계정 보안 설정에서 SOL RADAR 접근을 지우고 다시 연결하세요.",
      );
    await expect
      .element(page.getByRole("link", { name: "구글 캘린더 연동", exact: true }))
      .toBeVisible();
  });

  it("390px: 툴바 버튼과 띠 링크는 44px 이상이고, 긴 띠는 줄을 바꿔 가로로 넘치지 않는다", async () => {
    await page.viewport(390, 900);
    vi.stubGlobal("fetch", async () =>
      Response.json({ month: "2026-10", calendarId: "c", created: 12, updated: 30, deleted: 4 }),
    );
    show({ google: GOOGLE, eventsByDate: {}, upcoming: [] });
    const sync = page.getByRole("button", { name: "구글 캘린더에 넣기" });
    expect(sync.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(sync);
    const open = page.getByRole("link", { name: "구글 캘린더 열기(새 창)" });
    await expect.element(open).toBeVisible();
    expect(open.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await shot("calendar-390-synced");

    for (const root of mounted.splice(0)) root.unmount();
    document.body.replaceChildren();
    show({ google: { ...GOOGLE, state: "DISCONNECTED" }, eventsByDate: {}, upcoming: [] });
    const connect = page.getByRole("link", { name: "구글 캘린더 연동", exact: true });
    expect(connect.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await shot("calendar-390-disconnected");
  });
});
