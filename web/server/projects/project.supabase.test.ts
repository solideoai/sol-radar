import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectRepo } from "./project.supabase";

// 입찰 프로젝트 저장이 Supabase 에 무엇을 보내고 받은 행을 어떻게 옮기는지 본다. SQL·RLS 는 흉내 내지 않는다
// (누가 읽고 바꾸는지와 DB 함수의 거절은 scripts/database.test.mjs 의 입찰 프로젝트 묶음이 PGlite 로 본다).

type Call = { method: string; args: unknown[] };
type Query = { target: string; calls: Call[] };
type Reply = { data?: unknown; error?: unknown; count?: number | null };

const fake = vi.hoisted(() => ({
  queries: [] as { target: string; calls: { method: string; args: unknown[] }[] }[],
  // 대상(표 이름 또는 rpc:<함수>)마다 차례로 줄 응답
  replies: new Map<string, { data?: unknown; error?: unknown; count?: number | null }[]>(),
}));

vi.mock("@/server/supabase", () => {
  const settle = (query: Query) => {
    const next = fake.replies.get(query.target)?.shift() ?? {};
    return { data: next.data ?? null, error: next.error ?? null, count: next.count ?? null };
  };
  const chain = (query: Query): object =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const settled = settle(query);
            return (resolve: (value: unknown) => unknown) => resolve(settled);
          }
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            query.calls.push({ method: prop, args });
            return chain(query);
          };
        },
      },
    );
  const start = (target: string, calls: Call[]) => {
    const query: Query = { target, calls };
    fake.queries.push(query);
    return chain(query);
  };
  return {
    isSupabaseConfigured: () => true,
    getAuthClaims: async () => null,
    getSupabase: async () => ({
      from: (table: string) => start(table, []),
      rpc: (fn: string, args: unknown) => start(`rpc:${fn}`, [{ method: "rpc", args: [fn, args] }]),
    }),
  };
});

const ORG = "0f000000-0000-4000-8000-000000000001";
const PROJECT = "a1000000-0000-4000-8000-000000000001";
const PROJECT_2 = "a1000000-0000-4000-8000-000000000002";
const BID = "b1000000-0000-4000-8000-000000000001";
const BID_2 = "b1000000-0000-4000-8000-000000000002";
const REVIEW = "d1000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000003";

const reply = (target: string, ...next: Reply[]) => {
  fake.replies.set(target, [...(fake.replies.get(target) ?? []), ...next]);
};
const queriesOf = (target: string): Query[] => fake.queries.filter((q) => q.target === target);
const onlyOf = (target: string): Query => {
  const found = queriesOf(target);
  expect(found, target).toHaveLength(1);
  return found[0] as Query;
};
const argsOf = (query: Query, method: string): unknown[][] =>
  query.calls.filter((call) => call.method === method).map((call) => call.args);

const bidRow = (id: string) => ({
  id,
  title: `공고 ${id}`,
  agency: "가상 기관",
  notice_id: "DEMO-1",
  deadline_at: "2026-11-10T09:00:00Z",
  is_demo: true,
  status: "OPEN",
  latest_revision: 2,
});
const projectRow = (over: Record<string, unknown> = {}) => ({
  id: PROJECT,
  bid_id: BID,
  status: "PREPARING",
  owner_id: OWNER,
  submission_due_override: null,
  result: null,
  result_note: null,
  result_recorded_at: null,
  closed_at: null,
  created_at: "2026-10-20T00:00:00Z",
  opened_by_review_id: REVIEW,
  bid: bidRow(BID),
  owner: { profile: { display_name: "김담당", email: "owner@example.test" } },
  opened_review: { revision: { revision: 1 } },
  ...over,
});
const decisionRow = (over: Record<string, unknown> = {}) => ({
  id: REVIEW,
  bid_id: BID,
  decision: "BID",
  decided_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  reviewer_id: OWNER,
  reviewer: { display_name: "김담당", email: "owner@example.test" },
  ...over,
});
const raised = (message: string, details: string | null = null) => ({
  code: "P0001",
  message,
  details,
  hint: null,
});

