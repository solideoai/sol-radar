import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENT_KINDS,
  EMPTY_RAW_SCHEDULE,
  collectCalendarEvents,
  filterKinds,
  isRelevantState,
  kindsParam,
  latestRelevanceState,
  monthWeeks,
  parseKinds,
  parseMonth,
  parseScheduleTime,
  relevantDeadlineWindow,
  toggleKind,
  upcomingEvents,
  type CalendarBid,
  type CalendarProject,
  type CalendarSource,
} from "./calendar.model";

const ME = "user-me";
const OTHER = "user-other";

const bid = (
  id: string,
  deadlineAt: string | null,
  extra: Partial<CalendarBid> = {},
): CalendarBid => ({
  id,
  title: `공고 ${id}`,
  agency: "조달청",
  deadlineAt,
  isDemo: false,
  cancelled: false,
  rawSchedule: EMPTY_RAW_SCHEDULE,
  ...extra,
});

const project = (
  id: string,
  target: CalendarBid,
  extra: Partial<CalendarProject> = {},
): CalendarProject => ({
  id,
  status: "PREPARING",
  ownerId: ME,
  ownerName: "김소유",
  submissionDueOverride: null,
  bid: target,
  ...extra,
});

describe("collectCalendarEvents — 날짜", () => {
  it("UTC 15:00 마감은 KST 다음 날, 14:59 는 그날이다", () => {
    const events = collectCalendarEvents(
      {
        watchedBids: [bid("a", "2026-10-31T15:00:00Z"), bid("b", "2026-10-31T14:59:00Z")],
        projects: [],
        relevantBids: [],
      },
      { userId: ME, view: "org" },
    );
    expect(events.map((event) => [event.bid.id, event.date])).toEqual([
      ["b", "2026-10-31"],
      ["a", "2026-11-01"],
    ]);
  });

  it("마감이 없는 관심 공고와 프로젝트는 일정이 없다", () => {
    const empty = bid("a", null);
    expect(
      collectCalendarEvents(
        { watchedBids: [empty], projects: [project("p", bid("b", null))], relevantBids: [] },
        { userId: ME, view: "org" },
      ),
    ).toEqual([]);
  });
});

describe("collectCalendarEvents — 중복", () => {
  it("관심 공고이면서 프로젝트가 있으면 제출 마감 한 건에 관심 표시를 얹는다", () => {
    const target = bid("a", "2026-11-05T01:00:00Z");
    const events = collectCalendarEvents(
      { watchedBids: [target], projects: [project("p", target)], relevantBids: [] },
      { userId: ME, view: "org" },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "SUBMISSION_DUE",
      watched: true,
      dueOverridden: false,
      href: "/projects/p",
      project: { id: "p", isMine: true },
    });
  });

  it("제출 마감을 바꾸면 제출 마감과 공고 마감이 따로 두 건이다", () => {
    const target = bid("a", "2026-11-05T01:00:00Z", { isDemo: true });
    const events = collectCalendarEvents(
      {
        watchedBids: [],
        projects: [project("p", target, { submissionDueOverride: "2026-11-03T09:00:00Z" })],
        relevantBids: [],
      },
      { userId: ME, view: "org" },
    );
    expect(
      events.map((event) => [event.kind, event.date, event.dueOverridden, event.href]),
    ).toEqual([
      ["SUBMISSION_DUE", "2026-11-03", true, "/projects/p"],
      ["BID_DEADLINE", "2026-11-05", false, "/bids/a?origin=demo"],
    ]);
  });

  it("바꾼 제출 마감이 공고 마감과 같은 시각이면(표기만 다름) 한 건이다", () => {
    const target = bid("a", "2026-11-05T01:00:00Z");
    const events = collectCalendarEvents(
      {
        watchedBids: [],
        projects: [project("p", target, { submissionDueOverride: "2026-11-05T10:00:00+09:00" })],
        relevantBids: [],
      },
      { userId: ME, view: "org" },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "SUBMISSION_DUE", dueOverridden: false });
  });
});

