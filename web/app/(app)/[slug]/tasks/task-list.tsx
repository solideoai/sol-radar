"use client";

import { cn } from "cn";
import {
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchXIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { initialOf } from "@/lib/utils";
import type {
  ChangeTaskStatusResult,
  DeleteTaskResult,
  TaskListPage,
  TaskStatus,
  TaskView,
} from "@/server/task";
import { changeStatus, removeTask } from "./actions";
import { DueDate } from "./due-date";
import { useTaskDialogs } from "./task-dialogs";
import { createdDayText, listStatusText, tasksHref } from "./task-query";
import { TASK_STATUS_DISPLAY, TASK_STATUS_ORDER } from "./task-status";
import { type Navigate, TaskToolbar } from "./task-toolbar";

const STATUS_FAILURE: Record<Exclude<ChangeTaskStatusResult["status"], "saved">, string> = {
  gone: "이 작업은 그사이 지워졌습니다. 목록을 새로 고칩니다.",
  "not-in-org": "이 팀의 멤버가 아니어서 저장할 수 없습니다. 화면을 새로 고칩니다.",
  "signed-out": "로그인이 풀렸습니다. 다시 로그인하세요.",
};
const STATUS_ERROR = "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

const DELETE_FAILURE: Record<Exclude<DeleteTaskResult["status"], "deleted">, string> = {
  gone: "이 작업은 이미 지워졌습니다. 목록을 새로 고칩니다.",
  forbidden: "이 작업을 삭제할 권한이 없습니다. 화면을 새로 고칩니다.",
  "not-in-org": "이 팀의 멤버가 아니어서 삭제할 수 없습니다. 화면을 새로 고칩니다.",
  "signed-out": "로그인이 풀렸습니다. 다시 로그인하세요.",
};
const DELETE_ERROR = "작업을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 삭제 항목은 서버가 줄마다 정한 canDelete 로만 보인다 — 숨기는 것은 화면 요구이고, 삭제 권한은 DB 정책이 강제한다.
export function TaskList({
  slug,
  orgId,
  isPersonal,
  list,
}: {
  slug: string;
  orgId: string;
  isPersonal: boolean;
  list: TaskListPage;
}) {
  const router = useRouter();
  const { openAdd, openEdit, headingRef } = useTaskDialogs();
  // 이동을 기다리는 동안에도 도구 줄은 고른 값을 바로 보인다.
  const [isNavigating, startTransition] = useTransition();
  const [shownFilters, setShownFilters] = useOptimistic(list.filters);
  // 쪽 이동일 때만 새 쪽이 그려진 뒤 초점을 제목으로 옮긴다(조건을 바꾼 경우는 Select 에 남긴다).
  const focusAfterPageRef = useRef(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  // target 은 닫힌 뒤에도 남겨 둔다(닫히는 동안 본문이 사라지지 않게).
  const [deleteTarget, setDeleteTarget] = useState<TaskView | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 지운 줄은 사라져 눌렀던 단추로 돌아갈 수 없다. 성공으로 닫힐 때만 초점을 제목으로 보낸다.
  const wasDeletedRef = useRef(false);

  const { rows, total, page, pageCount, pageSize, today } = list;
  const isFirstEmpty = list.isDefaultQuery && total === 0;

  useEffect(() => {
    if (!focusAfterPageRef.current) return;
    focusAfterPageRef.current = false;
    headingRef.current?.focus();
  }, [page, headingRef]);

  const navigate: Navigate = (href, { scroll, filters }) => {
    startTransition(() => {
      if (filters) setShownFilters(filters);
      router.push(href, { scroll });
    });
  };

  const goToPage = (href: string) => {
    focusAfterPageRef.current = true;
    navigate(href, { scroll: true });
  };

  const onStatusChange = async (task: TaskView, status: TaskStatus) => {
    if (status === task.status) return;
    setSavingId(task.id);
    try {
      const result = await changeStatus(orgId, task.id, status);
      if (result.status !== "saved") {
        toast.error(STATUS_FAILURE[result.status]);
        return;
      }
      toast.success(`상태를 ${TASK_STATUS_DISPLAY[status].towardLabel} 바꿨습니다`);
      // 지금 조건에서 빠지는 줄이면(상태로 거르는 중) 단추가 사라진다. 초점을 제목으로 옮긴다.
      if (list.filters.status !== null && list.filters.status !== status) {
        headingRef.current?.focus();
      }
    } catch {
      toast.error(STATUS_ERROR);
    } finally {
      setSavingId(null);
    }
  };

  const openDelete = (task: TaskView) => {
    setDeleteTarget(task);
    setDeleteError(null);
    wasDeletedRef.current = false;
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await removeTask(orgId, deleteTarget.id);
      if (result.status === "not-in-org") {
        // 다시 그린 화면이 곧바로 404 라 대화상자 안 문구는 보이지 않는다. 앱 틀 밖에 남는 토스트로 알린다.
        toast.error(DELETE_FAILURE[result.status]);
        return;
      }
      if (result.status !== "deleted") {
        // 화면이 낡은 경우는 서버 함수가 이미 화면을 다시 그렸다(actions.ts).
        setDeleteError(DELETE_FAILURE[result.status]);
        return;
      }
      toast.success("작업을 삭제했습니다");
      wasDeletedRef.current = true;
      setIsDeleteOpen(false);
    } catch {
      setDeleteError(DELETE_ERROR);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    // min-w-0 이 없으면 긴 제목이 단을 넓혀 화면이 가로로 넘친다.
    <section aria-labelledby="tasks-title" className="min-w-0">
      {/* 카드의 기본 여백을 풀어 줄 사이 선이 카드 끝까지 닿게 한다. 칸을 숨기는 기준은 화면 폭이 아니라 카드 폭(@container)이다. */}
      <Card className="@container gap-0 py-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2
            id="tasks-title"
            ref={headingRef}
            tabIndex={-1}
            className="type-heading text-foreground outline-none"
          >
            작업 목록
          </h2>
          <p className="type-label text-muted-foreground tabular-nums">{total}개</p>
        </div>
        {/* 조건·쪽이 바뀐 것을 화면 낭독기에 여기 한 곳에서만 알린다. */}
        <p role="status" className="sr-only">
          {isFirstEmpty ? "" : listStatusText({ total, page, pageSize, shown: rows.length })}
        </p>
        {isFirstEmpty ? (
          <FirstEmpty isPersonal={isPersonal} onAdd={(opener) => openAdd(opener, "heading")} />
        ) : (
          <>
            <TaskToolbar
              slug={slug}
              filters={shownFilters}
              members={list.members}
              navigate={navigate}
              onCleared={() => headingRef.current?.focus()}
            />
            {/* 흐리게 하는 것은 움직이는 효과가 아니라서 motion-reduce 와 상관없다. */}
            <div
              aria-busy={isNavigating}
              className={cn("transition-opacity", isNavigating && "opacity-60")}
            >
              {rows.length === 0 ? (
                <FilteredEmpty />
              ) : (
                <Table
                  className="table-fixed"
                  containerClassName="rounded-none border-0"
                  aria-labelledby="tasks-title"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">작업</TableHead>
                      <TableHead className="w-14 @xl:w-32">상태</TableHead>
                      <TableHead className="hidden w-36 @xl:table-cell">담당자</TableHead>
                      <TableHead className="hidden w-32 @xl:table-cell">마감일</TableHead>
                      <TableHead className="hidden w-32 @3xl:table-cell">만든 날</TableHead>
                      <TableHead className="w-14 pr-6">
                        <span className="sr-only">관리</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        isSaving={savingId === task.id}
                        onEdit={(opener) => openEdit(task, opener)}
                        onStatusChange={(status) => onStatusChange(task, status)}
                        onDelete={() => openDelete(task)}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
              {pageCount > 1 ? (
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  hrefOf={(target) => tasksHref(slug, list.filters, target)}
                  onNavigate={goToPage}
                />
              ) : null}
            </div>
          </>
        )}
      </Card>
      <Dialog
        open={isDeleteOpen}
        // 삭제 중에는 닫히지 않는다. 중복 요청과 "닫았는데 지워짐"을 같이 막는다.
        onOpenChange={(next) => {
          if (!isDeleting) setIsDeleteOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => (wasDeletedRef.current ? headingRef.current : true)}
        >
          <DialogHeader>
            <DialogTitle>작업을 삭제할까요?</DialogTitle>
            <DialogDescription>
              삭제한 작업은 되돌릴 수 없습니다. 활동 기록에는 제목이 남습니다.
              {/* 소유자가 남이 만든 작업을 지울 때는 누가 만들었는지 한 번 더 알린다. */}
              {deleteTarget && !deleteTarget.isMine
                ? deleteTarget.creatorName === null
                  ? " 떠난 멤버가 만든 작업입니다."
                  : ` ${deleteTarget.creatorName} 님이 만든 작업입니다.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {/* 여백과 바탕은 바깥 상자가 맡는다. line-clamp 와 같은 요소에 여백을 주면 아래 여백 안에 넷째 줄의 윗부분이 비친다. */}
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="line-clamp-3 type-label wrap-anywhere text-foreground">
              {deleteTarget?.title}
            </p>
          </div>
          {deleteError ? (
            <p role="alert" className="type-label text-destructive">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isDeleting} />}>
              취소
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TaskRow({
  task,
  today,
  isSaving,
  onEdit,
  onStatusChange,
  onDelete,
}: {
  task: TaskView;
  today: string;
  isSaving: boolean;
  onEdit: (opener: HTMLElement | null) => void;
  onStatusChange: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  // "⋯ → 편집"으로 열면 메뉴 항목은 닫히며 사라진다. 대화상자를 닫은 뒤에는 이 단추로 돌아온다.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const assigneeName = task.assignee
    ? task.assignee.isMe
      ? `${task.assignee.name} (나)`
      : task.assignee.name
    : null;

  return (
    <TableRow>
      <TableCell className="pl-6">
        {/* 줄 전체를 누르는 대상으로 만들지 않는다(안에 단추가 셋이다). */}
        <button
          type="button"
          title={task.title}
          aria-haspopup="dialog"
          onClick={(event) => onEdit(event.currentTarget)}
          className="block w-full truncate rounded-sm text-left font-medium text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {task.title}
        </button>
        <p className="mt-0.5 flex min-w-0 gap-1 type-caption text-muted-foreground @xl:hidden">
          <span className="min-w-0 truncate">{assigneeName ?? "담당자 없음"}</span>
          {task.dueDate !== null ? (
            <>
              <span aria-hidden>·</span>
              <DueDate task={task} className="shrink-0" />
            </>
          ) : null}
        </p>
      </TableCell>
      <TableCell>
        <StatusMenu task={task} isSaving={isSaving} onChange={onStatusChange} />
      </TableCell>
      <TableCell className="hidden @xl:table-cell">
        {task.assignee ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar size="sm" aria-hidden>
              <AvatarFallback>{initialOf(task.assignee.name)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 gap-1">
              <span className="truncate text-foreground" title={task.assignee.name}>
                {task.assignee.name}
              </span>
              {task.assignee.isMe ? (
                <span className="shrink-0 text-muted-foreground">(나)</span>
              ) : null}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">없음</span>
        )}
      </TableCell>
      <TableCell className="hidden @xl:table-cell">
        <DueDate task={task} />
      </TableCell>
      <TableCell className="hidden text-muted-foreground tabular-nums @3xl:table-cell">
        <time dateTime={task.createdAt} title={task.createdAtText}>
          {createdDayText(task.createdAt, today)}
        </time>
      </TableCell>
      <TableCell className="pr-6">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                size="icon-sm"
                aria-label={`${task.title} 관리`}
                className="text-muted-foreground"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(menuTriggerRef.current)}>
              <PencilIcon />
              편집
            </DropdownMenuItem>
            {task.canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2Icon />
                  삭제
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function StatusMenu({
  task,
  isSaving,
  onChange,
}: {
  task: TaskView;
  isSaving: boolean;
  onChange: (status: TaskStatus) => void;
}) {
  const { label, icon: Icon } = TASK_STATUS_DISPLAY[task.status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // 메뉴가 닫히며 초점이 이 단추로 돌아오므로, 꺼져도 초점을 잃지 않게 한다(focusableWhenDisabled).
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving}
            focusableWhenDisabled
            aria-label={`${task.title} 상태: ${label}`}
            className="-mx-2 max-w-[calc(100%+1rem)] data-disabled:opacity-50"
          />
        }
      >
        <Icon className="text-muted-foreground" />
        <span className="hidden truncate @xl:inline">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>상태</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={task.status}
            onValueChange={(value: TaskStatus) => onChange(value)}
          >
            {TASK_STATUS_ORDER.map((status) => {
              const ItemIcon = TASK_STATUS_DISPLAY[status].icon;
              return (
                <DropdownMenuRadioItem key={status} value={status} closeOnClick>
                  <ItemIcon className="text-muted-foreground" />
                  {TASK_STATUS_DISPLAY[status].label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FirstEmpty({
  isPersonal,
  onAdd,
}: {
  isPersonal: boolean;
  onAdd: (opener: HTMLElement) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <ListChecksIcon className="size-5" />
      </span>
      <div>
        <p className="type-body font-semibold text-foreground">아직 작업이 없습니다</p>
        <p className="mt-1 type-label text-muted-foreground">
          {isPersonal
            ? "첫 작업을 추가해 할 일을 정리하세요."
            : "첫 작업을 추가하면 팀 멤버 모두에게 보입니다."}
        </p>
      </div>
      <Button aria-haspopup="dialog" onClick={(event) => onAdd(event.currentTarget)}>
        첫 작업 추가
      </Button>
    </div>
  );
}

function FilteredEmpty() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <SearchXIcon className="size-5" />
      </span>
      <div>
        <p className="type-body font-semibold text-foreground">조건에 맞는 작업이 없습니다</p>
        <p className="mt-1 type-label text-muted-foreground">
          위의 상태·담당자를 바꾸거나 조건을 지우세요.
        </p>
      </div>
    </div>
  );
}
