import "server-only";
import { headers } from "next/headers";
import { businessLayoutNext, organizationStatePath } from "@/app/auth/employment-routing";
import { notFound, redirect } from "next/navigation";
import { requireCompleteEmployment } from "@/app/(app)/employment-guard";
import { cache } from "react";
import type { ActivityScope } from "@/server/activity";
import { loadMyProfile } from "@/app/_lib/my-account";
import { getMyWorkspace, type MyWorkspace } from "@/server/organization";
import type { TaskScope } from "@/server/task";

export type ReadyWorkspace = Extract<MyWorkspace, { status: "ready" }>;

// layout 과 화면이 같은 요청에서 함께 읽으므로 cache 로 요청 하나에 한 번만 읽는다
// (받은 초대 수는 지금 시각을 조건으로 읽어서 같은 요청이 자동으로 합쳐지지 않는다).
// 돌아올 곳을 받지 않으면(조직 첫 주소 /{slug}) 보완 뒤 업무 첫 화면(/dashboard)으로 간다. layout 의 기본값과 같다(Ruling 16).
export const loadWorkspace = cache(async (slug: string, next = "/dashboard") => {
  await requireCompleteEmployment(next);
  return getMyWorkspace(slug);
});

// 틀(layout)은 화면 실행을 막지 못하므로 화면마다 다시 확인한다: 멤버가 아닌 조직은 404, 로그인 전·DB 없음은 계정 화면으로.
// 정지된 사람은 정책이 어느 조직도 열지 않아 늘 not-found 다 — 404 대신 계정 화면의 정지 안내로 보낸다.
export async function requireWorkspace(
  slug: string,
  next = `/${slug}/dashboard`,
): Promise<ReadyWorkspace> {
  const path = businessLayoutNext((await headers()).get("x-sol-radar-path") || next, slug);
  await requireCompleteEmployment(path);
  const workspace = await loadWorkspace(slug, path);
  if (workspace.status === "no-org" || workspace.status === "multiple-orgs")
    redirect(organizationStatePath(path));
  if (workspace.status === "not-found") {
    if ((await loadMyProfile()).status === "suspended") redirect("/auth/login");
    notFound();
  }
  if (workspace.status !== "ready") redirect("/auth/login");
  return workspace;
}

// 도메인끼리는 부르지 않으므로(lodestar) 작업·활동 도메인에 넘길 조직 정보는 화면이 이어 준다.
export const taskScopeOf = (workspace: ReadyWorkspace): TaskScope => ({
  orgId: workspace.current.id,
  userId: workspace.userId,
  isOwner: workspace.current.myRole === "owner",
});

export const activityScopeOf = (workspace: ReadyWorkspace): ActivityScope => ({
  orgId: workspace.current.id,
});