describe("collectCalendarEvents — 거르기", () => {
  const source: CalendarSource = {
    watchedBids: [bid("watched", "2026-11-02T01:00:00Z")],
    projects: [
      project("mine", bid("m", "2026-11-03T01:00:00Z")),
      project("theirs", bid("t", "2026-11-04T01:00:00Z"), { ownerId: OTHER, ownerName: "이영업" }),
      project("nobody", bid("n", "2026-11-04T02:00:00Z"), { ownerId: null, ownerName: null }),
    ],
    relevantBids: [],
  };

  it("조직 전체는 내 관심과 조직의 열린 프로젝트를 모두 보인다", () => {
    const keys = collectCalendarEvents(source, { userId: ME, view: "org" }).map(
      (event) => event.key,
    );
    expect(keys).toEqual([
      "BID_DEADLINE:watched",
      "SUBMISSION_DUE:mine",
      "SUBMISSION_DUE:theirs",
      "SUBMISSION_DUE:nobody",
    ]);
  });

  it("내 일정은 내 관심과 내가 담당인 프로젝트만 보인다", () => {
    const keys = collectCalendarEvents(source, { userId: ME, view: "mine" }).map(
      (event) => event.key,
    );
    expect(keys).toEqual(["BID_DEADLINE:watched", "SUBMISSION_DUE:mine"]);
  });

  it("남의 프로젝트라도 내가 관심 표시한 공고면 내 일정에 남는다", () => {
    const target = bid("t", "2026-11-04T01:00:00Z");
    const keys = collectCalendarEvents(
      {
        watchedBids: [target],
        projects: [project("theirs", target, { ownerId: OTHER })],
        relevantBids: [],
      },
      { userId: ME, view: "mine" },
    ).map((event) => event.key);
    expect(keys).toEqual(["SUBMISSION_DUE:theirs"]);
  });
});

describe("monthWeeks", () => {
  it("2026년 10월은 월요일 9/28 에 시작해 일요일 11/1 에 끝나는 5주다", () => {
    const weeks = monthWeeks({ year: 2026, month: 10 });
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toEqual({ date: "2026-09-28", day: 28, inMonth: false });
    expect(weeks[0]?.[3]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(weeks[4]?.[6]).toEqual({ date: "2026-11-01", day: 1, inMonth: false });
  });

  it("일요일에 시작하는 31일 달(2026년 3월)은 6주다", () => {
    const weeks = monthWeeks({ year: 2026, month: 3 });
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[6]).toEqual({ date: "2026-03-01", day: 1, inMonth: true });
    expect(weeks[5]?.[1]).toEqual({ date: "2026-03-31", day: 31, inMonth: true });
  });
});

describe("upcomingEvents", () => {
  const at = (iso: string) => bid(iso, iso);
  const events = collectCalendarEvents(
    {
      watchedBids: [
        at("2026-10-28T04:00:00Z"), // 오늘 13:00 KST, 지났다
        at("2026-10-28T06:00:00Z"), // 오늘 15:00 KST
        at("2026-11-10T14:59:00Z"), // 13일 뒤 23:59 KST
        at("2026-11-10T15:00:00Z"), // 14일 뒤 00:00 KST
      ],
      projects: [],
      relevantBids: [],
    },
    { userId: ME, view: "org" },
  );

  it("지금부터 오늘 포함 14일(KST) 안의 일정만, 오늘 지난 시각은 빼고 보인다", () => {
    expect(upcomingEvents(events, "2026-10-28T05:00:00Z").map((event) => event.at)).toEqual([
      "2026-10-28T06:00:00Z",
      "2026-11-10T14:59:00Z",
    ]);
  });
});

describe("parseMonth", () => {
  const fallback = { year: 2026, month: 10 };
  it("YYYY-MM 은 그 달, 형식이 틀리거나 달이 범위 밖이면 오늘의 달이다", () => {
    expect(parseMonth("2026-12", fallback)).toEqual({ year: 2026, month: 12 });
    expect(parseMonth("2026-13", fallback)).toEqual(fallback);
    expect(parseMonth("2026-1", fallback)).toEqual(fallback);
    expect(parseMonth(undefined, fallback)).toEqual(fallback);
  });
});

