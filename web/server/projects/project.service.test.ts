import { describe, expect, it, vi } from "vitest";
import type { AnalysisContext, PendingSourceRow } from "@/server/bids";
import type { TaskView } from "@/server/task";
import type { DecisionRecord, ProjectDetailRecord, ProjectRecord } from "./project.model";
import type { ProjectRepo, RpcOutcome } from "./project.repo";
import {
  countActiveProjects,
  getProject,
  getProjectBoard,
  getProjectEntry,
  openProject,
  recordProjectResult,
  updateProject,
  type ProjectDeps,
} from "./project.service";

const ORG = "0f000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000003";
const PROJECT = "a1000000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "a1000000-0000-4000-8000-000000000002";
const BID = "b1000000-0000-4000-8000-000000000001";
const REVIEW = "d1000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-21T00:00:00Z");

const ctx = (role: AnalysisContext["role"] = "SALES"): AnalysisContext => ({
  orgId: ORG,
  userId: USER,
  role,
});

const record = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: PROJECT,
  bidId: BID,
  status: "PREPARING",
  owner: null,
  submissionDueOverride: null,
  result: null,
  resultNote: null,
  resultRecordedAt: null,
  closedAt: null,
  createdAt: "2026-10-20T00:00:00Z",
  openedByReviewId: REVIEW,
  openedRevision: 1,
  bid: {
    id: BID,
    title: "가상 공고",
    agency: "가상 기관",
    noticeId: "DEMO-1",
    deadlineAt: "2026-11-10T09:00:00Z",
    isDemo: true,
    status: "OPEN",
    latestRevision: 1,
  },
  ...over,
});
const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: REVIEW,
  bidId: BID,
  decision: "BID",
  decidedAt: "2026-10-19T00:00:00Z",
  createdAt: "2026-10-19T00:00:00Z",
  reviewer: "이영업",
  ...over,
});
const detailRecord = (over: Partial<ProjectDetailRecord> = {}): ProjectDetailRecord => ({
  ...record(),
  openedBy: {
    reviewId: REVIEW,
    reviewer: "이영업",
    decidedAt: "2026-10-19T00:00:00Z",
    revision: 1,
    analysis: null,
  },
  decisions: [decision()],
  events: [],
  ...over,
});

const rpcOk = <T>(value: T): RpcOutcome<T> => ({ ok: true, value });
const rpcFail = (
  code: Extract<RpcOutcome<never>, { ok: false }>["code"],
  detail: string | null = null,
) => ({ ok: false, code, detail }) as const;

function fakeRepo(overrides: Partial<ProjectRepo> = {}): ProjectRepo {
  return {
    listBoard: vi.fn(async () => ({ projects: [], decisions: [], checklist: [] })),
    loadPendingSource: vi.fn(async (): Promise<PendingSourceRow[]> => []),
    getDetail: vi.fn(async () => detailRecord()),
    findRef: vi.fn(async () => ({ id: PROJECT, bidId: BID, status: "PREPARING" as const })),
    getEntrySource: vi.fn(async () => ({
      bidStatus: "OPEN" as const,
      project: null,
      decisions: [],
    })),
    countActive: vi.fn(async () => 0),
    isOrgMember: vi.fn(async () => true),
    openProject: vi.fn(async () => rpcOk({ projectId: PROJECT, reopened: false })),
    changeStatus: vi.fn(async () => rpcOk(null)),
    recordResult: vi.fn(async () => rpcOk(null)),
    updateFields: vi.fn(async () => "saved" as const),
    ...overrides,
  };
}

const CHECKLIST = [{ id: "t1", status: "done" }] as TaskView[];
const deps = (repo: ProjectRepo = fakeRepo()): ProjectDeps => ({
  repo,
  checklist: vi.fn(async () => CHECKLIST),
  origin: "demo",
});

// 저장 쪽 함수가 한 번이라도 불렸는지(권한 거절은 저장을 부르지 않는다)
const repoCalls = (repo: ProjectRepo) =>
  Object.values(repo).reduce(
    (sum, fn) => sum + (vi.isMockFunction(fn) ? fn.mock.calls.length : 0),
    0,
  );

