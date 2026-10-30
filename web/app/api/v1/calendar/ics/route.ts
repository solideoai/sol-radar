import { icsCalendar } from "@/app/(app)/(work)/calendar/calendar-export";
import { apiError } from "@/app/api/v1/_lib/http";
import { businessRoute, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import {
  calendarRepo,
  filterKinds,
  getCalendarEvents,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseKinds,
  parseMonth,
  parseView,
  relevantDeadlineWindow,
} from "@/server/calendar";

// GET /api/v1/calendar/ics — /calendar 에서 지금 보는 달의 일정을 .ics 파일로 내려준다(구글 캘린더·아웃룩 가져오기용).
// 쿼리 해석은 page.tsx 와 같다(틀린 month 는 이번 달, 틀린 view 는 조직 전체, kinds 가 없으면 전부).
// 조직은 세션이 정한다(쿼리의 orgId 는 보지 않는다). 읽기는 화면과 같은 사용자 세션 + RLS 다.
// 구독 주소(비밀 토큰 공개 주소)는 만들지 않는다. 내려받은 파일은 자동으로 갱신되지 않는다.

const CALENDAR_NAME = "SOL RADAR 입찰 일정";

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const query = rawQueryOf(request);
    const now = new Date().toISOString();
    const today = kstDateKey(now);
    const month = parseMonth(single(query.month), monthOfDateKey(today));
    const view = parseView(single(query.view));
    const kinds = parseKinds(single(query.kinds));
    // 관련 공고 범위는 화면과 같게 달력 격자 끝날로 잡는다(화면에 보이는 일정과 파일이 어긋나지 않게).
    const lastDay = monthWeeks(month).flat().at(-1)?.date ?? today;
    const window = relevantDeadlineWindow(lastDay, today);
    const { events, relevantFailed } = await getCalendarEvents(
      { orgId: ctx.orgId, userId: ctx.userId },
      view,
      { window },
      { repo: calendarRepo },
    );
    // 화면은 IT 공고 없이도 그리고 알리지만, 파일은 받은 뒤 알릴 길이 없어 일부만 담아 내려주지 않는다.
    if (relevantFailed)
      return apiError(
        503,
        "SERVICE_UNAVAILABLE",
        "IT 공고 일정을 불러오지 못했습니다. 잠시 뒤 다시 내려받으세요.",
        { component: "calendar-relevant" },
      );
    const monthPrefix = monthKey(month);
    const shown = filterKinds(events, kinds).filter((event) => event.date.startsWith(monthPrefix));
    const body = icsCalendar(shown, {
      siteOrigin: new URL(request.url).origin,
      now,
      name: CALENDAR_NAME,
    });
    const filename = `sol-radar-calendar-${monthPrefix}${view === "mine" ? "-mine" : ""}.ics`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Request-Id": crypto.randomUUID(),
      },
    });
  });
}
