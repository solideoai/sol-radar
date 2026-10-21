import { describe, expect, it, vi } from "vitest";
import {
  CHECKLIST_FORBIDDEN_MESSAGE,
  type ChecklistScope,
  type TaskMemberRow,
  type TaskRow,
  type TaskScope,
  type TaskStatsRow,
} from "./task.model";
import type { TaskRepo } from "./task.repo";
import {
  addProjectChecklistItem,
  addTask,
  changeTaskStatus,
  deleteProjectChecklistItem,
  deleteTask,
  getTaskAssignees,
  getTaskDashboard,
  getTaskList,
  listProjectChecklist,
  toggleProjectChecklistItem,
  updateProjectChecklistItem,
  updateTask,
} from "./task.service";

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const TASK_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const ME = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const OTHER = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const LEFT = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
// 서울 2026-10-14 12:00.
const NOW = new Date("2026-10-14T03:00:00.000Z");

// 팀에서 member 인 내가 보는 자리. 로그인·DB 연결·멤버인지는 조직 도메인이 이미 확인했다.
const SCOPE: TaskScope = { orgId: ORG_ID, userId: ME, isOwner: false };

const MEMBERS: TaskMemberRow[] = [
  { userId: OTHER, displayName: "김철수", email: "kim@example.com" },
  { userId: ME, displayName: "홍길동", email: "me@example.com" },
];

const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1",
  title: "회의록 공유",
  description: null,
  status: "todo",
  due_date: null,
  assignee_id: null,
  created_by: ME,
  completed_at: null,
  created_at: "2026-10-14T01:00:00.000Z",
  ...overrides,
});

const DATES = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const STATS: TaskStatsRow = {
  today: "2026-10-14",
  week_start: "2026-10-12",
  open_count: 3,
  overdue_count: 1,
  completed_this_week: 2,
  my_open_count: 1,
  daily_dates: DATES,
  daily_added: DATES.map(() => 1),
  daily_completed: DATES.map(() => 0),
};

// 저장 자리에 가짜를 꽂는다. 실제 Supabase 는 부르지 않는다(누가 무엇을 읽고 쓰는지는 DB 정책 시험이 본다).
const fakeRepo = (overrides: Partial<TaskRepo> = {}): TaskRepo => ({
  isConfigured: () => true,
  currentUserId: vi.fn(async () => ME),
  listMembers: vi.fn(async () => MEMBERS),
  isMember: vi.fn(async () => true),
  listPage: vi.fn(async () => ({ rows: [], total: 0 })),
  listDueSoon: vi.fn(async () => []),
  dashboardStats: vi.fn(async () => STATS),
  insert: vi.fn(async () => "saved" as const),
  update: vi.fn(async () => "saved" as const),
  deleteById: vi.fn(async () => true),
  isVisible: vi.fn(async () => false),
  listChecklist: vi.fn(async () => []),
  insertChecklistItem: vi.fn(async () => "saved" as const),
  updateChecklistItem: vi.fn(async () => "saved" as const),
  deleteChecklistItem: vi.fn(async () => true),
  isChecklistItemVisible: vi.fn(async () => false),
  ...overrides,
});

