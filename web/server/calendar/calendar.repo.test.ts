import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCalendarEvents } from "./calendar.service";

// 가짜 Supabase. 요청마다 받은 (메서드, 인자)를 적고, 표마다 정해 둔 쪽을 차례로 돌려준다. errors 에 적은 표는 오류를 돌려준다.
const { pages, errors, requests } = vi.hoisted(() => ({
  pages: {} as Record<string, unknown[][]>,
  errors: {} as Record<string, unknown>,
  requests: [] as unknown[][][],
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: (table: string) => {
      const calls: unknown[][] = [["from", table]];
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      const builder = {
        select: record("select"),
        eq: record("eq"),
        neq: record("neq"),
        in: record("in"),
        is: record("is"),
        gt: record("gt"),
        gte: record("gte"),
        lt: record("lt"),
        order: record("order"),
        limit: record("limit"),
        overrideTypes: () => builder,
        then: (resolve: (value: unknown) => void) => {
          requests.push(calls);
          const error = errors[table];
          resolve(
            error === undefined
              ? { data: pages[table]?.shift() ?? [], error: null }
              : { data: null, error },
          );
        },
      };
      return builder;
    },
  }),
}));

const SCOPE = { orgId: "org-1", userId: "user-me" };
// 오늘 10-28 에 2026년 10월을 볼 때의 범위(relevantDeadlineWindow): 10-14 00:00 KST 부터 12-26 00:00 KST 전까지
const WINDOW = { from: "2026-10-13T15:00:00.000Z", to: "2026-12-25T15:00:00.000Z" };

type StoredAssessment = { categories: string[]; created_at: string; id: string };

const revision = (
  number: number,
  opening: string | null = "2026-11-10 11:00:00",
  {
    procurementClass = null,
    relevance = [],
  }: {
    procurementClass?: string | null;
    relevance?: StoredAssessment[];
  } = {},
) => ({
  revision: number,
  BID_BEGIN: null,
  QUALIFICATION_DUE: null,
  JOINT_AGREEMENT_DUE: null,
  SITE_BRIEFING: null,
  OPENING: opening,
  sitePlace: null,
  procurementClass,
  relevance,
});

const notice = (
  id: string,
  revisions: ReturnType<typeof revision>[],
  latest = 2,
  itScope: boolean | null = true,
) => ({
  id,
  title: `공고 ${id} (가상)`,
  agency: "가상 기관",
  deadline_at: "2026-11-10T01:00:00Z",
  is_demo: false,
  status: "OPEN",
  latest_revision: latest,
  it_scope: itScope,
  revisions,
});

const noticeRequests = () => requests.filter((calls) => calls[0]?.[1] === "bid_notices");

