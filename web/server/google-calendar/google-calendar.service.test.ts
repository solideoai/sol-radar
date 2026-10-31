import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOAuthStateSigner } from "@/server/token-seal";
import { GoogleApiError, type GoogleApi } from "./google-api";
import { googleTokenSealer, type GoogleCalendarConfig } from "./google-calendar.config";
import type { EventMapping, GoogleCalendarRow, GoogleEventInput } from "./google-calendar.model";
import type { GoogleCalendarRepo } from "./google-calendar.repo";
import {
  completeGoogleCalendarConnect,
  startGoogleCalendarConnect,
  syncMyGoogleCalendar,
  type GoogleCalendarDeps,
} from "./google-calendar.service";

// 구글 캘린더 연동 흐름: 연결 시작·콜백 네 결과, 밀어넣기의 멱등·만료·캘린더 재생성·부분 실패 집계.
const USER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-10-30T06:00:00.000Z");
const CONFIG: GoogleCalendarConfig = { clientId: "id", clientSecret: "secret", tokenKey: KEY };
// 운영 코드와 같은 봉인(AAD 접두 "google:")으로 저장 행을 만든다.
const sealer = googleTokenSealer;
const signer = createOAuthStateSigner({
  keyName: "GOOGLE_TOKEN_ENC_KEY",
  info: "google-calendar-oauth-state",
  label: "google-calendar-state:v1",
});

const event = (key: string, date: string): GoogleEventInput => ({
  key,
  date,
  summary: `[공고 마감] ${key}`,
  description: "기관: 세종",
  location: null,
  startAt: `${date}T09:00:00.000Z`,
  endAt: `${date}T09:30:00.000Z`,
  url: null,
});

type Store = {
  link: GoogleCalendarRow | null;
  mappings: Map<string, EventMapping>;
  log: string[];
  identity: { linked: boolean; email: string | null };
  exchanged: Awaited<ReturnType<GoogleCalendarRepo["exchangeCode"]>>;
  /** 세션 끊기가 실패할 때의 오류 코드. 없으면 성공이다. */
  signOutError?: string;
};

function storeWith(overrides: Partial<Store> = {}): Store {
  return {
    link: null,
    mappings: new Map(),
    log: [],
    identity: { linked: false, email: null },
    exchanged: null,
    ...overrides,
  };
}

const connectedLink = (extra: Partial<GoogleCalendarRow> = {}): GoogleCalendarRow => ({
  status: "CONNECTED",
  google_email: "me@gmail.invalid",
  refresh_token_enc: sealer.encrypt("1//refresh", KEY, { userId: USER, kind: "refresh" }),
  calendar_id: "cal-1",
  last_synced_at: null,
  last_result: null,
  ...extra,
});

function repoOf(store: Store): GoogleCalendarRepo {
  return {
    isConfigured: () => true,
    currentUserId: async () => USER,
    readMine: async () => store.link,
    saveLink: async (userId, input) => {
      store.log.push(`save:${userId}:${input.googleEmail}:${input.resetCalendar}`);
      if (input.resetCalendar) store.mappings.clear();
      store.link = connectedLink({
        refresh_token_enc: input.refreshTokenEnc,
        google_email: input.googleEmail,
        calendar_id: input.resetCalendar ? null : (store.link?.calendar_id ?? null),
      });
    },
    setCalendarId: async (_userId, calendarId) => {
      store.log.push(`calendar:${calendarId}`);
      if (store.link) store.link = { ...store.link, calendar_id: calendarId };
    },
    markSync: async (_userId, result) => {
      store.log.push(`sync:${result}`);
    },
    markExpired: async () => {
      store.log.push("expired");
      if (store.link) store.link = { ...store.link, status: "EXPIRED" };
    },
    disconnect: async () => {
      store.link = null;
      store.mappings.clear();
    },
    listMappings: async (_userId, input) =>
      [...store.mappings.values()].filter(
        (mapping) =>
          mapping.eventDate.startsWith(`${input.monthPrefix}-`) ||
          input.keys.includes(mapping.eventKey),
      ),
    upsertMappings: async (_userId, rows) => {
      for (const row of rows) store.mappings.set(row.eventKey, row);
    },
    deleteMappings: async (_userId, keys) => {
      for (const key of keys) store.mappings.delete(key);
    },
    clearMappings: async () => {
      store.log.push("clear-mappings");
      store.mappings.clear();
    },
    googleIdentity: async () => store.identity,
    authorizeUrl: async (input) => {
      store.log.push(`authorize:${input.mode}:${input.queryParams.login_hint ?? "-"}`);
      return { url: `https://accounts.google.invalid/o/oauth2/auth?redirect=${input.redirectTo}` };
    },
    exchangeCode: async () => store.exchanged,
    signOut: async () => {
      store.log.push("sign-out");
      return { errorCode: store.signOutError ?? null };
    },
  };
}