describe("getTaskList", () => {
  it("기본 조건(전체·최근 만든 순)의 1쪽을 읽어 화면 모양과 담당자 후보를 돌려준다", async () => {
    const repo = fakeRepo({
      listPage: vi.fn(async () => ({
        rows: [taskRow({ id: "t1", due_date: "2026-10-14", assignee_id: OTHER })],
        total: 1,
      })),
    });
    const page = await getTaskList(SCOPE, {}, repo, NOW);
    expect(repo.listPage).toHaveBeenCalledWith(
      ORG_ID,
      { status: null, assignee: null, sort: "created" },
      0,
      20,
    );
    expect(page).toMatchObject({
      total: 1,
      page: 1,
      pageCount: 1,
      pageSize: 20,
      filters: { status: null, assignee: null, sort: "created" },
      isDefaultQuery: true,
      today: "2026-10-14",
      members: [
        { id: ME, name: "홍길동", isMe: true },
        { id: OTHER, name: "김철수", isMe: false },
      ],
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      id: "t1",
      dueText: "10. 14.",
      dueState: "today",
      assignee: { id: OTHER, name: "김철수", isMe: false },
      creatorName: "홍길동",
      isMine: true,
      canDelete: true,
    });
    // 지금 조직은 이미 확인됐으므로 로그인을 다시 묻지 않는다.
    expect(repo.currentUserId).not.toHaveBeenCalled();
  });

  it("쿼리의 상태·담당자·정렬·쪽을 저장에 넘기고, 쪽에 맞는 offset 으로 읽는다", async () => {
    const repo = fakeRepo({ listPage: vi.fn(async () => ({ rows: [], total: 57 })) });
    const page = await getTaskList(
      SCOPE,
      { status: "in_progress", assignee: OTHER, sort: "due", page: "3" },
      repo,
      NOW,
    );
    expect(repo.listPage).toHaveBeenCalledWith(
      ORG_ID,
      { status: "in_progress", assignee: OTHER, sort: "due" },
      40,
      20,
    );
    expect(page).toMatchObject({ page: 3, pageCount: 3, total: 57, isDefaultQuery: false });
  });

  it("잘못된 쿼리는 기본값으로 읽는다 — 없는 상태, 멤버가 아닌 담당자, 숫자가 아닌 쪽", async () => {
    const repo = fakeRepo();
    const page = await getTaskList(
      SCOPE,
      { status: "archived", assignee: LEFT, sort: "title", page: "abc" },
      repo,
      NOW,
    );
    expect(repo.listPage).toHaveBeenCalledWith(
      ORG_ID,
      { status: null, assignee: null, sort: "created" },
      0,
      20,
    );
    expect(page).toMatchObject({ page: 1, isDefaultQuery: true });
  });

  it("범위를 넘은 쪽을 요청하면 1쪽을 다시 읽어 보여 준다", async () => {
    const listPage = vi
      .fn<TaskRepo["listPage"]>()
      .mockResolvedValueOnce("out-of-range")
      .mockResolvedValueOnce({ rows: [taskRow()], total: 3 });
    const repo = fakeRepo({ listPage });
    const page = await getTaskList(SCOPE, { page: "9", status: "todo" }, repo, NOW);
    expect(listPage.mock.calls.map((call) => call[2])).toEqual([160, 0]);
    expect(listPage).toHaveBeenLastCalledWith(
      ORG_ID,
      { status: "todo", assignee: null, sort: "created" },
      0,
      20,
    );
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 3 });
    expect(page.rows).toHaveLength(1);
  });

  it("작업이 없으면 빈 목록이고 쪽은 1쪽이다", async () => {
    const page = await getTaskList(SCOPE, {}, fakeRepo(), NOW);
    expect(page).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
  });

  it("1쪽마저 범위를 넘었다면 저장과 코드가 어긋난 것이라 던진다", async () => {
    const repo = fakeRepo({ listPage: vi.fn(async () => "out-of-range" as const) });
    await expect(getTaskList(SCOPE, {}, repo, NOW)).rejects.toThrow("1쪽");
  });

  it("오늘(마감일 상태의 기준)은 서울 날짜다", async () => {
    const repo = fakeRepo({
      listPage: vi.fn(async () => ({ rows: [taskRow({ due_date: "2026-10-13" })], total: 1 })),
    });
    // UTC 로는 10-13 이지만 서울은 10-14 00:30 이다.
    const page = await getTaskList(SCOPE, {}, repo, new Date("2026-10-13T15:30:00.000Z"));
    expect(page.today).toBe("2026-10-14");
    expect(page.rows[0].dueState).toBe("overdue");
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ listPage: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getTaskList(SCOPE, {}, repo, NOW)).rejects.toThrow("db down");
  });
});

