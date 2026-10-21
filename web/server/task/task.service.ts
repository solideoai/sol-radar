import "server-only";
import {
  type AddChecklistItemResult,
  type AddTaskResult,
  type AssigneeOption,
  type ChangeTaskStatusResult,
  type ChecklistForbidden,
  type ChecklistScope,
  checklistForbidden,
  type DeleteChecklistItemResult,
  type DeleteTaskResult,
  DUE_SOON_COUNT,
  formFieldsOf,
  isDefaultFilters,
  memberNames,
  pageCountOf,
  parseId,
  parseNewTask,
  parseStatus,
  parseTaskEdit,
  parseTaskListQuery,
  seoulDate,
  TASK_PAGE_SIZE,
  type TaskDashboard,
  type TaskListPage,
  type TaskScope,
  type TaskView,
  toAssigneeOptions,
  toChecklistView,
  type ToggleChecklistItemResult,
  toTaskDashboard,
  toTaskView,
  type UpdateChecklistItemResult,
  type UpdateTaskResult,
} from "./task.model";
import { taskRepo, type TaskRepo } from "./task.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──
// 읽기는 조직 도메인이 확인한 지금 조직(scope)을 받는다 — 로그인·DB 연결·멤버인지는 그쪽이 이미 봤다.
// 쓰기는 화면 밖에서 직접 POST 로도 불리므로 조직 id 를 믿지 않는다: 그 조직의 멤버인지는 DB 정책이 다시 본다.

// 형식이 틀린 id 는 화면이 보낼 수 없는 값이다. 예상한 실패가 아니라 잘못된 호출이라 던진다.
function requireId(input: unknown, what: string): string {
  const parsed = parseId(input);
  if (!parsed.ok) throw new Error(`${what} id 형식이 올바르지 않습니다`);
  return parsed.id;
}

async function signedInUserId(repo: TaskRepo): Promise<string | null> {
  return repo.isConfigured() ? repo.currentUserId() : null;
}

// query 는 Next 의 searchParams 다. 범위를 넘은 쪽은 1쪽으로 본다.
// 기준 시각은 시험이 넘길 수 있다. 넘기지 않으면 목록을 읽은 뒤에 잰다.
export async function getTaskList(
  scope: TaskScope,
  query: Readonly<Record<string, string | string[] | undefined>>,
  repo: TaskRepo = taskRepo,
  now?: Date,
): Promise<TaskListPage> {
  const members = await repo.listMembers(scope.orgId);
  const parsed = parseTaskListQuery(
    query,
    members.map((member) => member.userId),
  );
  const { page: requested, ...filters } = parsed;
  const read = (page: number) =>
    repo.listPage(scope.orgId, filters, (page - 1) * TASK_PAGE_SIZE, TASK_PAGE_SIZE);
  const first = await read(requested);
  const page = first === "out-of-range" ? 1 : requested;
  const result = first === "out-of-range" ? await read(1) : first;
  // 1쪽은 범위를 넘을 수 없다(offset 0). 그래도 오면 저장과 코드가 어긋난 것이라 던진다.
  if (result === "out-of-range") throw new Error("작업 목록의 1쪽을 읽지 못했습니다");
  const today = seoulDate(now ?? new Date());
  const names = memberNames(members);
  return {
    rows: result.rows.map((row) => toTaskView(row, { scope, today, names })),
    total: result.total,
    page,
    pageCount: pageCountOf(result.total),
    pageSize: TASK_PAGE_SIZE,
    filters,
    isDefaultQuery: isDefaultFilters(filters),
    members: toAssigneeOptions(members, scope.userId),
    today,
  };
}

// 최근 활동은 활동 도메인이 따로 낸다. asOf 는 시험이 날짜 경계를 고정할 때만 넘긴다.
export async function getTaskDashboard(
  scope: TaskScope,
  repo: TaskRepo = taskRepo,
  asOf?: Date,
): Promise<TaskDashboard> {
  const [stats, dueSoon, members] = await Promise.all([
    repo.dashboardStats(scope.orgId, asOf?.toISOString()),
    repo.listDueSoon(scope.orgId, DUE_SOON_COUNT),
    repo.listMembers(scope.orgId),
  ]);
  return toTaskDashboard(stats, dueSoon, { scope, names: memberNames(members) });
}

