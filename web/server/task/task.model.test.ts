import { describe, expect, it } from "vitest";
import {
  CHECKLIST_FORBIDDEN_MESSAGE,
  checklistForbidden,
  dueStateOf,
  formFieldsOf,
  formatDateTime,
  formatDay,
  formatMonthDay,
  isDefaultFilters,
  pageCountOf,
  parseId,
  parseNewTask,
  parseStatus,
  parseTaskEdit,
  parseTaskListQuery,
  seoulDate,
  TASK_PAGE_SIZE,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskMemberRow,
  type TaskRow,
  type TaskScope,
  type TaskStatsRow,
  toAssigneeOptions,
  toStatus,
  toChecklistView,
  toTaskDashboard,
  toTaskView,
} from "./task.model";

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ME = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const OTHER = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const LEFT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

const scope = (overrides: Partial<TaskScope> = {}): TaskScope => ({
  orgId: ORG_ID,
  userId: ME,
  isOwner: false,
  ...overrides,
});

const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1",
  title: "회의록 공유",
  description: null,
  status: "todo",
  due_date: null,
  assignee_id: null,
  created_by: ME,
  completed_at: null,
  created_at: "2026-10-14T06:00:00.000Z",
  ...overrides,
});

const NAMES: ReadonlyMap<string, string> = new Map([
  [ME, "홍길동"],
  [OTHER, "김철수"],
]);

describe("상수", () => {
  it("상태는 할 일·진행 중·완료 셋이고, 한 쪽은 20줄이다", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done"]);
    expect(TASK_STATUS_LABELS).toEqual({ todo: "할 일", in_progress: "진행 중", done: "완료" });
    expect(TASK_PAGE_SIZE).toBe(20);
  });
});

