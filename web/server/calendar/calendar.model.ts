import "server-only";
import { parseKstDateTime } from "@/server/ingestion";
import { effectiveDueAt, type ProjectStatus } from "@/server/projects";
import { kstDate } from "@/server/scoring";

// ── 입찰 일정(/calendar) 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 일정은 새로 저장하지 않는다. 내 관심 공고(bid_watches 본인 행)와 조직의 열린 입찰 프로젝트(bid_projects)에서 마감을 모은다.
// 조직 전체 보기는 IT 범위 실공고(ADR-069)의 마감과 나라장터 입찰공고 원본(raw_payload)의 일정(제출 시작·자격 등록·협정서·
// 현장설명회·개찰)도 싣는다. 원본은 수집이 이미 저장한 값이라 API 호출·저장을 더하지 않는다.
// 날짜는 전부 입력 값으로 계산한다(Date.now() 를 부르지 않는다). 업무 기준은 KST 다(scoring/calendar 의 kstDate).

/** 화면이 확인한 지금 조직과 사용자. 조직은 서버가 정한다(M17). */
export type CalendarScope = { orgId: string; userId: string };

// org: 내 관심 + 조직의 열린 프로젝트 전부 + IT 범위 실공고. 관심·프로젝트는 IT 범위 밖이어도 싣는다(사람이 고른 것). mine: 내 관심 + 내가 담당인 프로젝트.
// 관심은 본인 것만 보인다(N3 설계 D6) — 조직 전체에도 남의 관심은 없다.
export const CALENDAR_VIEWS = ["org", "mine"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const DEFAULT_CALENDAR_VIEW: CalendarView = "org";

// 나라장터 입찰공고 원본의 일정. 입찰 마감(bidClseDt)은 공고 마감(deadline_at)과 같은 값이라 읽지 않는다(중복 금지).
export const SCHEDULE_KINDS = [
  "BID_BEGIN",
  "QUALIFICATION_DUE",
  "JOINT_AGREEMENT_DUE",
  "SITE_BRIEFING",
  "OPENING",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** 원본 일정 종류 → raw_payload 키(나라장터 입찰공고 API 응답 필드). 현장설명회 장소는 dcmtgOprtnPlce 다. */
export const RAW_SCHEDULE_KEYS = {
  BID_BEGIN: "bidBeginDt",
  QUALIFICATION_DUE: "bidQlfctRgstDt",
  JOINT_AGREEMENT_DUE: "cmmnSpldmdAgrmntClseDt",
  SITE_BRIEFING: "dcmtgOprtnDt",
  OPENING: "opengDt",
} as const satisfies Record<ScheduleKind, string>;
export const RAW_SITE_PLACE_KEY = "dcmtgOprtnPlce";

/** 최신 revision 원본의 일정 원문(KST, 오프셋 없음). 키가 없거나 빈 값이면 null 이다. */
export type RawSchedule = Record<ScheduleKind, string | null> & { sitePlace: string | null };

export const EMPTY_RAW_SCHEDULE: RawSchedule = {
  BID_BEGIN: null,
  QUALIFICATION_DUE: null,
  JOINT_AGREEMENT_DUE: null,
  SITE_BRIEFING: null,
  OPENING: null,
  sitePlace: null,
};

// ── 공고 분야(칩 색). 새로 저장하지 않고 목록 뷰(opportunity_list_items.categories)와 같은 규칙으로 계산한다 ──
// 규칙 출처: supabase/migrations/20261029000300_it_bid_scope.sql 목록 뷰의 cls·eff·cat, 정규식은 20261030000100_inline_it_scope.sql.
// 순서는 대표 분야 우선순위다. 분야가 여럿이면 앞의 것 하나로 칠한다(드문 분야가 SI·SW 에 묻히지 않게, 2026-11-03 사용자 결정).
export const CALENDAR_FIELDS = [
  "AI_AX",
  "SECURITY",
  "CLOUD",
  "DATA",
  "DIGITAL_TWIN",
  "SI_SW",
] as const;
export type CalendarField = (typeof CALENDAR_FIELDS)[number];

// it_scope_ai_title: 영문 단어 경계의 AI·AX·LLM·RAG 와 한국어 AI 단어("지능형"은 넣지 않는다, 실측 오탐).
const AI_TITLE =
  /(^|[^a-z0-9_])(ai|ax|llm|rag)([^a-z0-9_]|$)|인공지능|생성형|챗봇|머신러닝|딥러닝|초거대/i;
// it_scope_it_class: 공식 IT 공공조달분류명.
const IT_CLASS =
  /정보시스템|소프트웨어|데이터|정보인프라|클라우드|공간정보DB|정보통신|네트워크|전산|정보화/;

const isCalendarField = (value: string): value is CalendarField =>
  (CALENDAR_FIELDS as readonly string[]).includes(value);

/**
 * 공고의 대표 분야. categories 는 최신 revision 의 가장 최근 관련성 평가 분야, procurementClass 는 공공조달분류명이다.
 * 1) 평가 분야 가운데 아는 값(OTHER·모르는 값 제외) 2) 제목 AI 단어면 AI_AX 3) 1이 비었고 공식 IT 분류면 SI_SW.
 * 셋을 합친 것에서 CALENDAR_FIELDS 순서로 처음 것, 없으면 null(분야 없음)이다.
 */
export function primaryFieldOf({
  categories,
  title,
  procurementClass,
}: {
  categories: readonly string[];
  title: string;
  procurementClass: string | null;
}): CalendarField | null {
  const found = categories.filter(isCalendarField);
  const fields = new Set<CalendarField>(found);
  if (AI_TITLE.test(title)) fields.add("AI_AX");
  if (found.length === 0 && IT_CLASS.test(procurementClass ?? "")) fields.add("SI_SW");
  return CALENDAR_FIELDS.find((field) => fields.has(field)) ?? null;
}

export type CalendarBid = {
  id: string;
  title: string;
  agency: string | null;
  deadlineAt: string | null;
  isDemo: boolean;
  cancelled: boolean;
  // 대표 분야(primaryFieldOf). 분야가 없으면 null 이다.
  field: CalendarField | null;
  // 최신 revision 원본의 일정. 나라장터 입찰공고가 아니면(데모·다른 출처) 비어 있다.
  rawSchedule: RawSchedule;
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

// relevantBids: IT 범위 실공고(조직 전체 보기만 읽는다). 저장이 대상 조건·IT 범위로 이미 거른 것이다.
export type CalendarSource = {
  watchedBids: CalendarBid[];
  projects: CalendarProject[];
  relevantBids: CalendarBid[];
};

/** 공고 마감(deadline_at) 범위. from ≤ 마감 < to(ISO). */
export type DeadlineWindow = { from: string; to: string };

/**
 * 저장 포트. 구현(calendar.repo)은 사용자 세션 + RLS 로만 읽는다.
 * 관련 공고는 따로 읽는다(조직 전체 보기만 부른다). 관련 공고를 읽지 못해도 관심·프로젝트 일정은 그린다.
 */
export type CalendarRepo = {
  /** 내 관심 공고와 조직의 열린 프로젝트 */
  load(scope: CalendarScope): Promise<Omit<CalendarSource, "relevantBids">>;
  /** IT 범위 실공고 가운데 공고 마감이 window 안인 것(/gaps 와 대상 조건이 같고 마감 하한만 다르다) */
  loadRelevant(window: DeadlineWindow): Promise<CalendarBid[]>;
};

/** 화면이 그릴 일정. relevantFailed 는 관련 공고를 읽지 못해 관심·프로젝트 일정만 실었다는 뜻이다. */
export type CalendarResult = { events: CalendarEvent[]; relevantFailed: boolean };

// SUBMISSION_DUE: 프로젝트 제출 마감(변경 값 우선). BID_DEADLINE: 공고 마감. 나머지는 원본 일정(SCHEDULE_KINDS).
// 프로젝트의 제출 마감이 공고 마감과 같으면 한 건(SUBMISSION_DUE)으로 합친다 — 같은 시각에 두 칩을 그리지 않는다.
export type CalendarEventKind = "SUBMISSION_DUE" | "BID_DEADLINE" | ScheduleKind;

/** 화면의 종류 순서(거르기 칩·범례). 같은 시각 일정의 정렬도 이 순서다. */
export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[] = [
  "SUBMISSION_DUE",
  "BID_DEADLINE",
  ...SCHEDULE_KINDS,
];

export type CalendarEvent = {
  key: string;
  kind: CalendarEventKind;
  at: string;
  // KST 날짜 "YYYY-MM-DD"
  date: string;
  bid: Omit<CalendarBid, "deadlineAt" | "rawSchedule">;
  // 내가 관심 표시한 공고인지
  watched: boolean;
  project: { id: string; status: ProjectStatus; ownerName: string | null; isMine: boolean } | null;
  // 제출 마감을 공고 마감과 다르게 바꿨는지(SUBMISSION_DUE 만)
  dueOverridden: boolean;
  // 현장설명회 장소(SITE_BRIEFING 만, 원본에 있을 때)
  place: string | null;
  href: string;
};

/** revision 들 가운데 공고의 latest_revision 행. 없으면 undefined. */
export const latestRevisionOf = <T extends { revision: number }>(
  latest: number,
  revisions: readonly T[],
): T | undefined => revisions.find((entry) => entry.revision === latest);

// parseKstDateTime 은 상대 날짜("+3d")에만 기준 시각을 쓰는데, 상대 날짜는 시각을 지어낸 값(assumedTime)이라 아래에서 버린다.
// 그래서 기준 시각은 결과에 영향이 없다(Date.now() 를 부르지 않으려고 고정한다).
const UNUSED_ANCHOR = new Date(0);

/**
 * 원본 일정 원문 → UTC ISO. 원문은 KST 이고 오프셋이 없다("YYYY-MM-DD HH:mm[:ss]").
 * 빈 값·형식 오류·없는 날짜, 그리고 시각 없이 날짜만 있는 값은 null(정보 부족은 일정 없음).
 */
export function parseScheduleTime(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") return null;
  const parsed = parseKstDateTime(raw, UNUSED_ANCHOR);
  return parsed.ok && !parsed.assumedTime ? parsed.value : null;
}

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
  place: string | null = null,
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
      field: bid.field,
    },
    watched,
    project,
    dueOverridden,
    place,
    href:
      kind === "SUBMISSION_DUE" && project !== null ? `/projects/${project.id}` : bidHrefOf(bid),
  };
}

