import "server-only";

// ── 배럴: calendar 도메인의 공개 API. 바깥(app·components)은 @/server/calendar 만 부른다 ──
export {
  CALENDAR_VIEWS,
  DEFAULT_CALENDAR_VIEW,
  addDays,
  eventsByDate,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseMonth,
  parseView,
  shiftMonth,
  upcomingEvents,
} from "./calendar.model";
export type {
  CalendarDay,
  CalendarEvent,
  CalendarEventKind,
  CalendarMonth,
  CalendarRepo,
  CalendarScope,
  CalendarView,
} from "./calendar.model";
export { getCalendarEvents } from "./calendar.service";
export { calendarRepo } from "./calendar.repo";