describe("parseNewTask", () => {
  it("제목·설명은 앞뒤 공백을 빼고, 빈 설명·담당자·마감일은 없음(null)이다", () => {
    expect(
      parseNewTask({
        title: "  회의록 공유 ",
        description: "  첫 줄\n둘째 줄 ",
        assigneeId: "",
        dueDate: "",
      }),
    ).toEqual({
      ok: true,
      task: {
        title: "회의록 공유",
        description: "첫 줄\n둘째 줄",
        assigneeId: null,
        dueDate: null,
      },
    });
  });

  it("담당자는 비었거나 none·null·빠짐이면 없음이고, 멤버 id 면 그 id 다", () => {
    for (const assigneeId of ["", "none", null, undefined])
      expect(parseNewTask({ title: "제목", assigneeId })).toMatchObject({
        ok: true,
        task: { assigneeId: null },
      });
    expect(parseNewTask({ title: "제목", assigneeId: OTHER })).toMatchObject({
      ok: true,
      task: { assigneeId: OTHER },
    });
  });

  it("마감일은 YYYY-MM-DD 날짜만 받고, 비었거나 null 이면 없음이다", () => {
    expect(parseNewTask({ title: "제목", dueDate: "2026-10-21" })).toMatchObject({
      ok: true,
      task: { dueDate: "2026-10-21" },
    });
    expect(parseNewTask({ title: "제목", dueDate: null })).toMatchObject({
      ok: true,
      task: { dueDate: null },
    });
    expect(parseNewTask({ title: "제목", dueDate: "2028-02-29" })).toMatchObject({ ok: true });
  });

  it("설명이 공백뿐이면 없음(null)이다 — DB 는 빈 설명을 받지 않는다", () => {
    expect(parseNewTask({ title: "제목", description: "   " })).toMatchObject({
      ok: true,
      task: { description: null },
    });
  });

  it("제목은 1~120자다", () => {
    expect(parseNewTask({ title: "가".repeat(120) })).toMatchObject({ ok: true });
    expect(parseNewTask({ title: "가".repeat(121) })).toEqual({
      ok: false,
      field: "title",
      message: "제목은 120자 이하입니다",
    });
    for (const title of ["", "   ", "\u3000"])
      expect(parseNewTask({ title })).toEqual({
        ok: false,
        field: "title",
        message: "제목을 입력하세요",
      });
  });

  it("설명은 2000자까지다", () => {
    expect(parseNewTask({ title: "제목", description: "가".repeat(2000) })).toMatchObject({
      ok: true,
    });
    expect(parseNewTask({ title: "제목", description: "가".repeat(2001) })).toEqual({
      ok: false,
      field: "description",
      message: "설명은 2000자 이하입니다",
    });
  });

  it("없는 날짜·형식이 다른 날짜·0000년은 마감일 형식 오류다", () => {
    for (const dueDate of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-5",
      "2026-10-21T00:00",
      "내일",
      "0000-01-01",
    ])
      expect(parseNewTask({ title: "제목", dueDate })).toEqual({
        ok: false,
        field: "dueDate",
        message: "마감일 형식이 아닙니다",
      });
  });

  it("담당자가 id 형식이 아니면 담당자를 다시 고르라고 한다", () => {
    // 화면은 고른 멤버의 id 를 글자로 보낸다. 끝 한 글자가 빠진 id 도 형식 오류다.
    for (const assigneeId of ["user-1", "acme", "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6"])
      expect(parseNewTask({ title: "제목", assigneeId })).toEqual({
        ok: false,
        field: "assigneeId",
        message: "담당자를 다시 고르세요",
      });
  });

  it("틀린 칸이 여럿이면 화면 순서(제목 → 설명 → 담당자 → 마감일)로 첫 칸 하나만 알린다", () => {
    const allWrong = {
      title: "",
      description: "가".repeat(2001),
      assigneeId: "x",
      dueDate: "x",
    };
    expect(parseNewTask(allWrong)).toMatchObject({ field: "title" });
    expect(parseNewTask({ ...allWrong, title: "제목" })).toMatchObject({ field: "description" });
    expect(parseNewTask({ ...allWrong, title: "제목", description: "" })).toMatchObject({
      field: "assigneeId",
    });
    expect(
      parseNewTask({ ...allWrong, title: "제목", description: "", assigneeId: "" }),
    ).toMatchObject({ field: "dueDate" });
  });

  it("객체가 아닌 입력이나 제목이 빠진 입력은 제목 칸에서 걸린다", () => {
    for (const input of [null, undefined, "제목", 42, {}])
      expect(parseNewTask(input), JSON.stringify(input)).toMatchObject({
        ok: false,
        field: "title",
      });
  });
});

describe("parseTaskEdit", () => {
  it("추가의 칸에 상태를 더해 돌려준다", () => {
    expect(
      parseTaskEdit({
        title: " 고친 제목 ",
        status: "in_progress",
        assigneeId: ME,
        dueDate: "2026-10-21",
      }),
    ).toEqual({
      ok: true,
      task: {
        title: "고친 제목",
        description: null,
        assigneeId: ME,
        dueDate: "2026-10-21",
        status: "in_progress",
      },
    });
  });

  it("상태가 셋 중 하나가 아니면 상태를 고르라고 한다", () => {
    for (const status of [undefined, "", "archived", "DONE"])
      expect(parseTaskEdit({ title: "제목", status })).toEqual({
        ok: false,
        field: "status",
        message: "상태를 고르세요",
      });
  });

  it("상태는 다른 칸을 본 뒤에 본다", () => {
    expect(parseTaskEdit({ title: "", status: "x" })).toMatchObject({ field: "title" });
  });
});