type ApiScript = {
  refresh?: () => Promise<{ accessToken: string; expiresAt: Date }>;
  getCalendar?: GoogleApi["getCalendar"];
  insertEvent?: GoogleApi["insertEvent"];
  updateEvent?: GoogleApi["updateEvent"];
  deleteEvent?: GoogleApi["deleteEvent"];
};

function apiOf(script: ApiScript, calls: string[]): GoogleApi {
  let nextId = 0;
  return {
    refresh: script.refresh ?? (async () => ({ accessToken: "ya29", expiresAt: NOW })),
    getCalendar: script.getCalendar ?? (async () => "OK"),
    createCalendar: async () => {
      calls.push("createCalendar");
      return { id: "cal-new" };
    },
    insertEvent:
      script.insertEvent ??
      (async (_token, _calendar, body) => {
        calls.push(`insert:${body.extendedProperties.private.solKey}`);
        nextId += 1;
        return { id: `evt-${nextId}` };
      }),
    updateEvent:
      script.updateEvent ??
      (async (_token, _calendar, eventId) => {
        calls.push(`update:${eventId}`);
        return "UPDATED";
      }),
    deleteEvent:
      script.deleteEvent ??
      (async (_token, _calendar, eventId) => {
        calls.push(`delete:${eventId}`);
        return "DELETED";
      }),
  };
}

function depsOf(store: Store, script: ApiScript = {}, calls: string[] = []): GoogleCalendarDeps {
  return {
    repo: repoOf(store),
    config: () => CONFIG,
    api: () => apiOf(script, calls),
    now: () => NOW,
  };
}

describe("startGoogleCalendarConnect", () => {
  it("구글이 아직 로그인 수단이 아니면 연결(link), 이미면 같은 계정 재동의(signin)다", async () => {
    const store = storeWith();
    const start = await startGoogleCalendarConnect(
      {
        userId: USER,
        callbackOrigin: "https://www.solideos-radar.com",
        next: "/calendar?month=2026-11",
      },
      depsOf(store),
    );
    expect(start.kind).toBe("REDIRECT");
    if (start.kind !== "REDIRECT") return;
    expect(start.redirectTo).toContain(
      "https://www.solideos-radar.com/auth/callback?flow=google-calendar&next=%2Fcalendar%3Fmonth%3D2026-11",
    );
    expect(signer.verify({ state: start.state, userId: USER, secret: KEY, now: NOW })).toBe(true);
    expect(store.log).toEqual(["authorize:link:-"]);

    const linked = storeWith({ identity: { linked: true, email: "me@gmail.invalid" } });
    await startGoogleCalendarConnect(
      { userId: USER, callbackOrigin: "https://www.solideos-radar.com", next: "/calendar" },
      depsOf(linked),
    );
    expect(linked.log).toEqual(["authorize:signin:me@gmail.invalid"]);
  });

  it("설정이 없으면 시작하지 않는다", async () => {
    const deps = { ...depsOf(storeWith()), config: () => null };
    expect(
      await startGoogleCalendarConnect(
        { userId: USER, callbackOrigin: "https://x.invalid", next: "/calendar" },
        deps,
      ),
    ).toEqual({ kind: "NOT_CONFIGURED" });
  });
});

