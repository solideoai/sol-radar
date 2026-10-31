import { z } from "zod";
import {
  EVENT_DURATION_MS,
  exportDescriptionOf,
  exportPlaceOf,
  exportSummaryOf,
} from "@/app/(app)/(work)/calendar/calendar-export";
import { apiError, json } from "@/app/api/v1/_lib/http";
import { businessRoute, readJsonBody } from "@/app/api/v1/_lib/work-route";
import {
  CALENDAR_VIEWS,
  calendarRepo,
  filterKinds,
  getCalendarEvents,
  kstDateKey,
  monthKey,
  monthOfDateKey,
  monthWeeks,
  parseKinds,
  parseMonth,
  relevantDeadlineWindow,
  type CalendarEvent,
} from "@/server/calendar";
import {
  SYNC_MAX_EVENTS,
  monthRange,
  syncMyGoogleCalendar,
  type GoogleEventInput,
  type GoogleSyncOutcome,
} from "@/server/google-calendar";

// POST /api/v1/calendar/google/sync — /calendar 에서 지금 보는 달·보기·종류의 일정을 사용자의 구글 전용 캘린더에 넣는다(ADR-073).
// 이전에 넣은 일정 가운데 없어진 것은 조직 전체 보기에서 고른 종류만 지운다(내 일정 보기는 지우지 않는다).
// 쿼리 해석은 화면과 같다(view 가 없으면 조직 전체, kinds 가 없으면 전부). 조직은 세션이 정한다(본문의 orgId 는 보지 않는다).
// 읽기는 화면과 같은 사용자 세션 + RLS 다. 구글 호출은 그 사용자의 봉인된 refresh token 으로만 한다.
// 일정 글자(제목·설명·장소)는 화면의 "구글 캘린더에 추가" 링크와 같은 순수 함수가 만든다(가상 공고 [DEMO] 표시, 꺾쇠 제거).
// 담당자 이름은 싣지 않는다.

const bodySchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"),
    view: z.enum(CALENDAR_VIEWS).optional(),
    kinds: z.string().max(200).optional(),
  })
  .strict();

const inputOf = (event: CalendarEvent, siteOrigin: string): GoogleEventInput => ({
  key: event.key,
  date: event.date,
  summary: exportSummaryOf(event),
  description: exportDescriptionOf(event, siteOrigin),
  location: exportPlaceOf(event),
  startAt: event.at,
  endAt: new Date(Date.parse(event.at) + EVENT_DURATION_MS).toISOString(),
  url: `${siteOrigin}${event.href}`,
});

/**
 * 밀어넣기 결과를 JSON 한 줄로 남긴다(감사 대신의 서버 로그, ADR-073). 건수와 결과 코드만 싣는다.
 * 토큰·구글 이메일·일정 제목·캘린더 id 는 싣지 않는다.
 */
function logSync(userId: string, outcome: GoogleSyncOutcome): void {
  const counts = outcome.kind === "SYNCED" ? outcome.counts : null;
  const result = counts === null ? outcome.kind : counts.failed > 0 ? "PARTIAL" : "SYNCED";
  const isOk = result === "SYNCED";
  (isOk ? console.info : console.warn)(
    JSON.stringify({
      level: isOk ? "info" : "warn",
      source: "server",
      event: "google_calendar.sync",
      action: "sync",
      result,
      code: outcome.kind === "UPSTREAM_FAILED" ? outcome.code : null,
      userId,
      created: counts?.created ?? 0,
      updated: counts?.updated ?? 0,
      deleted: counts?.deleted ?? 0,
      failed: counts?.failed ?? 0,
      time: new Date().toISOString(),
    }),
  );
}