describe("getTaskDashboard", () => {
  it("수치는 집계 함수 하나에서 받고, 기한 표는 5개까지 읽는다", async () => {
    const repo = fakeRepo({
      listDueSoon: vi.fn(async () => [
        taskRow({ id: "d1", due_date: "2026-10-13", assignee_id: ME }),
      ]),
    });
    const dashboard = await getTaskDashboard(SCOPE, repo, NOW);
    expect(repo.dashboardStats).toHaveBeenCalledWith(ORG_ID, "2026-10-14T03:00:00.000Z");
    expect(repo.listDueSoon).toHaveBeenCalledWith(ORG_ID, 5);
    expect(repo.listMembers).toHaveBeenCalledWith(ORG_ID);
    expect(dashboard).toMatchObject({
      counts: { open: 3, overdue: 1, completedThisWeek: 2, mine: 1 },
      today: "2026-10-14",
      weekStart: "2026-10-12",
      weekStartLabel: "10. 12.",
    });
    expect(dashboard.daily).toHaveLength(14);
    expect(dashboard.dueSoon).toMatchObject([
      { id: "d1", dueState: "overdue", assignee: { name: "홍길동", isMe: true } },
    ]);
  });

  it("기준 시각을 넘기지 않으면 DB 의 지금으로 센다", async () => {
    const repo = fakeRepo();
    await getTaskDashboard(SCOPE, repo);
    expect(repo.dashboardStats).toHaveBeenCalledWith(ORG_ID, undefined);
  });

  it("집계 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({
      dashboardStats: vi.fn(async () => Promise.reject(new Error("rpc failed"))),
    });
    await expect(getTaskDashboard(SCOPE, repo, NOW)).rejects.toThrow("rpc failed");
  });
});

describe("getTaskAssignees", () => {
  it("지금 조직의 멤버를 나 먼저, 그다음 이름 가나다순으로 돌려준다", async () => {
    const repo = fakeRepo();
    await expect(getTaskAssignees(SCOPE, repo)).resolves.toEqual([
      { id: ME, name: "홍길동", isMe: true },
      { id: OTHER, name: "김철수", isMe: false },
    ]);
    expect(repo.listMembers).toHaveBeenCalledWith(ORG_ID);
  });
});