beforeEach(() => {
  fake.queries.length = 0;
  fake.replies.clear();
});

describe("listBoard", () => {
  it("이 조직 프로젝트 → 그 공고들의 결정·체크리스트를 org_id 로 좁혀 읽는다", async () => {
    reply("bid_projects", {
      data: [
        projectRow(),
        projectRow({
          id: PROJECT_2,
          bid_id: BID_2,
          bid: bidRow(BID_2),
          owner_id: null,
          owner: null,
        }),
      ],
    });
    reply("bid_reviews", { data: [decisionRow(), decisionRow({ id: "r2", bid_id: BID_2 })] });
    reply("tasks", {
      data: [
        { bid_project_id: PROJECT, status: "done" },
        { bid_project_id: PROJECT, status: "todo" },
      ],
    });

    const board = await projectRepo.listBoard(ORG);

    expect(argsOf(onlyOf("bid_projects"), "eq")).toEqual([["org_id", ORG]]);
    const reviews = onlyOf("bid_reviews");
    expect(argsOf(reviews, "eq")).toEqual([["org_id", ORG]]);
    expect(argsOf(reviews, "in")).toEqual([["bid_id", [BID, BID_2]]]);
    const tasks = onlyOf("tasks");
    expect(argsOf(tasks, "eq")).toEqual([["org_id", ORG]]);
    expect(argsOf(tasks, "in")).toEqual([["bid_project_id", [PROJECT, PROJECT_2]]]);

    expect(
      board.projects.map((p) => [p.id, p.owner, p.openedRevision, p.bid.latestRevision]),
    ).toEqual([
      [PROJECT, { id: OWNER, name: "김담당" }, 1, 2],
      [PROJECT_2, null, 1, 2],
    ]);
    expect(board.decisions.map((d) => [d.id, d.bidId, d.reviewer])).toEqual([
      [REVIEW, BID, "김담당"],
      ["r2", BID_2, "김담당"],
    ]);
    expect(board.checklist).toEqual([
      { bidProjectId: PROJECT, status: "done" },
      { bidProjectId: PROJECT, status: "todo" },
    ]);
  });

  it("프로젝트가 없으면 결정·체크리스트를 읽지 않는다", async () => {
    reply("bid_projects", { data: [] });
    expect(await projectRepo.listBoard(ORG)).toEqual({
      projects: [],
      decisions: [],
      checklist: [],
    });
    expect(fake.queries.map((q) => q.target)).toEqual(["bid_projects"]);
  });

  it("모르는 상태 값은 저장과 코드가 어긋난 것이라 던진다", async () => {
    reply("bid_projects", { data: [projectRow({ status: "DONE" })] });
    await expect(projectRepo.listBoard(ORG)).rejects.toThrow();
  });
});

describe("loadPendingSource", () => {
  it("대시보드와 같이 분석·결정을 이 조직으로 좁히고, 출처가 demo 면 데모 공고만 본다", async () => {
    reply("bid_notices", {
      data: [
        {
          id: BID,
          title: "대기 공고",
          agency: "가상 기관",
          is_demo: true,
          stage: "NOTICE",
          status: "OPEN",
          deadline_at: null,
          score_runs: [
            {
              id: "run-1",
              status: "COMPLETED",
              recommendation: "WATCH",
              review_flags: ["X"],
              created_at: "2026-10-19T00:00:00Z",
            },
          ],
          bid_reviews: [],
        },
      ],
    });
    const rows = await projectRepo.loadPendingSource(ORG, "demo");
    expect(argsOf(onlyOf("bid_notices"), "eq")).toEqual([
      ["score_runs.org_id", ORG],
      ["bid_reviews.org_id", ORG],
      ["is_demo", true],
    ]);
    expect(rows).toEqual([
      {
        bidId: BID,
        title: "대기 공고",
        agency: "가상 기관",
        isDemo: true,
        stage: "NOTICE",
        status: "OPEN",
        deadlineAt: null,
        analyses: [
          {
            id: "run-1",
            status: "COMPLETED",
            recommendation: "WATCH",
            reviewFlagCount: 1,
            createdAt: "2026-10-19T00:00:00Z",
          },
        ],
        reviews: [],
      },
    ]);
  });

  it("출처 all 은 데모 여부로 거르지 않는다", async () => {
    reply("bid_notices", { data: [] });
    await projectRepo.loadPendingSource(ORG, "all");
    expect(argsOf(onlyOf("bid_notices"), "eq").map(([column]) => column)).toEqual([
      "score_runs.org_id",
      "bid_reviews.org_id",
    ]);
  });
});

