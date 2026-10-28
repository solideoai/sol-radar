import "server-only";
import {
  collectCalendarEvents,
  type CalendarBid,
  type CalendarRepo,
  type CalendarResult,
  type CalendarScope,
  type CalendarView,
  type DeadlineWindow,
} from "./calendar.model";
import { calendarRepo } from "./calendar.repo";

// ── 서비스: 화면이 그릴 일정 ──
// 로그인·가입 완료·업무 조직은 화면 가드(requireWork)가 이미 봤다. 읽기 전용이고 모든 역할이 본다.
// 무엇이 보이는지는 RLS(본인 관심·내 조직 프로젝트·활동 중 회원의 공고 읽기)가 정한다.
// 관련 공고는 조직 전체 보기에서만 읽는다(내 일정은 관심 + 내 담당 프로젝트뿐이다).
// 관련 공고를 읽지 못하면 그것만 비우고 관심·프로젝트 일정은 그린다(market.service 의 겹쳐 보기 실패와 같은 방식).

type Deps = { repo?: CalendarRepo };

type ErrorFields = Partial<Record<"code" | "message" | "details" | "hint", unknown>>;
// PostgREST 오류는 Error 가 아닌 일반 객체({message,details,hint,code})로 던져지기도 한다(market.service 와 같다).
// Error 든 일반 객체든 같은 칸으로 풀어 로그에 원인을 남긴다.
function errorFields(error: unknown): ErrorFields {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  const { code, message, details, hint } = error as ErrorFields;
  return { code, message, details, hint };
}

function readRelevant(
  repo: CalendarRepo,
  window: DeadlineWindow,
): Promise<CalendarBid[] | "FAILED"> {
  return repo.loadRelevant(window).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "calendar_relevant_read_failed",
        ...errorFields(error),
        // calendar.repo 는 PostgREST 오류를 cause 로 감싸 던진다
        cause:
          error instanceof Error && error.cause !== undefined
            ? errorFields(error.cause)
            : undefined,
      }),
    );
    return "FAILED" as const;
  });
}

export async function getCalendarEvents(
  scope: CalendarScope,
  view: CalendarView,
  { window }: { window: DeadlineWindow },
  { repo = calendarRepo }: Deps = {},
): Promise<CalendarResult> {
  const [base, relevant] = await Promise.all([
    repo.load(scope),
    view === "org" ? readRelevant(repo, window) : Promise.resolve([]),
  ]);
  const relevantFailed = relevant === "FAILED";
  const source = { ...base, relevantBids: relevantFailed ? [] : relevant };
  return {
    events: collectCalendarEvents(source, { userId: scope.userId, view }),
    relevantFailed,
  };
}
