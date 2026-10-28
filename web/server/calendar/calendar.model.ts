import "server-only";
import { effectiveDueAt, type ProjectStatus } from "@/server/projects";
import { kstDate } from "@/server/scoring";

// ── 입찰 일정(/calendar) 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 일정은 새로 저장하지 않는다. 내 관심 공고(bid_watches 본인 행)와 조직의 열린 입찰 프로젝트(bid_projects)에서 마감을 모은다.
// 날짜는 전부 입력 값으로 계산한다(Date.now() 를 부르지 않는다). 업무 기준은 KST 다(scoring/calendar 의 kstDate).

/** 화면이 확인한 지금 조직과 사용자. 조직은 서버가 정한다(M17). */
export type CalendarScope = { orgId: string; userId: string };

// org: 내 관심 + 조직의 열린 프로젝트 전부. mine: 내 관심 + 내가 담당인 프로젝트.
// 관심은 본인 것만 보인다(N3 설계 D6) — 조직 전체에도 남의 관심은 없다.
export const CALENDAR_VIEWS = ["org", "mine"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const DEFAULT_CALENDAR_VIEW: CalendarView = "org";

export type CalendarBid = {
  id: string;
  title: string;
  agency: string | null;
  deadlineAt: string | null;
  isDemo: boolean;
  cancelled: boolean;
};

// 저장이 돌려주는 열린(CLOSED 아님) 프로젝트. 공고 하나에 열린 프로젝트는 조직마다 하나다(open_bid_project).
export type CalendarProject = {
  id: string;
  status: ProjectStatus;
  ownerId: string | null;
  ownerName: string | null;
  submissionDueOverride: string | null;
  bid: CalendarBid;
};

export type CalendarSource = { watchedBids: CalendarBid[]; projects: CalendarProject[] };

/** 저장 포트. 구현(calendar.repo)은 사용자 세션 + RLS 로만 읽는다. */
export type CalendarRepo = { load(scope: CalendarScope): Promise<CalendarSource> };

// SUBMISSION_DUE: 프로젝트 제출 마감(변경 값 우선). BID_DEADLINE: 공고 마감.
// 프로젝트의 제출 마감이 공고 마감과 같으면 한 건(SUBMISSION_DUE)으로 합친다 — 같은 시각에 두 칩을 그리지 않는다.
export type CalendarEventKind = "SUBMISSION_DUE" | "BID_DEADLINE";

export type CalendarEvent = {
  key: string;
  kind: CalendarEventKind;
  at: string;
  // KST 날짜 "YYYY-MM-DD"
  date: string;
  bid: Omit<CalendarBid, "deadlineAt">;
  // 내가 관심 표시한 공고인지
  watched: boolean;
  project: { id: string; status: ProjectStatus; ownerName: string | null; isMine: boolean } | null;
  // 제출 마감을 공고 마감과 다르게 바꿨는지(SUBMISSION_DUE 만)
  dueOverridden: boolean;
  href: string;
};

// 공고 상세의 DEMO 표시(상단바)가 주소의 출처를 따르므로 공고의 출처를 붙인다.
const bidHrefOf = (bid: CalendarBid) => `/bids/${bid.id}?origin=${bid.isDemo ? "demo" : "live"}`;

const sameInstant = (a: string, b: string | null) => b !== null && Date.parse(a) === Date.parse(b);

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO 시각의 KST 날짜 "YYYY-MM-DD". */
export function kstDateKey(iso: string): string {
  const { year, month, day } = kstDate(iso);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function eventOf(
  kind: CalendarEventKind,
  at: string,
  bid: CalendarBid,
  watched: boolean,
  project: CalendarEvent["project"],
  dueOverridden: boolean,
): CalendarEvent {
  return {
    key:
      kind === "SUBMISSION_DUE" && project !== null ? `${kind}:${project.id}` : `${kind}:${bid.id}`,
    kind,
    at,
    date: kstDateKey(at),
    bid: {
      id: bid.id,
      title: bid.title,
      agency: bid.agency,
      isDemo: bid.isDemo,
      cancelled: bid.cancelled,
    },
    watched,
    project,
    dueOverridden,
    href:
      kind === "SUBMISSION_DUE" && project !== null ? `/projects/${project.id}` : bidHrefOf(bid),
  };
}

function projectEventsOf(
  project: CalendarProject,
  watched: boolean,
  userId: string,
): CalendarEvent[] {
  const ref = {
    id: project.id,
    status: project.status,
    ownerName: project.ownerName,
    isMine: project.ownerId === userId,
  };
  const due = effectiveDueAt(project.bid.deadlineAt, project.submissionDueOverride);
  if (due === null) return [];
  const overridden =
    project.submissionDueOverride !== null &&
    !sameInstant(project.submissionDueOverride, project.bid.deadlineAt);
  const submission = eventOf("SUBMISSION_DUE", due, project.bid, watched, ref, overridden);
  // 제출 마감을 바꿨으면 공고 마감은 따로 한 건이다.
  return overridden && project.bid.deadlineAt !== null
    ? [
        submission,
        eventOf("BID_DEADLINE", project.bid.deadlineAt, project.bid, watched, ref, false),
      ]
    : [submission];
}

const KIND_ORDER: Record<CalendarEventKind, number> = { SUBMISSION_DUE: 0, BID_DEADLINE: 1 };

// 시각 순, 같은 시각이면 제출 마감 먼저, 다음은 공고명 가나다.
const byTime = (a: CalendarEvent, b: CalendarEvent) =>
  Date.parse(a.at) - Date.parse(b.at) ||
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.bid.title.localeCompare(b.bid.title, "ko") ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * 관심 공고와 열린 프로젝트에서 일정을 모은다.
 * 같은 공고가 관심이면서 프로젝트이면 프로젝트 일정 하나에 관심 표시(watched)를 얹는다.
 * 마감이 없는 공고는 일정이 없다.
 */
export function collectCalendarEvents(
  source: CalendarSource,
  { userId, view }: { userId: string; view: CalendarView },
): CalendarEvent[] {
  const watchedIds = new Set(source.watchedBids.map((bid) => bid.id));
  const projectBidIds = new Set(source.projects.map((project) => project.bid.id));
  const fromProjects = source.projects.flatMap((project) =>
    projectEventsOf(project, watchedIds.has(project.bid.id), userId),
  );
  const fromWatches = source.watchedBids.flatMap((bid) =>
    projectBidIds.has(bid.id) || bid.deadlineAt === null
      ? []
      : [eventOf("BID_DEADLINE", bid.deadlineAt, bid, true, null, false)],
  );
  const events = [...fromProjects, ...fromWatches];
  const visible =
    view === "mine" ? events.filter((event) => event.watched || event.project?.isMine) : events;
  return visible.toSorted(byTime);
}

// ── 달력 칸 ──

export type CalendarMonth = { year: number; month: number }; // month 1~12
export type CalendarDay = { date: string; day: number; inMonth: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const keyOfUtcMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMsOfKey = (key: string) => Date.parse(`${key}T00:00:00Z`);

export const monthKey = ({ year, month }: CalendarMonth) => `${year}-${pad(month)}`;

export const monthOfDateKey = (key: string): CalendarMonth => ({
  year: Number(key.slice(0, 4)),
  month: Number(key.slice(5, 7)),
});

export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** 주소의 ?month=YYYY-MM. 형식이 틀리거나 범위 밖이면 fallback(오늘의 달)이다. */
export function parseMonth(param: string | undefined, fallback: CalendarMonth): CalendarMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : fallback;
}

export const parseView = (param: string | undefined): CalendarView =>
  CALENDAR_VIEWS.find((view) => view === param) ?? DEFAULT_CALENDAR_VIEW;

export const addDays = (key: string, days: number) => keyOfUtcMs(utcMsOfKey(key) + days * DAY_MS);

/** 월요일에 시작하는 주들. 앞뒤 달의 날짜로 첫 주와 마지막 주를 채운다(4~6주). */
export function monthWeeks({ year, month }: CalendarMonth): CalendarDay[][] {
  const first = Date.UTC(year, month - 1, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(first + (week * 7 + weekday - lead) * DAY_MS);
      return {
        date: keyOfUtcMs(date.getTime()),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1,
      };
    }),
  );
}

/** 날짜별 일정. 들어온 순서(시각 순)를 지킨다. */
export function eventsByDate(
  events: readonly CalendarEvent[],
): ReadonlyMap<string, CalendarEvent[]> {
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  return byDate;
}

/** 지금부터 오늘 포함 days 일(KST) 안의 일정. 오늘 이미 지난 시각은 뺀다. */
export function upcomingEvents(
  events: readonly CalendarEvent[],
  now: string,
  days = 14,
): CalendarEvent[] {
  const lastDate = addDays(kstDateKey(now), days - 1);
  const nowMs = Date.parse(now);
  return events.filter((event) => Date.parse(event.at) >= nowMs && event.date <= lastDate);
}
