"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AssigneeOption, TaskView, UpdateTaskResult } from "@/server/task";
import { createTask, saveTask } from "./actions";
import { TASK_STATUS_ORDER, TaskStatusLabel } from "./task-status";

// 화면의 검증은 편의다. 같은 규칙을 서버(@/server/task)가 다시 보고, DB 제약이 한 번 더 지킨다.
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const NO_ASSIGNEE = "none";

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "제목을 입력하세요")
    .max(MAX_TITLE, `제목은 ${MAX_TITLE}자 이하입니다`),
  description: z.string().trim().max(MAX_DESCRIPTION, `설명은 ${MAX_DESCRIPTION}자 이하입니다`),
  status: z.enum(["todo", "in_progress", "done"]),
  // "none" 이면 담당자 없음. 멤버인지는 DB 의 외래 키가 본다.
  assigneeId: z.string(),
  // 브라우저 날짜 입력은 "YYYY-MM-DD" 이거나, 비었거나 다 채우지 않았으면 "" 다.
  dueDate: z.union([z.literal(""), z.iso.date("마감일 형식이 아닙니다")]),
});
type Values = z.infer<typeof schema>;

export type TaskDialogTarget = { mode: "add" } | { mode: "edit"; task: TaskView };

const defaultValuesOf = (target: TaskDialogTarget): Values =>
  target.mode === "add"
    ? { title: "", description: "", status: "todo", assigneeId: NO_ASSIGNEE, dueDate: "" }
    : {
        title: target.task.title,
        description: target.task.description ?? "",
        status: target.task.status,
        assigneeId: target.task.assignee?.id ?? NO_ASSIGNEE,
        dueDate: target.task.dueDate ?? "",
      };

export type SavedTask = { status: Values["status"]; assigneeId: string | null };

