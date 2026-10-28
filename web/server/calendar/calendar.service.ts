import "server-only";
import {
  collectCalendarEvents,
  type CalendarEvent,
  type CalendarRepo,
  type CalendarScope,
  type CalendarView,
} from "./calendar.model";
import { calendarRepo } from "./calendar.repo";

// ── 서비스: 화면이 그릴 일정 ──
// 로그인·가입 완료·업무 조직은 화면 가드(requireWork)가 이미 봤다. 읽기 전용이고 모든 역할이 본다.
// 무엇이 보이는지는 RLS(본인 관심·내 조직 프로젝트)가 정한다.

type Deps = { repo?: CalendarRepo };

export async function getCalendarEvents(
  scope: CalendarScope,
  view: CalendarView,
  { repo = calendarRepo }: Deps = {},
): Promise<CalendarEvent[]> {
  const source = await repo.load(scope);
  return collectCalendarEvents(source, { userId: scope.userId, view });
}
