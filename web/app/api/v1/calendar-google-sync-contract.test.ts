import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  fakeSession,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import { CALENDAR_EVENT_KINDS } from "@/server/calendar";
import type { GoogleSyncInput, GoogleSyncOutcome } from "@/server/google-calendar";
import * as route from "./calendar/google/sync/route";

// POST /api/v1/calendar/google/sync — 지금 보는 달·보기·종류의 일정을 구글 전용 캘린더에 넣는다(ADR-073).
// 일정 모으기 규칙은 calendar.model.test.ts, 밀어넣기 규칙은 google-calendar.service.test.ts 가 맡는다.

const EMPTY_SCHEDULE = {
  BID_BEGIN: null,
  QUALIFICATION_DUE: null,
  JOINT_AGREEMENT_DUE: null,
  SITE_BRIEFING: null,
  OPENING: null,
  sitePlace: null,
};
const bidOf = (id: string, deadlineAt: string, opening: string | null = null) => ({
  id,
  title: `가상 공고 ${id}`,
  agency: "조달청",
  deadlineAt,
  isDemo: true,
  cancelled: false,
  rawSchedule: { ...EMPTY_SCHEDULE, OPENING: opening },
});
// 2026-11: 공고 마감 1건과 원본 개찰 1건, 2026-12: 공고 마감 1건
const WATCHED = [
  bidOf("b-nov", "2026-11-05T01:00:00.000Z", "2026-11-06 10:00"),
  bidOf("b-dec", "2026-12-03T01:00:00.000Z"),
];

const state = vi.hoisted(() => ({
  loadedOrg: null as string | null,
  relevantFails: false,
  // null 이면 WATCHED 다(hoisted 라 WATCHED 를 직접 넣지 못한다).
  watched: null as ReturnType<typeof bidOf>[] | null,
  syncCalls: [] as { userId: string; input: GoogleSyncInput }[],
  outcome: {
    kind: "SYNCED",
    counts: { created: 2, updated: 0, deleted: 0, failed: 0 },
    calendarId: "cal-1",
  } as GoogleSyncOutcome,
}));
vi.mock("@/server/calendar", async (original) => ({
  ...(await original<typeof import("@/server/calendar")>()),
  calendarRepo: {
    load: async (scope: { orgId: string }) => {
      state.loadedOrg = scope.orgId;
      return { watchedBids: state.watched ?? WATCHED, projects: [] };
    },
    loadRelevant: async () => {
      if (state.relevantFails) throw new Error("relevant read failed");
      return [];
    },
  },
}));
vi.mock("@/server/google-calendar", async (original) => ({
  ...(await original<typeof import("@/server/google-calendar")>()),
  syncMyGoogleCalendar: async (userId: string, input: GoogleSyncInput) => {
    state.syncCalls.push({ userId, input });
    return state.outcome;
  },
}));
vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
}));
beforeEach(() => {
  resetFakeSession();
  state.loadedOrg = null;
  state.relevantFails = false;
  state.watched = null;
  state.syncCalls = [];
  state.outcome = {
    kind: "SYNCED",
    counts: { created: 2, updated: 0, deleted: 0, failed: 0 },
    calendarId: "cal-1",
  };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const post = (body: unknown, init: RequestInit = {}) =>
  fakeRequest("/api/v1/calendar/google/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FAKE_USERS.viewer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    ...init,
  });

it("미인증은 401, 쿠키 로그인은 확인 헤더가 없으면 403 이고 구글을 부르지 않는다", async () => {
  expect(
    (
      await route.POST(
        fakeRequest("/api/v1/calendar/google/sync", {
          method: "POST",
          body: JSON.stringify({ month: "2026-11" }),
        }),
      )
    ).status,
  ).toBe(401);
  fakeSession.cookie = FAKE_USERS.viewer.token;
  const csrf = await route.POST(
    fakeRequest("/api/v1/calendar/google/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: "2026-11" }),
    }),
  );
  expect(csrf.status).toBe(403);
  expect(state.syncCalls).toEqual([]);
});

it("세션 조직의 이 달 일정만, 고른 종류만 글자로 만들어 밀어넣고 건수를 돌려준다", async () => {
  const response = await route.POST(
    post({ month: "2026-11", kinds: "BID_DEADLINE", orgId: "forged" }),
  );
  expect(response.status).toBe(400);
  // strict 본문이라 모르는 키(orgId)는 거절한다. 조직은 세션이 정한다.
  const ok = await route.POST(post({ month: "2026-11", kinds: "BID_DEADLINE" }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    month: "2026-11",
    calendarId: "cal-1",
    created: 2,
    updated: 0,
    deleted: 0,
  });
  expect(state.loadedOrg).toBe(ORG_01);
  expect(state.syncCalls).toHaveLength(1);
  const { userId, input } = state.syncCalls[0]!;
  expect(userId).toBe(FAKE_USERS.viewer.id);
  // 삭제 범위를 정하는 보기·종류도 그대로 넘긴다(view 가 없으면 조직 전체).
  expect(input).toMatchObject({ monthPrefix: "2026-11", view: "org", kinds: ["BID_DEADLINE"] });
  expect(input.events.map((event) => event.key)).toEqual(["BID_DEADLINE:b-nov"]);
  expect(input.events[0]).toMatchObject({
    date: "2026-11-05",
    // 시험 공고는 가상(isDemo)이라 제목·설명에 DEMO 표시가 붙는다.
    summary: "[DEMO] [공고 마감] 가상 공고 b-nov",
    startAt: "2026-11-05T01:00:00.000Z",
    endAt: "2026-11-05T01:30:00.000Z",
    url: "https://app.example/bids/b-nov?origin=demo",
  });
  expect(input.events[0]?.description).toBe(
    "가상 데이터(DEMO)\n기관: 조달청\nSOL RADAR: https://app.example/bids/b-nov?origin=demo",
  );
});