// 여는 쪽이 열 때마다 key 를 바꿔 새로 그린다 — 입력값과 오류가 지난번 것을 물려받지 않는다.
export function TaskFormDialog({
  orgId,
  teamName,
  members,
  target,
  open,
  onOpenChange,
  onSaved,
  finalFocus,
}: {
  orgId: string;
  // 개인 공간이면 null.
  teamName: string | null;
  members: AssigneeOption[];
  target: TaskDialogTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: SavedTask) => void;
  finalFocus: () => HTMLElement | null;
}) {
  const isEdit = target.mode === "edit";
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaultValuesOf(target),
  });
  const { errors, isSubmitting } = form.formState;
  // 닫히는 애니메이션 동안 폼이 남아 다시 눌리면 같은 작업이 둘 생긴다. 성공한 뒤로도 제출 중과 똑같이 잠근다.
  const [isSaved, setIsSaved] = useState(false);
  const isLocked = isSubmitting || isSaved;
  // 그새 지워진 작업이다. 다시 저장해도 같은 결과라 "저장"을 끈다.
  const [isGone, setIsGone] = useState(false);
  // 고른 사람이 그새 팀을 떠나 멤버 목록에서 빠져도 이름을 알게 남긴다(assigneeItemsOf).
  const [pickedItems, setPickedItems] = useState<AssigneeItem[]>([]);
  const [title, description, dueDate] = useWatch({
    control: form.control,
    name: ["title", "description", "dueDate"],
  });
  // 서버·DB 와 같은 방식으로 앞뒤 공백을 빼고 센다.
  const titleLength = title.trim().length;
  const descriptionLength = description.trim().length;
  const assigneeItems = assigneeItemsOf(members, [
    ...(target.mode === "edit" && target.task.assignee !== null
      ? [{ value: target.task.assignee.id, label: target.task.assignee.name }]
      : []),
    ...pickedItems,
  ]);

  const onSubmit = async (values: Values) => {
    const input = {
      title: values.title,
      description: values.description,
      assigneeId: values.assigneeId,
      dueDate: values.dueDate,
    };
    try {
      const result =
        target.mode === "edit"
          ? await saveTask(orgId, target.task.id, { ...input, status: values.status })
          : await createTask(orgId, input);
      if (result.status === "saved") {
        setIsSaved(true);
        toast.success(isEdit ? "작업을 저장했습니다" : "작업을 추가했습니다");
        onSaved({
          status: values.status,
          assigneeId: values.assigneeId === NO_ASSIGNEE ? null : values.assigneeId,
        });
        return;
      }
      showFailure(result);
    } catch {
      // 서버 오류·네트워크 끊김. 서버가 준 내용은 보이지 않고 입력값을 남긴다.
      form.setError("root", { message: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
    }
  };

  // 화면이 낡은 경우는 서버 함수가 이미 화면을 다시 그렸다(actions.ts).
  const showFailure = (result: Exclude<UpdateTaskResult, { status: "saved" }>) => {
    switch (result.status) {
      case "invalid":
        form.setError(result.field, { message: result.message }, { shouldFocus: true });
        return;
      case "assignee-not-member":
        // 담당자가 그새 팀을 떠났다. 떠난 사람은 고를 수 없게 흐려진 채 칸에 남아 무엇이 거절됐는지 보인다.
        form.setError(
          "assigneeId",
          { message: "이 팀의 멤버가 아닙니다. 담당자를 다시 고르세요." },
          { shouldFocus: true },
        );
        return;
      case "gone":
        setIsGone(true);
        form.setError("root", { message: "이 작업은 그사이 지워졌습니다. 목록을 새로 고칩니다." });
        return;
      case "not-in-org":
        // 서버 함수가 같은 응답에서 화면을 다시 그려 곧바로 404 가 된다. 폼 아래 문구는 대화상자와 함께 사라지므로
        // 앱 틀 밖(루트의 Toaster)에 남는 토스트로 알린다.
        toast.error("이 팀의 멤버가 아니어서 저장할 수 없습니다. 화면을 새로 고칩니다.");
        return;
      case "signed-out":
        form.setError("root", { message: "로그인이 풀렸습니다. 다시 로그인하세요." });
        return;
    }
  };

  return (
    <Dialog
      open={open}
      // 저장하는 중에는 닫히지 않는다. 중복 요청과 "닫았는데 저장됨"을 같이 막는다.
      onOpenChange={(next) => {
        if (!isLocked) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "작업 편집" : "작업 추가"}</DialogTitle>
          {!isEdit && teamName !== null ? (
            <DialogDescription>{teamName}의 멤버 모두에게 보입니다.</DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <FieldGroup>
            <Field data-invalid={Boolean(errors.title)}>
              <FieldLabel htmlFor="task-title">제목</FieldLabel>
              {/* maxLength 를 걸지 않는다 — 붙여 넣은 글이 말없이 잘린다. 제출 중 readOnly 는 disabled 와 달리 초점을 지킨다. */}
              <Input
                id="task-title"
                autoComplete="off"
                readOnly={isLocked}
                aria-invalid={Boolean(errors.title)}
                aria-describedby="task-title-length"
                {...form.register("title")}
              />
              <LengthRow
                id="task-title-length"
                error={errors.title?.message}
                length={titleLength}
                max={MAX_TITLE}
              />
            </Field>
            <Field data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor="task-description">
                설명 <span className="font-normal text-muted-foreground">(선택)</span>
              </FieldLabel>
              <Textarea
                id="task-description"
                readOnly={isLocked}
                aria-invalid={Boolean(errors.description)}
                aria-describedby="task-description-length"
                className="max-h-60 min-h-24 resize-none"
                {...form.register("description")}
              />
              <LengthRow
                id="task-description-length"
                error={errors.description?.message}
                length={descriptionLength}
                max={MAX_DESCRIPTION}
              />
            </Field>
            {/* 좁을 때도 열을 grid-cols-1(minmax(0, 1fr))로 정하고 칸에 min-w-0 을 준다. 그러지 않으면 열이 내용 폭(auto)이 되어
                긴 담당자 이름이 칸을 대화상자 밖으로 민다. */}
            <div className="@container">
              <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
                {isEdit ? (
                  <Field data-invalid={Boolean(errors.status)} className="min-w-0">
                    <FieldLabel htmlFor="task-status">상태</FieldLabel>
                    <Controller
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={(value) => {
                            if (value) field.onChange(value);
                          }}
                          disabled={isLocked}
                        >
                          <SelectTrigger
                            id="task-status"
                            ref={field.ref}
                            aria-invalid={Boolean(errors.status)}
                            className="w-full"
                          >
                            <SelectValue>
                              {(value: Values["status"]) => <TaskStatusLabel status={value} />}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUS_ORDER.map((status) => (
                              <SelectItem key={status} value={status}>
                                <TaskStatusLabel status={status} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldError errors={[errors.status]} />
                  </Field>
                ) : null}
                <Field data-invalid={Boolean(errors.assigneeId)} className="min-w-0">
                  <FieldLabel htmlFor="task-assignee">담당자</FieldLabel>
                  <Controller
                    control={form.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <Select
                        items={assigneeItems}
                        value={field.value}
                        onValueChange={(value) => {
                          if (!value) return;
                          const item = assigneeItems.find((option) => option.value === value);
                          if (
                            item !== undefined &&
                            !pickedItems.some((picked) => picked.value === value)
                          ) {
                            setPickedItems([...pickedItems, item]);
                          }
                          field.onChange(value);
                        }}
                        disabled={isLocked}
                      >
                        <SelectTrigger
                          id="task-assignee"
                          ref={field.ref}
                          aria-invalid={Boolean(errors.assigneeId)}
                          className="w-full"
                        >
                          <SelectValue>
                            {(value: string) => (
                              <span className="truncate">
                                {assigneeItems.find((item) => item.value === value)?.label}
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {assigneeItems.map((item) => (
                            <SelectItem
                              key={item.value}
                              value={item.value}
                              disabled={item.hasLeft === true}
                            >
                              <span className="truncate">{item.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.assigneeId]} />
                </Field>
                <Field data-invalid={Boolean(errors.dueDate)} className="min-w-0">
                  <FieldLabel htmlFor="task-due">마감일</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="task-due"
                      type="date"
                      readOnly={isLocked}
                      aria-invalid={Boolean(errors.dueDate)}
                      {...form.register("dueDate")}
                    />
                    {/* 브라우저마다 날짜 칸을 비우는 방법이 달라 지우기 단추를 따로 둔다. */}
                    {dueDate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="마감일 지우기"
                        title="마감일 지우기"
                        disabled={isLocked}
                        className="text-muted-foreground"
                        onClick={() => {
                          form.setValue("dueDate", "", { shouldDirty: true });
                          form.setFocus("dueDate");
                        }}
                      >
                        <XIcon />
                      </Button>
                    ) : null}
                  </div>
                  <FieldError errors={[errors.dueDate]} />
                </Field>
              </div>
            </div>
            {target.mode === "edit" ? <CreatedLine task={target.task} /> : null}
          </FieldGroup>
          {errors.root ? (
            <p role="alert" className="type-label text-destructive">
              {errors.root.message}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isLocked} />}>
              취소
            </DialogClose>
            <Button type="submit" disabled={isLocked || isGone}>
              {isEdit ? (isLocked ? "저장 중…" : "저장") : isLocked ? "추가 중…" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// 오류가 없을 때도 글자 수가 오른쪽 끝에 남게 ml-auto 로 민다.
function LengthRow({
  id,
  error,
  length,
  max,
}: {
  id: string;
  error: string | undefined;
  length: number;
  max: number;
}) {
  return (
    <div className="flex items-start gap-3">
      <FieldError errors={[error === undefined ? undefined : { message: error }]} />
      <p
        id={id}
        className={`ml-auto shrink-0 type-caption tabular-nums ${length > max ? "text-destructive" : "text-muted-foreground"}`}
      >
        <span className="sr-only">글자 수 </span>
        {length}/{max}
      </p>
    </div>
  );
}

// 만든 사람이 떠났으면(지금 멤버가 아니거나 계정이 지워짐) "떠난 멤버".
function CreatedLine({ task }: { task: TaskView }) {
  const creator = task.creatorName === null ? "떠난 멤버가" : `${task.creatorName} 님이`;
  return (
    <p className="type-caption text-muted-foreground">
      {creator} <time dateTime={task.createdAt}>{task.createdAtText}</time>에 만들었습니다.
      {task.completedAt !== null && task.completedAtText !== null ? (
        <>
          {" · "}
          <time dateTime={task.completedAt}>{task.completedAtText}</time>에 완료
        </>
      ) : null}
    </p>
  );
}

type AssigneeItem = { value: string; label: string; hasLeft?: boolean };

// 칸의 값이었던 사람(known)이 그새 떠났으면 끝에 고를 수 없게 넣는다. 빼면 Base UI Select 가 목록에 없는 값을
// 처음 값으로 되돌려, 칸이 말없이 "담당자 없음"이 되고 오류도 지워진다. 다른 사람을 고를 때 빼도 같은 식으로 되돌린다.
function assigneeItemsOf(members: AssigneeOption[], known: AssigneeItem[]): AssigneeItem[] {
  const options = members.map((member) => ({
    value: member.id,
    label: member.isMe ? `${member.name} (나)` : member.name,
  }));
  const departed = known
    .filter(
      (item, index) =>
        !options.some((option) => option.value === item.value) &&
        known.findIndex((other) => other.value === item.value) === index,
    )
    .map((item) => ({ ...item, hasLeft: true }));
  return [{ value: NO_ASSIGNEE, label: "담당자 없음" }, ...options, ...departed];
}