export function POST(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const read = await readJsonBody(request);
    if (!read.ok) {
      return apiError(400, "VALIDATION_ERROR", "요청 본문이 너무 큽니다", {
        issues: [{ path: "body", message: "본문 크기 상한을 넘었습니다." }],
      });
    }
    const parsed = bodySchema.safeParse(read.value);
    if (!parsed.success || monthRange(parsed.data.month) === null) {
      return apiError(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
        issues: parsed.success
          ? [{ path: "month", message: "YYYY-MM 이어야 합니다." }]
          : parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
      });
    }
    const now = new Date().toISOString();
    const today = kstDateKey(now);
    const month = parseMonth(parsed.data.month, monthOfDateKey(today));
    const view = parsed.data.view ?? "org";
    const kinds = parseKinds(parsed.data.kinds);
    // 관련 공고 범위는 화면과 같게 달력 격자 끝날로 잡는다(화면에 보이는 일정과 구글에 넣는 일정이 어긋나지 않게).
    const lastDay = monthWeeks(month).flat().at(-1)?.date ?? today;
    const window = relevantDeadlineWindow(lastDay, today);
    const { events, relevantFailed } = await getCalendarEvents(
      { orgId: ctx.orgId, userId: ctx.userId },
      view,
      { window },
      { repo: calendarRepo },
    );
    // 화면은 IT 공고 없이도 그리고 알리지만, 구글에는 일부만 넣고 나머지를 지우게 되므로 넣지 않는다.
    if (relevantFailed) {
      return apiError(
        503,
        "SERVICE_UNAVAILABLE",
        "IT 공고 일정을 불러오지 못해 넣지 않았습니다. 새로 고친 뒤 다시 시도하세요.",
        { component: "calendar-relevant" },
      );
    }
    const monthPrefix = monthKey(month);
    const siteOrigin = new URL(request.url).origin;
    const shown = filterKinds(events, kinds).filter((event) => event.date.startsWith(monthPrefix));
    // 한 번에 너무 많이 넣지 않는다. 구글을 부르기 전에 막는다(화면은 component 로 문구를 고른다).
    if (shown.length > SYNC_MAX_EVENTS) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        `한 번에 넣을 수 있는 일정은 ${SYNC_MAX_EVENTS}건까지입니다. 일정 종류를 줄여 주세요.`,
        {
          component: "google-calendar-limit",
          limit: SYNC_MAX_EVENTS,
          issues: [{ path: "kinds", message: `일정 ${shown.length}건이 상한을 넘었습니다.` }],
        },
      );
    }
    // 삭제는 지금 보는 범위(조직 전체 보기의 고른 종류) 안에서만 한다(planSync).
    const outcome = await syncMyGoogleCalendar(ctx.userId, {
      monthPrefix,
      view,
      kinds,
      events: shown.map((event) => inputOf(event, siteOrigin)),
    });
    logSync(ctx.userId, outcome);
    switch (outcome.kind) {
      case "SYNCED": {
        const { created, updated, deleted, failed } = outcome.counts;
        // 일부만 넣었으면 502 다(스펙 상태 표 "일부 실패"). 넣은 일정은 매핑에 남아 다시 누르면 갱신으로 처리된다.
        if (failed > 0) {
          return apiError(
            502,
            "UPSTREAM_ERROR",
            "구글 캘린더 오류로 일부를 넣지 못했습니다. 다시 눌러 주세요.",
            { component: "google-calendar", code: "PARTIAL", created, updated, deleted, failed },
          );
        }
        return json({
          month: monthPrefix,
          calendarId: outcome.calendarId,
          created,
          updated,
          deleted,
        });
      }
      case "NOT_CONFIGURED":
        return apiError(503, "SERVICE_UNAVAILABLE", "구글 캘린더 연동이 준비되지 않았습니다.", {
          component: "google-calendar",
        });
      case "NOT_CONNECTED":
        return apiError(409, "GOOGLE_NOT_CONNECTED", "구글 계정을 먼저 연결해야 합니다.");
      case "EXPIRED":
        return apiError(409, "GOOGLE_EXPIRED", "구글 연결이 만료되었습니다. 다시 연결해 주세요.");
      case "UPSTREAM_FAILED":
        return apiError(
          502,
          "UPSTREAM_ERROR",
          "구글 캘린더에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.",
          {
            component: "google-calendar",
            code: outcome.code,
          },
        );
    }
  });
}