it("이 달 일정이 500건을 넘으면 구글을 부르지 않고 400 이다. 500건은 넣는다", async () => {
  // 2026-11 마감 공고 n건(개찰 없음) → 공고 마감 일정 n건
  const bidsOf = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      bidOf(`b-${index}`, `2026-11-${String((index % 28) + 1).padStart(2, "0")}T01:00:00.000Z`),
    );
  state.watched = bidsOf(501);
  const over = await route.POST(post({ month: "2026-11" }));
  expect(over.status).toBe(400);
  expect(await over.json()).toMatchObject({
    error: {
      code: "VALIDATION_ERROR",
      message: "한 번에 넣을 수 있는 일정은 500건까지입니다. 일정 종류를 줄여 주세요.",
      details: { component: "google-calendar-limit", limit: 500 },
    },
  });
  expect(state.syncCalls).toEqual([]);
  state.watched = bidsOf(500);
  expect((await route.POST(post({ month: "2026-11" }))).status).toBe(200);
  expect(state.syncCalls[0]?.input.events).toHaveLength(500);
});

it("종류를 고르지 않으면 이 달의 모든 종류, 다른 달은 넣지 않는다. 틀린 달은 400", async () => {
  await route.POST(post({ month: "2026-11" }));
  expect(state.syncCalls[0]?.input.events.map((event) => event.key)).toEqual([
    "BID_DEADLINE:b-nov",
    "OPENING:b-nov",
  ]);
  expect(state.syncCalls[0]?.input.kinds).toEqual(CALENDAR_EVENT_KINDS);
  await route.POST(post({ month: "2026-12", view: "mine" }));
  expect(state.syncCalls[1]?.input.events.map((event) => event.key)).toEqual([
    "BID_DEADLINE:b-dec",
  ]);
  expect(state.syncCalls[1]?.input.view).toBe("mine");
  // kinds= (빈 값)은 하나도 안 고른 것이다. 넣을 일정도, 지울 종류도 없다.
  await route.POST(post({ month: "2026-11", kinds: "" }));
  expect(state.syncCalls[2]?.input).toMatchObject({ kinds: [], events: [] });
  expect((await route.POST(post({ month: "2026-13" }))).status).toBe(400);
  expect((await route.POST(post({ month: "2026/11" }))).status).toBe(400);
  expect(state.syncCalls).toHaveLength(3);
});

it("조직 전체 보기에서 IT 공고 읽기가 실패하면 일부만 넣는 대신 503", async () => {
  state.relevantFails = true;
  const response = await route.POST(post({ month: "2026-11" }));
  expect(response.status).toBe(503);
  expect((await response.json()).error.details.component).toBe("calendar-relevant");
  expect(state.syncCalls).toEqual([]);
});

it("연결 전·만료·구글 실패·설정 없음은 각자의 코드로 답한다", async () => {
  const cases: [GoogleSyncOutcome, number, string][] = [
    [{ kind: "NOT_CONNECTED" }, 409, "GOOGLE_NOT_CONNECTED"],
    [{ kind: "EXPIRED" }, 409, "GOOGLE_EXPIRED"],
    [{ kind: "UPSTREAM_FAILED", code: "RATE_LIMITED" }, 502, "UPSTREAM_ERROR"],
    [{ kind: "NOT_CONFIGURED" }, 503, "SERVICE_UNAVAILABLE"],
  ];
  for (const [outcome, status, code] of cases) {
    state.outcome = outcome;
    const response = await route.POST(post({ month: "2026-11" }));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  }
});

it("일부 일정의 구글 호출이 실패하면 502 UPSTREAM_ERROR 와 건수를 주고, 로그에는 토큰 없이 결과·건수·user id 만 남긴다", async () => {
  state.outcome = {
    kind: "SYNCED",
    counts: { created: 1, updated: 2, deleted: 0, failed: 1 },
    calendarId: "cal-1",
  };
  const response = await route.POST(post({ month: "2026-11" }));
  expect(response.status).toBe(502);
  const { error } = await response.json();
  expect(error.code).toBe("UPSTREAM_ERROR");
  expect(error.details).toEqual({
    component: "google-calendar",
    code: "PARTIAL",
    created: 1,
    updated: 2,
    deleted: 0,
    failed: 1,
  });
  const warn = vi.mocked(console.warn).mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(warn).toEqual([
    expect.objectContaining({
      event: "google_calendar.sync",
      action: "sync",
      result: "PARTIAL",
      userId: FAKE_USERS.viewer.id,
      created: 1,
      updated: 2,
      deleted: 0,
      failed: 1,
    }),
  ]);
  expect(JSON.stringify(warn)).not.toMatch(/cal-1|token|@/i);
});
