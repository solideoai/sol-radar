import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoogleConnectResult } from "@/server/google-calendar";
import { completeGoogleCalendarCallback } from "./google-calendar";

// /auth/callback?flow=google-calendar 가 결과마다 어디로 보내는지(ADR-073). 연결 판정 규칙은 google-calendar.service.test.ts 가 맡는다.

const state = vi.hoisted(() => ({
  result: { outcome: "connected", reason: null, userId: "u-1" } as GoogleConnectResult,
}));
vi.mock("@/server/google-calendar", async (original) => ({
  ...(await original<typeof import("@/server/google-calendar")>()),
  completeGoogleCalendarConnect: async () => state.result,
}));

const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  state.result = { outcome: "connected", reason: null, userId: "u-1" };
  const capture = (line: unknown) => void logs.push(String(line));
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const callback = (next: string) =>
  new NextRequest(
    `https://app.example/auth/callback?flow=google-calendar&code=c&next=${encodeURIComponent(next)}`,
    { headers: { cookie: "google_calendar_state=s" } },
  );

it("연결되면 next 로 ?google=connected 를 붙여 보내고 state 쿠키를 지우며, 로그에 토큰 없이 결과와 user id 를 남긴다", async () => {
  const response = await completeGoogleCalendarCallback(callback("/calendar?month=2026-11"));
  expect(response.status).toBe(307);
  expect(response.headers.get("Location")).toBe(
    "https://app.example/calendar?month=2026-11&google=connected",
  );
  expect(response.headers.get("Set-Cookie")).toContain("google_calendar_state=;");
  expect(logs.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      event: "google_calendar.connect",
      action: "connect",
      result: "connected",
      userId: "u-1",
    }),
  ]);
});

it("다른 계정으로 돌아오면 로그인 화면(?link=google-mismatch)으로 보내고, next 는 사이트 안 경로만 싣는다", async () => {
  state.result = { outcome: "account_mismatch", reason: "STATE_INVALID", userId: null };
  const mismatch = await completeGoogleCalendarCallback(callback("/calendar?view=mine"));
  const location = new URL(mismatch.headers.get("Location") ?? "");
  expect(location.origin + location.pathname).toBe("https://app.example/auth/login");
  expect(location.searchParams.get("link")).toBe("google-mismatch");
  expect(location.searchParams.get("next")).toBe("/calendar?view=mine");
  expect(location.searchParams.has("google")).toBe(false);
  expect(mismatch.headers.get("Set-Cookie")).toContain("google_calendar_state=;");

  // 세션을 끊었으면 결과 한 줄만 남는다.
  expect(logs.map((line) => JSON.parse(line).event)).toEqual(["google_calendar.connect"]);

  // 바깥 주소 next 는 기본 경로로 바꾼다(open redirect 방지). 로그인 화면은 /auth/ 로 되돌리지 않는다.
  const outside = await completeGoogleCalendarCallback(callback("//evil.example/calendar"));
  const outsideLocation = new URL(outside.headers.get("Location") ?? "");
  expect(outsideLocation.origin).toBe("https://app.example");
  expect(outsideLocation.searchParams.get("next")).toBe("/auth/login");
});

it("다른 계정 세션을 끊지 못하면 오류 코드만 한 줄 더 남기고, 그대로 로그인 화면으로 보낸다", async () => {
  state.result = {
    outcome: "account_mismatch",
    reason: "STATE_INVALID",
    userId: null,
    signOutError: "session_not_found",
  };
  const response = await completeGoogleCalendarCallback(callback("/calendar"));
  expect(new URL(response.headers.get("Location") ?? "").pathname).toBe("/auth/login");
  const failed = logs
    .map((line) => JSON.parse(line))
    .find((record) => record.event === "google_calendar.sign_out_failed");
  expect(failed).toEqual({
    level: "warn",
    source: "server",
    event: "google_calendar.sign_out_failed",
    action: "connect",
    result: "failed",
    code: "session_not_found",
    time: expect.any(String),
  });
  expect(logs.join("\n")).not.toMatch(/google_calendar_state=s|code=c/);
});