describe("addTask", () => {
  it("다듬은 입력을 그 조직에 저장한다 — 만든 사람은 입력이 아니라 DB 가 로그인에서 채운다", async () => {
    const repo = fakeRepo();
    await expect(
      addTask(
        ORG_ID,
        { title: "  회의록 공유 ", description: " ", assigneeId: OTHER, dueDate: "2026-10-21" },
        repo,
      ),
    ).resolves.toEqual({ status: "saved" });
    expect(repo.insert).toHaveBeenCalledWith(ORG_ID, {
      title: "회의록 공유",
      description: null,
      assigneeId: OTHER,
      dueDate: "2026-10-21",
    });
  });

  it("담당자 none·빈 값과 빈 마감일은 없음으로 저장한다", async () => {
    const repo = fakeRepo();
    await addTask(ORG_ID, { title: "제목", assigneeId: "none", dueDate: "" }, repo);
    await addTask(ORG_ID, { title: "제목", assigneeId: "", dueDate: null }, repo);
    for (const call of vi.mocked(repo.insert).mock.calls)
      expect(call[1]).toMatchObject({ assigneeId: null, dueDate: null });
  });

  it("틀린 입력은 칸과 문구를 돌려주고, 로그인도 묻지 않고 저장도 하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(addTask(ORG_ID, { title: "   " }, repo)).resolves.toEqual({
      status: "invalid",
      field: "title",
      message: "제목을 입력하세요",
    });
    await expect(addTask(ORG_ID, { title: "제목", dueDate: "2026-02-30" }, repo)).resolves.toEqual({
      status: "invalid",
      field: "dueDate",
      message: "마감일 형식이 아닙니다",
    });
    expect(repo.currentUserId).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("그 조직의 멤버가 아니면(정책이 막음) not-in-org 다", async () => {
    const repo = fakeRepo({ insert: vi.fn(async () => "not-in-org" as const) });
    await expect(addTask(ORG_ID, { title: "제목" }, repo)).resolves.toEqual({
      status: "not-in-org",
    });
  });

  it("담당자가 그 조직의 멤버가 아니면(외래 키가 막음) assignee-not-member 다", async () => {
    const repo = fakeRepo({ insert: vi.fn(async () => "assignee-not-member" as const) });
    await expect(addTask(ORG_ID, { title: "제목", assigneeId: LEFT }, repo)).resolves.toEqual({
      status: "assignee-not-member",
    });
  });

  it("로그인 전이거나 DB 설정이 없으면 signed-out 이고 저장하지 않는다", async () => {
    const signedOut = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(addTask(ORG_ID, { title: "제목" }, signedOut)).resolves.toEqual({
      status: "signed-out",
    });
    expect(signedOut.insert).not.toHaveBeenCalled();

    const noDatabase = fakeRepo({ isConfigured: () => false });
    await expect(addTask(ORG_ID, { title: "제목" }, noDatabase)).resolves.toEqual({
      status: "signed-out",
    });
    expect(noDatabase.currentUserId).not.toHaveBeenCalled();
  });

  it("형식이 틀린 조직 id 는 화면이 보낼 수 없는 값이라 던지고 저장을 부르지 않는다", async () => {
    const repo = fakeRepo();
    await expect(addTask("acme", { title: "제목" }, repo)).rejects.toThrow("조직 id 형식");
    await expect(addTask(undefined, { title: "제목" }, repo)).rejects.toThrow("조직 id 형식");
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ insert: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(addTask(ORG_ID, { title: "제목" }, repo)).rejects.toThrow("db down");
  });
});

