import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkDeps } from "@/app/_lib/work-deps";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import { bidRevisionSummarySchema, type BidRevisionSummary, type BidsRepo } from "@/server/bids";
import * as revisionRoute from "./bids/[id]/revisions/[rev]/route";
import * as revisionsRoute from "./bids/[id]/revisions/route";

// 05 §2 공고 revision 두 GET 의 Route Handler 계약 시험. 인증·조직 확인은 진짜 코드가 돌고 저장소만 가짜다.

const deps = vi.hoisted(() => ({ current: null as WorkDeps | null }));
vi.mock("@/app/_lib/work-deps", () => ({
  workDeps: () => {
    if (deps.current === null) throw new Error("시험이 workDeps 를 정하지 않았다");
    return deps.current;
  },
}));
vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));

const BID_ID = "b1000000-0000-4000-8000-000000000007";

const revision = (n: number, changedFields: string[]): BidRevisionSummary => ({
  id: `r000000${n}-0000-4000-8000-000000000007`,
  revision: n,
  amendmentNo: `0${n}`,
  fetchedAt: `2026-10-1${n}T00:00:00.000Z`,
  checksum: `checksum-${n}`,
  changedFields,
});
const HISTORY = [revision(2, ["amendmentNo", "budgetKrw"]), revision(1, [])];
const SNAPSHOTS = [
  { revision: 1, normalized: { title: "FX-07", budgetKrw: "1800000000" } },
  { revision: 2, normalized: { title: "FX-07", budgetKrw: "2160000000" } },
];

function install(): { repo: BidsRepo; getHistory: ReturnType<typeof vi.fn> } {
  const getHistory = vi.fn(async (bidId: string) =>
    bidId === BID_ID ? { title: "FX-07", revisions: HISTORY } : null,
  );
  const notUsed = async (): Promise<never> => {
    throw new Error("revision 라우트가 부르지 않는 저장소 함수다");
  };
  const repo = {
    getRevisionHistory: getHistory,
    getRevisionSnapshots: vi.fn(async (_bidId: string, revisions: number[]) =>
      SNAPSHOTS.filter((row) => revisions.includes(row.revision)),
    ),
    bidExists: notUsed,
  } as unknown as BidsRepo;
  deps.current = {
    bids: repo,
    reviews: {},
    notifications: {},
    dashboard: {},
    queue: {},
    limiter: {},
    cursorSecret: "test-only-cursor-secret-at-least-32-characters",
    runMode: "mock",
    onInfraError: vi.fn(),
  } as unknown as WorkDeps;
  return { repo, getHistory };
}

async function listRevisions(id: string, user: FakeUser | null = FAKE_USERS.sales) {
  fakeSession.cookie = user?.token ?? null;
  return revisionsRoute.GET(fakeRequest(`/api/v1/bids/${id}/revisions`), {
    params: Promise.resolve({ id }),
  });
}

async function oneRevision(id: string, rev: string, user: FakeUser | null = FAKE_USERS.sales) {
  fakeSession.cookie = user?.token ?? null;
  return revisionRoute.GET(fakeRequest(`/api/v1/bids/${id}/revisions/${rev}`), {
    params: Promise.resolve({ id, rev }),
  });
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

describe("GET /api/v1/bids/:id/revisions", () => {
  it("200 이고 revision 요약 배열을 내림차순으로 낸다", async () => {
    install();
    const response = await listRevisions(BID_ID);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const parsed = bidRevisionSummarySchema.array().parse(body);
    expect(parsed.map((row) => row.revision)).toEqual([2, 1]);
  });

  it("VIEWER 도 200 이다(공고는 모든 조직이 같이 본다)", async () => {
    install();
    expect((await listRevisions(BID_ID, FAKE_USERS.viewer)).status).toBe(200);
  });

  it("세션이 없으면 401, 조직이 없으면 403 이고 저장소를 부르지 않는다", async () => {
    const { getHistory } = install();
    const anonymous = await listRevisions(BID_ID, null);
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("UNAUTHENTICATED");
    fakeSession.orgCount = 0;
    const noOrg = await listRevisions(BID_ID);
    expect(noOrg.status).toBe(403);
    expect((await noOrg.json()).error.details.reason).toBe("ORGANIZATION_REQUIRED");
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("uuid 가 아니거나 없는 공고는 404 bid 이다", async () => {
    const { getHistory } = install();
    const bad = await listRevisions("not-a-uuid");
    expect(bad.status).toBe(404);
    expect(getHistory).not.toHaveBeenCalled();
    const missing = await listRevisions("b1000000-0000-4000-8000-0000000000ff");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatchObject({
      code: "NOT_FOUND",
      details: { resource: "bid" },
    });
  });
});

describe("GET /api/v1/bids/:id/revisions/:rev", () => {
  it("200 이고 그 revision 의 스냅샷을 낸다", async () => {
    install();
    const response = await oneRevision(BID_ID, "2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ budgetKrw: "2160000000" });
  });

  it("VIEWER 도 200 이다", async () => {
    install();
    expect((await oneRevision(BID_ID, "1", FAKE_USERS.viewer)).status).toBe(200);
  });

  it("0·abc·앞 0·없는 번호는 404 revision 이다", async () => {
    install();
    for (const rev of ["0", "abc", "01", "3"]) {
      const response = await oneRevision(BID_ID, rev);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toMatchObject({
        code: "NOT_FOUND",
        details: { resource: "revision" },
      });
    }
  });

  it("번호가 숫자가 아니면 저장소를 부르지 않는다", async () => {
    const { getHistory } = install();
    await oneRevision(BID_ID, "abc");
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("uuid 가 아닌 id 는 404 bid 이고, 세션이 없으면 401 이다", async () => {
    install();
    const bad = await oneRevision("not-a-uuid", "1");
    expect(bad.status).toBe(404);
    expect((await bad.json()).error.details.resource).toBe("bid");
    expect((await oneRevision(BID_ID, "1", null)).status).toBe(401);
  });
});
