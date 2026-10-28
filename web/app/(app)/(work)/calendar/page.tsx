import type { Metadata } from "next";
import { connection } from "next/server";
import {
  DEFAULT_CALENDAR_VIEW,
  eventsByDate,
  getCalendarEvents,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseMonth,
  parseView,
  shiftMonth,
  upcomingEvents,
  type CalendarMonth,
  type CalendarView,
} from "@/server/calendar";
import { requireWork } from "@/app/(app)/(work)/work";
import { CALENDAR_PATH, CALENDAR_TITLE } from "./calendar-copy";
import { BidCalendar } from "./calendar-view";

export const metadata: Metadata = { title: CALENDAR_TITLE };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 기본 보기는 주소에 적지 않는다. 오늘의 달로 가는 링크는 month 를 뺀다.
function calendarHref(month: CalendarMonth | null, view: CalendarView): string {
  const params = new URLSearchParams();
  if (month !== null) params.set("month", monthKey(month));
  if (view !== DEFAULT_CALENDAR_VIEW) params.set("view", view);
  return params.size ? `${CALENDAR_PATH}?${params}` : CALENDAR_PATH;
}

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
  const events = await getCalendarEvents({ orgId: work.orgId, userId: work.userId }, requested);
  const weeks = monthWeeks(month);
  const byDate = eventsByDate(events);
  const shown = Object.fromEntries(
    weeks.flat().flatMap((day) => {
      const dayEvents = byDate.get(day.date);
      return dayEvents === undefined ? [] : [[day.date, dayEvents]];
    }),
  );
  const monthHref = (target: CalendarMonth) => calendarHref(target, requested);
  return (
    <BidCalendar
      monthLabel={`${month.year}년 ${month.month}월`}
      weeks={weeks}
      eventsByDate={shown}
      upcoming={upcomingEvents(events, now)}
      today={today}
      now={now}
      view={requested}
      hasAnyEvents={events.length > 0}
      links={{
        prev: monthHref(shiftMonth(month, -1)),
        next: monthHref(shiftMonth(month, 1)),
        today: calendarHref(null, requested),
        views: {
          org: calendarHref(month, "org"),
          mine: calendarHref(month, "mine"),
        },
      }}
    />
  );
}