describe("completeGoogleCalendarConnect", () => {
  const state = () => signer.create({ userId: USER, secret: KEY, now: NOW });
  const params = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ code: "auth-code", ...extra });

  it("refresh token 을 봉인해 저장하고 connected 다", async () => {
    const store = storeWith({
      exchanged: {
        userId: USER,
        providerRefreshToken: "1//fresh",
        googleEmail: "me@gmail.invalid",
      },
    });
    const outcome = await completeGoogleCalendarConnect(
      { params: params(), stateCookie: state() },
      depsOf(store),
    );
    expect(outcome).toEqual({ outcome: "connected", reason: null, userId: USER });
    expect(store.link?.refresh_token_enc).not.toContain("1//fresh");
    expect(
      sealer.decrypt(store.link?.refresh_token_enc ?? "", KEY, { userId: USER, kind: "refresh" }),
    ).toBe("1//fresh");
    expect(store.log).toEqual(["save:00000000-0000-0000-0000-000000000001:me@gmail.invalid:false"]);
  });

  it("동의 거부·코드 없음·state 쿠키 없음은 코드 교환 없이 끝낸다", async () => {
    const store = storeWith({
      exchanged: { userId: USER, providerRefreshToken: "x", googleEmail: null },
    });
    const deps = depsOf(store);
    expect(
      await completeGoogleCalendarConnect(
        { params: params({ error: "access_denied" }), stateCookie: state() },
        deps,
      ),
    ).toEqual({ outcome: "consent_denied", reason: "ACCESS_DENIED", userId: null });
    expect(
      await completeGoogleCalendarConnect(
        { params: new URLSearchParams(), stateCookie: state() },
        deps,
      ),
    ).toEqual({ outcome: "failed", reason: "CODE_MISSING", userId: null });
    expect(
      await completeGoogleCalendarConnect({ params: params(), stateCookie: undefined }, deps),
    ).toEqual({ outcome: "state_mismatch", reason: "STATE_MISSING", userId: null });
    expect(store.link).toBeNull();
  });

  it("시작한 사람과 다른 계정으로 돌아오면 그 세션을 끊고 account_mismatch 다", async () => {
    const store = storeWith({
      exchanged: {
        userId: OTHER,
        providerRefreshToken: "1//x",
        googleEmail: "other@gmail.invalid",
      },
    });
    const outcome = await completeGoogleCalendarConnect(
      { params: params(), stateCookie: state() },
      depsOf(store),
    );
    // 돌아온 사람은 시작한 사람이 아니라 행위자로 적지 않는다.
    expect(outcome).toEqual({ outcome: "account_mismatch", reason: "STATE_INVALID", userId: null });
    expect(store.log).toEqual(["sign-out"]);
    expect(store.link).toBeNull();

    // 세션 끊기가 실패하면 결과는 같고 오류 코드만 붙는다(콜백이 로그로 남긴다).
    const failing = storeWith({ exchanged: store.exchanged, signOutError: "session_not_found" });
    expect(
      await completeGoogleCalendarConnect(
        { params: params(), stateCookie: state() },
        depsOf(failing),
      ),
    ).toEqual({
      outcome: "account_mismatch",
      reason: "STATE_INVALID",
      userId: null,
      signOutError: "session_not_found",
    });
  });

  it("refresh token 이 없으면 저장하지 않고 no_refresh_token 이다", async () => {
    const store = storeWith({
      exchanged: { userId: USER, providerRefreshToken: null, googleEmail: null },
    });
    expect(
      await completeGoogleCalendarConnect(
        { params: params(), stateCookie: state() },
        depsOf(store),
      ),
    ).toEqual({ outcome: "no_refresh_token", reason: "REFRESH_MISSING", userId: USER });
    expect(store.link).toBeNull();
  });

  it("다른 구글 계정으로 다시 연결하면 전용 캘린더와 매핑을 비운다", async () => {
    const store = storeWith({
      link: connectedLink(),
      exchanged: { userId: USER, providerRefreshToken: "1//new", googleEmail: "new@gmail.invalid" },
    });
    store.mappings.set("k", { eventKey: "k", googleEventId: "g", eventDate: "2026-11-01" });
    await completeGoogleCalendarConnect({ params: params(), stateCookie: state() }, depsOf(store));
    expect(store.log).toEqual(["save:00000000-0000-0000-0000-000000000001:new@gmail.invalid:true"]);
    expect(store.link?.calendar_id).toBeNull();
    expect(store.mappings.size).toBe(0);
  });
});