describe("권한 — 쓰기는 ADMIN·SALES 만(canManageProjects)", () => {
  it.each(["VIEWER", "ANALYST"] as const)(
    "%s 의 openProject·updateProject·recordProjectResult 는 403 이고 repo 를 부르지 않는다",
    async (role) => {
      const repo = fakeRepo();
      const d = deps(repo);
      const results = [
        await openProject(ctx(role), { reviewId: REVIEW }, d),
        await updateProject(ctx(role), PROJECT, { status: "SUBMITTED" }, d),
        await recordProjectResult(ctx(role), PROJECT, { result: "WON" }, d),
      ];
      for (const result of results) {
        expect(result).toEqual({
          ok: false,
          status: 403,
          code: "FORBIDDEN",
          message: expect.any(String),
          details: { required: ["ADMIN", "SALES"] },
        });
      }
      expect(repoCalls(repo)).toBe(0);
    },
  );

  it("읽기는 역할과 상관없이 된다 — VIEWER 의 상세 canManage 는 false, SALES·ADMIN 은 true", async () => {
    for (const [role, canManage] of [
      ["VIEWER", false],
      ["ANALYST", false],
      ["SALES", true],
      ["ADMIN", true],
    ] as const) {
      const d = deps();
      const result = await getProject(ctx(role), PROJECT, d);
      expect(result.ok && result.data.canManage, role).toBe(canManage);
      expect(d.checklist).toHaveBeenCalledWith({ orgId: ORG, userId: USER, canManage }, PROJECT);
    }
  });
});

describe("본문 검증 — 400", () => {
  it("잘못된 본문은 400 VALIDATION_ERROR 이고 DB 함수를 부르지 않는다", async () => {
    const repo = fakeRepo();
    const d = deps(repo);
    const cases = [
      await openProject(ctx(), { reviewId: "r1" }, d),
      await openProject(ctx(), { reviewId: REVIEW, orgId: ORG }, d),
      await openProject(ctx(), "not json", d),
      await updateProject(ctx(), PROJECT, {}, d),
      await updateProject(ctx(), PROJECT, { note: "메모만" }, d),
      await recordProjectResult(ctx(), PROJECT, { result: "WIN" }, d),
    ];
    for (const result of cases) {
      expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
      expect(result.ok ? null : result.details?.issues).toEqual(expect.any(Array));
    }
    expect(repo.openProject).not.toHaveBeenCalled();
    expect(repo.changeStatus).not.toHaveBeenCalled();
    expect(repo.recordResult).not.toHaveBeenCalled();
    expect(repo.updateFields).not.toHaveBeenCalled();
  });
});

