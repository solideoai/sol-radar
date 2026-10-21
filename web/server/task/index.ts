import "server-only";

// ── 배럴: task 도메인의 공개 API. 바깥(app·components)은 @/server/task 만 부른다 ──
export {
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
export {
  CHECKLIST_FORBIDDEN_MESSAGE,
  TASK_PAGE_SIZE,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
} from "./task.model";
export type {
  AddChecklistItemResult,
  AddTaskResult,
  AssigneeOption,
  ChangeTaskStatusResult,
  ChecklistForbidden,
  ChecklistScope,
  DeleteChecklistItemResult,
  DeleteTaskResult,
  DueState,
  TaskDashboard,
  TaskDayCount,
  TaskField,
  TaskListFilters,
  TaskListPage,
  TaskScope,
  TaskSort,
  TaskStatus,
  TaskView,
  ToggleChecklistItemResult,
  UpdateChecklistItemResult,
  UpdateTaskResult,
} from "./task.model";
