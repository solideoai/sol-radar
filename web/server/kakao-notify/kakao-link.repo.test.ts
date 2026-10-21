import { inspect } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { KakaoLinkStoreError, createKakaoLinkStore } from "./kakao-link.repo";

// 카카오 연결 저장 port 의 Supabase 구현(service role, worker 전용. 계획 Task 3, 설계 §5.5·§7).
// 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어 PostgREST 로 나가는 요청(표·방법·select 열·필터·본문)을 보고,
// 메모리 행에 eq 필터를 적용해 어떤 행이 바뀌는지 본다. 실제 네트워크는 부르지 않는다.
// 저장 오류는 KakaoLinkStoreError 다. message 에는 표·동작·code 만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const OTHER_USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TABLE = "kakao_notify_links";
const LINK_COLUMNS = [
  "user_id",
  "access_token_enc",
  "refresh_token_enc",
  "access_expires_at",
  "refresh_expires_at",
  "status",
];
/** PostgREST 오류 본문·행의 값 자리. 오류 message 로 새면 안 된다. */
const LEAKY_TEXT = "LEAK-토큰암호문-비밀값";

type Row = Record<string, unknown>;
type Call = {
  method: string;
  table: string;
  params: URLSearchParams;
  prefer: string;
  body: unknown;
};
type Reply = { status: number; body?: unknown };

const linkRow = (overrides: Row = {}): Row => ({
  user_id: USER_ID,
  enabled: true,
  status: "CONNECTED",
  access_token_enc: "v1.kid.iv.tag.access",
  refresh_token_enc: "v1.iv.tag.refresh",
  access_expires_at: "2026-10-20T17:14:00+00:00",
  refresh_expires_at: "2026-12-19T05:14:00+00:00",
  last_sent_at: null,
  last_result: null,
  created_at: "2026-10-20T05:14:00+00:00",
  updated_at: "2026-10-20T05:14:00+00:00",
  ...overrides,
});

const postgrestError = (code: string, status = 400): Reply => ({
  status,
  body: {
    code,
    message: `${LEAKY_TEXT} message`,
    details: `${LEAKY_TEXT} details`,
    hint: `${LEAKY_TEXT} hint`,
  },
});

/** eq 필터와 is.null 만 안다. 다른 연산자·없는 열이면 400 으로 답해 흉내가 조용히 틀린 행을 고르지 않게 한다. */
function matches(row: Row, params: URLSearchParams): boolean | "UNSUPPORTED" {
  const filters = [...params.entries()].filter(([key]) => key !== "select");
  for (const [column, value] of filters) {
    if (!Object.hasOwn(row, column)) return "UNSUPPORTED";
    if (value === "is.null") {
      if (row[column] !== null) return false;
      continue;
    }
    if (!value.startsWith("eq.")) return "UNSUPPORTED";
    // eq 는 null 과 같지 않다(SQL 의 = null 처럼). null 을 "null" 글자와 맞추지 않는다.
    if (row[column] === null || String(row[column]) !== value.slice("eq.".length)) return false;
  }
  return true;
}

function project(row: Row, select: string | null): Row {
  if (select === null || select === "*") return { ...row };
  return Object.fromEntries(select.split(",").map((column) => [column.trim(), row[column.trim()]]));
}

