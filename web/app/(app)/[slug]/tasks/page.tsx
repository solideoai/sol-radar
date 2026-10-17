import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { getTaskList } from "@/server/task";
import { requireWorkspace, taskScopeOf } from "@/app/(app)/[slug]/workspace";
import { AddTaskButton, TaskDialogsProvider } from "./task-dialogs";
import { TaskList } from "./task-list";

export const metadata: Metadata = { title: "작업" };

// 잘못된 쿼리 값은 도메인(@/server/task)이 기본값으로 바꾼다. 누가 무엇을 읽고 쓰고 지우는지는 RLS 가 정한다.
export default async function TasksPage({ params, searchParams }: PageProps<"/[slug]/tasks">) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const workspace = await requireWorkspace(slug, `/${slug}/tasks`);
  const list = await getTaskList(taskScopeOf(workspace), query);
  const { id, name, isPersonal } = workspace.current;
  // 처음 빈 상태에서는 빈 상태의 "첫 작업 추가"가 주요 버튼이라 머리의 버튼은 그리지 않는다.
  const isFirstEmpty = list.isDefaultQuery && list.total === 0;

  return (
    <TaskDialogsProvider
      orgId={id}
      teamName={isPersonal ? null : name}
      members={list.members}
      filters={list.filters}
    >
      <AppPage
        title="작업"
        description={
          isPersonal ? "나만 보는 작업입니다." : `${name}의 멤버가 함께 보는 작업입니다.`
        }
        actions={isFirstEmpty ? null : <AddTaskButton />}
      >
        <TaskList slug={workspace.current.slug} orgId={id} isPersonal={isPersonal} list={list} />
      </AppPage>
    </TaskDialogsProvider>
  );
}
