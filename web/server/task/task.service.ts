import "server-only";
import {
  type AddTaskResult,
  type AssigneeOption,
  type ChangeTaskStatusResult,
  type DeleteTaskResult,
  DUE_SOON_COUNT,
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
  toAssigneeOptions,
  toTaskDashboard,
  toTaskView,
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
