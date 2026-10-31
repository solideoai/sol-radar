import "server-only";
import type { GoogleEventBody } from "./google-calendar.model";

// ── 구글 API 클라이언트: refresh token 으로 액세스 토큰 받기, 캘린더 확인·만들기, 이벤트 넣기·갱신·지우기 ──
// 작은 fetch 클라이언트다. 로그는 남기지 않는다(호출자 몫). 시간 초과는 부르는 쪽이 정한 deps.timeoutMs 하나다.
// 오류는 모두 GoogleApiError 로 던지고, code 와 HTTP 상태만 싣는다. 토큰·키·시크릿·응답 본문은 싣지 않고 cause 도 달지 않는다.
// 이벤트가 없음(404·410)은 갱신·삭제에서 오류가 아니라 값(EVENT_MISSING)이다 — 사용자가 구글에서 직접 지운 일정은 다시 만든다.
//
// 참고(2026-10-30 확인): https://developers.google.com/identity/protocols/oauth2/web-server#offline (refresh, invalid_grant),
// https://developers.google.com/calendar/api/v3/reference (calendars.get/insert, events.insert/update/delete, 410 Gone).

export type GoogleApiDeps = {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  /** 요청 하나(응답 본문 읽기까지)의 시간 초과. 기본값을 두지 않는다 — 부르는 쪽이 정한다. */
  timeoutMs: number;
  /** 토큰 만료 시각의 기준. */
  now: () => Date;
};

export type GoogleAccessToken = { accessToken: string; expiresAt: Date };

export type GoogleApiFailure =
  | "INVALID_GRANT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "INVALID_ID"
  | `HTTP_${number}`;

/** 구글 호출 실패. message 는 "google api 오류: <code>" 이고 값은 싣지 않는다. */
export class GoogleApiError extends Error {
  readonly code: GoogleApiFailure;
  readonly status: number | null;
  constructor(code: GoogleApiFailure, status: number | null = null) {
    super(`google api 오류: ${code}`);
    this.name = "GoogleApiError";
    this.code = code;
    this.status = status;
  }
}

export type GoogleApi = {
  /** refresh token → 액세스 토큰. 사용자가 권한을 거두었거나 refresh 가 만료됐으면 INVALID_GRANT. */
  refresh(refreshToken: string): Promise<GoogleAccessToken>;
  /** 전용 캘린더가 아직 있는지(사용자가 구글에서 지웠을 수 있다). */
  getCalendar(accessToken: string, calendarId: string): Promise<"OK" | "NOT_FOUND">;
  createCalendar(accessToken: string, summary: string, timeZone: string): Promise<{ id: string }>;
  insertEvent(
    accessToken: string,
    calendarId: string,
    body: GoogleEventBody,
  ): Promise<{ id: string }>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    body: GoogleEventBody,
  ): Promise<"UPDATED" | "EVENT_MISSING">;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<"DELETED" | "EVENT_MISSING">;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
]);

/** 객체의 필드 하나. 객체가 아니거나 필드가 없으면 undefined. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

const textField = (value: unknown, key: string): string | null => {
  const field = readField(value, key);
  return typeof field === "string" && field !== "" ? field : null;
};

const isTimeout = (error: unknown): boolean => {
  const name = readField(error, "name");
  return name === "TimeoutError" || name === "AbortError";
};

type Exchange = { status: number; body: unknown };

/**
 * id(캘린더·이벤트)를 주소의 한 조각으로 만든다. encodeURIComponent 는 / ? # 를 바꾸지만 "." ".." 는 그대로 두고,
 * 주소 해석이 ".." 조각을 위 경로로 올린다(…/calendars/../events → /calendar/v3/events). 그런 id 는 부르기 전에 거절한다.
 * id 는 DB 의 본인 행에서 오지만 사용자가 고칠 수 있는 열이다.
 */
function segmentOf(id: string): string {
  if (id === "" || id === "." || id === "..") throw new GoogleApiError("INVALID_ID");
  return encodeURIComponent(id);
}

/** 구글 403 본문의 reason 이 쿼터·속도 제한인지. */
function isRateLimited(body: unknown): boolean {
  const errors = readField(readField(body, "error"), "errors");
  return (
    Array.isArray(errors) &&
    errors.some((entry) => {
      const reason = textField(entry, "reason");
      return reason !== null && RATE_LIMIT_REASONS.has(reason);
    })
  );
}

