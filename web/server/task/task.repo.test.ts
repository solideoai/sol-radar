import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskRepo } from "./task.repo";

// 체크리스트 저장(P1 N6)이 Supabase 에 무엇을 보내는지 본다. SQL·RLS 는 흉내 내지 않는다
// (누가 넣고 고치고 지우는지는 scripts/database.test.mjs 의 입찰 프로젝트 묶음이 PGlite 로 본다).

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type Reply = { data?: unknown; error?: unknown };

const fake = vi.hoisted(() => ({
  queries: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
  reply: { data: [], error: null } as { data?: unknown; error?: unknown },
}));

vi.mock("@/server/supabase", () => {
  const chain = (query: Query): object =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) =>
              resolve({ data: fake.reply.data ?? null, error: fake.reply.error ?? null });
          }
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            query.calls.push({ method: prop, args });
            return chain(query);
          };
        },
      },
    );
  return {
    isSupabaseConfigured: () => true,
    getAuthClaims: async () => null,
    getSupabase: async () => ({
      from: (table: string) => {
        const query: Query = { table, calls: [] };
        fake.queries.push(query);
        return chain(query);
      },
    }),
  };
});

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const PROJECT_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const TASK_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const TASK = { title: "제안서 초안", description: null, dueDate: "2026-10-28", assigneeId: null };

const only = (): Query => {
  expect(fake.queries).toHaveLength(1);
  return fake.queries[0] as Query;
};
const argsOf = (query: Query, method: string): unknown[][] =>
  query.calls.filter((call) => call.method === method).map((call) => call.args);
const reply = (next: Reply) => {
  fake.reply = next;
};

beforeEach(() => {
  fake.queries.length = 0;
  reply({ data: [], error: null });
});

describe("체크리스트 저장", () => {
  it("insertChecklistItem 은 그 조직·그 프로젝트로 넣는다(bid_project_id 포함, 만든 사람은 DB 기본값)", async () => {
    reply({ data: null, error: null });
    await expect(taskRepo.insertChecklistItem(ORG_ID, PROJECT_ID, TASK)).resolves.toBe("saved");
    const query = only();
    expect(query.table).toBe("tasks");
    expect(argsOf(query, "insert")).toEqual([
      [
        {
          org_id: ORG_ID,
          bid_project_id: PROJECT_ID,
          title: "제안서 초안",
          description: null,
          due_date: "2026-10-28",
          assignee_id: null,
        },
      ],
    ]);
  });

  it("정책 거부(42501)는 rls-rejected, 프로젝트 외래 키 거절은 project-missing, 담당자 외래 키 거절은 assignee-not-member 다", async () => {
    reply({ error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(taskRepo.insertChecklistItem(ORG_ID, PROJECT_ID, TASK)).resolves.toBe(
      "rls-rejected",
    );
    reply({
      error: {
        code: "23503",
        message:
          'insert or update on table "tasks" violates foreign key constraint "tasks_bid_project_fkey"',
      },
    });
    await expect(taskRepo.insertChecklistItem(ORG_ID, PROJECT_ID, TASK)).resolves.toBe(
      "project-missing",
    );
    reply({
      error: {
        code: "23503",
        message:
          'insert or update on table "tasks" violates foreign key constraint "tasks_assignee_fkey"',
      },
    });
    await expect(taskRepo.insertChecklistItem(ORG_ID, PROJECT_ID, TASK)).resolves.toBe(
      "assignee-not-member",
    );
  });

  it("모르는 오류는 삼키지 않고 던진다", async () => {
    const error = { code: "XX000", message: "db down" };
    reply({ error });
    await expect(taskRepo.insertChecklistItem(ORG_ID, PROJECT_ID, TASK)).rejects.toBe(error);
  });

  it("listChecklist 는 그 조직·그 프로젝트의 행만 만든 순(오래된 것 먼저)으로 읽는다", async () => {
    await taskRepo.listChecklist(ORG_ID, PROJECT_ID);
    const query = only();
    expect(argsOf(query, "eq")).toEqual([
      ["org_id", ORG_ID],
      ["bid_project_id", PROJECT_ID],
    ]);
    expect(argsOf(query, "order")).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("고치기·지우기·보이는지는 그 프로젝트의 그 항목으로 좁힌다(일반 작업 id 로는 바뀌지 않는다)", async () => {
    reply({ data: [{ id: TASK_ID }], error: null });
    await expect(
      taskRepo.updateChecklistItem(ORG_ID, PROJECT_ID, TASK_ID, { status: "done" }),
    ).resolves.toBe("saved");
    await expect(taskRepo.deleteChecklistItem(ORG_ID, PROJECT_ID, TASK_ID)).resolves.toBe(true);
    reply({ data: null, error: null });
    await expect(taskRepo.isChecklistItemVisible(ORG_ID, PROJECT_ID, TASK_ID)).resolves.toBe(false);
    expect(fake.queries.map((query) => argsOf(query, "eq"))).toEqual([
      [
        ["org_id", ORG_ID],
        ["bid_project_id", PROJECT_ID],
        ["id", TASK_ID],
      ],
      [
        ["org_id", ORG_ID],
        ["bid_project_id", PROJECT_ID],
        ["id", TASK_ID],
      ],
      [
        ["org_id", ORG_ID],
        ["bid_project_id", PROJECT_ID],
        ["id", TASK_ID],
      ],
    ]);
    expect(argsOf(fake.queries[0] as Query, "update")).toEqual([[{ status: "done" }]]);
  });

  it("바뀐 행이 없으면 missing 이다(정책이 걸렀거나 그새 지워졌다)", async () => {
    reply({ data: [], error: null });
    await expect(
      taskRepo.updateChecklistItem(ORG_ID, PROJECT_ID, TASK_ID, { status: "todo" }),
    ).resolves.toBe("missing");
    await expect(taskRepo.deleteChecklistItem(ORG_ID, PROJECT_ID, TASK_ID)).resolves.toBe(false);
  });
});