describe("parseId·parseStatus·toStatus", () => {
  it("id 는 uuid 형식만 받는다", () => {
    expect(parseId(ORG_ID)).toEqual({ ok: true, id: ORG_ID });
    for (const input of ["acme", "", undefined, null, 1])
      expect(parseId(input)).toEqual({ ok: false });
  });

  it("상태는 셋 중 하나만 받는다", () => {
    expect(parseStatus("done")).toEqual({ ok: true, status: "done" });
    expect(parseStatus("archived")).toEqual({ ok: false });
  });

  it("DB 가 돌려준 상태가 셋 중 하나가 아니면 스키마와 코드가 어긋난 것이라 던진다", () => {
    expect(toStatus("in_progress")).toBe("in_progress");
    expect(() => toStatus("archived")).toThrow("알 수 없는 작업 상태입니다: archived");
  });
});

describe("parseTaskListQuery", () => {
  const MEMBERS = [ME, OTHER];

  it("비어 있으면 전체·최근 만든 순·1쪽이다", () => {
    expect(parseTaskListQuery({}, MEMBERS)).toEqual({
      status: null,
      assignee: null,
      sort: "created",
      page: 1,
    });
  });

  it("올바른 상태·멤버 담당자·담당자 없음·마감일 순·쪽을 읽는다", () => {
    expect(
      parseTaskListQuery(
        { status: "in_progress", assignee: OTHER, sort: "due", page: "3" },
        MEMBERS,
      ),
    ).toEqual({ status: "in_progress", assignee: OTHER, sort: "due", page: 3 });
    expect(parseTaskListQuery({ assignee: "none" }, MEMBERS)).toMatchObject({ assignee: "none" });
  });

  it("잘못된 값은 그 조건만 기본값이다 — 없는 상태, 멤버가 아닌 담당자, 모르는 정렬", () => {
    expect(
      parseTaskListQuery({ status: "archived", assignee: LEFT, sort: "title", page: "2" }, MEMBERS),
    ).toEqual({ status: null, assignee: null, sort: "created", page: 2 });
  });

  it("쪽은 1부터 시작하는 자연수만 받는다", () => {
    for (const page of ["0", "-1", "1.5", "01", "abc", "", "1e3", "9999999"])
      expect(parseTaskListQuery({ page }, MEMBERS).page, page).toBe(1);
    expect(parseTaskListQuery({ page: "999999" }, MEMBERS).page).toBe(999999);
  });

  it("같은 이름이 여럿이면 첫 값만 본다", () => {
    expect(
      parseTaskListQuery(
        { status: ["done", "todo"], assignee: [OTHER, ME], page: ["2", "5"] },
        MEMBERS,
      ),
    ).toMatchObject({ status: "done", assignee: OTHER, page: 2 });
  });
});

describe("isDefaultFilters·pageCountOf", () => {
  it("상태·담당자·정렬이 모두 기본일 때만 기본 조건이다", () => {
    expect(isDefaultFilters({ status: null, assignee: null, sort: "created" })).toBe(true);
    expect(isDefaultFilters({ status: "done", assignee: null, sort: "created" })).toBe(false);
    expect(isDefaultFilters({ status: null, assignee: "none", sort: "created" })).toBe(false);
    expect(isDefaultFilters({ status: null, assignee: null, sort: "due" })).toBe(false);
  });

  it("쪽 수는 20개씩 올림이고, 작업이 없어도 1쪽이다", () => {
    expect(pageCountOf(0)).toBe(1);
    expect(pageCountOf(20)).toBe(1);
    expect(pageCountOf(21)).toBe(2);
    expect(pageCountOf(57)).toBe(3);
  });
});

