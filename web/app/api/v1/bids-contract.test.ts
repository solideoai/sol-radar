import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkDeps } from "@/app/_lib/work-deps";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import {
  notificationRepo,
  type AnalysisView,
  type BidDetail,
  type BidsRepo,
  type DashboardRepo,
  type DashboardSource,
  type Notification,
  type NotificationRepo,
  type Review,
  type ReviewRepo,
} from "@/server/bids";
import * as analysisRoute from "./analyses/[id]/route";
import * as bidAnalysesRoute from "./bids/[id]/analyses/route";
import * as qualificationRoute from "./bids/[id]/qualification-checks/route";
import * as reviewsRoute from "./bids/[id]/reviews/route";
import * as bidRoute from "./bids/[id]/route";
import * as bidsRoute from "./bids/route";
import * as dashboardRoute from "./dashboard/summary/route";
import * as readRoute from "./notifications/[id]/read/route";
import * as notificationsRoute from "./notifications/route";

// 업무 Route Handler 계약 시험(05 §2·§3). 인증·가입 완료·업무 조직 확인은 진짜 코드가 돌고
// SDK 전송만 fake-session 이 바꾼다. 저장소·큐·속도 제한은 시험마다 workDeps 가짜로 바꾼다.

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
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
}));

const SECRET = "test-only-cursor-secret-at-least-32-characters";
const BID_ID = "b1000000-0000-4000-8000-000000000001";
const RUN_ID = "c1000000-0000-4000-8000-000000000001";
const REVIEW_ID = "d1000000-0000-4000-8000-000000000001";
const NOTE_ID = "e1000000-0000-4000-8000-000000000001";
const KEY = "3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c";
const REASON = "필수 자격을 모두 갖춘 공고라 입찰한다";

// 라우트는 서비스 결과를 그대로 JSON 으로 옮기므로 상세 DTO 는 필요한 필드만 둔다.
const BID = { id: BID_ID, title: "가상 공고", latestAnalysis: null } as unknown as BidDetail;
const ANALYSIS = {
  id: RUN_ID,
  bidId: BID_ID,
  status: "COMPLETED",
  qualification: { status: "SATISFIED", checks: [] },
} as unknown as AnalysisView;
const REVIEW: Review = {
  id: REVIEW_ID,
  bidId: BID_ID,
  revisionId: "rev-1",
  scoreRunId: RUN_ID,
  reviewer: { id: FAKE_USERS.sales.id, name: "가상직원", role: "SALES" },
  decision: "BID",
  reason: REASON,
  decidedAt: "2026-10-19T00:00:00.000Z",
  assignee: null,
  systemRecommendationAtDecision: "BID",
  disagreementFlag: false,
};
const NOTIFICATION: Notification = {
  id: NOTE_ID,
  type: "ANALYSIS_COMPLETE",
  channel: "IN_APP",
  status: "SENT",
  payload: {
    bidId: BID_ID,
    title: "가상 공고",
    message: "분석이 끝났습니다",
    link: `/bids/${BID_ID}`,
  },
  readAt: "2026-10-19T00:00:00.000Z",
  createdAt: "2026-10-19T00:00:00.000Z",
};
const DASHBOARD_SOURCE: DashboardSource = {
  bids: [],
  dataFreshness: { lastIngestAt: null, lastIngestStatus: null, lastIngestSummary: null },
  ai: { provider: "mock", kevEnabled: true, lastGatewayCheckAt: null, healthy: true },
  unreadNotifications: 0,
};
const ANALYSIS_INPUT = {
  companyProfileId: "cp-1",
  profileRevision: 1,
  revisionId: "rev-1",
  extractionId: null,
  algorithmVersion: "sol-score/v0.1",
};

const emptyPage = async () => ({ items: [], hasNext: false, last: null });

