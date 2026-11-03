import "server-only";

// ── 배럴: calendar 도메인의 공개 API. 바깥(app·components)은 @/server/calendar 만 부른다 ──
export {
  CALENDAR_EVENT_KINDS,
  CALENDAR_FIELDS,
  CALENDAR_VIEWS,
  DEFAULT_CALENDAR_VIEW,
  SCHEDULE_KINDS,
  addDays,
  eventsByDate,
  filterKinds,
  kindsParam,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseKinds,
  parseMonth,
  parseView,
  primaryFieldOf,
  relevantDeadlineWindow,
  shiftMonth,
  toggleKind,
  upcomingEvents,
} from "./calendar.model";
export type {
  CalendarDay,
  CalendarEvent,
  CalendarEventKind,
  CalendarField,
  CalendarMonth,
  CalendarRepo,
  CalendarResult,
  CalendarScope,
  CalendarView,
  DeadlineWindow,
  ScheduleKind,
} from "./calendar.model";
export { getCalendarEvents } from "./calendar.service";
export { calendarRepo } from "./calendar.repo";
