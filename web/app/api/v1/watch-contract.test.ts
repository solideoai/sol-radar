import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import type { WatchlistRepo } from "@/server/watchlist";
import * as watchRoute from "./bids/[id]/watch/route";

// PUT·DELETE /bids/:id/watch 계약(05 §2, N3). 인증·CSRF·가입 완료·업무 조직 확인은 진짜 입구 코드가 돌고,
// SDK 전송만 fake-session 이, 저장은 watch-deps 가짜가 맡는다. 본인 행만·다른 조직 0행은 DB 정책 시험이 본다.

const deps = vi.hoisted(() => ({ current: null as WatchlistRepo | null }));
vi.mock("@/app/_lib/watch-deps", () => ({
  watchDeps: () => {
    if (deps.current === null) throw new Error("시험이 watchDeps 를 정하지 않았다");
    return { repo: deps.current };
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

const BID_ID = "b1000000-0000-4000-8000-000000000001";

function install(overrides: Partial<WatchlistRepo> = {}): WatchlistRepo {
  const repo: WatchlistRepo = {
    bidExists: vi.fn(async () => true),
    addWatch: vi.fn(async () => undefined),
    removeWatch: vi.fn(async () => undefined),
    isWatching: vi.fn(async () => false),
    countWatchers: vi.fn(async () => 1),
    listMyWatchedBidIds: vi.fn(async () => []),
    ...overrides,
  };
  deps.current = repo;
  return repo;
}

const writes = (repo: WatchlistRepo) =>
  vi.mocked(repo.addWatch).mock.calls.length +
  vi.mocked(repo.removeWatch).mock.calls.length +
  vi.mocked(repo.bidExists).mock.calls.length;

type Method = "PUT" | "DELETE";
type SendOptions = {
  user?: FakeUser | null;
  csrf?: boolean;
  id?: string;
};

// 쿠키 세션이 기본이고 CSRF 헤더를 기본으로 단다.
function send(method: Method, options: SendOptions = {}): Promise<Response> {
  const user = options.user === undefined ? FAKE_USERS.sales : options.user;
  const id = options.id ?? BID_ID;
  fakeSession.cookie = user?.token ?? null;
  const request = fakeRequest(`/api/v1/bids/${id}/watch`, {
    method,
    headers: options.csrf === false ? {} : { "X-Requested-With": "sol-radar" },
  });
  const handle = method === "PUT" ? watchRoute.PUT : watchRoute.DELETE;
  return handle(request, { params: Promise.resolve({ id }) });
}

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({ code, requestId: response.headers.get("X-Request-Id") });
  return body.error;
}

beforeEach(() => {
  resetFakeSession();
  deps.current = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PUT·DELETE /api/v1/bids/:id/watch", () => {
  it("PUT 은 200 { bidId, watched: true, watcherCount } 이고 세션의 조직·사람으로 넣는다", async () => {
    const repo = install({ countWatchers: vi.fn(async () => 3) });
    const response = await send("PUT");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bidId: BID_ID,
      watched: true,
      watcherCount: 3,
    });
    expect(repo.addWatch).toHaveBeenCalledWith(
      { orgId: FAKE_USERS.sales.orgId, userId: FAKE_USERS.sales.id },
      BID_ID,
    );
  });

  it("PUT 을 두 번 보내도 둘 다 200 이고 본문이 같다(멱등)", async () => {
    install();
    const first = await send("PUT");
    const second = await send("PUT");
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.json()).toEqual(await first.json());
  });

  it("DELETE 는 관심이 없던 공고여도 200 { watched: false } 다(멱등)", async () => {
    const repo = install({ countWatchers: vi.fn(async () => 0) });
    const response = await send("DELETE");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bidId: BID_ID,
      watched: false,
      watcherCount: 0,
    });
    expect(repo.removeWatch).toHaveBeenCalledTimes(1);
  });

  it("11 G5: 다른 조직 사용자는 자기 조직·자기 id 범위로만 넣고 지운다(세션의 조직이 저장까지 그대로 간다)", async () => {
    const repo = install();
    const other = FAKE_USERS.otherViewer;
    await send("PUT", { user: other });
    await send("DELETE", { user: other });
    const scope = { orgId: other.orgId, userId: other.id };
    expect(repo.addWatch).toHaveBeenCalledWith(scope, BID_ID);
    expect(repo.removeWatch).toHaveBeenCalledWith(scope, BID_ID);
  });

  it("VIEWER 도 자기 관심을 넣고 뺀다(모든 역할 허용, 설계 §2.4)", async () => {
    install();
    expect((await send("PUT", { user: FAKE_USERS.viewer })).status).toBe(200);
    expect((await send("DELETE", { user: FAKE_USERS.viewer })).status).toBe(200);
  });

  it("경로 id 가 UUID 가 아니면 404 {resource: bid} 이고 저장을 부르지 않는다", async () => {
    const repo = install();
    for (const method of ["PUT", "DELETE"] as const) {
      const error = await errorOf(await send(method, { id: "not-a-uuid" }), 404, "NOT_FOUND");
      expect(error.details).toEqual({ resource: "bid" });
    }
    expect(writes(repo)).toBe(0);
  });

  it("없는 공고면 404 {resource: bid} 이고 넣거나 지우지 않는다", async () => {
    const repo = install({ bidExists: vi.fn(async () => false) });
    for (const method of ["PUT", "DELETE"] as const) {
      const error = await errorOf(await send(method), 404, "NOT_FOUND");
      expect(error.details).toEqual({ resource: "bid" });
    }
    expect(repo.addWatch).not.toHaveBeenCalled();
    expect(repo.removeWatch).not.toHaveBeenCalled();
  });

  it("세션이 없으면 401, 쿠키 세션에 CSRF 헤더가 없으면 403 이고 저장을 부르지 않는다", async () => {
    const repo = install();
    for (const method of ["PUT", "DELETE"] as const) {
      await errorOf(await send(method, { user: null }), 401, "UNAUTHENTICATED");
      await errorOf(await send(method, { csrf: false }), 403, "CSRF_REJECTED");
    }
    expect(writes(repo)).toBe(0);
  });

  it("업무 조직이 둘이면 403 UNSUPPORTED_ACCOUNT_STATE 다(조직을 요청에서 받지 않는다, M17)", async () => {
    const repo = install();
    fakeSession.orgCount = 2;
    await errorOf(await send("PUT"), 403, "UNSUPPORTED_ACCOUNT_STATE");
    expect(writes(repo)).toBe(0);
  });

  it("저장이 던진 DB 오류는 500 INTERNAL_ERROR 이고 원문이 응답에 없다", async () => {
    install({
      addWatch: vi.fn(async () => {
        throw { code: "XX000", message: "private database details" };
      }),
    });
    const response = await send("PUT");
    const text = await response.clone().text();
    await errorOf(response, 500, "INTERNAL_ERROR");
    expect(text).not.toContain("private");
  });

  it("route 모듈은 PUT·DELETE 만 내보낸다", () => {
    expect(Object.keys(watchRoute).sort()).toEqual(["DELETE", "PUT"]);
  });
});
