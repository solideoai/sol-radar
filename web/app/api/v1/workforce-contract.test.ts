import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import * as route from "./workforce/simulation/route";
const bid = "b1000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ exists: true, read: vi.fn() }));
vi.mock("@/server/workforce", async (original) => ({
  ...(await original<typeof import("@/server/workforce")>()),
  workforceRepo: {
    readBid: async (org: string, bidId: string) => {
      state.read(org, bidId);
      return state.exists ? { bidId, title: "가상", isDemo: true } : null;
    },
    latestAttempt: async () => null,
    scoredSnapshots: async () => [],
    current: async () => ({ people: [], assignments: [] }),
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
  state.exists = true;
  state.read.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});
afterEach(() => vi.unstubAllEnvs());
const request = (query: string) =>
  fakeRequest(`/api/v1/workforce/simulation?${query}`, {
    headers: { Authorization: `Bearer ${FAKE_USERS.viewer.token}` },
  });
it("VIEWER도 세션 조직만 읽고 접근할 수 없는 공고는 404다", async () => {
  const response = await route.GET(request(`bidIds=${bid}&orgId=forged`));
  expect(response.status).toBe(200);
  expect(state.read).toHaveBeenCalledWith(ORG_01, bid);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  state.exists = false;
  expect((await route.GET(request(`bidIds=${bid}`))).status).toBe(404);
});
it("미인증과 서로 다른 UUID 1~3건 이외의 입력을 조회 전에 거절한다", async () => {
  expect((await route.GET(fakeRequest(`/api/v1/workforce/simulation?bidIds=${bid}`))).status).toBe(
    401,
  );
  for (const query of [
    "",
    "bidIds=invalid",
    `bidIds=${bid},${bid}`,
    `bidIds=${[1, 2, 3, 4].map((n) => `b1000000-0000-4000-8000-00000000000${n}`).join(",")}`,
  ])
    expect((await route.GET(request(query))).status).toBe(400);
  expect(state.read).not.toHaveBeenCalled();
});
