import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import * as route from "./analyses/route";

const list = vi.hoisted(() => vi.fn(async () => ({ items: [], hasNext: false, last: null })));
vi.mock("@/server/bids", async (original) => ({
  ...(await original<typeof import("@/server/bids")>()),
  analysisHistoryRepo: { list },
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
  list.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("API_CURSOR_SECRET", "analysis-test-cursor-secret-at-least-32-characters");
});
afterEach(() => vi.unstubAllEnvs());

it("VIEWER도 세션 조직의 필터된 이력을 읽고 요청 orgId를 권한으로 쓰지 않는다", async () => {
  const response = await route.GET(
    fakeRequest("/api/v1/analyses?status=PARTIAL&runMode=mock&orgId=other", {
      headers: { Authorization: `Bearer ${FAKE_USERS.viewer.token}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(list).toHaveBeenCalledWith(
    ORG_01,
    expect.objectContaining({ status: "PARTIAL", runMode: "mock" }),
    null,
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("미인증·유효하지 않은 필터는 저장소 호출 전에 거절한다", async () => {
  expect((await route.GET(fakeRequest("/api/v1/analyses"))).status).toBe(401);
  expect(
    (
      await route.GET(
        fakeRequest("/api/v1/analyses?limit=101", {
          headers: { Authorization: `Bearer ${FAKE_USERS.viewer.token}` },
        }),
      )
    ).status,
  ).toBe(400);
  expect(list).not.toHaveBeenCalled();
});
