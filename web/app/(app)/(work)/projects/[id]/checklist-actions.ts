"use server";
import { revalidatePath } from "next/cache";
import { requireWork } from "@/app/(app)/(work)/work";
import { canManageProjects } from "@/server/projects";
import {
  addProjectChecklistItem,
  toggleProjectChecklistItem,
  deleteProjectChecklistItem,
} from "@/server/task";

async function scopeOf(projectId: string) {
  const work = await requireWork(`/projects/${projectId}`);
  return { orgId: work.orgId, userId: work.userId, canManage: canManageProjects(work.role) };
}
export async function addChecklistItem(projectId: string, input: unknown) {
  const scope = await scopeOf(projectId);
  if (!scope.canManage)
    return { status: "forbidden", message: "체크리스트를 고칠 권한이 없습니다" } as const;
  const result = await addProjectChecklistItem(scope, projectId, input);
  if (result.status === "saved") revalidatePath(`/projects/${projectId}`);
  return result;
}
export async function toggleChecklistItem(projectId: string, itemId: string, done: boolean) {
  const scope = await scopeOf(projectId);
  if (!scope.canManage)
    return { status: "forbidden", message: "체크리스트를 고칠 권한이 없습니다" } as const;
  const result = await toggleProjectChecklistItem(scope, projectId, itemId, done);
  if (result.status === "saved") revalidatePath(`/projects/${projectId}`);
  return result;
}
export async function removeChecklistItem(projectId: string, itemId: string) {
  const scope = await scopeOf(projectId);
  if (!scope.canManage)
    return { status: "forbidden", message: "체크리스트를 고칠 권한이 없습니다" } as const;
  const result = await deleteProjectChecklistItem(scope, projectId, itemId);
  if (result.status === "deleted") revalidatePath(`/projects/${projectId}`);
  return result;
}
