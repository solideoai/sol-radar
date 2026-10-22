import "server-only";
import { z } from "zod";
import type { Database, Tables } from "@/lib/database.types";
import { nameOf } from "@/server/shared";

// ── 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 작업은 조직에 속한다. 누가 읽고 쓰고 지우는지는 DB 정책(마이그레이션 20261014000004)이 정한다.

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  done: "완료",
};

// "created" 는 최근 만든 순(기본), "due" 는 마감일 순(없는 것은 맨 뒤, 같으면 최근 만든 순).
export type TaskSort = "created" | "due";

export const TASK_PAGE_SIZE = 20;

export const DUE_SOON_COUNT = 5;

export type TaskRow = Pick<
  Tables<"tasks">,
  | "id"
  | "title"
  | "description"
  | "status"
  | "due_date"
  | "assignee_id"
  | "created_by"
  | "completed_at"
  | "created_at"
>;

export type TaskMemberRow = { userId: string; displayName: string | null; email: string | null };

export type TaskStatsRow =
  Database["public"]["Functions"]["task_dashboard_stats"]["Returns"][number];

// 화면이 조직 도메인의 지금 조직에서 만들어 넘긴다. 도메인끼리는 부르지 않는다(lodestar).
export type TaskScope = {
  orgId: string;
  userId: string;
  // owner 는 조직의 작업을 모두 지운다(DB 정책과 같다).
  isOwner: boolean;
};

export type AssigneeOption = { id: string; name: string; isMe: boolean };

// 열린 작업만 지남·오늘을 붙인다. 완료된 작업은 지나도 "지남"을 붙이지 않는다.
export type DueState = "overdue" | "today" | "later" | "done" | "none";

// 권한은 DB 가 강제하고, canDelete 는 "삭제" 항목을 보일지만 정한다.
export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  statusLabel: string;
  // 서울 날짜 "YYYY-MM-DD" 와 그 표기. 없으면 둘 다 null.
  dueDate: string | null;
  dueText: string | null;
  dueState: DueState;
  // 담당자는 늘 지금 멤버다(복합 외래 키). 없으면 null.
  assignee: { id: string; name: string; isMe: boolean } | null;
  createdAt: string;
  createdAtText: string;
  // 만든 사람이 지금 멤버가 아니거나(떠남) 계정이 지워졌으면 null — 화면은 "떠난 멤버"로 쓴다.
  creatorName: string | null;
  isMine: boolean;
  completedAt: string | null;
  completedAtText: string | null;
  canDelete: boolean;
};

// assignee 는 null(전체)·"none"(담당자 없음)·멤버 id 다.
export type TaskListFilters = {
  status: TaskStatus | null;
  assignee: string | null;
  sort: TaskSort;
};

export type TaskListQuery = TaskListFilters & { page: number };

export type TaskListPage = {
  rows: TaskView[];
  // 지금 조건에 맞는 작업 수(모든 쪽).
  total: number;
  // 실제로 보인 쪽. 요청한 쪽이 범위를 넘었으면 1 이다.
  page: number;
  // 작업이 없어도 1 이다.
  pageCount: number;
  pageSize: number;
  // 잘못된 값은 기본값으로 바꾼 조건.
  filters: TaskListFilters;
  // 처음 빈 상태와 "조건 지우기"를 가른다.
  isDefaultQuery: boolean;
  members: AssigneeOption[];
  // 마감일 상태를 가른 서울 날짜 "YYYY-MM-DD".
  today: string;
};

// date 는 서울 날짜 "YYYY-MM-DD", label 은 칸 글자("10. 13.").
export type TaskDayCount = { date: string; label: string; added: number; completed: number };

export type TaskDashboard = {
  counts: { open: number; overdue: number; completedThisWeek: number; mine: number };
  // 집계 함수가 쓴 서울 날짜와 그 주 월요일("YYYY-MM-DD"), 월요일의 표기("10. 12.").
  today: string;
  weekStart: string;
  weekStartLabel: string;
  // 오래된 날부터 오늘까지 14칸.
  daily: TaskDayCount[];
  // 마감일이 있는 열린 작업, 마감일 순(지난 것이 먼저)으로 DUE_SOON_COUNT 개까지.
  dueSoon: TaskView[];
};

