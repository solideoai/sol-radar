"use client";

import { PlusIcon } from "lucide-react";
import { createContext, use, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssigneeOption, TaskListFilters, TaskView } from "@/server/task";
import { type SavedTask, type TaskDialogTarget, TaskFormDialog } from "./task-form-dialog";

// 머리의 "작업 추가"와 표가 같은 대화상자를 연다. 화면 틀(AppPage)은 서버 컴포넌트로 두고, 이 공급자가 바깥을 감싸 둘을 잇는다.
type TaskDialogs = {
  // returnTo: 닫힌 뒤 초점을 돌려줄 곳. 연 단추가 곧 사라지면(처음 빈 상태의 단추) "heading" 을 넘긴다.
  openAdd: (opener: HTMLElement, returnTo?: "opener" | "heading") => void;
  openEdit: (task: TaskView, opener: HTMLElement | null) => void;
  // 연 단추가 사라졌을 때 초점을 돌려받는 "작업 목록" 제목이다(표가 단다).
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

const TaskDialogsContext = createContext<TaskDialogs | null>(null);

export function useTaskDialogs(): TaskDialogs {
  const value = use(TaskDialogsContext);
  if (value === null) throw new Error("TaskDialogsProvider 안에서만 쓴다");
  return value;
}

// 지금 조건에서 빠지면 그 줄(과 연 단추)이 사라지므로 초점을 제목으로 보낸다.
const leavesView = (filters: TaskListFilters, saved: SavedTask): boolean =>
  (filters.status !== null && filters.status !== saved.status) ||
  (filters.assignee === "none" && saved.assigneeId !== null) ||
  (filters.assignee !== null &&
    filters.assignee !== "none" &&
    filters.assignee !== saved.assigneeId);

export function TaskDialogsProvider({
  orgId,
  teamName,
  members,
  filters,
  children,
}: {
  orgId: string;
  teamName: string | null;
  members: AssigneeOption[];
  filters: TaskListFilters;
  children: React.ReactNode;
}) {
  // target 은 닫힌 뒤에도 남겨 둔다 — 닫히는 애니메이션 동안 내용이 사라지지 않게 한다.
  const [target, setTarget] = useState<TaskDialogTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // 열 때마다 바꿔 대화상자를 새로 그린다(입력값·오류를 물려받지 않는다).
  const [openCount, setOpenCount] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnToHeadingRef = useRef(false);

  const open = (next: TaskDialogTarget, opener: HTMLElement | null, toHeading: boolean) => {
    setTarget(next);
    openerRef.current = opener;
    returnToHeadingRef.current = toHeading;
    setOpenCount((count) => count + 1);
    setIsOpen(true);
  };

  const dialogs: TaskDialogs = {
    openAdd: (opener, returnTo = "opener") => open({ mode: "add" }, opener, returnTo === "heading"),
    openEdit: (task, opener) => open({ mode: "edit", task }, opener, false),
    headingRef,
  };

  const onSaved = (saved: SavedTask) => {
    if (leavesView(filters, saved)) returnToHeadingRef.current = true;
    setIsOpen(false);
  };

  // 연 단추가 사라졌으면(조건에서 빠짐, 처음 빈 상태의 단추) "작업 목록" 제목으로 돌아간다.
  const finalFocus = () => {
    const opener = openerRef.current;
    return returnToHeadingRef.current || !opener?.isConnected ? headingRef.current : opener;
  };

  return (
    <TaskDialogsContext value={dialogs}>
      {children}
      {target ? (
        <TaskFormDialog
          key={openCount}
          orgId={orgId}
          teamName={teamName}
          members={members}
          target={target}
          open={isOpen}
          onOpenChange={setIsOpen}
          onSaved={onSaved}
          finalFocus={finalFocus}
        />
      ) : null}
    </TaskDialogsContext>
  );
}

export function AddTaskButton() {
  const { openAdd } = useTaskDialogs();
  return (
    <Button aria-haspopup="dialog" onClick={(event) => openAdd(event.currentTarget)}>
      <PlusIcon data-icon="inline-start" />
      작업 추가
    </Button>
  );
}
