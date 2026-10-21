import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkDeps } from "@/app/_lib/work-deps";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  ORG_02,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import type {
  AnalysisView,
  BidDetail,
  BidListItem,
  BidsRepo,
  Review,
  ReviewRepo,
} from "@/server/bids";
import * as analysisRoute from "./analyses/[id]/route";
import * as whatIfRoute from "./analyses/[id]/what-if/route";
import * as bidAnalysesRoute from "./bids/[id]/analyses/route";
import * as qualificationRoute from "./bids/[id]/qualification-checks/route";
import * as reviewsRoute from "./bids/[id]/reviews/route";
import * as bidRoute from "./bids/[id]/route";
import * as bidsRoute from "./bids/route";

// 11 G5 조직 격리의 Route Handler 겹. 공고는 모든 조직이 같이 보고, 분석·결정은 조직마다 따로다.
// 가짜 저장소가 RLS 대신 orgId 로 거른다. 세션의 조직이 저장소까지 그대로 가는지와
// 다른 조직의 자원이 404·[]·null 로만 보이는지를 본다(정책 자체는 scripts/database.test.mjs).

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

const SECRET = "test-only-cursor-secret-at-least-32-characters";
// 가상 FX-01 공고와 org-01 의 분석·결정
const FX01 = "f0000000-0000-4000-8000-000000000001";
const ORG01_RUN = "a0000000-0000-4000-8000-000000000001";
const ORG01_REVIEW = "a0000000-0000-4000-8000-000000000002";

const ORG01_ANALYSIS = {
  id: ORG01_RUN,
  bidId: FX01,
  status: "COMPLETED",
  qualification: {
    status: "SATISFIED",
    checks: [
      { id: `${ORG01_RUN}:license`, requirementName: "소프트웨어사업자", outcome: "SATISFIED" },
    ],
  },
} as unknown as AnalysisView;
const ORG01_DECISION: Review = {
  id: ORG01_REVIEW,
  bidId: FX01,
  revisionId: "rev-1",
  scoreRunId: ORG01_RUN,
  reviewer: { id: FAKE_USERS.sales.id, name: "가상직원", role: "SALES" },
  decision: "BID",
  reason: "필수 자격을 모두 갖춘 공고라 입찰한다",
  decidedAt: "2026-10-19T00:00:00.000Z",
  assignee: null,
  systemRecommendationAtDecision: "BID",
  disagreementFlag: false,
};

const runs = [{ orgId: ORG_01, view: ORG01_ANALYSIS }];
const decisions = [{ orgId: ORG_01, review: ORG01_DECISION }];
const runsOf = (orgId: string, bidId: string) =>
  runs.filter((run) => run.orgId === orgId && run.view.bidId === bidId).map((run) => run.view);
const notUsed = async (): Promise<never> => {
  throw new Error("조직 격리 시험에서 부르지 않는 저장소 함수다");
};

function orgScopedBids(): BidsRepo {
  return {
    listBids: vi.fn(async (orgId: string) => {
      const latest = runsOf(orgId, FX01)[0] ?? null;
      const item = {
        id: FX01,
        title: "가상 FX-01",
        latestAnalysis: latest === null ? null : { id: latest.id, status: latest.status },
      } as unknown as BidListItem;
      return { items: [item], hasNext: false, last: null };
    }),
    getBid: vi.fn(async (orgId: string, id: string) =>
      id === FX01
        ? ({
            id: FX01,
            title: "가상 FX-01",
            latestAnalysis: runsOf(orgId, id)[0] ?? null,
            reviews: decisions
              .filter((decision) => decision.orgId === orgId)
              .map((decision) => decision.review),
          } as unknown as BidDetail)
        : null,
    ),
    countBids: notUsed,
    bidExists: vi.fn(async (_orgId: string, bidId: string) => bidId === FX01),
    listAnalyses: vi.fn(async (orgId: string, bidId: string) => ({
      items: runsOf(orgId, bidId),
      hasNext: false,
      last: null,
    })),
    getLatestScoredAnalysis: vi.fn(
      async (orgId: string, bidId: string) => runsOf(orgId, bidId)[0] ?? null,
    ),
    getAnalysis: vi.fn(
      async (orgId: string, id: string) =>
        runs.find((run) => run.orgId === orgId && run.view.id === id)?.view ?? null,
    ),
    getAnalysisSnapshot: vi.fn(async (orgId: string, id: string) =>
      runs.some((run) => run.orgId === orgId && run.view.id === id)
        ? { status: "COMPLETED" as const, inputSnapshot: null }
        : null,
    ),
    findRunningAnalysis: notUsed,
    findCompletedSameInput: notUsed,
    resolveAnalysisInput: notUsed,
    createAnalysisRun: notUsed,
    markRunFailed: notUsed,
    findIdempotency: notUsed,
  };
}

function orgScopedReviews(): ReviewRepo {
  return {
    listReviews: vi.fn(async (orgId: string, bidId: string) =>
      bidId === FX01
        ? decisions.filter((decision) => decision.orgId === orgId).map((d) => d.review)
        : null,
    ),
    getReviewTarget: notUsed,
    isOrgMember: notUsed,
    createReview: notUsed,
  };
}