beforeEach(() => {
  for (const table of Object.keys(pages)) delete pages[table];
  for (const table of Object.keys(errors)) delete errors[table];
  requests.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("calendarRepo — IT 공고", () => {
  it("/gaps 와 같은 대상 조건에 마감 범위(오늘 0시 − 14일부터)를 더해 500건씩 id 순으로 이어 읽는다", async () => {
    const full = Array.from({ length: 500 }, (_, index) =>
      notice(`n${String(index).padStart(3, "0")}`, []),
    );
    pages.bid_notices = [full, []];
    await getCalendarEvents(SCOPE, "org", { window: WINDOW });

    const [first, second] = noticeRequests();
    const filters = [
      ["eq", "is_demo", false],
      ["neq", "source", "fixture"],
      ["eq", "stage", "NOTICE"],
      ["in", "status", ["OPEN", "AMENDED"]],
      // 하한은 지금이 아니라 범위 앞(오늘 0시 − 14일)이다. 마감이 지난 공고도 읽어 개찰까지 보인다(/gaps 는 지금 이후).
      ["gte", "deadline_at", WINDOW.from],
      ["lt", "deadline_at", WINDOW.to],
      ["is", "opportunity.superseded_by", null],
    ];
    expect(first?.slice(2, 9)).toEqual(filters);
    expect(first?.slice(9)).toEqual([
      ["order", "id"],
      ["limit", 500],
    ]);
    expect(second?.slice(2, 10)).toEqual([...filters, ["gt", "id", "n499"]]);
    expect(noticeRequests()).toHaveLength(2);
  });

  it("raw_payload 는 통째로 받지 않고 일정 키만 경로로 고른다", async () => {
    await getCalendarEvents(SCOPE, "org", { window: WINDOW });
    for (const calls of requests) {
      const select = String(calls.find(([method]) => method === "select")?.[1]);
      expect(select.match(/raw_payload(?!->>)/g)).toBeNull();
    }
    const select = String(noticeRequests()[0]?.find(([method]) => method === "select")?.[1]);
    for (const path of [
      "BID_BEGIN:raw_payload->>bidBeginDt",
      "QUALIFICATION_DUE:raw_payload->>bidQlfctRgstDt",
      "JOINT_AGREEMENT_DUE:raw_payload->>cmmnSpldmdAgrmntClseDt",
      "SITE_BRIEFING:raw_payload->>dcmtgOprtnDt",
      "OPENING:raw_payload->>opengDt",
      "sitePlace:raw_payload->>dcmtgOprtnPlce",
    ])
      expect(select).toContain(path);
    // 입찰 마감(bidClseDt)은 공고 마감(deadline_at)과 같은 값이라 읽지 않는다.
    expect(select).not.toContain("bidClseDt");
  });

  it("IT 범위 밖 공고는 마감 일정에서 빠지고 관심 공고는 남는다", async () => {
    // IT 범위는 목록·집계와 같은 DB 계산 열(it_scope, ADR-069)이다. 관심·프로젝트는 IT 범위 밖이어도 싣는다.
    pages.bid_watches = [
      [
        {
          bid: {
            ...notice("watched", [revision(2)], 2, false),
            deadline_at: "2026-11-02T01:00:00Z",
          },
        },
      ],
    ];
    // IT 공고의 원본 일정은 최신 revision(2)의 개찰이다. IT 범위 밖(false·null) 공고는 뺀다.
    pages.bid_notices = [
      [
        notice("it", [revision(1, "2026-11-01 10:00"), revision(2)]),
        notice("other", [revision(2)], 2, false),
        notice("unknown", [revision(2)], 2, null),
      ],
    ];
    const { events, relevantFailed } = await getCalendarEvents(SCOPE, "org", { window: WINDOW });

    expect(relevantFailed).toBe(false);
    const select = String(noticeRequests()[0]?.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("it_scope");
    expect(events.map((event) => [event.key, event.at]).toSorted()).toEqual([
      ["BID_DEADLINE:it", "2026-11-10T01:00:00Z"],
      ["BID_DEADLINE:watched", "2026-11-02T01:00:00Z"],
      ["OPENING:it", "2026-11-10T02:00:00.000Z"],
      ["OPENING:watched", "2026-11-10T02:00:00.000Z"],
    ]);
  });

  it("공고 분야: 최신 revision 의 가장 최근 관련성 평가로 대표 분야를 정한다", async () => {
    pages.bid_notices = [
      [
        notice("n1", [
          revision(1, undefined, {
            relevance: [{ categories: ["AI_AX"], created_at: "2026-10-03T00:00:00Z", id: "c" }],
          }),
          revision(2, undefined, {
            relevance: [
              { categories: ["SI_SW"], created_at: "2026-10-01T00:00:00Z", id: "a" },
              { categories: ["SECURITY", "SI_SW"], created_at: "2026-10-02T00:00:00Z", id: "b" },
            ],
          }),
        ]),
      ],
    ];
    const { events } = await getCalendarEvents(SCOPE, "org", { window: WINDOW });
    expect(events.length).toBeGreaterThan(0); // 공고 마감 + 개찰
    expect(events.every((event) => event.bid.field === "SECURITY")).toBe(true);
  });

  it("공고 분야: 평가가 없으면 공공조달분류명으로 SI·SW, 둘 다 없으면 분야 없음", async () => {
    pages.bid_notices = [
      [
        notice("classified", [revision(2, null, { procurementClass: "정보시스템유지관리서비스" })]),
        notice("none", [revision(2, null)]),
      ],
    ];
    const { events } = await getCalendarEvents(SCOPE, "org", { window: WINDOW });
    expect(Object.fromEntries(events.map((event) => [event.bid.id, event.bid.field]))).toEqual({
      classified: "SI_SW",
      none: null,
    });
  });

  it("revision 임베드는 공공조달분류명과 관련성 평가를 함께 고른다", async () => {
    await getCalendarEvents(SCOPE, "org", { window: WINDOW });
    const select = String(noticeRequests()[0]?.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("procurementClass:raw_payload->>pubPrcrmntClsfcNm");
    expect(select).toContain("relevance:bid_relevance_assessments(categories,created_at,id)");
  });

  it("내 일정 보기는 관련 공고를 읽지 않는다", async () => {
    await getCalendarEvents(SCOPE, "mine", { window: WINDOW });
    expect(noticeRequests()).toEqual([]);
    expect(requests.map((calls) => calls[0]?.[1]).toSorted()).toEqual([
      "bid_projects",
      "bid_watches",
    ]);
  });

  it("관련 공고를 읽지 못하면 관심·프로젝트 일정은 남기고 relevantFailed 로 알리며 원인을 로그에 남긴다", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = (id: string, deadline: string) => ({
      ...notice(id, []),
      deadline_at: deadline,
    });
    pages.bid_watches = [[{ bid: stored("watched", "2026-11-02T01:00:00Z") }]];
    pages.bid_projects = [
      [
        {
          id: "p1",
          status: "PREPARING",
          owner_id: "user-me",
          submission_due_override: null,
          bid: stored("project", "2026-11-03T01:00:00Z"),
          owner: { profile: { display_name: "김소유", email: null } },
        },
      ],
    ];
    errors.bid_notices = { code: "57014", message: "canceling statement due to statement timeout" };

    const { events, relevantFailed } = await getCalendarEvents(SCOPE, "org", { window: WINDOW });
    expect(relevantFailed).toBe(true);
    expect(events.map((event) => event.key)).toEqual(["BID_DEADLINE:watched", "SUBMISSION_DUE:p1"]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      event: "calendar_relevant_read_failed",
      message: "입찰 일정의 관련 공고를 읽지 못했습니다",
      cause: { code: "57014", message: "canceling statement due to statement timeout" },
    });
  });
});