describe("날짜·시각 표기", () => {
  it("서울 날짜는 UTC 15시에 바뀐다", () => {
    expect(seoulDate(new Date("2026-10-13T14:59:59.999Z"))).toBe("2026-10-13");
    expect(seoulDate(new Date("2026-10-13T15:00:00.000Z"))).toBe("2026-10-14");
    expect(seoulDate(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });

  it("월·일 표기는 앞의 0 을 뺀다", () => {
    expect(formatMonthDay("2026-10-21")).toBe("10. 21.");
    expect(formatMonthDay("2027-01-05")).toBe("1. 5.");
  });

  it("올해면 월·일, 다른 해면 연도까지 쓴다", () => {
    expect(formatDay("2026-10-21", "2026-10-14")).toBe("10. 21.");
    expect(formatDay("2027-01-05", "2026-10-14")).toBe("2027. 1. 5.");
    expect(formatDay("2025-12-31", "2026-01-01")).toBe("2025. 12. 31.");
  });

  it("시각은 서울 시간의 오전·오후 표기다", () => {
    expect(formatDateTime("2026-10-14T06:00:00.000Z")).toBe("2026. 10. 14. 오후 3:00");
    expect(formatDateTime("2026-10-13T15:05:00.000Z")).toBe("2026. 10. 14. 오전 12:05");
  });
});

describe("dueStateOf", () => {
  const TODAY = "2026-10-14";

  it("마감일이 없으면 none 이다(완료여도)", () => {
    expect(dueStateOf("todo", null, TODAY)).toBe("none");
    expect(dueStateOf("done", null, TODAY)).toBe("none");
  });

  it("열린 작업은 마감일이 오늘보다 이르면 지남, 오늘이면 오늘, 늦으면 later 다", () => {
    expect(dueStateOf("todo", "2026-10-13", TODAY)).toBe("overdue");
    expect(dueStateOf("in_progress", "2026-10-14", TODAY)).toBe("today");
    expect(dueStateOf("todo", "2026-10-15", TODAY)).toBe("later");
    expect(dueStateOf("todo", "2025-12-31", TODAY)).toBe("overdue");
  });

  it("완료된 작업은 지나도 지남을 붙이지 않는다", () => {
    expect(dueStateOf("done", "2026-10-01", TODAY)).toBe("done");
    expect(dueStateOf("done", "2026-10-14", TODAY)).toBe("done");
  });
});

describe("toAssigneeOptions", () => {
  it("나 먼저, 그다음 이름 가나다순이다 — 이름은 표시 이름, 없으면 이메일 @ 앞", () => {
    const members: TaskMemberRow[] = [
      { userId: OTHER, displayName: "하늘", email: "sky@example.com" },
      { userId: LEFT, displayName: null, email: "garam@example.com" },
      { userId: ME, displayName: "홍길동", email: "me@example.com" },
      { userId: "u4", displayName: "가람", email: null },
    ];
    expect(toAssigneeOptions(members, ME)).toEqual([
      { id: ME, name: "홍길동", isMe: true },
      { id: "u4", name: "가람", isMe: false },
      { id: OTHER, name: "하늘", isMe: false },
      { id: LEFT, name: "garam", isMe: false },
    ]);
  });

  it("멤버가 없으면 빈 목록이다", () => {
    expect(toAssigneeOptions([], ME)).toEqual([]);
  });
});

describe("toTaskView", () => {
  const TODAY = "2026-10-14";

  it("화면이 그리는 모양으로 바꾼다 — 상태 글자, 마감일 표기와 상태, 담당자, 만든 사람, 시각 표기", () => {
    expect(
      toTaskView(
        taskRow({
          description: "금요일까지",
          status: "in_progress",
          due_date: "2026-10-12",
          assignee_id: OTHER,
          created_by: OTHER,
        }),
        { scope: scope(), today: TODAY, names: NAMES },
      ),
    ).toEqual({
      id: "t1",
      title: "회의록 공유",
      description: "금요일까지",
      status: "in_progress",
      statusLabel: "진행 중",
      dueDate: "2026-10-12",
      dueText: "10. 12.",
      dueState: "overdue",
      assignee: { id: OTHER, name: "김철수", isMe: false },
      createdAt: "2026-10-14T06:00:00.000Z",
      createdAtText: "2026. 10. 14. 오후 3:00",
      creatorName: "김철수",
      isMine: false,
      completedAt: null,
      completedAtText: null,
      canDelete: false,
    });
  });

  it("내가 만든 작업은 member 여도 지울 수 있고, owner 는 남이 만든 작업도 지울 수 있다", () => {
    const context = { today: TODAY, names: NAMES };
    expect(toTaskView(taskRow({ created_by: ME }), { ...context, scope: scope() })).toMatchObject({
      isMine: true,
      canDelete: true,
    });
    expect(
      toTaskView(taskRow({ created_by: OTHER }), { ...context, scope: scope() }),
    ).toMatchObject({ isMine: false, canDelete: false });
    expect(
      toTaskView(taskRow({ created_by: OTHER }), { ...context, scope: scope({ isOwner: true }) }),
    ).toMatchObject({ isMine: false, canDelete: true });
  });

  it("만든 사람이 떠났거나 계정이 지워졌으면 만든 사람 이름은 null 이고(떠난 멤버), 내 것도 아니다", () => {
    const context = { scope: scope(), today: TODAY, names: NAMES };
    expect(toTaskView(taskRow({ created_by: LEFT }), context)).toMatchObject({
      creatorName: null,
      isMine: false,
      canDelete: false,
    });
    expect(toTaskView(taskRow({ created_by: null }), context)).toMatchObject({
      creatorName: null,
      isMine: false,
      canDelete: false,
    });
  });

  it("담당자가 나면 isMe 이고, 없으면 null 이다", () => {
    const context = { scope: scope(), today: TODAY, names: NAMES };
    expect(toTaskView(taskRow({ assignee_id: ME }), context).assignee).toEqual({
      id: ME,
      name: "홍길동",
      isMe: true,
    });
    expect(toTaskView(taskRow({ assignee_id: null }), context).assignee).toBeNull();
  });

  it("완료된 작업은 완료 시각을 쓰고, 지난 마감일에도 지남을 붙이지 않는다", () => {
    expect(
      toTaskView(
        taskRow({
          status: "done",
          due_date: "2026-10-01",
          completed_at: "2026-10-13T15:05:00.000Z",
        }),
        { scope: scope(), today: TODAY, names: NAMES },
      ),
    ).toMatchObject({
      statusLabel: "완료",
      dueText: "10. 1.",
      dueState: "done",
      completedAt: "2026-10-13T15:05:00.000Z",
      completedAtText: "2026. 10. 14. 오전 12:05",
    });
  });

  it("다른 해의 마감일은 연도까지 쓰고, 마감일이 없으면 표기도 없다", () => {
    const context = { scope: scope(), today: TODAY, names: NAMES };
    expect(toTaskView(taskRow({ due_date: "2027-01-05" }), context)).toMatchObject({
      dueText: "2027. 1. 5.",
      dueState: "later",
    });
    expect(toTaskView(taskRow({ due_date: null }), context)).toMatchObject({
      dueDate: null,
      dueText: null,
      dueState: "none",
    });
  });

  it("DB 가 모르는 상태를 돌려주면 던진다", () => {
    expect(() =>
      toTaskView(taskRow({ status: "archived" }), { scope: scope(), today: TODAY, names: NAMES }),
    ).toThrow("알 수 없는 작업 상태입니다");
  });
});

describe("toTaskDashboard", () => {
  const DATES = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const stats = (overrides: Partial<TaskStatsRow> = {}): TaskStatsRow => ({
    today: "2026-10-14",
    week_start: "2026-10-12",
    open_count: 4,
    overdue_count: 1,
    completed_this_week: 2,
    my_open_count: 3,
    daily_dates: DATES,
    daily_added: DATES.map((_, i) => i),
    daily_completed: DATES.map((_, i) => (i === 13 ? 5 : 0)),
    ...overrides,
  });

  it("집계 함수의 수치를 그대로 옮기고(앱에서 세지 않는다) 14칸 차트와 기한 표를 만든다", () => {
    const dashboard = toTaskDashboard(
      stats(),
      [taskRow({ id: "d1", due_date: "2026-10-13", assignee_id: ME })],
      { scope: scope(), names: NAMES },
    );
    expect(dashboard.counts).toEqual({ open: 4, overdue: 1, completedThisWeek: 2, mine: 3 });
    expect(dashboard.today).toBe("2026-10-14");
    expect(dashboard.weekStart).toBe("2026-10-12");
    expect(dashboard.weekStartLabel).toBe("10. 12.");
    expect(dashboard.daily).toHaveLength(14);
    expect(dashboard.daily[0]).toEqual({
      date: "2026-10-01",
      label: "10. 1.",
      added: 0,
      completed: 0,
    });
    expect(dashboard.daily[13]).toEqual({
      date: "2026-10-14",
      label: "10. 14.",
      added: 13,
      completed: 5,
    });
    expect(dashboard.dueSoon.map((task) => [task.id, task.dueState, task.assignee?.isMe])).toEqual([
      ["d1", "overdue", true],
    ]);
  });

  it("기한 표의 지남·오늘은 집계 함수가 쓴 서울 날짜로 가른다", () => {
    const dashboard = toTaskDashboard(
      stats({ today: "2026-10-13" }),
      [taskRow({ id: "d1", due_date: "2026-10-13" })],
      { scope: scope(), names: NAMES },
    );
    expect(dashboard.dueSoon[0].dueState).toBe("today");
  });

  it("작업이 없으면 수치는 0 이고 기한 표는 비어 있다", () => {
    const empty = toTaskDashboard(
      stats({
        open_count: 0,
        overdue_count: 0,
        completed_this_week: 0,
        my_open_count: 0,
        daily_added: DATES.map(() => 0),
        daily_completed: DATES.map(() => 0),
      }),
      [],
      { scope: scope(), names: NAMES },
    );
    expect(empty.counts).toEqual({ open: 0, overdue: 0, completedThisWeek: 0, mine: 0 });
    expect(empty.daily.every((day) => day.added === 0 && day.completed === 0)).toBe(true);
    expect(empty.dueSoon).toEqual([]);
  });
});

describe("입찰 프로젝트 체크리스트 모델", () => {
  it("formFieldsOf 는 FormData 의 글자 칸만 객체로 옮기고, 객체는 그대로 둔다", () => {
    const form = new FormData();
    form.set("title", "제안서");
    form.set("dueDate", "2026-10-28");
    form.set("file", new Blob(["x"]), "x.txt");
    expect(formFieldsOf(form)).toEqual({ title: "제안서", dueDate: "2026-10-28" });
    const plain = { title: "그대로" };
    expect(formFieldsOf(plain)).toBe(plain);
  });

  it("toChecklistView 의 지우기 표시는 만든 사람이 아니라 canManage 다", () => {
    const context = { today: "2026-10-14", names: NAMES };
    const manager = { orgId: ORG_ID, userId: ME, canManage: true };
    const reader = { orgId: ORG_ID, userId: ME, canManage: false };
    expect(
      toChecklistView(taskRow({ created_by: OTHER }), { ...context, scope: manager }).canDelete,
    ).toBe(true);
    expect(
      toChecklistView(taskRow({ created_by: ME }), { ...context, scope: reader }).canDelete,
    ).toBe(false);
    expect(
      toChecklistView(taskRow({ created_by: ME }), { ...context, scope: reader }),
    ).toMatchObject({
      isMine: true,
      title: "회의록 공유",
    });
  });

  it("권한 없음 결과는 고정 문구를 싣는다", () => {
    expect(checklistForbidden()).toEqual({
      status: "forbidden",
      message: CHECKLIST_FORBIDDEN_MESSAGE,
    });
    expect(CHECKLIST_FORBIDDEN_MESSAGE).toBe("체크리스트를 고칠 권한이 없습니다");
  });
});