describe("DB 오류 코드 → 응답", () => {
  it("열기 NOT_FOUND → 404 {resource:review}, FORBIDDEN → 403", async () => {
    const notFound = await openProject(
      ctx(),
      { reviewId: REVIEW },
      deps(fakeRepo({ openProject: vi.fn(async () => rpcFail("NOT_FOUND")) })),
    );
    expect(notFound).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "review" },
    });
    const forbidden = await openProject(
      ctx(),
      { reviewId: REVIEW },
      deps(fakeRepo({ openProject: vi.fn(async () => rpcFail("FORBIDDEN")) })),
    );
    expect(forbidden).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      details: { required: ["ADMIN", "SALES"] },
    });
  });

  it("PROJECT_REQUIRES_BID_DECISION → 409 {reviewId}", async () => {
    const result = await openProject(
      ctx(),
      { reviewId: REVIEW },
      deps(fakeRepo({ openProject: vi.fn(async () => rpcFail("PROJECT_REQUIRES_BID_DECISION")) })),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "PROJECT_REQUIRES_BID_DECISION",
      details: { reviewId: REVIEW },
    });
  });

  it("PROJECT_ALREADY_OPEN → 409 {projectId: detail}", async () => {
    const result = await openProject(
      ctx(),
      { reviewId: REVIEW },
      deps(
        fakeRepo({
          openProject: vi.fn(async () => rpcFail("PROJECT_ALREADY_OPEN", OTHER_PROJECT)),
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 409,
      code: "PROJECT_ALREADY_OPEN",
      details: { projectId: OTHER_PROJECT },
    });
  });

  it("LATEST_DECISION_NOT_BID → 409 {bidId, latestDecision}", async () => {
    const repo = fakeRepo({
      changeStatus: vi.fn(async () => rpcFail("LATEST_DECISION_NOT_BID", "WATCH")),
    });
    const result = await updateProject(ctx(), PROJECT, { status: "SUBMITTED" }, deps(repo));
    expect(result).toMatchObject({
      status: 409,
      code: "LATEST_DECISION_NOT_BID",
      details: { bidId: BID, latestDecision: "WATCH" },
    });
    expect(repo.updateFields).not.toHaveBeenCalled();
  });

  it("INVALID_PROJECT_TRANSITION → 409 {from, to}(detail '전>후')", async () => {
    const result = await updateProject(
      ctx(),
      PROJECT,
      { status: "PREPARING" },
      deps(
        fakeRepo({
          changeStatus: vi.fn(async () =>
            rpcFail("INVALID_PROJECT_TRANSITION", "CLOSED>PREPARING"),
          ),
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 409,
      code: "INVALID_PROJECT_TRANSITION",
      details: { from: "CLOSED", to: "PREPARING" },
    });
  });

  it("담당자 외래 키 거절(다른 조직 사람) → 404 {resource:owner}", async () => {
    const result = await updateProject(
      ctx(),
      PROJECT,
      { ownerId: OWNER },
      deps(fakeRepo({ updateFields: vi.fn(async () => "owner-not-member" as const) })),
    );
    expect(result).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "owner" },
    });
  });

  it("결과 기록 NOT_FOUND → 404 {resource:project}", async () => {
    const result = await recordProjectResult(
      ctx(),
      PROJECT,
      { result: "WON" },
      deps(fakeRepo({ recordResult: vi.fn(async () => rpcFail("NOT_FOUND")) })),
    );
    expect(result).toMatchObject({ status: 404, details: { resource: "project" } });
  });
});

describe("getProject — 다른 조직·없는 id 는 404", () => {
  it("저장이 null(다른 조직·없음)이면 404 {resource:project} 이고 체크리스트를 읽지 않는다", async () => {
    const d = deps(fakeRepo({ getDetail: vi.fn(async () => null) }));
    expect(await getProject(ctx(), OTHER_PROJECT, d)).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "project" },
    });
    expect(d.checklist).not.toHaveBeenCalled();
  });

  it("uuid 가 아니면 저장을 부르지 않고 404 다", async () => {
    const repo = fakeRepo();
    expect(await getProject(ctx(), "p1", deps(repo))).toMatchObject({ status: 404 });
    expect(repoCalls(repo)).toBe(0);
  });

  it("상세는 체크리스트 줄과 진행 수를 싣는다", async () => {
    const d = deps();
    const result = await getProject(ctx(), PROJECT, d);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.checklist).toBe(CHECKLIST);
    expect(result.data.checklistProgress).toEqual({ done: 1, total: 1 });
    expect(d.repo.getDetail).toHaveBeenCalledWith(ORG, PROJECT);
  });
});

describe("openProject", () => {
  it("새로 열면 201, 다시 열면 200 이고 본문은 상세다", async () => {
    const created = await openProject(ctx(), { reviewId: REVIEW }, deps());
    expect(created).toMatchObject({ ok: true, status: 201, data: { id: PROJECT } });
    const reopened = await openProject(
      ctx(),
      { reviewId: REVIEW },
      deps(
        fakeRepo({ openProject: vi.fn(async () => rpcOk({ projectId: PROJECT, reopened: true })) }),
      ),
    );
    expect(reopened).toMatchObject({ ok: true, status: 200, data: { id: PROJECT } });
  });

  it("DB 함수에 결정 id 하나만 넘긴다(조직은 함수가 세션으로 정한다)", async () => {
    const repo = fakeRepo();
    await openProject(ctx(), { reviewId: REVIEW }, deps(repo));
    expect(repo.openProject).toHaveBeenCalledWith(REVIEW);
  });
});