describe("updateTask", () => {
  const EDIT = {
    title: " 고친 제목 ",
    description: "설명",
    status: "done",
    assigneeId: ME,
    dueDate: "2026-10-21",
  };

  it("다듬은 다섯 칸을 그 조직의 그 작업에 저장한다", async () => {
    const repo = fakeRepo();
    await expect(updateTask(ORG_ID, TASK_ID, EDIT, repo)).resolves.toEqual({ status: "saved" });
    expect(repo.update).toHaveBeenCalledWith(ORG_ID, TASK_ID, {
      title: "고친 제목",
      description: "설명",
      status: "done",
      assigneeId: ME,
      dueDate: "2026-10-21",
    });
  });

  it("바뀐 행이 없는데 아직 멤버면 작업이 그새 지워진 것이다(gone)", async () => {
    const repo = fakeRepo({ update: vi.fn(async () => "missing" as const) });
    await expect(updateTask(ORG_ID, TASK_ID, EDIT, repo)).resolves.toEqual({ status: "gone" });
    expect(repo.isMember).toHaveBeenCalledWith(ORG_ID, ME);
  });

  it("바뀐 행이 없고 멤버도 아니면 내가 조직에서 빠진 것이다(not-in-org)", async () => {
    const repo = fakeRepo({
      update: vi.fn(async () => "missing" as const),
      isMember: vi.fn(async () => false),
    });
    await expect(updateTask(ORG_ID, TASK_ID, EDIT, repo)).resolves.toEqual({
      status: "not-in-org",
    });
  });

  it("담당자를 외래 키가 거절하면 assignee-not-member 다", async () => {
    const repo = fakeRepo({ update: vi.fn(async () => "assignee-not-member" as const) });
    await expect(updateTask(ORG_ID, TASK_ID, EDIT, repo)).resolves.toEqual({
      status: "assignee-not-member",
    });
    expect(repo.isMember).not.toHaveBeenCalled();
  });

  it("상태가 없거나 틀리면 status 칸 오류이고 저장하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(
      updateTask(ORG_ID, TASK_ID, { ...EDIT, status: "archived" }, repo),
    ).resolves.toEqual({ status: "invalid", field: "status", message: "상태를 고르세요" });
    await expect(
      updateTask(ORG_ID, TASK_ID, { ...EDIT, title: "가".repeat(121) }, repo),
    ).resolves.toEqual({ status: "invalid", field: "title", message: "제목은 120자 이하입니다" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("로그인 전이면 signed-out 이고 저장하지 않는다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(updateTask(ORG_ID, TASK_ID, EDIT, repo)).resolves.toEqual({
      status: "signed-out",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("형식이 틀린 조직·작업 id 는 던진다", async () => {
    const repo = fakeRepo();
    await expect(updateTask("acme", TASK_ID, EDIT, repo)).rejects.toThrow("조직 id 형식");
    await expect(updateTask(ORG_ID, "t1", EDIT, repo)).rejects.toThrow("작업 id 형식");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("changeTaskStatus", () => {
  it("상태 한 칸만 저장한다", async () => {
    const repo = fakeRepo();
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "done", repo)).resolves.toEqual({
      status: "saved",
    });
    expect(repo.update).toHaveBeenCalledWith(ORG_ID, TASK_ID, { status: "done" });
  });

  it("바뀐 행이 없으면 멤버십으로 gone 과 not-in-org 를 가른다", async () => {
    const gone = fakeRepo({ update: vi.fn(async () => "missing" as const) });
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "todo", gone)).resolves.toEqual({
      status: "gone",
    });
    const left = fakeRepo({
      update: vi.fn(async () => "missing" as const),
      isMember: vi.fn(async () => false),
    });
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "todo", left)).resolves.toEqual({
      status: "not-in-org",
    });
  });

  it("로그인 전이면 signed-out 이다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "done", repo)).resolves.toEqual({
      status: "signed-out",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("모르는 상태·형식이 틀린 id 는 화면이 보낼 수 없는 값이라 던진다", async () => {
    const repo = fakeRepo();
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "archived", repo)).rejects.toThrow(
      "작업 상태 값",
    );
    await expect(changeTaskStatus(ORG_ID, "t1", "done", repo)).rejects.toThrow("작업 id 형식");
    await expect(changeTaskStatus("acme", TASK_ID, "done", repo)).rejects.toThrow("조직 id 형식");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("상태만 바꿨는데 담당자 외래 키가 거절하면 저장과 코드가 어긋난 것이라 던진다", async () => {
    const repo = fakeRepo({ update: vi.fn(async () => "assignee-not-member" as const) });
    await expect(changeTaskStatus(ORG_ID, TASK_ID, "done", repo)).rejects.toThrow("담당자");
  });
});

describe("deleteTask", () => {
  it("지운 행이 있으면 deleted 다", async () => {
    const repo = fakeRepo();
    await expect(deleteTask(ORG_ID, TASK_ID, repo)).resolves.toEqual({ status: "deleted" });
    expect(repo.deleteById).toHaveBeenCalledWith(ORG_ID, TASK_ID);
    expect(repo.isVisible).not.toHaveBeenCalled();
  });

  it("지운 행이 없는데 작업이 아직 보이면 지울 권한이 없다(forbidden)", async () => {
    const repo = fakeRepo({
      deleteById: vi.fn(async () => false),
      isVisible: vi.fn(async () => true),
    });
    await expect(deleteTask(ORG_ID, TASK_ID, repo)).resolves.toEqual({ status: "forbidden" });
    expect(repo.isVisible).toHaveBeenCalledWith(ORG_ID, TASK_ID);
  });

  it("지운 행도 없고 보이지도 않으면, 멤버면 이미 지워진 것(gone)이고 아니면 not-in-org 다", async () => {
    const gone = fakeRepo({ deleteById: vi.fn(async () => false) });
    await expect(deleteTask(ORG_ID, TASK_ID, gone)).resolves.toEqual({ status: "gone" });
    const left = fakeRepo({
      deleteById: vi.fn(async () => false),
      isMember: vi.fn(async () => false),
    });
    await expect(deleteTask(ORG_ID, TASK_ID, left)).resolves.toEqual({ status: "not-in-org" });
  });

  it("로그인 전이면 signed-out 이고 지우지 않는다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(deleteTask(ORG_ID, TASK_ID, repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it("형식이 틀린 id 는 던지고 지우지 않는다", async () => {
    const repo = fakeRepo();
    await expect(deleteTask(ORG_ID, "t1", repo)).rejects.toThrow("작업 id 형식");
    await expect(deleteTask("acme", TASK_ID, repo)).rejects.toThrow("조직 id 형식");
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ deleteById: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(deleteTask(ORG_ID, TASK_ID, repo)).rejects.toThrow("db down");
  });
});

// ── 입찰 프로젝트 체크리스트(P1 N6, 계획 Task 3) ──
// 체크리스트는 bid_project_id 가 있는 작업이다. 쓰기는 restrictive 정책이 ADMIN·SALES 만 연다(M13).
// RLS 거부는 던지지 않고 "체크리스트를 고칠 권한이 없습니다" 결과다.
describe("입찰 프로젝트 체크리스트", () => {
  const PROJECT_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
  const MANAGER: ChecklistScope = { orgId: ORG_ID, userId: ME, canManage: true };
  const READER: ChecklistScope = { orgId: ORG_ID, userId: ME, canManage: false };
  const FORBIDDEN = { status: "forbidden", message: CHECKLIST_FORBIDDEN_MESSAGE };

  describe("listProjectChecklist", () => {
    it("listProjectChecklist 는 그 프로젝트 행만 읽는다 — 저장에 조직과 프로젝트를 넘기고 받은 순서(만든 순) 그대로다", async () => {
      const repo = fakeRepo({
        listChecklist: vi.fn(async () => [
          taskRow({ id: "t1", created_at: "2026-10-14T01:00:00.000Z" }),
          taskRow({ id: "t2", status: "done", created_at: "2026-10-14T02:00:00.000Z" }),
        ]),
      });
      const rows = await listProjectChecklist(MANAGER, PROJECT_ID, repo, NOW);
      expect(repo.listChecklist).toHaveBeenCalledWith(ORG_ID, PROJECT_ID);
      expect(repo.listPage).not.toHaveBeenCalled();
      expect(rows.map((row) => row.id)).toEqual(["t1", "t2"]);
      expect(rows[1]).toMatchObject({ status: "done", statusLabel: "완료" });
    });

    it("지우기 표시는 역할로 정한다 — ADMIN·SALES 면 남이 만든 항목도, 아니면 내가 만든 항목도 없다", async () => {
      const repo = fakeRepo({
        listChecklist: vi.fn(async () => [
          taskRow({ id: "mine", created_by: ME }),
          taskRow({ id: "theirs", created_by: OTHER }),
        ]),
      });
      const managed = await listProjectChecklist(MANAGER, PROJECT_ID, repo, NOW);
      expect(managed.map((row) => row.canDelete)).toEqual([true, true]);
      const read = await listProjectChecklist(READER, PROJECT_ID, repo, NOW);
      expect(read.map((row) => row.canDelete)).toEqual([false, false]);
    });

    it("형식이 틀린 프로젝트 id 는 던지고 읽지 않는다", async () => {
      const repo = fakeRepo();
      await expect(listProjectChecklist(MANAGER, "p1", repo, NOW)).rejects.toThrow(
        "프로젝트 id 형식",
      );
      expect(repo.listChecklist).not.toHaveBeenCalled();
    });
  });

  describe("addProjectChecklistItem", () => {
    it("addProjectChecklistItem 은 insert 에 bid_project_id 를 넣는다 — 템플릿 검증(parseNewTask)을 그대로 쓴다", async () => {
      const repo = fakeRepo();
      await expect(
        addProjectChecklistItem(
          MANAGER,
          PROJECT_ID,
          { title: " 제안서 초안 ", description: " ", assigneeId: "none", dueDate: "2026-10-28" },
          repo,
        ),
      ).resolves.toEqual({ status: "saved" });
      expect(repo.insertChecklistItem).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, {
        title: "제안서 초안",
        description: null,
        assigneeId: null,
        dueDate: "2026-10-28",
      });
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("FormData 로 와도 같은 칸 이름(title·description·assigneeId·dueDate)으로 읽는다", async () => {
      const repo = fakeRepo();
      const form = new FormData();
      form.set("title", "가격 제안서");
      form.set("assigneeId", OTHER);
      form.set("dueDate", "");
      await addProjectChecklistItem(MANAGER, PROJECT_ID, form, repo);
      expect(repo.insertChecklistItem).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, {
        title: "가격 제안서",
        description: null,
        assigneeId: OTHER,
        dueDate: null,
      });
    });

    it("틀린 입력은 칸 오류이고 저장하지 않는다", async () => {
      const repo = fakeRepo();
      await expect(
        addProjectChecklistItem(MANAGER, PROJECT_ID, { title: "" }, repo),
      ).resolves.toEqual({ status: "invalid", field: "title", message: "제목을 입력하세요" });
      expect(repo.insertChecklistItem).not.toHaveBeenCalled();
    });

    it("RLS 거부(42501)는 권한 없음 결과다 — 멤버인데 거절되면 forbidden, 멤버가 아니면 not-in-org", async () => {
      const rejected = fakeRepo({
        insertChecklistItem: vi.fn(async () => "rls-rejected" as const),
      });
      await expect(
        addProjectChecklistItem(READER, PROJECT_ID, { title: "몰래 넣기" }, rejected),
      ).resolves.toEqual(FORBIDDEN);
      expect(rejected.isMember).toHaveBeenCalledWith(ORG_ID, ME);

      const left = fakeRepo({
        insertChecklistItem: vi.fn(async () => "rls-rejected" as const),
        isMember: vi.fn(async () => false),
      });
      await expect(
        addProjectChecklistItem(MANAGER, PROJECT_ID, { title: "제목" }, left),
      ).resolves.toEqual({ status: "not-in-org" });
    });

    it("다른 조직·없는 프로젝트(외래 키 거절)는 gone, 담당자 외래 키 거절은 assignee-not-member 다", async () => {
      const gone = fakeRepo({ insertChecklistItem: vi.fn(async () => "project-missing" as const) });
      await expect(
        addProjectChecklistItem(MANAGER, PROJECT_ID, { title: "제목" }, gone),
      ).resolves.toEqual({ status: "gone" });
      const assignee = fakeRepo({
        insertChecklistItem: vi.fn(async () => "assignee-not-member" as const),
      });
      await expect(
        addProjectChecklistItem(MANAGER, PROJECT_ID, { title: "제목", assigneeId: LEFT }, assignee),
      ).resolves.toEqual({ status: "assignee-not-member" });
    });

    it("형식이 틀린 프로젝트 id 는 던지고 저장하지 않는다", async () => {
      const repo = fakeRepo();
      await expect(addProjectChecklistItem(MANAGER, "p1", { title: "제목" }, repo)).rejects.toThrow(
        "프로젝트 id 형식",
      );
      expect(repo.insertChecklistItem).not.toHaveBeenCalled();
    });
  });

  describe("toggleProjectChecklistItem", () => {
    it("체크는 done, 해제는 todo 로 그 프로젝트의 그 항목만 바꾼다", async () => {
      const repo = fakeRepo();
      await expect(
        toggleProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, true, repo),
      ).resolves.toEqual({ status: "saved" });
      await toggleProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, false, repo);
      expect(vi.mocked(repo.updateChecklistItem).mock.calls).toEqual([
        [ORG_ID, PROJECT_ID, TASK_ID, { status: "done" }],
        [ORG_ID, PROJECT_ID, TASK_ID, { status: "todo" }],
      ]);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("바뀐 행이 없는데 항목이 보이면 권한 없음(정책이 걸렀다), 안 보이면 gone·not-in-org 다", async () => {
      const blocked = fakeRepo({
        updateChecklistItem: vi.fn(async () => "missing" as const),
        isChecklistItemVisible: vi.fn(async () => true),
      });
      await expect(
        toggleProjectChecklistItem(READER, PROJECT_ID, TASK_ID, true, blocked),
      ).resolves.toEqual(FORBIDDEN);
      expect(blocked.isChecklistItemVisible).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, TASK_ID);

      const gone = fakeRepo({ updateChecklistItem: vi.fn(async () => "missing" as const) });
      await expect(
        toggleProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, true, gone),
      ).resolves.toEqual({ status: "gone" });
    });

    it("불리언이 아닌 값·형식이 틀린 id 는 화면이 보낼 수 없는 값이라 던진다", async () => {
      const repo = fakeRepo();
      await expect(
        toggleProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, "done", repo),
      ).rejects.toThrow("완료 값");
      await expect(
        toggleProjectChecklistItem(MANAGER, PROJECT_ID, "t1", true, repo),
      ).rejects.toThrow("작업 id 형식");
      expect(repo.updateChecklistItem).not.toHaveBeenCalled();
    });
  });

  describe("updateProjectChecklistItem", () => {
    it("템플릿 편집 검증(parseTaskEdit)을 거쳐 그 프로젝트의 항목에 저장한다", async () => {
      const repo = fakeRepo();
      await expect(
        updateProjectChecklistItem(
          MANAGER,
          PROJECT_ID,
          TASK_ID,
          { title: " 고친 항목 ", status: "in_progress", assigneeId: ME, dueDate: "" },
          repo,
        ),
      ).resolves.toEqual({ status: "saved" });
      expect(repo.updateChecklistItem).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, TASK_ID, {
        title: "고친 항목",
        description: null,
        status: "in_progress",
        assigneeId: ME,
        dueDate: null,
      });
    });

    it("정책이 걸러 바뀐 행이 없고 항목이 보이면 권한 없음이다", async () => {
      const repo = fakeRepo({
        updateChecklistItem: vi.fn(async () => "missing" as const),
        isChecklistItemVisible: vi.fn(async () => true),
      });
      await expect(
        updateProjectChecklistItem(
          READER,
          PROJECT_ID,
          TASK_ID,
          { title: "t", status: "todo" },
          repo,
        ),
      ).resolves.toEqual(FORBIDDEN);
    });
  });

  describe("deleteProjectChecklistItem", () => {
    it("지운 행이 있으면 deleted, 없는데 보이면 권한 없음, 안 보이면 gone 이다", async () => {
      const deleted = fakeRepo();
      await expect(
        deleteProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, deleted),
      ).resolves.toEqual({ status: "deleted" });
      expect(deleted.deleteChecklistItem).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, TASK_ID);
      expect(deleted.deleteById).not.toHaveBeenCalled();

      const blocked = fakeRepo({
        deleteChecklistItem: vi.fn(async () => false),
        isChecklistItemVisible: vi.fn(async () => true),
      });
      await expect(
        deleteProjectChecklistItem(READER, PROJECT_ID, TASK_ID, blocked),
      ).resolves.toEqual(FORBIDDEN);

      const gone = fakeRepo({ deleteChecklistItem: vi.fn(async () => false) });
      await expect(deleteProjectChecklistItem(MANAGER, PROJECT_ID, TASK_ID, gone)).resolves.toEqual(
        { status: "gone" },
      );
    });
  });
});