describe("getDetail", () => {
  const detailRow = (over: Record<string, unknown> = {}) =>
    projectRow({
      opened_review: {
        id: REVIEW,
        decided_at: "2026-10-19T00:00:00Z",
        reviewer_id: null,
        reviewer: null,
        revision: { revision: 1 },
        score_run: {
          finished_at: "2026-10-18T00:00:00Z",
          score: "71.5",
          recommendation: "BID",
          algorithm_version: "sol-score-v0.1",
          input_snapshot_hash: "hash-1",
        },
      },
      events: [
        {
          id: "e1",
          actor_id: OWNER,
          from_status: null,
          to_status: "PREPARING",
          note: null,
          created_at: "2026-10-20T00:00:00Z",
          actor: { display_name: null, email: "owner@example.test" },
        },
        {
          id: "e2",
          actor_id: "10000000-0000-4000-8000-000000000009",
          from_status: "PREPARING",
          to_status: "SUBMITTED",
          note: "접수",
          created_at: "2026-10-21T00:00:00Z",
          actor: null,
        },
      ],
      ...over,
    });

  it("uuid 가 아니면 부르지 않고 null 이다", async () => {
    expect(await projectRepo.getDetail(ORG, "p1")).toBeNull();
    expect(fake.queries).toHaveLength(0);
  });

  it("다른 조직·없는 id 는 null 이고 결정을 읽지 않는다", async () => {
    reply("bid_projects", { data: null });
    expect(await projectRepo.getDetail(ORG, PROJECT)).toBeNull();
    expect(argsOf(onlyOf("bid_projects"), "eq")).toEqual([
      ["org_id", ORG],
      ["id", PROJECT],
    ]);
    expect(queriesOf("bid_reviews")).toHaveLength(0);
  });

  it("여는 결정·분석 요약·이력을 옮긴다(탈퇴 결정자·조직을 떠난 행위자·numeric 문자열)", async () => {
    reply("bid_projects", { data: detailRow() });
    reply("bid_reviews", { data: [decisionRow()] });
    const detail = await projectRepo.getDetail(ORG, PROJECT);
    expect(argsOf(onlyOf("bid_reviews"), "eq")).toEqual([["org_id", ORG]]);
    expect(argsOf(onlyOf("bid_reviews"), "in")).toEqual([["bid_id", [BID]]]);
    expect(detail?.openedBy).toEqual({
      reviewId: REVIEW,
      reviewer: "탈퇴한 사용자",
      decidedAt: "2026-10-19T00:00:00Z",
      revision: 1,
      analysis: {
        finishedAt: "2026-10-18T00:00:00Z",
        solScore: 71.5,
        recommendation: "BID",
        algorithmVersion: "sol-score-v0.1",
        inputSnapshotHash: "hash-1",
      },
    });
    expect(detail?.events).toEqual([
      {
        id: "e1",
        actor: "owner",
        from: null,
        to: "PREPARING",
        note: null,
        createdAt: "2026-10-20T00:00:00Z",
      },
      {
        id: "e2",
        actor: null,
        from: "PREPARING",
        to: "SUBMITTED",
        note: "접수",
        createdAt: "2026-10-21T00:00:00Z",
      },
    ]);
    expect(detail?.decisions).toHaveLength(1);
  });

  it("결정에 분석이 없거나 끝나지 않았으면 분석 요약은 null 이다", async () => {
    const base = detailRow();
    reply("bid_projects", {
      data: { ...base, opened_review: { ...base.opened_review, score_run: null } },
    });
    reply("bid_reviews", { data: [decisionRow()] });
    expect((await projectRepo.getDetail(ORG, PROJECT))?.openedBy.analysis).toBeNull();
  });
});

