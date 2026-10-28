import { describe, expect, it } from "vitest";
import {
  collectCalendarEvents,
  monthWeeks,
  parseMonth,
  upcomingEvents,
  type CalendarBid,
  type CalendarProject,
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
        { watchedBids: [empty], projects: [project("p", bid("b", null))] },
        { userId: ME, view: "org" },
      ),
    ).toEqual([]);
  });
});

describe("collectCalendarEvents — 중복", () => {
  it("관심 공고이면서 프로젝트가 있으면 제출 마감 한 건에 관심 표시를 얹는다", () => {
    const target = bid("a", "2026-11-05T01:00:00Z");
    const events = collectCalendarEvents(
      { watchedBids: [target], projects: [project("p", target)] },
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
      },
      { userId: ME, view: "org" },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "SUBMISSION_DUE", dueOverridden: false });
  });
});

describe("collectCalendarEvents — 거르기", () => {
  const source = {
    watchedBids: [bid("watched", "2026-11-02T01:00:00Z")],
    projects: [
      project("mine", bid("m", "2026-11-03T01:00:00Z")),
      project("theirs", bid("t", "2026-11-04T01:00:00Z"), { ownerId: OTHER, ownerName: "이영업" }),
      project("nobody", bid("n", "2026-11-04T02:00:00Z"), { ownerId: null, ownerName: null }),
    ],
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
      { watchedBids: [target], projects: [project("theirs", target, { ownerId: OTHER })] },
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
