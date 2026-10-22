import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import type { ProjectDeps, ProjectRepo } from "@/server/projects";
import * as projectRoute from "./projects/[id]/route";
import * as projectsRoute from "./projects/route";

const deps = vi.hoisted(() => ({ current: null as ProjectDeps | null }));
vi.mock("@/app/_lib/project-deps", () => ({
  projectDeps: () => {
    if (deps.current === null) throw new Error("project deps missing");
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

const ID = "b1000000-0000-4000-8000-000000000001";
const BID = "b1000000-0000-4000-8000-000000000002";
function install(overrides: Partial<ProjectRepo> = {}) {
  const repo: ProjectRepo = {
    listBoard: vi.fn(async () => ({ projects: [], decisions: [], checklist: [] })),
    loadPendingSource: vi.fn(async () => []),
    getDetail: vi.fn(async () => null),
    findRef: vi.fn(async () => ({ id: ID, bidId: BID, status: "PREPARING" as const })),
    getEntrySource: vi.fn(async () => null),
    countActive: vi.fn(async () => 0),
    isOrgMember: vi.fn(async () => true),
    openProject: vi.fn(async () => ({
      ok: false as const,
      code: "PROJECT_REQUIRES_BID_DECISION" as const,
      detail: null,
    })),
    patch: vi.fn(async () => ({
      ok: false as const,
      code: "LATEST_DECISION_NOT_BID" as const,
      detail: "WATCH",
    })),
    changeStatus: vi.fn(async () => ({ ok: true as const, value: null })),
    recordResult: vi.fn(async () => ({ ok: true as const, value: null })),
    updateFields: vi.fn(async () => "saved" as const),
    ...overrides,
  };
  deps.current = { repo, checklist: async () => [], origin: "demo" };
  return repo;
}
function send(body: unknown, user: FakeUser = FAKE_USERS.sales) {
  fakeSession.cookie = user.token;
  return projectRoute.PATCH(
    fakeRequest(`/api/v1/projects/${ID}`, {
      method: "PATCH",
      headers: { "X-Requested-With": "sol-radar", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
}
beforeEach(() => {
  resetFakeSession();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("projects HTTP contract", () => {
  it("latest WATCH returns409 and mixed PATCH invokes exactly one atomic write", async () => {
    const repo = install();
    const response = await send({
      status: "SUBMITTED",
      ownerId: null,
      submissionDueOverride: "2026-12-01T18:00:00+09:00",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "LATEST_DECISION_NOT_BID" as const, details: { latestDecision: "WATCH" } },
    });
    expect(repo.patch).toHaveBeenCalledExactlyOnceWith(ID, {
      status: "SUBMITTED",
      ownerId: null,
      submissionDueOverride: "2026-12-01T09:00:00.000Z",
    });
    expect(repo.changeStatus).not.toHaveBeenCalled();
    expect(repo.updateFields).not.toHaveBeenCalled();
    expect(repo.getDetail).not.toHaveBeenCalled();
  });
  it("foreign organization resource is404 and no mutation is attempted", async () => {
    const repo = install({ findRef: vi.fn(async () => null) });
    expect((await send({ status: "SUBMITTED" })).status).toBe(404);
    expect(repo.findRef).toHaveBeenCalledWith(FAKE_USERS.sales.orgId, ID);
    expect(repo.patch).not.toHaveBeenCalled();
  });
  it("VIEWER cannot PATCH; invalid owner is404 before any write", async () => {
    const repo = install({ isOrgMember: vi.fn(async () => false) });
    expect((await send({ status: "SUBMITTED" }, FAKE_USERS.viewer)).status).toBe(403);
    expect((await send({ status: "SUBMITTED", ownerId: FAKE_USERS.otherViewer.id })).status).toBe(
      404,
    );
    expect(repo.patch).not.toHaveBeenCalled();
  });
  it("BID-required create conflict is409; oversized body rejected before repository", async () => {
    const repo = install();
    fakeSession.cookie = FAKE_USERS.sales.token;
    const create = (body: unknown) =>
      projectsRoute.POST(
        fakeRequest("/api/v1/projects", {
          method: "POST",
          headers: { "X-Requested-With": "sol-radar" },
          body: JSON.stringify(body),
        }),
      );
    const response = await create({ reviewId: ID });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PROJECT_REQUIRES_BID_DECISION" },
    });
    vi.mocked(repo.openProject).mockClear();
    expect((await create({ note: "x".repeat(17000) })).status).toBe(400);
    expect(repo.openProject).not.toHaveBeenCalled();
  });
});