describe("updateProject", () => {
  it("상태와 담당자·마감이 함께 오면 상태 함수를 먼저 부르고 성공한 뒤 열을 고친다", async () => {
    const order: string[] = [];
    const repo = fakeRepo({
      changeStatus: vi.fn(async () => {
        order.push("status");
        return rpcOk(null);
      }),
      updateFields: vi.fn(async () => {
        order.push("fields");
        return "saved" as const;
      }),
    });
    const result = await updateProject(
      ctx(),
      PROJECT,
      {
        status: "SUBMITTED",
        note: " 접수 ",
        ownerId: OWNER,
        submissionDueOverride: "2026-11-10T18:00",
      },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(order).toEqual(["status", "fields"]);
    expect(repo.changeStatus).toHaveBeenCalledWith(PROJECT, "SUBMITTED", "접수");
    expect(repo.updateFields).toHaveBeenCalledWith(ORG, PROJECT, {
      ownerId: OWNER,
      submissionDueOverride: "2026-11-10T09:00:00.000Z",
    });
  });

  it("상태만이면 열을 고치지 않고, 메모가 없으면 null 로 넘긴다", async () => {
    const repo = fakeRepo();
    await updateProject(ctx(), PROJECT, { status: "CLOSED" }, deps(repo));
    expect(repo.changeStatus).toHaveBeenCalledWith(PROJECT, "CLOSED", null);
    expect(repo.updateFields).not.toHaveBeenCalled();
  });

  it("담당자 비우기·마감 되돌리기(null)는 그 키만 고친다", async () => {
    const repo = fakeRepo();
    await updateProject(ctx(), PROJECT, { ownerId: null }, deps(repo));
    await updateProject(ctx(), PROJECT, { submissionDueOverride: null }, deps(repo));
    expect(vi.mocked(repo.updateFields).mock.calls).toEqual([
      [ORG, PROJECT, { ownerId: null }],
      [ORG, PROJECT, { submissionDueOverride: null }],
    ]);
    expect(repo.changeStatus).not.toHaveBeenCalled();
    expect(repo.isOrgMember).not.toHaveBeenCalled();
  });

  it("담당자가 이 조직 구성원이 아니면 상태를 바꾸기 전에 404 {resource:owner} 다", async () => {
    const repo = fakeRepo({ isOrgMember: vi.fn(async () => false) });
    const result = await updateProject(
      ctx(),
      PROJECT,
      { status: "SUBMITTED", ownerId: OWNER },
      deps(repo),
    );
    expect(result).toMatchObject({ status: 404, details: { resource: "owner" } });
    expect(repo.isOrgMember).toHaveBeenCalledWith(ORG, OWNER);
    expect(repo.changeStatus).not.toHaveBeenCalled();
  });

  it("다른 조직·없는 프로젝트는 404 이고 DB 함수·열 쓰기를 부르지 않는다", async () => {
    const repo = fakeRepo({ findRef: vi.fn(async () => null) });
    const result = await updateProject(ctx(), OTHER_PROJECT, { status: "SUBMITTED" }, deps(repo));
    expect(result).toMatchObject({ status: 404, details: { resource: "project" } });
    expect(repo.changeStatus).not.toHaveBeenCalled();
    expect(repo.updateFields).not.toHaveBeenCalled();
  });

  it("열을 고쳤는데 바뀐 행이 없으면(그새 없어짐) 404 다", async () => {
    const repo = fakeRepo({ updateFields: vi.fn(async () => "missing" as const) });
    expect(await updateProject(ctx(), PROJECT, { ownerId: null }, deps(repo))).toMatchObject({
      status: 404,
      details: { resource: "project" },
    });
  });
});

describe("recordProjectResult", () => {
  it("결과·메모를 DB 함수에 넘기고 상세를 200 으로 돌려준다", async () => {
    const repo = fakeRepo();
    const result = await recordProjectResult(
      ctx("ADMIN"),
      PROJECT,
      { result: "LOST", note: " 가격 차 " },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(repo.recordResult).toHaveBeenCalledWith(PROJECT, "LOST", "가격 차");
  });
});

describe("getProjectBoard", () => {
  it("검토 대기는 그 출처의 원본에서 계산하고, 프로젝트는 칸 순서대로 싣는다", async () => {
    const repo = fakeRepo({
      loadPendingSource: vi.fn(async (): Promise<PendingSourceRow[]> => [
        {
          bidId: "pending-1",
          title: "대기 공고",
          agency: null,
          isDemo: true,
          stage: "NOTICE",
          status: "OPEN",
          deadlineAt: null,
          analyses: [
            {
              id: "run-1",
              status: "COMPLETED",
              recommendation: "WATCH",
              reviewFlagCount: 0,
              createdAt: "2026-10-19T00:00:00Z",
            },
          ],
          reviews: [],
        },
      ]),
      listBoard: vi.fn(async () => ({
        projects: [
          record({ id: "closed", status: "CLOSED", closedAt: "2026-10-20T00:00:00Z" }),
          record({ id: "open" }),
        ],
        decisions: [decision({ decision: "WATCH", decidedAt: "2026-10-20T00:00:00Z" }), decision()],
        checklist: [
          { bidProjectId: "open", status: "done" },
          { bidProjectId: "open", status: "todo" },
        ],
      })),
    });
    const result = await getProjectBoard(ctx("VIEWER"), deps(repo), NOW);
    expect(repo.loadPendingSource).toHaveBeenCalledWith(ORG, "demo");
    expect(repo.listBoard).toHaveBeenCalledWith(ORG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pending.map((card) => card.bidId)).toEqual(["pending-1"]);
    expect(result.data.projects.map((card) => card.id)).toEqual(["open", "closed"]);
    const [open, closed] = result.data.projects;
    expect(open?.checklist).toEqual({ done: 1, total: 2 });
    expect(open?.warnings.latestDecision).toBe("WATCH");
    expect(closed?.checklist).toEqual({ done: 0, total: 0 });
    expect(closed?.warnings).toEqual({
      latestDecision: null,
      bidAmended: false,
      bidCancelled: false,
    });
  });
});

describe("getProjectEntry", () => {
  it("공고가 없으면 404 {resource:bid}, 있으면 들어가기 상태를 정한다", async () => {
    expect(
      await getProjectEntry(
        ctx(),
        BID,
        deps(fakeRepo({ getEntrySource: vi.fn(async () => null) })),
      ),
    ).toMatchObject({ status: 404, details: { resource: "bid" } });

    const result = await getProjectEntry(
      ctx(),
      BID,
      deps(
        fakeRepo({
          getEntrySource: vi.fn(async () => ({
            bidStatus: "OPEN" as const,
            project: null,
            decisions: [
              decision({ id: "old", decision: "WATCH", decidedAt: "2026-10-18T00:00:00Z" }),
              decision(),
            ],
          })),
        }),
      ),
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { state: "create", latestReviewId: REVIEW },
    });
  });

  it("VIEWER 는 프로젝트가 없으면 숨김이다", async () => {
    const result = await getProjectEntry(
      ctx("VIEWER"),
      BID,
      deps(
        fakeRepo({
          getEntrySource: vi.fn(async () => ({
            bidStatus: "OPEN" as const,
            project: null,
            decisions: [decision()],
          })),
        }),
      ),
    );
    expect(result).toMatchObject({ ok: true, data: { state: "hidden" } });
  });

  it("uuid 가 아니면 저장을 부르지 않고 404 다", async () => {
    const repo = fakeRepo();
    expect(await getProjectEntry(ctx(), "bid-1", deps(repo))).toMatchObject({ status: 404 });
    expect(repoCalls(repo)).toBe(0);
  });
});

describe("countActiveProjects", () => {
  it("저장이 센 수를 그대로 돌려준다(CLOSED 제외는 저장 질의가 한다)", async () => {
    const repo = fakeRepo({ countActive: vi.fn(async () => 2) });
    await expect(countActiveProjects(ORG, { repo })).resolves.toBe(2);
    expect(repo.countActive).toHaveBeenCalledWith(ORG);
  });
});
