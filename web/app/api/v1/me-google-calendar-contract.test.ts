import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import type { GoogleCalendarView, GoogleConnectStart } from "@/server/google-calendar";
import * as connectRoute from "./me/google-calendar/connect/route";
import * as route from "./me/google-calendar/route";

// /api/v1/me/google-calendar — 연결 상태 읽기·해제, /connect — 구글 동의 화면으로 보내기(ADR-073).

const state = vi.hoisted(() => ({
  view: {
    state: "CONNECTED",
    googleEmail: "me@gmail.invalid",
    hasCalendar: true,
    lastSyncedAt: "2026-10-30T06:00:00.000Z",
    lastResult: "SYNCED",
  } as GoogleCalendarView,
  disconnected: [] as string[],
  starts: [] as { userId: string; callbackOrigin: string; next: string }[],
  start: {
    kind: "REDIRECT",
    redirectTo: "https://accounts.google.invalid/o/oauth2/auth?x=1",
    state: "1700000000.nonce.mac",
  } as GoogleConnectStart,
}));
vi.mock("@/server/google-calendar", async (original) => ({
  ...(await original<typeof import("@/server/google-calendar")>()),
  getMyGoogleCalendar: async () => state.view,
  disconnectMyGoogleCalendar: async (userId: string) => {
    state.disconnected.push(userId);
  },
  startGoogleCalendarConnect: async (input: {
    userId: string;
    callbackOrigin: string;
    next: string;
  }) => {
    state.starts.push(input);
    return state.start;
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
  state.disconnected = [];
  state.starts = [];
  state.start = {
    kind: "REDIRECT",
    redirectTo: "https://accounts.google.invalid/o/oauth2/auth?x=1",
    state: "1700000000.nonce.mac",
  };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const bearer = { Authorization: `Bearer ${FAKE_USERS.viewer.token}` };

it("GET 은 본인 연결 상태를 돌려주고 토큰을 싣지 않는다. 미인증은 401", async () => {
  expect((await route.GET(fakeRequest("/api/v1/me/google-calendar"))).status).toBe(401);
  const response = await route.GET(fakeRequest("/api/v1/me/google-calendar", { headers: bearer }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual(state.view);
  expect(JSON.stringify(body)).not.toMatch(/refresh|token/i);
});

it("DELETE 는 확인 헤더가 있어야 하고 본인 연결만 지운다", async () => {
  fakeSession.cookie = FAKE_USERS.viewer.token;
  expect(
    (await route.DELETE(fakeRequest("/api/v1/me/google-calendar", { method: "DELETE" }))).status,
  ).toBe(403);
  expect(state.disconnected).toEqual([]);
  const response = await route.DELETE(
    fakeRequest("/api/v1/me/google-calendar", {
      method: "DELETE",
      headers: { "X-Requested-With": "sol-radar" },
    }),
  );
  expect(response.status).toBe(204);
  expect(state.disconnected).toEqual([FAKE_USERS.viewer.id]);
});

it("connect 는 이 사이트 안의 이동만 구글로 보내고 state 쿠키를 굽는다", async () => {
  fakeSession.cookie = FAKE_USERS.viewer.token;
  const response = await connectRoute.GET(
    fakeRequest("/api/v1/me/google-calendar/connect?next=%2Fcalendar%3Fmonth%3D2026-11", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("Location")).toBe(
    "https://accounts.google.invalid/o/oauth2/auth?x=1",
  );
  const cookie = response.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("google_calendar_state=1700000000.nonce.mac");
  expect(cookie).toContain("Path=/auth/callback");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(state.starts).toEqual([
    {
      userId: FAKE_USERS.viewer.id,
      callbackOrigin: "https://app.example",
      next: "/calendar?month=2026-11",
    },
  ]);
});

it("다른 사이트에서 온 이동·로그인 전·설정 없음은 구글로 보내지 않고 next 로 돌려보낸다", async () => {
  const crossSite = await connectRoute.GET(
    fakeRequest("/api/v1/me/google-calendar/connect?next=%2Fcalendar", {
      headers: { ...bearer, "Sec-Fetch-Site": "cross-site" },
    }),
  );
  expect(crossSite.status).toBe(307);
  expect(crossSite.headers.get("Location")).toBe("https://app.example/calendar?google=failed");
  const signedOut = await connectRoute.GET(
    fakeRequest("/api/v1/me/google-calendar/connect?next=https%3A%2F%2Fevil.example", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
  );
  // 바깥 주소 next 는 기본 경로로 바꾼다(open redirect 방지).
  expect(signedOut.headers.get("Location")).toBe("https://app.example/auth/login?google=failed");
  state.start = { kind: "NOT_CONFIGURED" };
  const notConfigured = await connectRoute.GET(
    fakeRequest("/api/v1/me/google-calendar/connect?next=%2Fcalendar", {
      headers: { ...bearer, "Sec-Fetch-Site": "none" },
    }),
  );
  expect(notConfigured.headers.get("Location")).toBe("https://app.example/calendar?google=failed");
  expect(state.starts).toHaveLength(1);
});
