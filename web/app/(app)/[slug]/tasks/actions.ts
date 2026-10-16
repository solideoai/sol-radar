"use server";

import { requireCompleteEmployment } from "@/app/(app)/employment-guard";

import { refresh } from "next/cache";
import {
  type AddTaskResult,
  addTask,
  type ChangeTaskStatusResult,
  changeTaskStatus,
  type DeleteTaskResult,
  deleteTask,
  updateTask,
  type UpdateTaskResult,
} from "@/server/task";

// 얇게 둔다 — 검증·로그인 확인·저장은 도메인(@/server/task)이, 누가 읽고 쓰고 지우는지는 RLS 가 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다(조직 id 도 마찬가지다).
// 저장했거나 화면이 낡았으면 서버 컴포넌트를 다시 그린다 — 조직에서 빠졌으면 다시 그린 화면이 404 다.
// 입력 오류·로그인 풀림은 다시 그려도 달라지는 것이 없어 그리지 않는다.
const isStale = (status: string) => status !== "invalid" && status !== "signed-out";

export async function createTask(orgId: unknown, input: unknown): Promise<AddTaskResult> {
  await requireCompleteEmployment("/memos");
  const result = await addTask(orgId, input);
  if (isStale(result.status)) refresh();
  return result;
}

export async function saveTask(
  orgId: unknown,
  taskId: unknown,
  input: unknown,
): Promise<UpdateTaskResult> {
  await requireCompleteEmployment("/memos");
  const result = await updateTask(orgId, taskId, input);
  if (isStale(result.status)) refresh();
  return result;
}

export async function changeStatus(
  orgId: unknown,
  taskId: unknown,
  status: unknown,
): Promise<ChangeTaskStatusResult> {
  await requireCompleteEmployment("/memos");
  const result = await changeTaskStatus(orgId, taskId, status);
  if (isStale(result.status)) refresh();
  return result;
}

export async function removeTask(orgId: unknown, taskId: unknown): Promise<DeleteTaskResult> {
  await requireCompleteEmployment("/memos");
  const result = await deleteTask(orgId, taskId);
  if (isStale(result.status)) refresh();
  return result;
}