// ── 쓰기 결과 ──
// 예상한 실패는 던지지 않고 값으로 돌려준다.
//   signed-out           로그인이 풀렸다
//   not-in-org           내가 그 조직의 멤버가 아니다(그새 빠졌다). 화면을 새로 그리면 404 다
//   assignee-not-member  담당자가 그 조직의 멤버가 아니다(DB 의 복합 외래 키가 거절했다)
//   gone                 작업이 그새 지워졌다
//   forbidden            작업은 보이지만 지울 권한이 없다(만든 사람도 owner 도 아니다)
//   invalid              입력이 틀렸다. field 는 그 칸이다

export type TaskField = "title" | "description" | "status" | "dueDate" | "assigneeId";

export type AddTaskResult =
  | { status: "saved" }
  | { status: "signed-out" }
  | { status: "not-in-org" }
  | { status: "assignee-not-member" }
  | { status: "invalid"; field: TaskField; message: string };

export type UpdateTaskResult = AddTaskResult | { status: "gone" };

export type ChangeTaskStatusResult =
  { status: "saved" } | { status: "signed-out" } | { status: "not-in-org" } | { status: "gone" };

export type DeleteTaskResult =
  | { status: "deleted" }
  | { status: "signed-out" }
  | { status: "not-in-org" }
  | { status: "gone" }
  | { status: "forbidden" };

// ── 입찰 프로젝트 체크리스트(P1 N6) ──
// 체크리스트는 bid_project_id 가 있는 작업이다(M11). 쓰기(넣기·고치기·지우기)는 restrictive 정책이 ADMIN·SALES 만 연다(M13,
// 마이그레이션 20261022000300). canManage 는 화면이 sol_role 로 정해 넘긴다. 지우기 표시만 정하고 권한은 DB 가 강제한다.
export type ChecklistScope = { orgId: string; userId: string; canManage: boolean };

export const CHECKLIST_FORBIDDEN_MESSAGE = "체크리스트를 고칠 권한이 없습니다";
// 정책이 거절했다(멤버이지만 ADMIN·SALES 가 아니다). 던지지 않고 이 값으로 돌려준다.
export type ChecklistForbidden = { status: "forbidden"; message: string };
export const checklistForbidden = (): ChecklistForbidden => ({
  status: "forbidden",
  message: CHECKLIST_FORBIDDEN_MESSAGE,
});

// gone: 프로젝트(넣기) 또는 항목(고치기·지우기)이 그새 없어졌거나 다른 조직의 것이다.
export type AddChecklistItemResult = AddTaskResult | ChecklistForbidden | { status: "gone" };
export type UpdateChecklistItemResult = UpdateTaskResult | ChecklistForbidden;
export type ToggleChecklistItemResult = ChangeTaskStatusResult | ChecklistForbidden;
export type DeleteChecklistItemResult =
  Exclude<DeleteTaskResult, { status: "forbidden" }> | ChecklistForbidden;