function fakeBids(): BidsRepo {
  return {
    listBids: vi.fn(emptyPage),
    countBids: vi.fn(async () => 0),
    getBid: vi.fn(async () => BID),
    bidExists: vi.fn(async () => true),
    listAnalyses: vi.fn(emptyPage),
    getLatestScoredAnalysis: vi.fn(async () => ANALYSIS),
    getAnalysis: vi.fn(async () => ANALYSIS),
    getAnalysisSnapshot: vi.fn(async () => null),
    findRunningAnalysis: vi.fn(async () => null),
    findCompletedSameInput: vi.fn(async () => null),
    resolveAnalysisInput: vi.fn(async () => ANALYSIS_INPUT),
    createAnalysisRun: vi.fn(async () => ({ created: { id: RUN_ID, status: "QUEUED" as const } })),
    markRunFailed: vi.fn(async () => undefined),
    findIdempotency: vi.fn(async () => null),
  };
}

function fakeReviews(): ReviewRepo {
  return {
    getReviewTarget: vi.fn(async () => ({
      revisionId: "rev-1",
      analysis: { id: RUN_ID, recommendation: "BID" as const },
    })),
    listReviews: vi.fn(async () => [REVIEW]),
    isOrgMember: vi.fn(async () => true),
    createReview: vi.fn(async () => REVIEW),
  };
}

function fakeNotifications(): NotificationRepo {
  return {
    list: vi.fn(async () => ({ items: [NOTIFICATION], hasNext: false, last: null })),
    markRead: vi.fn(async () => NOTIFICATION),
  };
}

type Overrides = {
  bids?: Partial<BidsRepo>;
  reviews?: Partial<ReviewRepo>;
  notifications?: Partial<NotificationRepo>;
  dashboard?: Partial<DashboardRepo>;
} & Partial<Pick<WorkDeps, "queue" | "limiter" | "cursorSecret" | "onInfraError">>;

function install(overrides: Overrides = {}): WorkDeps {
  const { bids, reviews, notifications, dashboard, ...rest } = overrides;
  const built: WorkDeps = {
    bids: { ...fakeBids(), ...bids },
    reviews: { ...fakeReviews(), ...reviews },
    notifications: { ...fakeNotifications(), ...notifications },
    dashboard: {
      load: vi.fn(async () => DASHBOARD_SOURCE),
      loadStatus: vi.fn(async () => ({
        dataFreshness: DASHBOARD_SOURCE.dataFreshness,
        unreadNotifications: DASHBOARD_SOURCE.unreadNotifications,
      })),
      ...dashboard,
    },
    queue: { enqueue: vi.fn(async () => undefined) },
    limiter: { hit: vi.fn(async () => ({ allowed: true as const })) },
    cursorSecret: SECRET,
    runMode: "mock",
    onInfraError: vi.fn(),
    ...rest,
  };
  deps.current = built;
  return built;
}

// 저장소·큐·속도 제한 호출 수의 합
function backendCalls(d: WorkDeps): number {
  return [d.bids, d.reviews, d.notifications, d.dashboard, d.queue, d.limiter]
    .flatMap((port) => Object.values(port))
    .reduce((sum, fn) => sum + (vi.isMockFunction(fn) ? fn.mock.calls.length : 0), 0);
}