function fakeSupabase(initial: Row[], fail?: (call: Call) => Reply | undefined) {
  const rows: Row[] = structuredClone(initial);
  const calls: Call[] = [];

  const route = (call: Call): Reply => {
    const failure = fail?.(call);
    if (failure) return failure;
    if (call.table !== TABLE) return postgrestError("FAKE_UNKNOWN_TABLE", 404);
    const picked = rows.map((row) => matches(row, call.params));
    if (picked.includes("UNSUPPORTED")) return postgrestError("FAKE_UNSUPPORTED_FILTER");
    const matched = rows.filter((_row, index) => picked[index] === true);
    if (call.method === "GET") {
      return { status: 200, body: matched.map((row) => project(row, call.params.get("select"))) };
    }
    if (call.method === "PATCH") {
      const patch = typeof call.body === "object" && call.body !== null ? call.body : {};
      for (const row of matched) Object.assign(row, patch);
      return call.prefer.includes("return=representation")
        ? { status: 200, body: matched.map((row) => project(row, call.params.get("select"))) }
        : { status: 204 };
    }
    return postgrestError("FAKE_UNSUPPORTED_METHOD", 405);
  };

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: (init?.method ?? "GET").toUpperCase(),
      table: url.pathname.replace(/^\/rest\/v1\//, ""),
      params: url.searchParams,
      prefer: headers.get("prefer") ?? "",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const reply = route(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };

  // 시험용 가짜 값. 실제 키 모양이 아니다.
  const client = createClient<Database>("http://supabase.test", "fake-service-role-key-for-tests", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return {
    client,
    rows,
    calls,
    sequence: () => calls.map((call) => `${call.method} ${call.table}`),
  };
}

const storeWith = (rows: Row[] = [linkRow()], fail?: (call: Call) => Reply | undefined) => {
  const fake = fakeSupabase(rows, fail);
  return { store: createKakaoLinkStore(fake.client), fake };
};

function only(calls: Call[]): Call {
  expect(calls).toHaveLength(1);
  return calls[0];
}

const selectedColumns = (call: Call): string[] =>
  (call.params.get("select") ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .toSorted();

const filtersOf = (call: Call): Record<string, string> =>
  Object.fromEntries([...call.params.entries()].filter(([key]) => key !== "select"));

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

const failAll = (code: string) => () => postgrestError(code);

function expectStoreError(error: Error, action: string, code: string): void {
  expect(error).toBeInstanceOf(KakaoLinkStoreError);
  expect(error.name).toBe("KakaoLinkStoreError");
  expect(error.message).toBe(`kakao link store 오류: ${TABLE}.${action} ${code}`);
  for (const text of [String(error), inspect(error), error.stack ?? ""]) {
    expect(text).not.toContain(LEAKY_TEXT);
  }
}

// ── read ──

describe("read", () => {
  it("kakao_notify_links 를 GET 한 번으로, 그 사용자 행만 읽는다", async () => {
    const { store, fake } = storeWith();
    await store.read(USER_ID);
    expect(fake.sequence()).toEqual([`GET ${TABLE}`]);
    expect(filtersOf(only(fake.calls))).toEqual({ user_id: `eq.${USER_ID}` });
  });

  it("user_id·토큰 암호문 둘·만료 둘·status 열만 고른다", async () => {
    const { store, fake } = storeWith();
    await store.read(USER_ID);
    expect(selectedColumns(only(fake.calls))).toEqual(LINK_COLUMNS.toSorted());
  });

  it("행을 StoredKakaoLink 로 바꾼다(시각은 Date)", async () => {
    const { store } = storeWith();
    expect(await store.read(USER_ID)).toEqual({
      userId: USER_ID,
      accessTokenEnc: "v1.kid.iv.tag.access",
      refreshTokenEnc: "v1.iv.tag.refresh",
      accessExpiresAt: new Date("2026-10-20T17:14:00Z"),
      refreshExpiresAt: new Date("2026-12-19T05:14:00Z"),
      status: "CONNECTED",
    });
  });

  it("토큰 암호문·만료가 null 이면 null 로 둔다", async () => {
    const { store } = storeWith([
      linkRow({
        status: "EXPIRED",
        access_token_enc: null,
        refresh_token_enc: null,
        access_expires_at: null,
        refresh_expires_at: null,
      }),
    ]);
    expect(await store.read(USER_ID)).toEqual({
      userId: USER_ID,
      accessTokenEnc: null,
      refreshTokenEnc: null,
      accessExpiresAt: null,
      refreshExpiresAt: null,
      status: "EXPIRED",
    });
  });

  it("행이 없으면 null", async () => {
    const { store } = storeWith([linkRow({ user_id: OTHER_USER_ID })]);
    expect(await store.read(USER_ID)).toBeNull();
  });

  it("status 가 CONNECTED·EXPIRED 가 아니면 UNEXPECTED_STATUS 로 던진다", async () => {
    const { store } = storeWith([linkRow({ status: LEAKY_TEXT })]);
    expectStoreError(await rejectionOf(store.read(USER_ID)), "select", "UNEXPECTED_STATUS");
  });

  it("시각이 읽을 수 없는 글자면 INVALID_ROW 로 던진다", async () => {
    const { store } = storeWith([linkRow({ access_expires_at: LEAKY_TEXT })]);
    expectStoreError(await rejectionOf(store.read(USER_ID)), "select", "INVALID_ROW");
  });

  it("PostgREST 오류는 code 만 싣고 던진다", async () => {
    const { store } = storeWith([linkRow()], failAll("42501"));
    expectStoreError(await rejectionOf(store.read(USER_ID)), "select", "42501");
  });
});

// ── saveTokens ──

/** 읽은 행의 액세스 암호문(linkRow 기본값). 조건부 갱신의 기대값이다. */
const READ_ACCESS = { accessTokenEnc: "v1.kid.iv.tag.access" };

describe("saveTokens", () => {
  const sealed = {
    accessTokenEnc: "v1.kid.new.tag.access",
    refreshTokenEnc: "v1.kid.new.tag.refresh",
    accessExpiresAt: new Date("2026-10-21T05:14:00.000Z"),
    refreshExpiresAt: new Date("2026-12-20T05:14:00.000Z"),
  };

  it("그 사용자 행을 PATCH 한 번으로 바꾸고 본문은 토큰 암호문 둘·만료 둘(ISO)뿐이며, 바꿨으면 true", async () => {
    const { store, fake } = storeWith();
    expect(await store.saveTokens(USER_ID, sealed, READ_ACCESS)).toBe(true);
    const call = only(fake.calls);
    expect(`${call.method} ${call.table}`).toBe(`PATCH ${TABLE}`);
    expect(call.body).toEqual({
      access_token_enc: "v1.kid.new.tag.access",
      refresh_token_enc: "v1.kid.new.tag.refresh",
      access_expires_at: "2026-10-21T05:14:00.000Z",
      refresh_expires_at: "2026-12-20T05:14:00.000Z",
    });
  });

  it("user_id 와 access_token_enc=읽은 값 조건으로 PATCH 한다(조건부 갱신)", async () => {
    const { store, fake } = storeWith();
    await store.saveTokens(USER_ID, sealed, READ_ACCESS);
    expect(filtersOf(only(fake.calls))).toEqual({
      user_id: `eq.${USER_ID}`,
      access_token_enc: `eq.${READ_ACCESS.accessTokenEnc}`,
    });
  });

  it("바뀐 행을 돌려받으려고 user_id 만 고른다(토큰 열을 읽지 않는다)", async () => {
    const { store, fake } = storeWith();
    await store.saveTokens(USER_ID, sealed, READ_ACCESS);
    expect(selectedColumns(only(fake.calls))).toEqual(["user_id"]);
  });

  it("행의 액세스 암호문이 읽은 값과 다르면(그 사이 사용자가 다시 연결함) 바꾸지 않고 false", async () => {
    const { store, fake } = storeWith([linkRow({ access_token_enc: "v1.kid.reconnected.access" })]);
    expect(await store.saveTokens(USER_ID, sealed, READ_ACCESS)).toBe(false);
    expect(fake.rows[0]).toMatchObject({
      access_token_enc: "v1.kid.reconnected.access",
      refresh_token_enc: "v1.iv.tag.refresh",
    });
  });

  it("기대값이 null 이면 access_token_enc is null 로 거른다 — null 인 행은 바꾸고 true, 값이 있는 행은 그대로 false", async () => {
    const nullRow = storeWith([linkRow({ access_token_enc: null })]);
    expect(await nullRow.store.saveTokens(USER_ID, sealed, { accessTokenEnc: null })).toBe(true);
    expect(filtersOf(only(nullRow.fake.calls))).toEqual({
      user_id: `eq.${USER_ID}`,
      access_token_enc: "is.null",
    });
    expect(nullRow.fake.rows[0].access_token_enc).toBe("v1.kid.new.tag.access");

    const filledRow = storeWith();
    expect(await filledRow.store.saveTokens(USER_ID, sealed, { accessTokenEnc: null })).toBe(false);
    expect(filledRow.fake.rows[0].access_token_enc).toBe(READ_ACCESS.accessTokenEnc);
  });

  it("행이 없으면(그 사이 연결 해제) false", async () => {
    const { store } = storeWith([linkRow({ user_id: OTHER_USER_ID })]);
    expect(await store.saveTokens(USER_ID, sealed, READ_ACCESS)).toBe(false);
  });

  it("refresh 가 null 이면 null 로 적는다", async () => {
    const { store, fake } = storeWith();
    await store.saveTokens(
      USER_ID,
      { ...sealed, refreshTokenEnc: null, refreshExpiresAt: null },
      READ_ACCESS,
    );
    expect(only(fake.calls).body).toMatchObject({
      refresh_token_enc: null,
      refresh_expires_at: null,
    });
  });

  it("다른 사용자 행은 바꾸지 않는다", async () => {
    const { store, fake } = storeWith([linkRow(), linkRow({ user_id: OTHER_USER_ID })]);
    await store.saveTokens(USER_ID, sealed, READ_ACCESS);
    expect(fake.rows.find((row) => row.user_id === OTHER_USER_ID)?.access_token_enc).toBe(
      READ_ACCESS.accessTokenEnc,
    );
    expect(fake.rows.find((row) => row.user_id === USER_ID)?.access_token_enc).toBe(
      "v1.kid.new.tag.access",
    );
  });

  it("PostgREST 오류는 code 만 싣고 던진다", async () => {
    const { store } = storeWith([linkRow()], failAll("23514"));
    expectStoreError(
      await rejectionOf(store.saveTokens(USER_ID, sealed, READ_ACCESS)),
      "update",
      "23514",
    );
  });
});

// ── markExpired ──

describe("markExpired", () => {
  it("CONNECTED 이고 액세스 암호문이 읽은 값인 행을 EXPIRED 로 바꾸고 true", async () => {
    const { store, fake } = storeWith();
    expect(await store.markExpired(USER_ID, READ_ACCESS)).toBe(true);
    expect(fake.rows[0].status).toBe("EXPIRED");
  });

  it("이미 EXPIRED 면 바꾸지 않고 false", async () => {
    const { store, fake } = storeWith([linkRow({ status: "EXPIRED" })]);
    expect(await store.markExpired(USER_ID, READ_ACCESS)).toBe(false);
    expect(fake.rows[0].status).toBe("EXPIRED");
  });

  it("행이 없으면 false", async () => {
    const { store } = storeWith([linkRow({ user_id: OTHER_USER_ID })]);
    expect(await store.markExpired(USER_ID, READ_ACCESS)).toBe(false);
  });

  it("액세스 암호문이 읽은 값과 다르면(그 사이 다시 연결한 새 행) CONNECTED 그대로 두고 false", async () => {
    const { store, fake } = storeWith([linkRow({ access_token_enc: "v1.kid.reconnected.access" })]);
    expect(await store.markExpired(USER_ID, READ_ACCESS)).toBe(false);
    expect(fake.rows[0].status).toBe("CONNECTED");
  });

  it("user_id·status=CONNECTED·access_token_enc=읽은 값 조건으로 PATCH 하고 본문은 status 하나다", async () => {
    const { store, fake } = storeWith();
    await store.markExpired(USER_ID, READ_ACCESS);
    const call = only(fake.calls);
    expect(call.method).toBe("PATCH");
    expect(filtersOf(call)).toEqual({
      user_id: `eq.${USER_ID}`,
      status: "eq.CONNECTED",
      access_token_enc: `eq.${READ_ACCESS.accessTokenEnc}`,
    });
    expect(call.body).toEqual({ status: "EXPIRED" });
  });

  it("기대값이 null 이면 access_token_enc is null 로 거른다", async () => {
    const { store, fake } = storeWith([linkRow({ access_token_enc: null })]);
    expect(await store.markExpired(USER_ID, { accessTokenEnc: null })).toBe(true);
    expect(filtersOf(only(fake.calls))).toMatchObject({ access_token_enc: "is.null" });
    expect(fake.rows[0].status).toBe("EXPIRED");
  });

  it("바뀐 행을 돌려받으려고 user_id 만 고른다(토큰 열을 읽지 않는다)", async () => {
    const { store, fake } = storeWith();
    await store.markExpired(USER_ID, READ_ACCESS);
    expect(selectedColumns(only(fake.calls))).toEqual(["user_id"]);
  });

  it("PostgREST 오류는 code 만 싣고 던진다", async () => {
    const { store } = storeWith([linkRow()], failAll("40001"));
    expectStoreError(await rejectionOf(store.markExpired(USER_ID, READ_ACCESS)), "update", "40001");
  });
});

// ── markResult ──

describe("markResult", () => {
  const AT = new Date("2026-10-20T05:14:01.000Z");

  it.each(["SENT", "FAILED", "EXPIRED"] as const)(
    "%s 를 last_result 에, 시각을 last_sent_at 에 적는다",
    async (result) => {
      const { store, fake } = storeWith();
      await store.markResult(USER_ID, result, AT);
      const call = only(fake.calls);
      expect(call.method).toBe("PATCH");
      expect(filtersOf(call)).toEqual({ user_id: `eq.${USER_ID}` });
      expect(call.body).toEqual({ last_sent_at: "2026-10-20T05:14:01.000Z", last_result: result });
      expect(fake.rows[0]).toMatchObject({ last_result: result, status: "CONNECTED" });
    },
  );

  it("PostgREST 오류는 code 만 싣고 던진다", async () => {
    const { store } = storeWith([linkRow()], failAll("08006"));
    expectStoreError(await rejectionOf(store.markResult(USER_ID, "SENT", AT)), "update", "08006");
  });

  it("code 가 없는 오류는 UNKNOWN 이다", async () => {
    const { store } = storeWith([linkRow()], () => ({
      status: 500,
      body: { message: LEAKY_TEXT },
    }));
    expectStoreError(await rejectionOf(store.markResult(USER_ID, "SENT", AT)), "update", "UNKNOWN");
  });
});