const projectRefOf = (project: CalendarProject, userId: string): CalendarEvent["project"] => ({
  id: project.id,
  status: project.status,
  ownerName: project.ownerName,
  isMine: project.ownerId === userId,
});

function projectEventsOf(
  project: CalendarProject,
  watched: boolean,
  userId: string,
): CalendarEvent[] {
  const ref = projectRefOf(project, userId);
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

// 원본 일정. 취소된 공고는 마감 칩(줄 그음)만 남기고 원본 일정은 싣지 않는다(열리지 않을 일정이다).
function scheduleEventsOf(
  bid: CalendarBid,
  watched: boolean,
  project: CalendarEvent["project"],
): CalendarEvent[] {
  if (bid.cancelled) return [];
  return SCHEDULE_KINDS.flatMap((kind) => {
    const at = parseScheduleTime(bid.rawSchedule[kind]);
    if (at === null) return [];
    const place =
      kind === "SITE_BRIEFING" ? (bid.rawSchedule.sitePlace?.trim() ?? "") || null : null;
    return [eventOf(kind, at, bid, watched, project, false, place)];
  });
}

const KIND_ORDER = Object.fromEntries(
  CALENDAR_EVENT_KINDS.map((kind, index) => [kind, index]),
) as Record<CalendarEventKind, number>;

// 시각 순, 같은 시각이면 종류 순(제출 마감 → 공고 마감 → 원본 일정), 다음은 공고명 가나다.
const byTime = (a: CalendarEvent, b: CalendarEvent) =>
  Date.parse(a.at) - Date.parse(b.at) ||
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.bid.title.localeCompare(b.bid.title, "ko") ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

// 같은 공고·종류·시각은 한 번만 그린다. 앞의 것(관심·프로젝트 표시가 붙은 것)을 남긴다.
function distinctEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const identity = `${event.bid.id}|${event.kind}|${Date.parse(event.at)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/**
 * 관심 공고·열린 프로젝트·관련 공고(조직 전체만)에서 일정을 모은다.
 * 같은 공고가 관심이면서 프로젝트이면 프로젝트 일정 하나에 관심 표시(watched)를 얹는다.
 * 관련 공고가 관심·프로젝트이기도 하면 그쪽 일정(표시가 붙은 것)만 남긴다.
 * 원본 일정은 공고마다 한 번, 그 공고의 관심·프로젝트 표시를 붙여 싣는다. 마감이 없는 공고는 마감 일정이 없다.
 */
export function collectCalendarEvents(
  source: CalendarSource,
  { userId, view }: { userId: string; view: CalendarView },
): CalendarEvent[] {
  const watchedIds = new Set(source.watchedBids.map((bid) => bid.id));
  const projectByBid = new Map(source.projects.map((project) => [project.bid.id, project]));
  const fromProjects = source.projects.flatMap((project) =>
    projectEventsOf(project, watchedIds.has(project.bid.id), userId),
  );
  const fromWatches = source.watchedBids.flatMap((bid) =>
    projectByBid.has(bid.id) || bid.deadlineAt === null
      ? []
      : [eventOf("BID_DEADLINE", bid.deadlineAt, bid, true, null, false)],
  );
  // 관심·프로젝트인 관련 공고는 위에서 이미 그렸다. 관련 공고만의 일정은 관심·프로젝트 표시가 없어
  // 내 일정 보기에서는 아래 거르기가 뺀다(저장도 내 일정에서는 관련 공고를 읽지 않는다).
  const relevant = source.relevantBids.filter(
    (bid) => !watchedIds.has(bid.id) && !projectByBid.has(bid.id),
  );
  const fromRelevant = relevant.flatMap((bid) =>
    bid.deadlineAt === null
      ? []
      : [eventOf("BID_DEADLINE", bid.deadlineAt, bid, false, null, false)],
  );
  // 원본 일정: 공고마다 한 번(프로젝트 → 관심 → 관련 순으로 처음 본 공고 행을 쓴다).
  const scheduleBids = new Map<string, CalendarBid>();
  for (const bid of [
    ...source.projects.map((project) => project.bid),
    ...source.watchedBids,
    ...relevant,
  ])
    if (!scheduleBids.has(bid.id)) scheduleBids.set(bid.id, bid);
  const fromSchedule = [...scheduleBids.values()].flatMap((bid) => {
    const project = projectByBid.get(bid.id);
    return scheduleEventsOf(
      bid,
      watchedIds.has(bid.id),
      project === undefined ? null : projectRefOf(project, userId),
    );
  });
  const events = distinctEvents([
    ...fromProjects,
    ...fromWatches,
    ...fromRelevant,
    ...fromSchedule,
  ]);
  const visible =
    view === "mine" ? events.filter((event) => event.watched || event.project?.isMine) : events;
  return visible.toSorted(byTime);
}

// ── 종류 거르기(?kinds=) ──

/**
 * 주소의 ?kinds=A,B. 없으면 전부다. 모르는 값은 무시한다.
 * 적혀 있는데 아는 값이 하나도 없으면(빈 값 포함) 빈 목록이다 — 전부로 되돌리지 않고 화면이 "0건 + 전체 보기"를 보인다.
 */
export function parseKinds(param: string | undefined): CalendarEventKind[] {
  if (param === undefined) return [...CALENDAR_EVENT_KINDS];
  const asked = new Set(param.split(",").map((value) => value.trim()));
  return CALENDAR_EVENT_KINDS.filter((kind) => asked.has(kind));
}

/** 보이는 종류에서 하나를 켜고 끈 목록(화면 종류 순서). */
export function toggleKind(
  kinds: readonly CalendarEventKind[],
  kind: CalendarEventKind,
): CalendarEventKind[] {
  const next = new Set(kinds);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return CALENDAR_EVENT_KINDS.filter((known) => next.has(known));
}

/** 전부 보이면 주소에 적지 않는다(null). */
export const kindsParam = (kinds: readonly CalendarEventKind[]): string | null =>
  CALENDAR_EVENT_KINDS.every((kind) => kinds.includes(kind)) ? null : kinds.join(",");

export const filterKinds = (
  events: readonly CalendarEvent[],
  kinds: readonly CalendarEventKind[],
): CalendarEvent[] => events.filter((event) => kinds.includes(event.kind));

// ── 관련 공고를 읽을 공고 마감 범위 ──

// 원본 일정은 공고 마감(deadline_at) 앞뒤에 있다. 제출 시작·자격 등록·협정서·현장설명회는 마감 전(공고 기간, 길어도 40일 안팎),
// 개찰은 마감 뒤(보통 같은 날, 협상·2단계 입찰은 며칠 뒤)다. 그래서 마감이 [오늘 − 14일, 보일 끝날 + 45일) 인 공고를 읽으면
// 오늘부터 보일 칸의 원본 일정이 빠지지 않는다고 가정한다(마감이 지나도 개찰까지 남는다).
// 이 밖의 일정(마감 45일 넘게 전의 제출 시작 등)은 그 공고가 범위에 들 때만 보인다.
// 하한은 보일 첫날이 아니라 오늘 기준이다. 마감이 14일 넘게 지난 관련 공고는 읽지 않아 지난 달 칸에는 보이지 않는다(출처 줄이 설명한다).
export const SCHEDULE_LAG_AFTER_DEADLINE_DAYS = 14;
export const SCHEDULE_LEAD_BEFORE_DEADLINE_DAYS = 45;

const kstMidnightIso = (key: string) => new Date(`${key}T00:00:00+09:00`).toISOString();

/**
 * 관련 공고를 읽을 공고 마감 범위. 앞은 오늘 0시(KST) − 14일, 뒤는 보일 끝날(달력 격자 끝날과 다가오는 14일 끝 중 늦은 날) + 45일까지다.
 * lastDay 는 달력 격자 끝날, today 는 오늘(모두 KST "YYYY-MM-DD").
 */
export function relevantDeadlineWindow(
  lastDay: string,
  today: string,
  upcomingDays = 14,
): DeadlineWindow {
  const upcomingLast = addDays(today, upcomingDays - 1);
  const last = lastDay > upcomingLast ? lastDay : upcomingLast;
  return {
    from: kstMidnightIso(addDays(today, -SCHEDULE_LAG_AFTER_DEADLINE_DAYS)),
    to: kstMidnightIso(addDays(last, SCHEDULE_LEAD_BEFORE_DEADLINE_DAYS + 1)),
  };
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