describe("parseScheduleTime — 나라장터 원본 시각(KST, 오프셋 없음)", () => {
  it("'YYYY-MM-DD HH:mm[:ss]' 를 Asia/Seoul 로 읽는다", () => {
    expect(parseScheduleTime("2026-10-28 14:00:00")).toBe("2026-10-28T05:00:00.000Z");
    expect(parseScheduleTime("2026-11-23 10:00")).toBe("2026-11-23T01:00:00.000Z");
    // KST 00:30 은 UTC 로 전날이다.
    expect(parseScheduleTime("2026-11-01 00:30")).toBe("2026-10-31T15:30:00.000Z");
  });

  it("빈 값·형식 오류·없는 날짜·시각 없는 날짜·상대 날짜는 일정 없음(null)이다", () => {
    for (const raw of [
      null,
      "",
      "   ",
      "2026/11/23 10:00",
      "내일 10시",
      "2026-02-30 10:00",
      "2026-11-23",
      "+3d",
    ])
      expect(parseScheduleTime(raw)).toBeNull();
  });
});

describe("collectCalendarEvents — 원본 일정", () => {
  const FULL = {
    BID_BEGIN: "2026-11-02 09:00:00",
    QUALIFICATION_DUE: "2026-11-09 18:00",
    JOINT_AGREEMENT_DUE: "2026-11-09 18:00:00",
    SITE_BRIEFING: "2026-11-04 14:00",
    OPENING: "2026-11-10 11:00:00",
    sitePlace: "  세종청사 6동 대회의실 ",
  };
  const kindsOf = (source: Partial<CalendarSource>, view: "org" | "mine" = "org") =>
    collectCalendarEvents(
      { watchedBids: [], projects: [], relevantBids: [], ...source },
      { userId: ME, view },
    ).map((event) => [event.kind, event.at, event.place]);

  it("종류마다 원본 키의 시각으로 한 건씩, 현장설명회에만 장소(앞뒤 공백 없이)를 붙인다", () => {
    const target = bid("r", "2026-11-10T01:00:00Z", { rawSchedule: FULL });
    expect(kindsOf({ relevantBids: [target] })).toEqual([
      ["BID_BEGIN", "2026-11-02T00:00:00.000Z", null],
      ["SITE_BRIEFING", "2026-11-04T05:00:00.000Z", "세종청사 6동 대회의실"],
      ["QUALIFICATION_DUE", "2026-11-09T09:00:00.000Z", null],
      ["JOINT_AGREEMENT_DUE", "2026-11-09T09:00:00.000Z", null],
      ["BID_DEADLINE", "2026-11-10T01:00:00Z", null],
      ["OPENING", "2026-11-10T02:00:00.000Z", null],
    ]);
  });

  it("빈 값·형식이 틀린 키는 그 일정만 버리고 공고의 다른 일정은 남긴다", () => {
    const target = bid("r", "2026-11-10T01:00:00Z", {
      rawSchedule: {
        ...EMPTY_RAW_SCHEDULE,
        BID_BEGIN: "",
        QUALIFICATION_DUE: "2026.11.09",
        SITE_BRIEFING: "2026-11-04 14:00",
        sitePlace: "   ",
        OPENING: "2026-11-10 11:00",
      },
    });
    expect(kindsOf({ relevantBids: [target] })).toEqual([
      ["SITE_BRIEFING", "2026-11-04T05:00:00.000Z", null],
      ["BID_DEADLINE", "2026-11-10T01:00:00Z", null],
      ["OPENING", "2026-11-10T02:00:00.000Z", null],
    ]);
  });

  it("취소된 공고는 마감 칩만 남기고 원본 일정은 싣지 않는다", () => {
    const cancelled = bid("c", "2026-11-10T01:00:00Z", { cancelled: true, rawSchedule: FULL });
    expect(kindsOf({ watchedBids: [cancelled] }).map(([kind]) => kind)).toEqual(["BID_DEADLINE"]);
  });

  it("같은 공고가 관심·프로젝트·관련에 함께 걸려도 (공고, 종류, 시각)마다 한 번, 관심·프로젝트 표시를 얹는다", () => {
    const target = bid("x", "2026-11-10T01:00:00Z", { rawSchedule: FULL });
    const events = collectCalendarEvents(
      {
        watchedBids: [target],
        projects: [project("p", target)],
        relevantBids: [target],
      },
      { userId: ME, view: "org" },
    );
    expect(events.map((event) => event.kind).toSorted()).toEqual(
      [
        "SUBMISSION_DUE",
        ...Object.keys(EMPTY_RAW_SCHEDULE).filter((key) => key !== "sitePlace"),
      ].toSorted(),
    );
    for (const event of events)
      expect(event).toMatchObject({ watched: true, project: { id: "p", isMine: true } });
  });

  it("관련 공고는 관심·프로젝트가 아니어도 조직 전체에 마감·원본 일정이 실리고, 관심·프로젝트 표시는 없다", () => {
    const relevant = bid("r", "2026-11-10T01:00:00Z", { rawSchedule: FULL });
    const events = collectCalendarEvents(
      {
        watchedBids: [],
        projects: [],
        // 쪽 나눠 읽기 사이에 같은 공고가 두 번 와도 일정은 한 번씩이다.
        relevantBids: [relevant, relevant],
      },
      { userId: ME, view: "org" },
    );
    expect(events).toHaveLength(6);
    for (const event of events)
      expect(event).toMatchObject({ watched: false, project: null, href: "/bids/r?origin=live" });
  });

  it("내 일정은 관련 공고를 싣지 않고, 관심·내 프로젝트 공고의 원본 일정만 싣는다", () => {
    const schedule = { ...EMPTY_RAW_SCHEDULE, OPENING: "2026-11-10 11:00" };
    const source: CalendarSource = {
      watchedBids: [bid("w", "2026-11-10T01:00:00Z", { rawSchedule: schedule })],
      projects: [
        project("mine", bid("m", "2026-11-10T01:00:00Z", { rawSchedule: schedule })),
        project("theirs", bid("t", "2026-11-10T01:00:00Z", { rawSchedule: schedule }), {
          ownerId: OTHER,
        }),
      ],
      relevantBids: [bid("r", "2026-11-10T01:00:00Z", { rawSchedule: schedule })],
    };
    const keys = collectCalendarEvents(source, { userId: ME, view: "mine" }).map(
      (event) => event.key,
    );
    expect(keys.toSorted()).toEqual(
      ["BID_DEADLINE:w", "OPENING:w", "SUBMISSION_DUE:mine", "OPENING:m"].toSorted(),
    );
  });
});