export async function getTaskAssignees(
  scope: TaskScope,
  repo: TaskRepo = taskRepo,
): Promise<AssigneeOption[]> {
  return toAssigneeOptions(await repo.listMembers(scope.orgId), scope.userId);
}

export async function addTask(
  orgIdInput: unknown,
  input: unknown,
  repo: TaskRepo = taskRepo,
): Promise<AddTaskResult> {
  const orgId = requireId(orgIdInput, "조직");
  const parsed = parseNewTask(input);
  if (!parsed.ok) return { status: "invalid", field: parsed.field, message: parsed.message };
  if (!(await signedInUserId(repo))) return { status: "signed-out" };
  return { status: await repo.insert(orgId, parsed.task) };
}

async function missingReason(
  orgId: string,
  userId: string,
  repo: TaskRepo,
): Promise<"gone" | "not-in-org"> {
  return (await repo.isMember(orgId, userId)) ? "gone" : "not-in-org";
}

export async function updateTask(
  orgIdInput: unknown,
  idInput: unknown,
  input: unknown,
  repo: TaskRepo = taskRepo,
): Promise<UpdateTaskResult> {
  const orgId = requireId(orgIdInput, "조직");
  const id = requireId(idInput, "작업");
  const parsed = parseTaskEdit(input);
  if (!parsed.ok) return { status: "invalid", field: parsed.field, message: parsed.message };
  const userId = await signedInUserId(repo);
  if (!userId) return { status: "signed-out" };
  const result = await repo.update(orgId, id, parsed.task);
  return { status: result === "missing" ? await missingReason(orgId, userId, repo) : result };
}

// 화면은 세 값 중 하나만 보낸다 — 다른 값은 잘못된 호출이라 던진다.
export async function changeTaskStatus(
  orgIdInput: unknown,
  idInput: unknown,
  statusInput: unknown,
  repo: TaskRepo = taskRepo,
): Promise<ChangeTaskStatusResult> {
  const orgId = requireId(orgIdInput, "조직");
  const id = requireId(idInput, "작업");
  const status = parseStatus(statusInput);
  if (!status.ok) throw new Error("작업 상태 값이 올바르지 않습니다");
  const userId = await signedInUserId(repo);
  if (!userId) return { status: "signed-out" };
  const result = await repo.update(orgId, id, { status: status.status });
  // 상태만 바꾸므로 담당자 외래 키에 걸리지 않는다. 걸렸다면 저장과 코드가 어긋난 것이다.
  if (result === "assignee-not-member") throw new Error("상태만 바꿨는데 담당자가 거절됐습니다");
  return { status: result === "missing" ? await missingReason(orgId, userId, repo) : result };
}

export async function deleteTask(
  orgIdInput: unknown,
  idInput: unknown,
  repo: TaskRepo = taskRepo,
): Promise<DeleteTaskResult> {
  const orgId = requireId(orgIdInput, "조직");
  const id = requireId(idInput, "작업");
  const userId = await signedInUserId(repo);
  if (!userId) return { status: "signed-out" };
  if (await repo.deleteById(orgId, id)) return { status: "deleted" };
  // 아직 보이면 지울 권한이 없는 것이고(그새 member 로 바뀜 등), 안 보이면 이미 없거나 내가 빠졌다.
  if (await repo.isVisible(orgId, id)) return { status: "forbidden" };
  return { status: await missingReason(orgId, userId, repo) };
}

// ── 입찰 프로젝트 체크리스트(P1 N6, 계획 Task 3) ──
// 템플릿 검증(parseNewTask·parseTaskEdit)을 그대로 쓰고 bid_project_id 만 더한다.
// scope 는 화면이 업무 맥락(requireWork)에서 만든다 — 조직은 요청에서 받지 않는다(M17). 프로젝트·항목 id 는 화면이 보낸 값이라 검사한다.
// 쓰기 권한은 restrictive 정책이 정하고(ADMIN·SALES), 거절은 던지지 않고 "체크리스트를 고칠 권한이 없습니다" 결과다.