function failureOf(exchange: Exchange): GoogleApiError {
  const { status, body } = exchange;
  if (status === 401) return new GoogleApiError("UNAUTHORIZED", status);
  if (status === 403) {
    return new GoogleApiError(isRateLimited(body) ? "RATE_LIMITED" : "FORBIDDEN", status);
  }
  if (status === 404) return new GoogleApiError("NOT_FOUND", status);
  if (status === 429) return new GoogleApiError("RATE_LIMITED", status);
  return new GoogleApiError(`HTTP_${status}`, status);
}

export function createGoogleApi(deps: GoogleApiDeps): GoogleApi {
  async function send(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    url: string;
    accessToken?: string;
    json?: unknown;
    form?: Record<string, string>;
  }): Promise<Exchange> {
    const headers: Record<string, string> = {};
    if (input.accessToken !== undefined) headers.Authorization = `Bearer ${input.accessToken}`;
    let body: string | undefined;
    if (input.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded;charset=utf-8";
      body = new URLSearchParams(input.form).toString();
    } else if (input.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.json);
    }
    let response: Response;
    try {
      response = await deps.fetch(input.url, {
        method: input.method,
        headers,
        body,
        signal: AbortSignal.timeout(deps.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      throw new GoogleApiError(isTimeout(error) ? "TIMEOUT" : "NETWORK");
    }
    if (response.status === 204) return { status: 204, body: null };
    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text === "" ? null : JSON.parse(text);
    } catch (error) {
      // 본문을 읽다 끊기거나 JSON 이 아니면 상태만으로 판단한다.
      if (isTimeout(error)) throw new GoogleApiError("TIMEOUT", response.status);
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  const idOf = (exchange: Exchange): string => {
    const id = textField(exchange.body, "id");
    if (id === null) throw new GoogleApiError("BAD_RESPONSE", exchange.status);
    return id;
  };

  const calendarUrl = (calendarId: string) => `${CALENDAR_API}/calendars/${segmentOf(calendarId)}`;
  const eventUrl = (calendarId: string, eventId: string) =>
    `${calendarUrl(calendarId)}/events/${segmentOf(eventId)}`;
  const eventsUrl = (calendarId: string) => `${calendarUrl(calendarId)}/events`;

  return {
    async refresh(refreshToken) {
      const exchange = await send({
        method: "POST",
        url: TOKEN_URL,
        form: {
          client_id: deps.clientId,
          client_secret: deps.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        },
      });
      if (exchange.status === 200) {
        const accessToken = textField(exchange.body, "access_token");
        const expiresIn = readField(exchange.body, "expires_in");
        if (accessToken === null || typeof expiresIn !== "number") {
          throw new GoogleApiError("BAD_RESPONSE", exchange.status);
        }
        return { accessToken, expiresAt: new Date(deps.now().getTime() + expiresIn * 1000) };
      }
      // invalid_grant: refresh token 만료·권한 철회·비밀번호 변경. 다시 해도 같다 — 사용자가 다시 연결해야 한다.
      if (textField(exchange.body, "error") === "invalid_grant") {
        throw new GoogleApiError("INVALID_GRANT", exchange.status);
      }
      throw failureOf(exchange);
    },

    async getCalendar(accessToken, calendarId) {
      const exchange = await send({
        method: "GET",
        url: calendarUrl(calendarId),
        accessToken,
      });
      if (exchange.status === 200) return "OK";
      if (exchange.status === 404) return "NOT_FOUND";
      throw failureOf(exchange);
    },

    async createCalendar(accessToken, summary, timeZone) {
      const exchange = await send({
        method: "POST",
        url: `${CALENDAR_API}/calendars`,
        accessToken,
        json: { summary, timeZone },
      });
      if (exchange.status === 200) return { id: idOf(exchange) };
      throw failureOf(exchange);
    },

    async insertEvent(accessToken, calendarId, body) {
      const exchange = await send({
        method: "POST",
        url: eventsUrl(calendarId),
        accessToken,
        json: body,
      });
      if (exchange.status === 200) return { id: idOf(exchange) };
      throw failureOf(exchange);
    },

    async updateEvent(accessToken, calendarId, eventId, body) {
      const exchange = await send({
        method: "PUT",
        url: eventUrl(calendarId, eventId),
        accessToken,
        json: body,
      });
      if (exchange.status === 200) return "UPDATED";
      if (exchange.status === 404 || exchange.status === 410) return "EVENT_MISSING";
      throw failureOf(exchange);
    },

    async deleteEvent(accessToken, calendarId, eventId) {
      const exchange = await send({
        method: "DELETE",
        url: eventUrl(calendarId, eventId),
        accessToken,
      });
      if (exchange.status === 204 || exchange.status === 200) return "DELETED";
      if (exchange.status === 404 || exchange.status === 410) return "EVENT_MISSING";
      throw failureOf(exchange);
    },
  };
}
