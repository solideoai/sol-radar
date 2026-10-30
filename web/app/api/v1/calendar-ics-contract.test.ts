import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  fakeSession,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import * as route from "./calendar/ics/route";

// GET /api/v1/calendar/ics — 지금 보는 달의 일정을 .ics 로 내려준다. 일정 모으기 규칙은 calendar.model.test.ts 가 맡는다.

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
  relevantCalls: 0,
}));
vi.mock("@/server/calendar", async (original) => ({
  ...(await original<typeof import("@/server/calendar")>()),
  calendarRepo: {
    load: async (scope: { orgId: string }) => {
      state.loadedOrg = scope.orgId;
      return { watchedBids: WATCHED, projects: [] };
    },
    loadRelevant: async () => {
      state.relevantCalls += 1;
      if (state.relevantFails) throw new Error("relevant read failed");
      return [];
    },
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
  state.relevantCalls = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  // 관련 공고 읽기 실패 로그가 시험 출력을 덮지 않게 한다.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const request = (query: string) =>
  fakeRequest(`/api/v1/calendar/ics?${query}`, {
    headers: { Authorization: `Bearer ${FAKE_USERS.viewer.token}` },
  });
const veventCount = (body: string) => body.match(/BEGIN:VEVENT/g)?.length ?? 0;

it("미인증은 401", async () => {
  expect((await route.GET(fakeRequest("/api/v1/calendar/ics"))).status).toBe(401);
  expect(state.loadedOrg).toBeNull();
});

it("세션 조직의 이 달 일정만, 고른 종류만 .ics 로 내려준다", async () => {
  const response = await route.GET(request("month=2026-11&kinds=BID_DEADLINE&orgId=forged"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="sol-radar-calendar-2026-11.ics"',
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).not.toBeNull();
  const body = await response.text();
  expect(veventCount(body)).toBe(1);
  expect(body).toContain("UID:BID_DEADLINE:b-nov@sol-radar");
  expect(body).toContain("URL:https://app.example/bids/b-nov?origin=demo");
  expect(state.loadedOrg).toBe(ORG_01);
});

it("종류를 고르지 않으면 이 달의 모든 종류, 다른 달은 담지 않는다", async () => {
  const body = await (await route.GET(request("month=2026-11"))).text();
  expect(veventCount(body)).toBe(2);
  expect(body).toContain("UID:OPENING:b-nov@sol-radar");
  expect(body).not.toContain("b-dec");
  const december = await (await route.GET(request("month=2026-12"))).text();
  expect(veventCount(december)).toBe(1);
  expect(december).toContain("UID:BID_DEADLINE:b-dec@sol-radar");
});

it("브라우저 쿠키 세션으로도 내려받고, 내 일정 보기는 파일 이름에 -mine 을 붙이며 IT 공고를 읽지 않는다", async () => {
  fakeSession.cookie = FAKE_USERS.viewer.token;
  const response = await route.GET(fakeRequest("/api/v1/calendar/ics?month=2026-11&view=mine"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="sol-radar-calendar-2026-11-mine.ics"',
  );
  expect(veventCount(await response.text())).toBe(2);
  expect(state.relevantCalls).toBe(0);
});

it("조직 전체 보기에서 IT 공고 읽기가 실패하면 일부만 담은 파일 대신 503", async () => {
  state.relevantFails = true;
  const response = await route.GET(request("month=2026-11"));
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
});
