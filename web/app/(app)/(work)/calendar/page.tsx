import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import {
  CALENDAR_EVENT_KINDS,
  DEFAULT_CALENDAR_VIEW,
  eventsByDate,
  filterKinds,
  getCalendarEvents,
  kindsParam,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseKinds,
  parseMonth,
  parseView,
  relevantDeadlineWindow,
  shiftMonth,
  toggleKind,
  upcomingEvents,
  type CalendarEventKind,
  type CalendarMonth,
  type CalendarView,
} from "@/server/calendar";
import {
  loadMyGoogleCalendar,
  readGoogleCalendarConfig,
  toGoogleConnectOutcome,
} from "@/server/google-calendar";
import { errorNameOf } from "@/server/shared";
import { requireWork } from "@/app/(app)/(work)/work";
import { CALENDAR_PATH, CALENDAR_TITLE } from "./calendar-copy";
import { siteOriginOf } from "./calendar-export";
import { BidCalendar, capUpcoming } from "./calendar-view";
import type { GoogleCalendarToolbar } from "./google-connect";

export const metadata: Metadata = { title: CALENDAR_TITLE };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 기본 보기·전부 보이는 종류는 주소에 적지 않는다. 오늘의 달로 가는 링크는 month 를 뺀다.
// 종류를 하나도 고르지 않으면 kinds= (빈 값)이 남아 다시 열어도 빈 달력이다.
function calendarHref(
  month: CalendarMonth | null,
  view: CalendarView,
  kinds: readonly CalendarEventKind[],
): string {
  const params = new URLSearchParams();
  if (month !== null) params.set("month", monthKey(month));
  if (view !== DEFAULT_CALENDAR_VIEW) params.set("view", view);
  const kindsValue = kindsParam(kinds);
  if (kindsValue !== null) params.set("kinds", kindsValue);
  // 종류 사이 쉼표는 읽기 쉽게 그대로 둔다(/gaps 의 assume 과 같은 방식).
  return params.size
    ? `${CALENDAR_PATH}?${params.toString().replaceAll("%2C", ",")}`
    : CALENDAR_PATH;
}

// 구글 캘린더 연동(ADR-073)의 연결 상태. 서버에 연동 설정(env 셋)이 없으면 버튼이 늘 실패하므로 두지 않는다(null).
// 구글 표가 아직 없는 DB(마이그레이션 적용 전)에서도 달력은 열린다. 버튼만 숨기고 오류 이름을 남긴다.
const loadGoogleView = () =>
  readGoogleCalendarConfig(process.env) === null
    ? Promise.resolve(null)
    : loadMyGoogleCalendar().catch((error: unknown) => {
        console.error(
          JSON.stringify({ event: "google_calendar.load_failed", error: errorNameOf(error) }),
        );
        return null;
      });

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  await connection();
  const raw = await searchParams;
  const asked = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value])
      asked.append(key, item);
  const work = await requireWork(`${CALENDAR_PATH}${asked.size ? `?${asked}` : ""}`);
  const requested = parseView(single(raw.view));
  const now = new Date().toISOString();
  const today = kstDateKey(now);
  const month = parseMonth(single(raw.month), monthOfDateKey(today));
  const kinds = parseKinds(single(raw.kinds));
  const weeks = monthWeeks(month);
  const days = weeks.flat();
  // 관련 공고는 보일 칸(오늘부터 달력 격자 끝과 다가오는 14일)의 원본 일정이 들어올 공고 마감 범위만 읽는다.
  const window = relevantDeadlineWindow(days.at(-1)?.date ?? today, today);
  const [{ events, relevantFailed }, googleView] = await Promise.all([
    getCalendarEvents({ orgId: work.orgId, userId: work.userId }, requested, { window }),
    loadGoogleView(),
  ]);
  // 종류 거르기는 그리기 직전에 한다. hasAnyEvents 는 거르기 전 일정으로 본다(빈 조직 안내와 "고른 종류 없음"을 나눈다).
  const shown = filterKinds(events, kinds);
  const byDate = eventsByDate(shown);
  const cells = Object.fromEntries(
    days.flatMap((day) => {
      const dayEvents = byDate.get(day.date);
      return dayEvents === undefined ? [] : [[day.date, dayEvents]];
    }),
  );
  // 다가오는 14일은 그릴 만큼(UPCOMING_MAX)만 넘기고 나머지는 건수만 넘긴다(HTML·RSC 크기).
  const upcoming = capUpcoming(upcomingEvents(shown, now));
  const kindsFiltered = kindsParam(kinds) !== null;
  const siteOrigin = siteOriginOf(await headers());
  const monthHref = (target: CalendarMonth) => calendarHref(target, requested, kinds);
  // 연결하고 돌아올 곳은 지금 보는 달·보기·종류 그대로다(?google= 은 빼고). 밀어넣기도 같은 범위다.
  const google: GoogleCalendarToolbar | null =
    googleView === null
      ? null
      : {
          state: googleView.state,
          outcome: toGoogleConnectOutcome(single(raw.google)),
          returnPath: calendarHref(month, requested, kinds),
          sync: { month: monthKey(month), view: requested, kinds: kindsParam(kinds) },
        };
  return (
    <BidCalendar
      monthLabel={`${month.year}년 ${month.month}월`}
      weeks={weeks}
      eventsByDate={cells}
      upcoming={upcoming.upcoming}
      upcomingHidden={upcoming.upcomingHidden}
      today={today}
      now={now}
      view={requested}
      kinds={kinds}
      kindsFiltered={kindsFiltered}
      hasAnyEvents={events.length > 0}
      relevantFailed={relevantFailed}
      siteOrigin={siteOrigin}
      google={google}
      links={{
        prev: monthHref(shiftMonth(month, -1)),
        next: monthHref(shiftMonth(month, 1)),
        today: calendarHref(null, requested, kinds),
        views: {
          org: calendarHref(month, "org", kinds),
          mine: calendarHref(month, "mine", kinds),
        },
        kinds: Object.fromEntries(
          CALENDAR_EVENT_KINDS.map((kind) => [
            kind,
            calendarHref(month, requested, toggleKind(kinds, kind)),
          ]),
        ) as Record<CalendarEventKind, string>,
        allKinds: kindsFiltered ? calendarHref(month, requested, CALENDAR_EVENT_KINDS) : null,
      }}
    />
  );
}