type Method = "GET" | "POST" | "PATCH";
type Resource = "bid" | "analysis" | "notification";
type Endpoint = {
  name: string;
  method: Method;
  path: (id: string) => string;
  handle: (request: Request, id: string) => Promise<Response>;
  id: string;
  resource?: Resource;
  body?: unknown;
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const GET_BIDS: Endpoint = {
  name: "GET /bids",
  method: "GET",
  path: () => "/api/v1/bids",
  handle: (request) => bidsRoute.GET(request),
  id: "",
};
const GET_BID: Endpoint = {
  name: "GET /bids/:id",
  method: "GET",
  path: (id) => `/api/v1/bids/${id}`,
  handle: (request, id) => bidRoute.GET(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
};
const GET_ANALYSES: Endpoint = {
  name: "GET /bids/:id/analyses",
  method: "GET",
  path: (id) => `/api/v1/bids/${id}/analyses`,
  handle: (request, id) => bidAnalysesRoute.GET(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
};
const POST_ANALYSES: Endpoint = {
  name: "POST /bids/:id/analyses",
  method: "POST",
  path: (id) => `/api/v1/bids/${id}/analyses`,
  handle: (request, id) => bidAnalysesRoute.POST(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
  body: {},
};
const GET_ANALYSIS: Endpoint = {
  name: "GET /analyses/:id",
  method: "GET",
  path: (id) => `/api/v1/analyses/${id}`,
  handle: (request, id) => analysisRoute.GET(request, ctx(id)),
  id: RUN_ID,
  resource: "analysis",
};
const GET_CHECKS: Endpoint = {
  name: "GET /bids/:id/qualification-checks",
  method: "GET",
  path: (id) => `/api/v1/bids/${id}/qualification-checks`,
  handle: (request, id) => qualificationRoute.GET(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
};
const GET_REVIEWS: Endpoint = {
  name: "GET /bids/:id/reviews",
  method: "GET",
  path: (id) => `/api/v1/bids/${id}/reviews`,
  handle: (request, id) => reviewsRoute.GET(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
};
const POST_REVIEWS: Endpoint = {
  name: "POST /bids/:id/reviews",
  method: "POST",
  path: (id) => `/api/v1/bids/${id}/reviews`,
  handle: (request, id) => reviewsRoute.POST(request, ctx(id)),
  id: BID_ID,
  resource: "bid",
  body: { decision: "BID", reason: REASON },
};
const GET_DASHBOARD: Endpoint = {
  name: "GET /dashboard/summary",
  method: "GET",
  path: () => "/api/v1/dashboard/summary",
  handle: (request) => dashboardRoute.GET(request),
  id: "",
};
const GET_NOTIFICATIONS: Endpoint = {
  name: "GET /notifications",
  method: "GET",
  path: () => "/api/v1/notifications",
  handle: (request) => notificationsRoute.GET(request),
  id: "",
};
const PATCH_READ: Endpoint = {
  name: "PATCH /notifications/:id/read",
  method: "PATCH",
  path: (id) => `/api/v1/notifications/${id}/read`,
  handle: (request, id) => readRoute.PATCH(request, ctx(id)),
  id: NOTE_ID,
  resource: "notification",
};

const ENDPOINTS = [
  GET_BIDS,
  GET_BID,
  GET_ANALYSES,
  POST_ANALYSES,
  GET_ANALYSIS,
  GET_CHECKS,
  GET_REVIEWS,
  POST_REVIEWS,
  GET_DASHBOARD,
  GET_NOTIFICATIONS,
  PATCH_READ,
];
const WRITES = ENDPOINTS.filter((endpoint) => endpoint.method !== "GET");
const WITH_PATH_ID = ENDPOINTS.filter((endpoint) => endpoint.resource !== undefined);

type SendOptions = {
  user?: FakeUser | null;
  via?: "cookie" | "bearer";
  csrf?: boolean;
  id?: string;
  query?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

// 쿠키 세션이 기본이다. 쓰기 요청은 CSRF 헤더를 기본으로 단다.
function send(endpoint: Endpoint, options: SendOptions = {}): Promise<Response> {
  const user = options.user === undefined ? FAKE_USERS.sales : options.user;
  const via = options.via ?? "cookie";
  const id = options.id ?? endpoint.id;
  const headers: Record<string, string> = {};
  if (via === "bearer" && user !== null) headers.Authorization = `Bearer ${user.token}`;
  if (endpoint.method !== "GET" && (options.csrf ?? true))
    headers["X-Requested-With"] = "sol-radar";
  const payload = options.body === undefined ? endpoint.body : options.body;
  const body =
    options.rawBody ??
    (endpoint.method === "GET" || payload === undefined ? undefined : JSON.stringify(payload));
  if (body !== undefined) headers["Content-Type"] = "application/json";
  fakeSession.cookie = via === "cookie" ? (user?.token ?? null) : null;
  const request = fakeRequest(`${endpoint.path(id)}${options.query ?? ""}`, {
    method: endpoint.method,
    headers: { ...headers, ...options.headers },
    body,
  });
  return endpoint.handle(request, id);
}

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({
    code,
    message: expect.any(String),
    requestId: response.headers.get("X-Request-Id"),
    details: expect.any(Object),
  });
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

describe("업무 Route Handler 계약", () => {
  it("1. 세션이 없으면 모든 route 가 401 UNAUTHENTICATED 이고 requestId 가 X-Request-Id 와 같다", async () => {
    const d = install();
    for (const endpoint of ENDPOINTS) {
      await errorOf(await send(endpoint, { user: null }), 401, "UNAUTHENTICATED");
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("2. 쿠키 세션의 쓰기 요청은 X-Requested-With 가 없거나 틀리면 403 CSRF_REJECTED 다", async () => {
    const d = install();
    for (const endpoint of WRITES) {
      await errorOf(await send(endpoint, { csrf: false }), 403, "CSRF_REJECTED");
      await errorOf(
        await send(endpoint, { csrf: false, headers: { "X-Requested-With": "XMLHttpRequest" } }),
        403,
        "CSRF_REJECTED",
      );
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("2. Bearer 는 X-Requested-With 없이 쓰기 요청을 통과한다", async () => {
    install();
    const bearer = { via: "bearer" as const, csrf: false, headers: { "Idempotency-Key": KEY } };
    expect((await send(POST_ANALYSES, bearer)).status).toBe(202);
    expect((await send(POST_REVIEWS, bearer)).status).toBe(201);
    expect((await send(PATCH_READ, bearer)).status).toBe(200);
  });

  it("3. VIEWER 의 분석 요청과 ANALYST 의 결정 기록은 403 FORBIDDEN 이고 저장소를 부르지 않는다", async () => {
    const d = install();
    await errorOf(await send(POST_ANALYSES, { user: FAKE_USERS.viewer }), 403, "FORBIDDEN");
    await errorOf(await send(POST_REVIEWS, { user: FAKE_USERS.analyst }), 403, "FORBIDDEN");
    expect(backendCalls(d)).toBe(0);
  });

  it("4. Idempotency-Key 가 UUID 가 아니면 400 이고 issues[0].path 가 Idempotency-Key 다", async () => {
    const d = install();
    const error = await errorOf(
      await send(POST_ANALYSES, { headers: { "Idempotency-Key": "abc" } }),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details.issues[0].path).toBe("Idempotency-Key");
    expect(d.bids.createAnalysisRun).not.toHaveBeenCalled();
  });

  it("5. 정상 분석 요청은 202 와 접수 본문이고 세션의 조직·사람으로 run 을 만든다", async () => {
    const d = install();
    const response = await send(POST_ANALYSES, { headers: { "Idempotency-Key": KEY } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      analysisId: RUN_ID,
      status: "QUEUED",
      deduplicated: false,
      pollUrl: `/api/v1/analyses/${RUN_ID}`,
    });
    expect(d.bids.createAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_01,
        bidId: BID_ID,
        requestedBy: FAKE_USERS.sales.id,
        idempotencyKey: `${ORG_01}:${KEY}`,
      }),
    );
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      orgId: ORG_01,
      scoreRunId: RUN_ID,
      idempotencyKey: `${ORG_01}:${KEY}`,
    });
  });

  it("5. 본문이 비면 {} 로 보고, JSON 이 아니면 400 VALIDATION_ERROR 다", async () => {
    const d = install();
    expect((await send(POST_ANALYSES, { body: undefined, rawBody: "" })).status).toBe(202);
    await errorOf(await send(POST_ANALYSES, { rawBody: "{not json" }), 400, "VALIDATION_ERROR");
    await errorOf(await send(POST_ANALYSES, { body: { force: "yes" } }), 400, "VALIDATION_ERROR");
    expect(d.bids.createAnalysisRun).toHaveBeenCalledTimes(1);
  });

  it("6. 속도 제한에 걸리면 429 RATE_LIMITED 와 Retry-After: 17 이다", async () => {
    const d = install({
      limiter: { hit: vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 17 })) },
    });
    const response = await send(POST_ANALYSES);
    await errorOf(response, 429, "RATE_LIMITED");
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(d.bids.createAnalysisRun).not.toHaveBeenCalled();
  });

  it("7. 큐가 던지면 503 {component:queue} 이고 run 을 풀고 원인을 로그 콜백에 넘긴다", async () => {
    const failure = new Error("connect redis://user:secret@redis:6379 refused");
    const d = install({
      queue: {
        enqueue: vi.fn(async () => {
          throw failure;
        }),
      },
    });
    const response = await send(POST_ANALYSES, { headers: { "Idempotency-Key": KEY } });
    const text = await response.clone().text();
    const error = await errorOf(response, 503, "SERVICE_UNAVAILABLE");
    expect(error.details).toEqual({ component: "queue" });
    expect(d.bids.markRunFailed).toHaveBeenCalledWith(ORG_01, RUN_ID, "ENQUEUE_FAILED");
    expect(d.onInfraError).toHaveBeenCalledWith("queue", failure);
    expect(text).not.toContain("secret");
  });

  it("8. 목록 쿼리가 틀리면 400, 서명이 틀린 커서는 400 INVALID_CURSOR 다", async () => {
    const d = install({
      bids: {
        listBids: vi.fn(async () => ({
          items: [],
          hasNext: true,
          last: { sortValue: "2026-10-19T00:00:00.000Z", id: BID_ID },
        })),
      },
    });
    const sortError = await errorOf(
      await send(GET_BIDS, { query: "?sort=bogus" }),
      400,
      "VALIDATION_ERROR",
    );
    expect(sortError.details.issues).toEqual([{ path: "sort", message: expect.any(String) }]);
    expect(d.bids.listBids).not.toHaveBeenCalled();

    const first = await send(GET_BIDS);
    expect(first.status).toBe(200);
    const cursor: string = (await first.json()).pageInfo.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    expect((await send(GET_BIDS, { query: `?cursor=${cursor}` })).status).toBe(200);
    const forged = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    await errorOf(await send(GET_BIDS, { query: `?cursor=${forged}` }), 400, "INVALID_CURSOR");
    await errorOf(await send(GET_BIDS, { query: "?cursor=e30.forged" }), 400, "INVALID_CURSOR");
    expect(d.bids.listBids).toHaveBeenCalledTimes(2);
  });

  it("8. 커서 비밀이 없으면 커서 목록 셋 모두 503 {component:cursor} 이다", async () => {
    const d = install({ cursorSecret: null });
    for (const endpoint of [GET_BIDS, GET_ANALYSES, GET_NOTIFICATIONS]) {
      const error = await errorOf(await send(endpoint), 503, "SERVICE_UNAVAILABLE");
      expect(error.details).toEqual({ component: "cursor" });
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("9. 경로 id 가 UUID 가 아니면 404 이고 저장소·큐·속도 제한을 부르지 않는다", async () => {
    const d = install();
    for (const endpoint of WITH_PATH_ID) {
      for (const id of ["abc", "FX-01", `${BID_ID}x`]) {
        const error = await errorOf(
          await send(endpoint, { id, headers: { "Idempotency-Key": KEY } }),
          404,
          "NOT_FOUND",
        );
        expect(error.details, `${endpoint.name} ${id}`).toEqual({ resource: endpoint.resource });
      }
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("10. 결정 기록 정상은 201 Review 이고 세션의 조직·사람으로 쓴다", async () => {
    const d = install();
    const response = await send(POST_REVIEWS);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(REVIEW);
    expect(d.reviews.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_01,
        bidId: BID_ID,
        reviewerId: FAKE_USERS.sales.id,
        decision: "BID",
        reason: REASON,
      }),
    );
  });

  it("10. 사유 9자는 400 path reason, 조직 밖 담당자는 404 {resource:assignee} 다", async () => {
    const d = install({ reviews: { isOrgMember: vi.fn(async () => false) } });
    const reasonError = await errorOf(
      await send(POST_REVIEWS, { body: { decision: "BID", reason: "123456789" } }),
      400,
      "VALIDATION_ERROR",
    );
    expect(reasonError.details.issues.map((issue: { path: string }) => issue.path)).toEqual([
      "reason",
    ]);
    const assigneeError = await errorOf(
      await send(POST_REVIEWS, {
        body: { decision: "BID", reason: REASON, assigneeUserId: FAKE_USERS.otherViewer.id },
      }),
      404,
      "NOT_FOUND",
    );
    expect(assigneeError.details).toEqual({ resource: "assignee" });
    expect(d.reviews.isOrgMember).toHaveBeenCalledWith(ORG_01, FAKE_USERS.otherViewer.id);
    expect(d.reviews.createReview).not.toHaveBeenCalled();
  });

  it("11. 알림 목록은 바깥 링크를 공고 상세로 바꾸고, 모양이 틀린 행을 빼고, Page 봉투로 낸다(O1·O11)", async () => {
    install({ notifications: notificationRepo });
    const me = FAKE_USERS.sales.id;
    const row = (id: string, payload: unknown, createdAt: string) => ({
      id,
      user_id: me,
      org_id: ORG_01,
      type: "ANALYSIS_COMPLETE",
      channel: "IN_APP",
      status: "SENT",
      payload,
      read_at: null,
      created_at: createdAt,
    });
    fakeSession.tables.notifications = [
      row(
        "e1000000-0000-4000-8000-000000000011",
        { bidId: BID_ID, title: "가상 공고", message: "끝", link: "https://evil.example" },
        "2026-10-19T03:00:00.000Z",
      ),
      row("e1000000-0000-4000-8000-000000000012", {}, "2026-10-19T02:00:00.000Z"),
      row(
        "e1000000-0000-4000-8000-000000000013",
        { bidId: BID_ID, title: "가상 공고", message: "끝", link: `/bids/${BID_ID}` },
        "2026-10-19T01:00:00.000Z",
      ),
    ];
    const response = await send(GET_NOTIFICATIONS, { query: "?limit=5" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["items", "pageInfo"]);
    expect(Object.keys(body.pageInfo).sort()).toEqual(["cursor", "hasNext", "nextCursor"]);
    expect(body.pageInfo).toEqual({ cursor: null, nextCursor: null, hasNext: false });
    expect(body.items).toHaveLength(2);
    expect(body.items[0].payload.link).toBe(`/bids/${BID_ID}`);
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });

  it("12. 남의 알림 읽음 처리는 404 이고 그 행을 고치지 않는다", async () => {
    install({ notifications: notificationRepo });
    const mine = "e1000000-0000-4000-8000-000000000021";
    const theirs = "e1000000-0000-4000-8000-000000000022";
    const row = (id: string, userId: string) => ({
      id,
      user_id: userId,
      org_id: ORG_01,
      type: "BID_CHANGED",
      channel: "IN_APP",
      status: "SENT",
      payload: { bidId: BID_ID, title: "가상 공고", message: "변경", link: `/bids/${BID_ID}` },
      read_at: null,
      created_at: "2026-10-19T00:00:00.000Z",
    });
    fakeSession.tables.notifications = [
      row(mine, FAKE_USERS.sales.id),
      row(theirs, FAKE_USERS.viewer.id),
    ];
    const error = await errorOf(await send(PATCH_READ, { id: theirs }), 404, "NOT_FOUND");
    expect(error.details).toEqual({ resource: "notification" });
    expect(fakeSession.tables.notifications[1]?.read_at).toBeNull();

    const own = await send(PATCH_READ, { id: mine });
    expect(own.status).toBe(200);
    expect((await own.json()).readAt).toEqual(expect.any(String));
  });

  it("13. 업무 조직이 둘이면 403 UNSUPPORTED_ACCOUNT_STATE, 없으면 403 FORBIDDEN ORGANIZATION_REQUIRED 다", async () => {
    const d = install();
    fakeSession.orgCount = 2;
    for (const endpoint of ENDPOINTS) {
      await errorOf(await send(endpoint), 403, "UNSUPPORTED_ACCOUNT_STATE");
    }
    fakeSession.orgCount = 0;
    for (const endpoint of ENDPOINTS) {
      const error = await errorOf(await send(endpoint), 403, "FORBIDDEN");
      expect(error.details.reason).toBe("ORGANIZATION_REQUIRED");
    }
    expect(backendCalls(d)).toBe(0);
  });

  // 보안 L5: POST 본문 상한 16KB. 새 오류 코드 없이 400 VALIDATION_ERROR, issues path "body".
  const bodyTooLarge = async (response: Response) => {
    const error = await errorOf(response, 400, "VALIDATION_ERROR");
    expect(error.message).toBe("본문이 너무 큽니다");
    expect(error.details.issues).toEqual([{ path: "body", message: expect.any(String) }]);
  };
  const OVER_LIMIT = `"${"x".repeat(16 * 1024)}"`;

  it("16. Content-Length 가 16KB 를 넘는 분석 요청은 400 body 이고 속도 제한 횟수를 쓰지 않는다", async () => {
    const d = install();
    await bodyTooLarge(
      await send(POST_ANALYSES, {
        rawBody: OVER_LIMIT,
        headers: { "Idempotency-Key": KEY, "Content-Length": String(OVER_LIMIT.length) },
      }),
    );
    expect(d.limiter.hit).not.toHaveBeenCalled();
    expect(backendCalls(d)).toBe(0);
  });

  it("16. Content-Length 없이 16KB 를 넘게 읽힌 분석 요청도 400 body 이고 run 을 만들지 않는다", async () => {
    const d = install();
    await bodyTooLarge(await send(POST_ANALYSES, { rawBody: OVER_LIMIT }));
    // 길이를 미리 알 수 없어 본문은 속도 제한 뒤에 읽는다. 그 뒤로는 저장소·큐를 부르지 않는다.
    expect(d.limiter.hit).toHaveBeenCalledTimes(1);
    expect(d.bids.bidExists).not.toHaveBeenCalled();
    expect(d.bids.createAnalysisRun).not.toHaveBeenCalled();
  });

  it("16. VIEWER 는 큰 본문이어도 403 FORBIDDEN 이다(권한이 먼저)", async () => {
    const d = install();
    await errorOf(
      await send(POST_ANALYSES, {
        user: FAKE_USERS.viewer,
        rawBody: OVER_LIMIT,
        headers: { "Content-Length": String(OVER_LIMIT.length) },
      }),
      403,
      "FORBIDDEN",
    );
    expect(backendCalls(d)).toBe(0);
  });

  it("16. 결정 기록도 16KB 를 넘으면 400 body 이고 저장하지 않는다", async () => {
    const d = install();
    const reason = "가".repeat(6000);
    const rawBody = JSON.stringify({ decision: "BID", reason });
    await bodyTooLarge(await send(POST_REVIEWS, { rawBody }));
    await bodyTooLarge(
      await send(POST_REVIEWS, {
        rawBody: "{}",
        headers: { "Content-Length": String(16 * 1024 + 1) },
      }),
    );
    expect(d.reviews.createReview).not.toHaveBeenCalled();
    expect(backendCalls(d)).toBe(0);
  });

  it("14. route 모듈은 정해진 HTTP 메서드만 내보낸다", () => {
    const exported = (module: object) => Object.keys(module).sort();
    expect(exported(bidsRoute)).toEqual(["GET"]);
    expect(exported(bidRoute)).toEqual(["GET"]);
    expect(exported(bidAnalysesRoute)).toEqual(["GET", "POST"]);
    expect(exported(analysisRoute)).toEqual(["GET"]);
    expect(exported(qualificationRoute)).toEqual(["GET"]);
    expect(exported(reviewsRoute)).toEqual(["GET", "POST"]);
    expect(exported(dashboardRoute)).toEqual(["GET"]);
    expect(exported(notificationsRoute)).toEqual(["GET"]);
    expect(exported(readRoute)).toEqual(["PATCH"]);
  });

  it("15. 저장소가 던진 DB 오류는 500 INTERNAL_ERROR 이고 원문이 응답에 없다", async () => {
    const dbError = { code: "XX000", message: "private database details" };
    install({
      bids: {
        listBids: vi.fn(async () => {
          throw dbError;
        }),
      },
    });
    const response = await send(GET_BIDS);
    const text = await response.clone().text();
    await errorOf(response, 500, "INTERNAL_ERROR");
    expect(text).not.toContain("private");
  });

  it("15. 큐 실패 뒤 run 정리(markRunFailed)가 던져도 500 INTERNAL_ERROR 이고 원문이 없다", async () => {
    install({
      queue: {
        enqueue: vi.fn(async () => {
          throw new Error("queue down");
        }),
      },
      bids: {
        markRunFailed: vi.fn(async () => {
          throw { code: "XX000", message: "private release failure" };
        }),
      },
    });
    const response = await send(POST_ANALYSES);
    const text = await response.clone().text();
    await errorOf(response, 500, "INTERNAL_ERROR");
    expect(text).not.toContain("private");
  });
});

describe("업무 Route Handler 조회 연결", () => {
  it("GET 경로는 세션의 조직으로 서비스를 부르고 200 을 낸다", async () => {
    const d = install();
    for (const endpoint of [GET_BID, GET_ANALYSIS, GET_CHECKS, GET_REVIEWS, GET_ANALYSES]) {
      expect((await send(endpoint)).status, endpoint.name).toBe(200);
    }
    expect(d.bids.getBid).toHaveBeenCalledWith(ORG_01, BID_ID);
    expect(d.bids.getAnalysis).toHaveBeenCalledWith(ORG_01, RUN_ID);
    expect(d.bids.getLatestScoredAnalysis).toHaveBeenCalledWith(ORG_01, BID_ID);
    expect(d.reviews.listReviews).toHaveBeenCalledWith(ORG_01, BID_ID);
    expect(d.bids.listAnalyses).toHaveBeenCalledWith(ORG_01, BID_ID, 20, null);
  });

  it("대시보드는 실행 모드의 기본 출처로 요약을 내고, 틀린 origin 은 400 이다", async () => {
    const d = install();
    const response = await send(GET_DASHBOARD);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dataFreshness: { isDemo: true },
      bids: { total: 0 },
      unreadNotifications: 0,
    });
    expect(d.dashboard.load).toHaveBeenCalledWith(ORG_01, "demo");
    await errorOf(await send(GET_DASHBOARD, { query: "?origin=bogus" }), 400, "VALIDATION_ERROR");
  });

  it("알림 목록·읽음 처리는 세션 사용자로 부른다", async () => {
    const d = install();
    expect((await send(GET_NOTIFICATIONS, { query: "?unreadOnly=true" })).status).toBe(200);
    expect(d.notifications.list).toHaveBeenCalledWith(
      FAKE_USERS.sales.id,
      { unreadOnly: true, limit: 20 },
      null,
    );
    expect((await send(PATCH_READ)).status).toBe(200);
    expect(d.notifications.markRead).toHaveBeenCalledWith(FAKE_USERS.sales.id, NOTE_ID);
  });
});