describe("관련성 — 최신 revision 의 최신 평가", () => {
  it("만든 시각이 늦은 평가, 같으면 id 가 큰 평가를 쓴다. 평가가 없으면 null 이다", () => {
    const at = "2026-10-28T00:00:00Z";
    expect(
      latestRelevanceState([
        { state: "RELEVANT", createdAt: "2026-10-27T00:00:00Z", id: "b" },
        { state: "LOW_RELEVANCE", createdAt: at, id: "a" },
      ]),
    ).toBe("LOW_RELEVANCE");
    expect(
      latestRelevanceState([
        { state: "LOW_RELEVANCE", createdAt: at, id: "a" },
        { state: "CANDIDATE", createdAt: at, id: "b" },
      ]),
    ).toBe("CANDIDATE");
    expect(latestRelevanceState([])).toBeNull();
  });

  it("RELEVANT·CANDIDATE 만 관련 업종이다(사람 확인 필요·낮음·미분류·평가 없음은 아니다)", () => {
    expect(
      ["RELEVANT", "CANDIDATE", "NEEDS_REVIEW", "LOW_RELEVANCE", "UNCLASSIFIED", null].map(
        isRelevantState,
      ),
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe("종류 거르기(?kinds=)", () => {
  it("없으면 전부, 모르는 값은 무시하고 화면 순서로 돌려준다", () => {
    expect(parseKinds(undefined)).toEqual(CALENDAR_EVENT_KINDS);
    expect(parseKinds("OPENING,NOPE,BID_BEGIN")).toEqual(["BID_BEGIN", "OPENING"]);
  });

  it("아는 값이 하나도 없거나 빈 값이면 전부가 아니라 빈 목록이다(화면은 0건 + 전체 보기)", () => {
    expect(parseKinds("NOPE")).toEqual([]);
    expect(parseKinds("")).toEqual([]);
  });

  it("켜고 끈 목록은 주소에 적고, 전부면 적지 않는다. 다 끄면 빈 값으로 적어 0건을 지킨다", () => {
    const withoutOpening = toggleKind(CALENDAR_EVENT_KINDS, "OPENING");
    expect(kindsParam(withoutOpening)).toBe(
      "SUBMISSION_DUE,BID_DEADLINE,BID_BEGIN,QUALIFICATION_DUE,JOINT_AGREEMENT_DUE,SITE_BRIEFING",
    );
    expect(kindsParam(toggleKind(withoutOpening, "OPENING"))).toBeNull();
    expect(kindsParam(toggleKind(["OPENING"], "OPENING"))).toBe("");
    expect(parseKinds(kindsParam([]) ?? undefined)).toEqual([]);
  });

  it("고른 종류의 일정만 남긴다", () => {
    const events = collectCalendarEvents(
      {
        watchedBids: [
          bid("w", "2026-11-10T01:00:00Z", {
            rawSchedule: { ...EMPTY_RAW_SCHEDULE, OPENING: "2026-11-10 11:00" },
          }),
        ],
        projects: [],
        relevantBids: [],
      },
      { userId: ME, view: "org" },
    );
    expect(filterKinds(events, ["OPENING"]).map((event) => event.kind)).toEqual(["OPENING"]);
    expect(filterKinds(events, [])).toEqual([]);
  });
});

describe("relevantDeadlineWindow — 관련 공고를 읽을 공고 마감 범위", () => {
  it("2026년 10월(격자 끝 11-01, 오늘 10-28)은 10-14 00:00 KST 부터 12-26 00:00 KST 전까지다", () => {
    // 다가오는 14일 끝(11-10)이 격자 끝보다 늦어 그쪽 + 45일을 덮는다.
    expect(relevantDeadlineWindow("2026-11-01", "2026-10-28")).toEqual({
      from: "2026-10-13T15:00:00.000Z",
      to: "2026-12-25T15:00:00.000Z",
    });
  });

  const insideOf = (window: { from: string; to: string }) => (deadlineKst: string) => {
    const at = new Date(`${deadlineKst}+09:00`).toISOString();
    return window.from <= at && at < window.to;
  };

  it("마감이 지났어도 오늘 0시(KST) 14일 전 이후면 범위 안이고, 그보다 이르면 밖이다(지금이 하한이 아니다)", () => {
    // 오늘 10-28 14:00 에 본다. 오늘 10:00 마감 공고는 11:00 개찰이 남아 있어 읽어야 한다.
    const inside = insideOf(relevantDeadlineWindow("2026-11-01", "2026-10-28"));
    expect(inside("2026-10-28T10:00:00")).toBe(true);
    expect(inside("2026-10-14T00:00:00")).toBe(true);
    expect(inside("2026-10-13T23:59:00")).toBe(false);
  });

  it("가정: 앞은 보는 달과 상관없이 오늘 기준, 뒤는 보일 끝날 45일 뒤까지다(개찰은 마감 뒤 14일, 제출 시작은 마감 전 45일 안)", () => {
    // 다음다음 달(격자 끝 2027-01-03)을 봐도 앞은 오늘(10-28) − 14일이다(다가오는 14일도 같은 범위로 읽는다).
    const inside = insideOf(relevantDeadlineWindow("2027-01-03", "2026-10-28"));
    expect(inside("2026-10-14T00:00:00")).toBe(true);
    expect(inside("2026-10-13T23:59:00")).toBe(false);
    // 뒤쪽: 격자 끝날(2027-01-03) + 45일 = 2027-02-17 의 마지막 시각까지.
    expect(inside("2027-02-17T23:59:00")).toBe(true);
    expect(inside("2027-02-18T00:00:00")).toBe(false);
  });
});
