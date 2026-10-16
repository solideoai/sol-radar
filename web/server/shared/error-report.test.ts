import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportBrowserError,
  reportServerError,
  toBrowserErrorRecord,
  toServerErrorRecord,
} from "./error-report";

// 스펙 3장 6번: JSON 한 줄(시각·digest·경로·메서드·라우트 종류·오류 이름과 메시지).
// 쿠키·인증 헤더·요청 본문·검색어는 남기지 않는다.
const NOW = new Date("2026-10-15T06:36:38.790Z");
const CONTEXT = { routePath: "/[slug]/tasks", routeType: "action" };

const withDigest = (message: string, digest: unknown) =>
  Object.assign(new Error(message), { digest });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("toServerErrorRecord", () => {
  it("서버 오류 한 건을 정한 칸과 순서로 적는다", () => {
    const record = toServerErrorRecord(
      withDigest("확인용 서버 오류", "708337598"),
      { path: "/acme/tasks", method: "POST" },
      CONTEXT,
      NOW,
    );
    expect(record).toEqual({
      level: "error",
      source: "server",
      time: "2026-10-15T06:36:38.790Z",
      name: "Error",
      message: "확인용 서버 오류",
      digest: "708337598",
      path: "/acme/tasks",
      method: "POST",
      routePath: "/[slug]/tasks",
      routeType: "action",
    });
    // 로그에서 같은 모양으로 찾도록 칸 순서도 고정한다.
    expect(Object.keys(record)).toEqual([
      "level",
      "source",
      "time",
      "name",
      "message",
      "digest",
      "path",
      "method",
      "routePath",
      "routeType",
    ]);
  });

  it("경로의 검색어(?…)와 조각(#…)은 남기지 않는다", () => {
    const pathOf = (path: string) =>
      toServerErrorRecord(new Error("x"), { path, method: "GET" }, CONTEXT, NOW).path;
    expect(pathOf("/acme/tasks?q=비밀&token=abc")).toBe("/acme/tasks");
    expect(pathOf("/auth/confirm?token_hash=th-zz-1&type=email#done")).toBe("/auth/confirm");
    expect(pathOf("/acme#section?x=1")).toBe("/acme");
    expect(pathOf("/?")).toBe("/");
    expect(pathOf("/acme/tasks")).toBe("/acme/tasks");
  });

  it("요청에 쿠키·인증 헤더·본문이 실려 와도 기록에는 없다", () => {
    // onRequestError 의 request 처럼 headers 가 붙은 값을 그대로 넘겨 본다.
    const request = {
      path: "/acme/tasks?session=s-zz-9",
      method: "POST",
      headers: {
        cookie: "sb-access-token=at-zz-1; sb-refresh-token=rt-zz-2",
        authorization: "Bearer bearer-zz-3",
      },
      body: "password=pw-zz-4",
    };
    const line = JSON.stringify(toServerErrorRecord(new Error("x"), request, CONTEXT, NOW));
    for (const secret of [
      "at-zz-1",
      "rt-zz-2",
      "bearer-zz-3",
      "pw-zz-4",
      "s-zz-9",
      "cookie",
      "authorization",
    ])
      expect(line, secret).not.toContain(secret);
  });

  it("Error 의 하위 종류는 그 이름을 쓴다", () => {
    expect(
      toServerErrorRecord(new TypeError("t"), { path: "/", method: "GET" }, CONTEXT, NOW).name,
    ).toBe("TypeError");
  });

  it("Error 가 아닌 값도 기록한다 — 문자열은 메시지가 되고 이름은 NonError 다", () => {
    const recordOf = (error: unknown) =>
      toServerErrorRecord(error, { path: "/", method: "GET" }, CONTEXT, NOW);
    expect(recordOf("문자열 오류")).toMatchObject({
      name: "NonError",
      message: "문자열 오류",
      digest: null,
    });
    for (const error of [null, undefined, 42, Symbol("s")])
      expect(recordOf(error), String(error)).toMatchObject({
        name: "NonError",
        message: "",
        digest: null,
      });
    // 이름·메시지·digest 를 가진 일반 객체(직렬화를 거친 오류)는 그 값을 쓴다.
    expect(recordOf({ name: "PostgrestError", message: "m", digest: "d1" })).toMatchObject({
      name: "PostgrestError",
      message: "m",
      digest: "d1",
    });
  });

  it("digest 가 글자가 아니면 null 이다", () => {
    for (const digest of [undefined, 123, null])
      expect(
        toServerErrorRecord(withDigest("x", digest), { path: "/", method: "GET" }, CONTEXT, NOW)
          .digest,
      ).toBeNull();
  });

  it("메시지는 1000자까지만 남긴다", () => {
    const messageOf = (length: number) =>
      toServerErrorRecord(
        new Error("가".repeat(length)),
        { path: "/", method: "GET" },
        CONTEXT,
        NOW,
      ).message;
    expect(messageOf(1000)).toHaveLength(1000);
    expect(messageOf(1001)).toHaveLength(1000);
    expect(messageOf(50_000)).toHaveLength(1000);
  });
});

describe("toBrowserErrorRecord", () => {
  it("브라우저 기록은 source 가 browser 이고 메서드·라우트 칸은 비어 있다", () => {
    expect(
      toBrowserErrorRecord(withDigest("가려진 문장", "708337598"), "/acme/tasks", NOW),
    ).toEqual({
      level: "error",
      source: "browser",
      time: "2026-10-15T06:36:38.790Z",
      name: "Error",
      message: "가려진 문장",
      digest: "708337598",
      path: "/acme/tasks",
      method: null,
      routePath: null,
      routeType: null,
    });
  });

  it("경로의 검색어·조각을 떼고, 경로를 모르면 null 이다", () => {
    expect(toBrowserErrorRecord(new Error("x"), "/acme?q=1#a", NOW).path).toBe("/acme");
    expect(toBrowserErrorRecord(new Error("x"), null, NOW).path).toBeNull();
  });
});

describe("reportServerError", () => {
  it("표준 오류 출력에 JSON 한 줄을 남긴다 — 메시지에 줄바꿈이 있어도 한 줄이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportServerError(
      withDigest("첫 줄\n둘째 줄", "42"),
      { path: "/acme/tasks?q=1", method: "GET" },
      { routePath: "/[slug]/tasks", routeType: "render" },
    );
    expect(log).toHaveBeenCalledTimes(1);
    const [line, ...rest] = log.mock.calls[0];
    expect(rest).toEqual([]);
    expect(typeof line).toBe("string");
    expect(line).not.toMatch(/[\r\n]/);
    expect(JSON.parse(String(line))).toEqual(
      toServerErrorRecord(
        withDigest("첫 줄\n둘째 줄", "42"),
        { path: "/acme/tasks?q=1", method: "GET" },
        { routePath: "/[slug]/tasks", routeType: "render" },
        NOW,
      ),
    );
  });
});

describe("reportBrowserError", () => {
  it("브라우저 주소의 경로와 함께 JSON 한 줄을 콘솔에 남긴다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("window", { location: { pathname: "/acme/tasks", search: "?q=비밀" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportBrowserError(withDigest("x", "7"));
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual(
      toBrowserErrorRecord(withDigest("x", "7"), "/acme/tasks", NOW),
    );
    expect(line).not.toContain("비밀");
  });

  it("window 가 없는 곳(서버 렌더)에서도 던지지 않고 경로를 null 로 남긴다", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => reportBrowserError(new Error("x"))).not.toThrow();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      source: "browser",
      path: null,
    });
  });
});