describe("findRef·getEntrySource·countActive·isOrgMember", () => {
  it("findRef 는 org_id·id 로 좁힌다", async () => {
    reply("bid_projects", { data: { id: PROJECT, bid_id: BID, status: "SUBMITTED" } });
    expect(await projectRepo.findRef(ORG, PROJECT)).toEqual({
      id: PROJECT,
      bidId: BID,
      status: "SUBMITTED",
    });
    expect(argsOf(onlyOf("bid_projects"), "eq")).toEqual([
      ["org_id", ORG],
      ["id", PROJECT],
    ]);
  });

  it("getEntrySource 는 공고가 없으면 null, 있으면 이 조직 프로젝트·결정을 싣는다", async () => {
    reply("bid_notices", { data: null }, { data: { id: BID, status: "CANCELLED" } });
    reply(
      "bid_projects",
      { data: null },
      {
        data: { id: PROJECT, status: "CLOSED", closed_at: "2026-10-20T00:00:00Z", result: "LOST" },
      },
    );
    reply("bid_reviews", { data: [] }, { data: [decisionRow()] });

    expect(await projectRepo.getEntrySource(ORG, BID)).toBeNull();
    const source = await projectRepo.getEntrySource(ORG, BID);
    expect(source).toMatchObject({
      bidStatus: "CANCELLED",
      project: { id: PROJECT, status: "CLOSED", closedAt: "2026-10-20T00:00:00Z", result: "LOST" },
      decisions: [{ id: REVIEW, decision: "BID" }],
    });
    for (const query of queriesOf("bid_projects")) {
      expect(argsOf(query, "eq")).toEqual([
        ["org_id", ORG],
        ["bid_id", BID],
      ]);
    }
  });

  it("countActive 는 이 조직의 CLOSED 아닌 행을 센다", async () => {
    reply("bid_projects", { count: 3 });
    expect(await projectRepo.countActive(ORG)).toBe(3);
    const query = onlyOf("bid_projects");
    expect(argsOf(query, "select")).toEqual([["id", { count: "exact", head: true }]]);
    expect(argsOf(query, "eq")).toEqual([["org_id", ORG]]);
    expect(argsOf(query, "neq")).toEqual([["status", "CLOSED"]]);
  });

  it("isOrgMember 는 uuid 가 아니면 부르지 않는다", async () => {
    expect(await projectRepo.isOrgMember(ORG, "u1")).toBe(false);
    reply("memberships", { data: { user_id: OWNER } });
    expect(await projectRepo.isOrgMember(ORG, OWNER)).toBe(true);
    expect(argsOf(onlyOf("memberships"), "eq")).toEqual([
      ["org_id", ORG],
      ["user_id", OWNER],
    ]);
  });
});