// 서버 함수는 객체(TaskFormDialog)로도 FormData(폼 action)로도 불릴 수 있다. 칸 이름은 같다.
export function formFieldsOf(input: unknown): unknown {
  if (!(input instanceof FormData)) return input;
  return Object.fromEntries(
    [...input.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

// ── 입력 규칙 ──
// 같은 규칙을 DB 제약(tasks_title_check·tasks_description_check·tasks_status_check)이 한 번 더 지킨다.

export function parseId(input: unknown): { ok: true; id: string } | { ok: false } {
  const parsed = z.uuid().safeParse(input);
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false };
}

const statusSchema = z.enum(TASK_STATUSES, "상태를 고르세요");

export function parseStatus(input: unknown): { ok: true; status: TaskStatus } | { ok: false } {
  const parsed = statusSchema.safeParse(input);
  return parsed.success ? { ok: true, status: parsed.data } : { ok: false };
}

const blankToEmpty = (value: unknown): unknown => value ?? "";

const titleSchema = z
  .string("제목은 글자여야 합니다")
  .trim()
  .min(1, "제목을 입력하세요")
  .max(120, "제목은 120자 이하입니다");

const descriptionSchema = z.preprocess(
  blankToEmpty,
  z
    .string("설명은 글자여야 합니다")
    .trim()
    .max(2000, "설명은 2000자 이하입니다")
    .transform((value) => (value === "" ? null : value)),
);

// 0000년은 PostgreSQL 이 받지 않는다.
const dueDateSchema = z.preprocess(
  blankToEmpty,
  z.union([
    z.literal("").transform(() => null),
    z.iso
      .date("마감일 형식이 아닙니다")
      .refine((value) => !value.startsWith("0000"), "마감일 형식이 아닙니다"),
  ]),
);

// 멤버인지는 DB 의 외래 키가 본다.
const assigneeSchema = z.preprocess(
  blankToEmpty,
  z.union([z.literal(["", "none"]).transform(() => null), z.uuid("담당자를 다시 고르세요")]),
);

export type TaskInput = {
  title: string;
  description: string | null;
  dueDate: string | null;
  assigneeId: string | null;
};

export type TaskEdit = TaskInput & { status: TaskStatus };

type Parsed<T> = { ok: true; task: T } | { ok: false; field: TaskField; message: string };

// 객체가 아닌 입력은 빈 객체로 본다. 그러면 칸마다 "비어 있음"으로 걸린다.
const fieldsSchema = z.record(z.string(), z.unknown()).catch({});

const invalid = (field: TaskField, error: z.ZodError) =>
  ({ ok: false, field, message: error.issues[0].message }) as const;

// 새 작업은 "할 일"로 시작한다. 틀린 칸이 여럿이면 화면 순서(제목 → 설명 → 담당자 → 마감일)로 첫 칸 하나를 알린다.
export function parseNewTask(input: unknown): Parsed<TaskInput> {
  const raw = fieldsSchema.parse(input);
  const title = titleSchema.safeParse(raw.title);
  if (!title.success) return invalid("title", title.error);
  const description = descriptionSchema.safeParse(raw.description);
  if (!description.success) return invalid("description", description.error);
  const assignee = assigneeSchema.safeParse(raw.assigneeId);
  if (!assignee.success) return invalid("assigneeId", assignee.error);
  const dueDate = dueDateSchema.safeParse(raw.dueDate);
  if (!dueDate.success) return invalid("dueDate", dueDate.error);
  return {
    ok: true,
    task: {
      title: title.data,
      description: description.data,
      assigneeId: assignee.data,
      dueDate: dueDate.data,
    },
  };
}

export function parseTaskEdit(input: unknown): Parsed<TaskEdit> {
  const base = parseNewTask(input);
  if (!base.ok) return base;
  const status = statusSchema.safeParse(fieldsSchema.parse(input).status);
  if (!status.success) return invalid("status", status.error);
  return { ok: true, task: { ...base.task, status: status.data } };
}

// 같은 이름이 여럿이면 첫 값만 본다.
type QueryValue = string | string[] | undefined;
const firstOf = (value: QueryValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PAGE_PATTERN = /^[1-9]\d{0,5}$/;

// 잘못된 값(없는 상태·멤버가 아닌 담당자·숫자가 아닌 쪽)은 그 조건만 기본값이다.
// 쪽이 범위를 넘는지는 개수를 세 봐야 알므로 서비스가 본다.
export function parseTaskListQuery(
  query: Readonly<Record<string, QueryValue>>,
  memberIds: readonly string[],
): TaskListQuery {
  const status = parseStatus(firstOf(query.status));
  const assignee = firstOf(query.assignee);
  const page = firstOf(query.page);
  return {
    status: status.ok ? status.status : null,
    assignee:
      assignee === "none" || (assignee !== undefined && memberIds.includes(assignee))
        ? assignee
        : null,
    sort: firstOf(query.sort) === "due" ? "due" : "created",
    page: page !== undefined && PAGE_PATTERN.test(page) ? Number(page) : 1,
  };
}

export const isDefaultFilters = (filters: TaskListFilters): boolean =>
  filters.status === null && filters.assignee === null && filters.sort === "created";

export const pageCountOf = (total: number): number =>
  Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));

// ── 날짜·시각 표기 ──
// 서버의 시간대(UTC)와 상관없이 서울로 가른다. 오전 9시 전의 일이 전날로 가지 않게 한다.

const seoulDateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Seoul",
});