describe("syncMyGoogleCalendar", () => {
  // 조직 전체 보기, 두 종류를 고른 범위. 삭제 범위 규칙은 google-calendar.model.test.ts 의 planSync 시험이 맡는다.
  const scope = {
    monthPrefix: "2026-11",
    view: "org",
    kinds: ["BID_DEADLINE", "OPENING"],
  } as const;
  const events = [event("BID_DEADLINE:b1", "2026-11-03"), event("OPENING:b1", "2026-11-10")];

  it("처음에는 만들고, 두 번째는 갱신하며, 사라진 일정은 지운다(멱등)", async () => {
    const store = storeWith({ link: connectedLink() });
    const calls: string[] = [];
    const deps = depsOf(store, {}, calls);
    const first = await syncMyGoogleCalendar(USER, { ...scope, events }, deps);
    expect(first).toEqual({
      kind: "SYNCED",
      counts: { created: 2, updated: 0, deleted: 0, failed: 0 },
      calendarId: "cal-1",
    });
    expect(store.mappings.size).toBe(2);
    const second = await syncMyGoogleCalendar(USER, { ...scope, events: [events[0]!] }, deps);
    expect(second).toEqual({
      kind: "SYNCED",
      counts: { created: 0, updated: 1, deleted: 1, failed: 0 },
      calendarId: "cal-1",
    });
    expect([...store.mappings.keys()]).toEqual(["BID_DEADLINE:b1"]);
    expect(calls).toEqual([
      "insert:BID_DEADLINE:b1",
      "insert:OPENING:b1",
      "update:evt-1",
      "delete:evt-2",
    ]);
    expect(store.log.filter((line) => line.startsWith("sync:"))).toEqual([
      "sync:SYNCED",
      "sync:SYNCED",
    ]);
  });

  it("연결 전·만료·refresh 거부(invalid_grant)는 구글에 일정을 보내지 않는다", async () => {
    expect(await syncMyGoogleCalendar(USER, { ...scope, events }, depsOf(storeWith()))).toEqual({
      kind: "NOT_CONNECTED",
    });
    const expired = storeWith({ link: connectedLink({ status: "EXPIRED" }) });
    expect(await syncMyGoogleCalendar(USER, { ...scope, events }, depsOf(expired))).toEqual({
      kind: "EXPIRED",
    });
    const revoked = storeWith({ link: connectedLink() });
    const calls: string[] = [];
    const outcome = await syncMyGoogleCalendar(
      USER,
      { ...scope, events },
      depsOf(
        revoked,
        {
          refresh: async () => {
            throw new GoogleApiError("INVALID_GRANT", 400);
          },
        },
        calls,
      ),
    );
    expect(outcome).toEqual({ kind: "EXPIRED" });
    expect(revoked.link?.status).toBe("EXPIRED");
    expect(calls).toEqual([]);
  });

  it("봉인이 변조됐으면 만료로 바꾸고, 다른 키로 봉인된 것은 설정 오류로 던진다", async () => {
    const tampered = storeWith({
      link: connectedLink({ refresh_token_enc: "v1.bad.bad.bad.bad" }),
    });
    expect(await syncMyGoogleCalendar(USER, { ...scope, events }, depsOf(tampered))).toEqual({
      kind: "EXPIRED",
    });
    expect(tampered.log).toEqual(["expired"]);
    const otherKey = randomBytes(32).toString("base64");
    const mismatched = storeWith({
      link: connectedLink({
        refresh_token_enc: sealer.encrypt("1//r", otherKey, { userId: USER, kind: "refresh" }),
      }),
    });
    await expect(
      syncMyGoogleCalendar(USER, { ...scope, events }, depsOf(mismatched)),
    ).rejects.toThrow("GOOGLE_TOKEN_ENC_KEY KEY_MISMATCH");
  });

  it("전용 캘린더가 구글에서 사라졌으면 새로 만들고 매핑을 비운 뒤 다시 넣는다", async () => {
    const store = storeWith({ link: connectedLink() });
    store.mappings.set("OPENING:b1", {
      eventKey: "OPENING:b1",
      googleEventId: "old",
      eventDate: "2026-11-10",
    });
    const calls: string[] = [];
    const outcome = await syncMyGoogleCalendar(
      USER,
      { ...scope, events },
      depsOf(store, { getCalendar: async () => "NOT_FOUND" }, calls),
    );
    expect(outcome).toEqual({
      kind: "SYNCED",
      counts: { created: 2, updated: 0, deleted: 0, failed: 0 },
      calendarId: "cal-new",
    });
    expect(store.log).toEqual(["clear-mappings", "calendar:cal-new", "sync:SYNCED"]);
    expect(calls[0]).toBe("createCalendar");
  });

  it("갱신 대상이 구글에 없으면 다시 만들고, 구글 호출 실패는 건수로 세어 FAILED 로 적는다", async () => {
    const store = storeWith({ link: connectedLink() });
    store.mappings.set("BID_DEADLINE:b1", {
      eventKey: "BID_DEADLINE:b1",
      googleEventId: "gone",
      eventDate: "2026-11-03",
    });
    const calls: string[] = [];
    const outcome = await syncMyGoogleCalendar(
      USER,
      { ...scope, events },
      depsOf(
        store,
        {
          updateEvent: async () => "EVENT_MISSING",
          insertEvent: async (_token, _calendar, body) => {
            const key = body.extendedProperties.private.solKey;
            if (key === "OPENING:b1") throw new GoogleApiError("RATE_LIMITED", 429);
            calls.push(`insert:${key}`);
            return { id: "evt-again" };
          },
        },
        calls,
      ),
    );
    expect(outcome).toEqual({
      kind: "SYNCED",
      counts: { created: 1, updated: 0, deleted: 0, failed: 1 },
      calendarId: "cal-1",
    });
    expect(store.mappings.get("BID_DEADLINE:b1")?.googleEventId).toBe("evt-again");
    expect(store.mappings.has("OPENING:b1")).toBe(false);
    expect(store.log.at(-1)).toBe("sync:FAILED");
  });

  it("캘린더를 만들지 못하면 UPSTREAM_FAILED 이고 결과는 FAILED 다", async () => {
    const store = storeWith({ link: connectedLink({ calendar_id: null }) });
    const deps = depsOf(store);
    deps.api = () => ({
      ...apiOf({}, []),
      createCalendar: async () => {
        throw new GoogleApiError("HTTP_500", 500);
      },
    });
    expect(await syncMyGoogleCalendar(USER, { ...scope, events }, deps)).toEqual({
      kind: "UPSTREAM_FAILED",
      code: "HTTP_500",
    });
    expect(store.log).toEqual(["sync:FAILED"]);
  });
});
