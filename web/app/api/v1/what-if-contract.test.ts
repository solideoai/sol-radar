import { readFileSync } from "node:fs";
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
import type { BidsRepo } from "@/server/bids";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  toScoringTeam,
  type CompanyProfile,
  type RequirementExtraction,
  type ScoringPerson,
} from "@/server/scoring";
import * as whatIfRoute from "./analyses/[id]/what-if/route";

// BOOST-2 가정 재계산 Route Handler 계약 시험. 인증·CSRF 는 진짜 코드가 돌고 저장소만 가짜다.

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

const RUN_ID = "c1000000-0000-4000-8000-000000000001";
const CALCULATION_DATE = "2026-10-16";

// scoring 의 test-support 는 딥임포트라 쓸 수 없다. fixtures/ 에서 FX-03 입력 스냅샷을 같은 방식으로 조립한다.
const readFixture = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url), "utf8")) as T;

function relativeDate(spec: string | null): string | null {
  const match = spec === null ? null : /^([+-])(\d+)d$/.exec(spec);
  if (spec === null || match === null) return spec;
  const days = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const [year, month, day] = CALCULATION_DATE.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0)).toISOString();
}

function fx03Snapshot(): unknown {
  const bid = readFixture<{
    records: {
      amendmentNo: string;
      noticeId: string;
      title: string;
      agency: string | null;
      budgetKrw: string | null;
      noticeDate: string | null;
      deadlineAt: string | null;
      stage: "PLAN" | "PRE_SPEC" | "NOTICE";
    }[];
  }>("bids/FX-03.json").records[0];
  const people = readFixture<{
    people: ScoringPerson[];
    assignments: {
      personId: string;
      startsAt: string;
      endsAt: string;
      allocationPercent: number;
    }[];
    asOf: string;
  }>("people/solideo.people.json");
  return {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: {
      noticeId: bid.noticeId,
      revisionId: `FX-03#${bid.amendmentNo}`,
      title: bid.title,
      agency: bid.agency,
      stage: bid.stage,
      budgetKrw: bid.budgetKrw,
      deadlineAt: relativeDate(bid.deadlineAt),
      noticeDate: relativeDate(bid.noticeDate),
      fetchedAt: `${CALCULATION_DATE}T09:00:00Z`,
      projectPeriod: null,
      structuredQualifications: [],
    },
    extraction: readFixture<RequirementExtraction>("extractions/FX-03.json"),
    profile: readFixture<CompanyProfile>("company/solideo-profile.json"),
    team: toScoringTeam(people.people, people.assignments, people.asOf),
    kev: null,
    config: { ...SCORING_CONFIG_V0_1, today: CALCULATION_DATE },
  };
}

function bidsWith(getAnalysisSnapshot: BidsRepo["getAnalysisSnapshot"]): BidsRepo {
  const notUsed = async (): Promise<never> => {
    throw new Error("가정 재계산이 부르지 않는 저장소 함수다");
  };
  return {
    listBids: notUsed,
    countBids: notUsed,
    getBid: notUsed,
    bidExists: notUsed,
    getRevisionHistory: notUsed,
    getRevisionSnapshots: notUsed,
    listAnalyses: notUsed,
    getLatestScoredAnalysis: notUsed,
    getAnalysis: notUsed,
    getAnalysisSnapshot,
    findRunningAnalysis: notUsed,
    findCompletedSameInput: notUsed,
    resolveAnalysisInput: notUsed,
    createAnalysisRun: notUsed,
    markRunFailed: notUsed,
    findIdempotency: notUsed,
  };
}

function install(bids: BidsRepo): WorkDeps {
  const notUsed = async (): Promise<never> => {
    throw new Error("가정 재계산이 부르지 않는 저장소 함수다");
  };
  const built: WorkDeps = {
    bids,
    reviews: {
      getReviewTarget: notUsed,
      listReviews: notUsed,
      isOrgMember: notUsed,
      createReview: notUsed,
    },
    notifications: { list: notUsed, markRead: notUsed },
    dashboard: { load: notUsed, loadStatus: notUsed },
    queue: { enqueue: notUsed },
    limiter: { hit: notUsed },
    cursorSecret: "test-only-cursor-secret-at-least-32-characters",
    runMode: "mock",
    onInfraError: vi.fn(),
  };
  deps.current = built;
  return built;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ASSUME_ICT = { assumptions: [{ kind: "QUALIFICATION", code: "ICT_CONSTRUCTION" }] };

function post(
  id: string,
  options: { user?: FakeUser | null; csrf?: boolean; body?: unknown } = {},
): Promise<Response> {
  const user = options.user === undefined ? FAKE_USERS.sales : options.user;
  fakeSession.cookie = user?.token ?? null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.csrf ?? true) headers["X-Requested-With"] = "sol-radar";
  return whatIfRoute.POST(
    fakeRequest(`/api/v1/analyses/${id}/what-if`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body ?? ASSUME_ICT),
    }),
    ctx(id),
  );
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

describe("POST /api/v1/analyses/:id/what-if", () => {
  it("세션이 없으면 401 이고 저장소를 부르지 않는다", async () => {
    const getSnapshot = vi.fn(async () => null);
    install(bidsWith(getSnapshot));
    const response = await post(RUN_ID, { user: null });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("CSRF 헤더가 없으면 403 CSRF_REJECTED 이다", async () => {
    const getSnapshot = vi.fn(async () => null);
    install(bidsWith(getSnapshot));
    const response = await post(RUN_ID, { csrf: false });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_REJECTED");
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("UUID 가 아닌 id 는 저장소를 부르지 않고 404 analysis 다", async () => {
    const getSnapshot = vi.fn(async () => null);
    install(bidsWith(getSnapshot));
    const response = await post("not-a-uuid");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({
      code: "NOT_FOUND",
      details: { resource: "analysis" },
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("다른 조직의 run 은 없는 것과 같은 404 이고 세션의 조직으로만 읽는다", async () => {
    const snapshot = fx03Snapshot();
    const getSnapshot = vi.fn(async (orgId: string) =>
      orgId === ORG_01 ? { status: "COMPLETED" as const, inputSnapshot: snapshot } : null,
    );
    install(bidsWith(getSnapshot));
    const response = await post(RUN_ID, { user: FAKE_USERS.otherViewer });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ details: { resource: "analysis" } });
    expect(getSnapshot).toHaveBeenCalledWith(ORG_02, RUN_ID);
  });

  it("FX-03 스냅샷에 정보통신공사업을 가정하면 200 과 assumable·before·after 를 돌려준다", async () => {
    const snapshot = fx03Snapshot();
    install(
      bidsWith(vi.fn(async () => ({ status: "COMPLETED" as const, inputSnapshot: snapshot }))),
    );
    const response = await post(RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["after", "assumable", "before"]);
    expect(body.assumable).toContain("ICT_CONSTRUCTION");
    expect(body.before.recommendation).toBe("NO_BID");
    expect(body.after.recommendation).toBe("WATCH");
  });

  it("가정할 수 없는 자격은 400 VALIDATION_ERROR 와 rejected 다", async () => {
    const snapshot = fx03Snapshot();
    install(
      bidsWith(vi.fn(async () => ({ status: "COMPLETED" as const, inputSnapshot: snapshot }))),
    );
    const response = await post(RUN_ID, {
      body: { assumptions: [{ kind: "QUALIFICATION", code: "NOT_A_LICENSE" }] },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: [{ path: "assumptions" }],
        rejected: [{ kind: "QUALIFICATION", code: "NOT_A_LICENSE" }],
      },
    });
  });
});