export async function listProjectChecklist(
  scope: ChecklistScope,
  projectId: string,
  repo: TaskRepo = taskRepo,
  now?: Date,
): Promise<TaskView[]> {
  const id = requireId(projectId, "프로젝트");
  const [rows, members] = await Promise.all([
    repo.listChecklist(scope.orgId, id),
    repo.listMembers(scope.orgId),
  ]);
  const today = seoulDate(now ?? new Date());
  const names = memberNames(members);
  return rows.map((row) => toChecklistView(row, { scope, today, names }));
}

// 넣기가 정책에 걸렸을 때: 아직 멤버면 역할이 막은 것이고, 아니면 내가 조직에서 빠졌다.
async function rejectedReason(
  scope: ChecklistScope,
  repo: TaskRepo,
): Promise<{ status: "not-in-org" } | ChecklistForbidden> {
  return (await repo.isMember(scope.orgId, scope.userId))
    ? checklistForbidden()
    : { status: "not-in-org" };
}

// 고치기·지우기가 0행일 때: 항목이 아직 보이면 정책이 걸렀고, 안 보이면 그새 지워졌거나 내가 빠졌다.
async function unchangedReason(
  scope: ChecklistScope,
  projectId: string,
  taskId: string,
  repo: TaskRepo,
): Promise<{ status: "gone" | "not-in-org" } | ChecklistForbidden> {
  if (await repo.isChecklistItemVisible(scope.orgId, projectId, taskId))
    return checklistForbidden();
  return { status: await missingReason(scope.orgId, scope.userId, repo) };
}

export async function addProjectChecklistItem(
  scope: ChecklistScope,
  projectIdInput: unknown,
  input: unknown,
  repo: TaskRepo = taskRepo,
): Promise<AddChecklistItemResult> {
  const projectId = requireId(projectIdInput, "프로젝트");
  const parsed = parseNewTask(formFieldsOf(input));
  if (!parsed.ok) return { status: "invalid", field: parsed.field, message: parsed.message };
  const result = await repo.insertChecklistItem(scope.orgId, projectId, parsed.task);
  if (result === "rls-rejected") return rejectedReason(scope, repo);
  if (result === "project-missing") return { status: "gone" };
  return { status: result };
}

export async function updateProjectChecklistItem(
  scope: ChecklistScope,
  projectIdInput: unknown,
  taskIdInput: unknown,
  input: unknown,
  repo: TaskRepo = taskRepo,
): Promise<UpdateChecklistItemResult> {
  const projectId = requireId(projectIdInput, "프로젝트");
  const taskId = requireId(taskIdInput, "작업");
  const parsed = parseTaskEdit(formFieldsOf(input));
  if (!parsed.ok) return { status: "invalid", field: parsed.field, message: parsed.message };
  const result = await repo.updateChecklistItem(scope.orgId, projectId, taskId, parsed.task);
  if (result === "missing") return unchangedReason(scope, projectId, taskId, repo);
  return { status: result };
}

// 체크 = 완료(done), 해제 = 할 일(todo). 화면은 불리언만 보낸다 — 다른 값은 잘못된 호출이라 던진다.
export async function toggleProjectChecklistItem(
  scope: ChecklistScope,
  projectIdInput: unknown,
  taskIdInput: unknown,
  done: unknown,
  repo: TaskRepo = taskRepo,
): Promise<ToggleChecklistItemResult> {
  const projectId = requireId(projectIdInput, "프로젝트");
  const taskId = requireId(taskIdInput, "작업");
  if (typeof done !== "boolean") throw new Error("체크리스트 완료 값이 올바르지 않습니다");
  const result = await repo.updateChecklistItem(scope.orgId, projectId, taskId, {
    status: done ? "done" : "todo",
  });
  if (result === "assignee-not-member") throw new Error("상태만 바꿨는데 담당자가 거절됐습니다");
  if (result === "missing") return unchangedReason(scope, projectId, taskId, repo);
  return { status: result };
}

export async function deleteProjectChecklistItem(
  scope: ChecklistScope,
  projectIdInput: unknown,
  taskIdInput: unknown,
  repo: TaskRepo = taskRepo,
): Promise<DeleteChecklistItemResult> {
  const projectId = requireId(projectIdInput, "프로젝트");
  const taskId = requireId(taskIdInput, "작업");
  if (await repo.deleteChecklistItem(scope.orgId, projectId, taskId)) return { status: "deleted" };
  return unchangedReason(scope, projectId, taskId, repo);
}