describe("DB 함수", () => {
  it("openProject 는 결정 id 하나만 넘기고 첫 행을 옮긴다", async () => {
    reply("rpc:open_bid_project", { data: [{ project_id: PROJECT, reopened: true }] });
    expect(await projectRepo.openProject(REVIEW)).toEqual({
      ok: true,
      value: { projectId: PROJECT, reopened: true },
    });
    expect(argsOf(onlyOf("rpc:open_bid_project"), "rpc")).toEqual([
      ["open_bid_project", { p_review_id: REVIEW }],
    ]);
  });

  it("P0001 + 알려진 코드는 결과로, detail 을 함께 돌려준다", async () => {
    reply("rpc:open_bid_project", { error: raised("PROJECT_ALREADY_OPEN", PROJECT_2) });
    expect(await projectRepo.openProject(REVIEW)).toEqual({
      ok: false,
      code: "PROJECT_ALREADY_OPEN",
      detail: PROJECT_2,
    });
    reply("rpc:change_bid_project_status", { error: raised("NOT_FOUND") });
    expect(await projectRepo.changeStatus(PROJECT, "SUBMITTED", null)).toEqual({
      ok: false,
      code: "NOT_FOUND",
      detail: null,
    });
  });

  it("모르는 P0001 메시지·다른 오류 코드는 던진다", async () => {
    reply("rpc:record_bid_project_result", { error: raised("SOMETHING_ELSE") });
    await expect(projectRepo.recordResult(PROJECT, "WON", null)).rejects.toMatchObject({
      message: "SOMETHING_ELSE",
    });
    reply("rpc:change_bid_project_status", { error: { code: "23514", message: "check" } });
    await expect(projectRepo.changeStatus(PROJECT, "CLOSED", "x")).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("메모가 없으면 빈 글자를 보낸다(함수가 null 로 저장한다)", async () => {
    await projectRepo.changeStatus(PROJECT, "CLOSED", null);
    await projectRepo.recordResult(PROJECT, "LOST", "가격 차");
    expect(argsOf(onlyOf("rpc:change_bid_project_status"), "rpc")).toEqual([
      ["change_bid_project_status", { p_project_id: PROJECT, p_to_status: "CLOSED", p_note: "" }],
    ]);
    expect(argsOf(onlyOf("rpc:record_bid_project_result"), "rpc")).toEqual([
      ["record_bid_project_result", { p_project_id: PROJECT, p_result: "LOST", p_note: "가격 차" }],
    ]);
  });
});

describe("updateFields", () => {
  it("온 키만 열 이름으로 바꿔 쓰고 org_id·id 로 좁힌다", async () => {
    reply("bid_projects", { data: [{ id: PROJECT }] });
    expect(await projectRepo.updateFields(ORG, PROJECT, { ownerId: null })).toBe("saved");
    const query = onlyOf("bid_projects");
    expect(argsOf(query, "update")).toEqual([[{ owner_id: null }]]);
    expect(argsOf(query, "eq")).toEqual([
      ["org_id", ORG],
      ["id", PROJECT],
    ]);

    reply("bid_projects", { data: [{ id: PROJECT }] });
    await projectRepo.updateFields(ORG, PROJECT, {
      ownerId: OWNER,
      submissionDueOverride: "2026-11-10T09:00:00.000Z",
    });
    expect(argsOf(queriesOf("bid_projects")[1] as Query, "update")).toEqual([
      [{ owner_id: OWNER, submission_due_override: "2026-11-10T09:00:00.000Z" }],
    ]);
  });

  it("바뀐 행이 없으면 missing, 담당자 외래 키 거절은 owner-not-member, 그 밖의 오류는 던진다", async () => {
    reply("bid_projects", { data: [] });
    expect(await projectRepo.updateFields(ORG, PROJECT, { ownerId: null })).toBe("missing");
    reply("bid_projects", {
      error: {
        code: "23503",
        message:
          'insert or update on table "bid_projects" violates foreign key constraint "bid_projects_owner_fkey"',
      },
    });
    expect(await projectRepo.updateFields(ORG, PROJECT, { ownerId: OWNER })).toBe(
      "owner-not-member",
    );
    reply("bid_projects", { error: { code: "42501", message: "permission denied" } });
    await expect(
      projectRepo.updateFields(ORG, PROJECT, { submissionDueOverride: null }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
