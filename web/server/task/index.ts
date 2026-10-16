import "server-only";

// ── 배럴: task 도메인의 공개 API. 바깥(app·components)은 @/server/task 만 부른다 ──
export {
  addTask,
  changeTaskStatus,
  deleteTask,
  getTaskAssignees,
  getTaskDashboard,
  getTaskList,
  updateTask,
} from "./task.service";
export { TASK_PAGE_SIZE, TASK_STATUS_LABELS, TASK_STATUSES } from "./task.model";
export type {
  AddTaskResult,
  AssigneeOption,
  ChangeTaskStatusResult,
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
  UpdateTaskResult,
} from "./task.model";
