import { describe, expect, it } from "vitest";
import { GoogleApiError, createGoogleApi } from "./google-api";
import { toGoogleEventBody } from "./google-calendar.model";

// 구글 API 클라이언트: 토큰 갱신의 invalid_grant, 이벤트 없음(404·410)은 값, 그 밖은 GoogleApiError. 비밀은 오류에 싣지 않는다.
type Reply = { status: number; body?: unknown };
const BODY = toGoogleEventBody({
  key: "BID_DEADLINE:b1",
  date: "2026-11-03",
  summary: "[공고 마감] 세종",
  description: "기관: 세종",
  location: null,
  startAt: "2026-11-03T09:00:00.000Z",
  endAt: "2026-11-03T09:30:00.000Z",
  url: null,
});

function apiWith(replies: Reply[], calls: { url: string; init: RequestInit }[] = []) {
  const queue = [...replies];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const reply = queue.shift();
    if (reply === undefined) throw new TypeError("fetch failed");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  };
  return createGoogleApi({
    fetch: fetchStub,
    clientId: "client-id",
    clientSecret: "client-secret-value",
    timeoutMs: 1_000,
    now: () => new Date("2026-10-30T00:00:00.000Z"),
  });
}

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error instanceof GoogleApiError ? error.code : null;
  }
  return "NO_THROW";
};

describe("createGoogleApi", () => {
  it("refresh token 으로 액세스 토큰을 받고 만료 시각을 계산한다", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = apiWith(
      [{ status: 200, body: { access_token: "ya29.x", expires_in: 3600 } }],
      calls,
    );
    const token = await api.refresh("1//refresh");
    expect(token).toEqual({
      accessToken: "ya29.x",
      expiresAt: new Date("2026-10-30T01:00:00.000Z"),
    });
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]?.init.body)).toContain("grant_type=refresh_token");
  });

  it("invalid_grant 는 INVALID_GRANT 이고 오류 문구에 비밀이 없다", async () => {
    const api = apiWith([{ status: 400, body: { error: "invalid_grant" } }]);
    try {
      await api.refresh("1//refresh");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleApiError);
      expect((error as GoogleApiError).code).toBe("INVALID_GRANT");
      expect((error as Error).message).not.toContain("client-secret-value");
      expect((error as Error).message).not.toContain("1//refresh");
    }
  });

  it("캘린더 없음과 이벤트 없음은 값이고, 401·429·403 쿼터는 코드로 나눈다", async () => {
    const api = apiWith([
      { status: 404 },
      { status: 200, body: { id: "cal-1" } },
      { status: 200, body: { id: "evt-1" } },
      { status: 410 },
      { status: 404 },
      { status: 401 },
      { status: 429 },
      { status: 403, body: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } },
      { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } },
    ]);
    expect(await api.getCalendar("t", "cal-0")).toBe("NOT_FOUND");
    expect(await api.createCalendar("t", "SOL RADAR 입찰 일정", "Asia/Seoul")).toEqual({
      id: "cal-1",
    });
    expect(await api.insertEvent("t", "cal-1", BODY)).toEqual({ id: "evt-1" });
    expect(await api.updateEvent("t", "cal-1", "evt-1", BODY)).toBe("EVENT_MISSING");
    expect(await api.deleteEvent("t", "cal-1", "evt-1")).toBe("EVENT_MISSING");
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("UNAUTHORIZED");
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("RATE_LIMITED");
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("RATE_LIMITED");
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("FORBIDDEN");
  });

  it("응답에 id 가 없으면 BAD_RESPONSE, 연결 실패는 NETWORK 다", async () => {
    const api = apiWith([{ status: 200, body: { kind: "calendar#event" } }]);
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("BAD_RESPONSE");
    expect(await codeOf(() => api.insertEvent("t", "cal-1", BODY))).toBe("NETWORK");
  });

  // 보안 리뷰 F3: id 에 / .. ? 가 있어도 요청은 구글 캘린더 API 의 그 캘린더 아래에만 간다.
  it("calendarId·eventId 에 / .. ? 가 있어도 호스트와 경로가 캘린더 API 밖으로 나가지 않는다", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (count: number) =>
      Array.from({ length: count }, () => ({ status: 200, body: { id: "e-1" } }));
    const ids = ["../../oauth2/v4/token", "a/b?c=d#e", "%2e%2e", "..%2f..", "x/../../y"];
    const api = apiWith(ok(ids.length * 3), calls);
    for (const id of ids) {
      await api.getCalendar("token", id);
      await api.insertEvent("token", id, BODY);
      await api.updateEvent("token", "cal-1", id, BODY);
    }
    expect(calls).toHaveLength(ids.length * 3);
    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.host).toBe("www.googleapis.com");
      expect(url.pathname.startsWith("/calendar/v3/calendars/")).toBe(true);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
    expect(new URL(calls[0]?.url ?? "").pathname).toBe(
      "/calendar/v3/calendars/..%2F..%2Foauth2%2Fv4%2Ftoken",
    );

    // "." ".." 은 주소 해석이 위 경로로 올리므로 부르지 않고 거절한다.
    const before = calls.length;
    for (const id of ["..", ".", ""]) {
      expect(await codeOf(() => api.getCalendar("token", id))).toBe("INVALID_ID");
      expect(await codeOf(() => api.deleteEvent("token", "cal-1", id))).toBe("INVALID_ID");
      expect(await codeOf(() => api.insertEvent("token", id, BODY))).toBe("INVALID_ID");
    }
    expect(calls).toHaveLength(before);
  });
});