export function seoulDate(instant: Date): string {
  const parts = seoulDateFormat.formatToParts(instant);
  const read = (type: "year" | "month" | "day"): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

// 브라우저의 ko-KR 숫자 날짜와 같은 모양("10. 21.")이다.
export function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}. ${Number(day)}.`;
}

export function formatDay(date: string, today: string): string {
  const year = date.slice(0, 4);
  return year === today.slice(0, 4)
    ? formatMonthDay(date)
    : `${Number(year)}. ${formatMonthDay(date)}`;
}

const dateTimeFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export const formatDateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));

// 날짜끼리는 "YYYY-MM-DD" 글자로 견줘도 순서가 같다.
export function dueStateOf(status: TaskStatus, dueDate: string | null, today: string): DueState {
  if (dueDate === null) return "none";
  if (status === "done") return "done";
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "later";
}

// status 는 DB 제약이 셋으로 묶는다. 다른 값이 오면 스키마와 코드가 어긋난 것이라 던진다.
export function toStatus(value: string): TaskStatus {
  const parsed = parseStatus(value);
  if (!parsed.ok) throw new Error(`알 수 없는 작업 상태입니다: ${value}`);
  return parsed.status;
}

// ── 화면 모양 ──

export const memberNames = (members: readonly TaskMemberRow[]): ReadonlyMap<string, string> =>
  new Map(members.map((member) => [member.userId, nameOf(member.displayName, member.email)]));

export const toAssigneeOptions = (
  members: readonly TaskMemberRow[],
  userId: string,
): AssigneeOption[] =>
  members
    .map((member) => ({
      id: member.userId,
      name: nameOf(member.displayName, member.email),
      isMe: member.userId === userId,
    }))
    .toSorted((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name, "ko") : a.isMe ? -1 : 1));

export type TaskViewContext = {
  scope: TaskScope;
  // 서울 날짜 "YYYY-MM-DD". 마감일 상태와 표기(올해인지)를 가른다.
  today: string;
  names: ReadonlyMap<string, string>;
};

export function toTaskView(row: TaskRow, { scope, today, names }: TaskViewContext): TaskView {
  const status = toStatus(row.status);
  const isMine = row.created_by === scope.userId;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status,
    statusLabel: TASK_STATUS_LABELS[status],
    dueDate: row.due_date,
    dueText: row.due_date === null ? null : formatDay(row.due_date, today),
    dueState: dueStateOf(status, row.due_date, today),
    assignee:
      row.assignee_id === null
        ? null
        : {
            id: row.assignee_id,
            // 외래 키가 지금 멤버만 받는다. 읽는 사이에 떠났다면 이름을 찾지 못한다.
            name: names.get(row.assignee_id) ?? "떠난 멤버",
            isMe: row.assignee_id === scope.userId,
          },
    createdAt: row.created_at,
    createdAtText: formatDateTime(row.created_at),
    creatorName: row.created_by === null ? null : (names.get(row.created_by) ?? null),
    isMine,
    completedAt: row.completed_at,
    completedAtText: row.completed_at === null ? null : formatDateTime(row.completed_at),
    canDelete: scope.isOwner || isMine,
  };
}

// 체크리스트 줄. 지우기 표시는 만든 사람이 아니라 역할로 정한다 — 프로젝트 행은 ADMIN·SALES 가 누가 만든 행이든 지우고,
// 다른 역할은 자기가 만든 행도 못 지운다(마이그레이션 20261022000300 의 체크리스트 삭제 정책).
export function toChecklistView(
  row: TaskRow,
  { scope, today, names }: Omit<TaskViewContext, "scope"> & { scope: ChecklistScope },
): TaskView {
  const view = toTaskView(row, {
    scope: { orgId: scope.orgId, userId: scope.userId, isOwner: false },
    today,
    names,
  });
  return { ...view, canDelete: scope.canManage };
}

// 수치는 DB 가 셌다 — 여기서는 세지 않는다.
export function toTaskDashboard(
  stats: TaskStatsRow,
  dueSoon: readonly TaskRow[],
  context: Omit<TaskViewContext, "today">,
): TaskDashboard {
  const today = stats.today;
  return {
    counts: {
      open: stats.open_count,
      overdue: stats.overdue_count,
      completedThisWeek: stats.completed_this_week,
      mine: stats.my_open_count,
    },
    today,
    weekStart: stats.week_start,
    weekStartLabel: formatMonthDay(stats.week_start),
    daily: stats.daily_dates.map((date, index) => ({
      date,
      label: formatMonthDay(date),
      added: stats.daily_added[index] ?? 0,
      completed: stats.daily_completed[index] ?? 0,
    })),
    dueSoon: dueSoon.map((row) => toTaskView(row, { ...context, today })),
  };
}