function install(): WorkDeps {
  const built: WorkDeps = {
    bids: orgScopedBids(),
    reviews: orgScopedReviews(),
    notifications: { list: notUsed, markRead: notUsed },
    dashboard: { load: notUsed, loadStatus: notUsed, listFinishedScores: notUsed },
    queue: { enqueue: notUsed },
    limiter: { hit: notUsed },
    cursorSecret: SECRET,
    runMode: "mock",
    onInfraError: vi.fn(),
  };
  deps.current = built;
  return built;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function get(user: FakeUser, path: string): Request {
  fakeSession.cookie = user.token;
  return fakeRequest(path);
}

// 가정 재계산은 저장하지 않는 읽기 계산이지만 POST 다(CSRF 머리글을 붙인다).
function postJson(user: FakeUser, path: string, body: unknown): Request {
  fakeSession.cookie = user.token;
  return fakeRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "sol-radar" },
    body: JSON.stringify(body),
  });
}

const ASSUME_ICT = { assumptions: [{ kind: "QUALIFICATION", code: "ICT_CONSTRUCTION" }] };

// 오류 봉투에서 요청마다 다른 requestId 를 뺀 부분.
const errorShape = (error: { code: string; message: string; details: unknown }) => ({
  code: error.code,
  message: error.message,
  details: error.details,
});

// 조직 격리에 걸리는 조회 경로 전부. 이름 → 응답
async function readAll(user: FakeUser): Promise<Record<string, Response>> {
  return {
    list: await bidsRoute.GET(get(user, "/api/v1/bids")),
    bid: await bidRoute.GET(get(user, `/api/v1/bids/${FX01}`), ctx(FX01)),
    analyses: await bidAnalysesRoute.GET(get(user, `/api/v1/bids/${FX01}/analyses`), ctx(FX01)),
    checks: await qualificationRoute.GET(
      get(user, `/api/v1/bids/${FX01}/qualification-checks`),
      ctx(FX01),
    ),
    analysis: await analysisRoute.GET(get(user, `/api/v1/analyses/${ORG01_RUN}`), ctx(ORG01_RUN)),
    reviews: await reviewsRoute.GET(get(user, `/api/v1/bids/${FX01}/reviews`), ctx(FX01)),
    whatIf: await whatIfRoute.POST(
      postJson(user, `/api/v1/analyses/${ORG01_RUN}/what-if`, ASSUME_ICT),
      ctx(ORG01_RUN),
    ),
  };
}

beforeEach(() => {
  resetFakeSession();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("11 G5 조직 격리 — Route Handler", () => {
  it("대조군: org-01 SALES 는 자기 조직의 분석·자격 확인·결정을 본다", async () => {
    install();
    const { whatIf, ...responses } = await readAll(FAKE_USERS.sales);
    for (const [name, response] of Object.entries(responses)) {
      expect(response.status, name).toBe(200);
    }
    // 가정 재계산은 자기 조직 run 까지 간다. 가짜 저장소의 org-01 스냅샷이 비어 있어 NO_SNAPSHOT 404 다
    // (다른 조직의 "없는 run" 404 와 다른 본문이다. 아래 org-02 시험과 짝).
    expect(whatIf?.status).toBe(404);
    expect((await whatIf?.json()).error.details).toEqual({
      resource: "analysis",
      reason: "NO_SNAPSHOT",
    });
    expect((await responses.bid?.json()).latestAnalysis.id).toBe(ORG01_RUN);
    expect((await responses.analysis?.json()).id).toBe(ORG01_RUN);
    expect(await responses.checks?.json()).toHaveLength(1);
    expect(await responses.reviews?.json()).toEqual([ORG01_DECISION]);
  });

  it("org-02 VIEWER 는 FX-01 자격 확인 404, org-01 분석 404, 결정 [] 이고 공고는 latestAnalysis null 로 본다", async () => {
    const d = install();
    const responses = await readAll(FAKE_USERS.otherViewer);

    expect(responses.checks?.status).toBe(404);
    expect((await responses.checks?.json()).error).toMatchObject({
      code: "NOT_FOUND",
      details: { resource: "analysis" },
    });
    expect(responses.analysis?.status).toBe(404);
    const analysisError = (await responses.analysis?.json()).error;
    expect(analysisError).toMatchObject({
      code: "NOT_FOUND",
      details: { resource: "analysis" },
    });
    // 다른 조직 run 의 가정 재계산은 GET /analyses/:id 와 같은 404 본문이다(있는지 새지 않는다).
    expect(responses.whatIf?.status).toBe(404);
    expect(errorShape((await responses.whatIf?.json()).error)).toEqual(errorShape(analysisError));
    expect(responses.reviews?.status).toBe(200);
    expect(await responses.reviews?.json()).toEqual([]);
    expect(responses.bid?.status).toBe(200);
    const bid = await responses.bid?.json();
    expect(bid.latestAnalysis).toBeNull();
    expect(bid.reviews).toEqual([]);

    // 세션의 조직(org-02)이 저장소까지 그대로 간다. 요청이 조직을 고를 길은 없다.
    expect(d.bids.getAnalysis).toHaveBeenCalledWith(ORG_02, ORG01_RUN);
    expect(d.bids.getAnalysisSnapshot).toHaveBeenCalledWith(ORG_02, ORG01_RUN);
    expect(d.bids.getLatestScoredAnalysis).toHaveBeenCalledWith(ORG_02, FX01);
    expect(d.reviews.listReviews).toHaveBeenCalledWith(ORG_02, FX01);
  });

  it("org-02 VIEWER 의 응답 본문 어디에도 org-01 run id·결정 id 가 없다", async () => {
    install();
    const responses = await readAll(FAKE_USERS.otherViewer);
    for (const [name, response] of Object.entries(responses)) {
      const text = await response.text();
      expect(text, name).not.toContain(ORG01_RUN);
      expect(text, name).not.toContain(ORG01_REVIEW);
    }
  });
});
