"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontalIcon, MoveRightIcon, UserMinusIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Department, JobTitle, TeamMemberListItem } from "@/server/people";

// N4b 조직·인력 ADMIN 편집 진입점(추가·부서/직급 이동·퇴사). 점수 계산 속성은 다루지 않는다.
// 화면의 검증은 편의다. 같은 규칙을 서버(/api/v1/team-members)와 DB 함수가 다시 본다.

export type TeamMemberEditTarget =
  | { mode: "create" }
  | { mode: "move"; member: TeamMemberListItem }
  | { mode: "leave"; member: TeamMemberListItem };

type Option = { value: string; label: string };
type FieldName = "name" | "departmentId" | "jobTitleId" | "email";
type RequestFailure = { message: string; fields: Partial<Record<FieldName, string>> };

const FIELD_NAMES: readonly FieldName[] = ["name", "departmentId", "jobTitleId", "email"];
const EMAIL_PATTERN = /^[a-z0-9]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const createSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(40, "이름은 40자 이하입니다."),
  departmentId: z.string().min(1, "부서를 고르세요."),
  jobTitleId: z.string().min(1, "직급을 고르세요."),
  email: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_PATTERN, "영문 소문자·숫자 메일 주소를 입력하세요."),
  ]),
});
type CreateValues = z.infer<typeof createSchema>;
const moveSchema = createSchema.pick({ departmentId: true, jobTitleId: true });
type MoveValues = z.infer<typeof moveSchema>;

/** 직원을 둘 수 있는 부서(본부·그룹·팀, ADR-063)를 "상위 › 부서" 이름으로. */
export function teamOptions(departments: readonly Department[]): Option[] {
  const names = new Map(departments.map((item) => [item.id, item.name]));
  return departments
    .map((item) => {
      const parent = item.parentId === null ? undefined : names.get(item.parentId);
      return { value: item.id, label: parent ? `${parent} › ${item.name}` : item.name };
    })
    .toSorted((a, b) => a.label.localeCompare(b.label, "ko"));
}

async function sendEdit(path: string, method: "POST" | "PATCH", body: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "sol-radar" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const failure: RequestFailure = { message: "저장하지 못했습니다. 다시 시도하세요.", fields: {} };
  const value: unknown = await response.json().catch(() => null);
  const error = z
    .object({
      error: z.object({
        message: z.string(),
        details: z
          .object({ issues: z.array(z.object({ path: z.string(), message: z.string() })) })
          .partial()
          .optional(),
      }),
    })
    .safeParse(value);
  if (error.success) {
    failure.message = error.data.error.message;
    for (const issue of error.data.error.details?.issues ?? []) {
      const field = FIELD_NAMES.find((name) => name === issue.path);
      if (field) failure.fields[field] = issue.message;
    }
  }
  throw failure;
}

const isRequestFailure = (value: unknown): value is RequestFailure =>
  typeof value === "object" && value !== null && "message" in value && "fields" in value;

/** 표 한 줄의 관리 메뉴. 줄을 누르면 상세가 열리므로 메뉴 안의 누름은 줄로 올리지 않는다. */
export function TeamMemberRowActions({
  member,
  onEdit,
}: {
  member: TeamMemberListItem;
  onEdit: (target: TeamMemberEditTarget) => void;
}) {
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${member.name} 관리`}
              className="text-muted-foreground"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit({ mode: "move", member })}>
            <MoveRightIcon />
            부서·직급 이동
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onEdit({ mode: "leave", member })}>
            <UserMinusIcon />
            퇴사 처리
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// 여는 쪽이 열 때마다 key 를 바꿔 새로 그린다 — 지난 입력값·오류를 물려받지 않는다.
export function TeamMemberEditDialog({
  target,
  departments,
  jobTitles,
  open,
  onOpenChange,
  onSaved,
}: {
  target: TeamMemberEditTarget;
  departments: readonly Department[];
  jobTitles: readonly JobTitle[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [locked, setLocked] = useState(false);
  return (
    <Dialog
      open={open}
      // 저장하는 중에는 닫히지 않는다. 중복 요청과 "닫았는데 저장됨"을 같이 막는다.
      onOpenChange={(next) => {
        if (!locked) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        {target.mode === "create" ? (
          <CreateForm
            teams={teamOptions(departments)}
            titles={jobTitles.map((item) => ({ value: item.id, label: item.label }))}
            onLock={setLocked}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : target.mode === "move" ? (
          <MoveForm
            member={target.member}
            teams={teamOptions(departments)}
            titles={jobTitles.map((item) => ({ value: item.id, label: item.label }))}
            onLock={setLocked}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : (
          <LeaveForm
            member={target.member}
            onLock={setLocked}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = {
  onLock: (locked: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
};

function CreateForm({ teams, titles, onLock, onCancel, onSaved }: FormProps & PlacementOptions) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", departmentId: "", jobTitleId: "", email: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    onLock(true);
    try {
      await sendEdit("/api/v1/team-members", "POST", {
        name: values.name,
        departmentId: values.departmentId,
        jobTitleId: values.jobTitleId,
        ...(values.email ? { email: values.email } : {}),
      });
      toast.success(`${values.name.trim()} 님을 명부에 추가했습니다`);
      onSaved();
    } catch (error) {
      showFailure(
        error,
        (field, message) => form.setError(field, { message }),
        (message) => form.setError("root", { message }),
      );
    } finally {
      onLock(false);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>직원 추가</DialogTitle>
        <DialogDescription>
          운영 명부에 직원을 추가합니다. 점수 계산 대상 인력은 바뀌지 않습니다.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="member-name">이름</FieldLabel>
          <Input
            id="member-name"
            autoComplete="off"
            readOnly={isSubmitting}
            aria-invalid={Boolean(errors.name)}
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <PlacementRow>
          <Controller
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <OptionSelect
                id="member-team"
                label="부서"
                value={field.value}
                onChange={field.onChange}
                triggerRef={field.ref}
                error={errors.departmentId?.message}
                disabled={isSubmitting}
                options={teams}
              />
            )}
          />
          <Controller
            control={form.control}
            name="jobTitleId"
            render={({ field }) => (
              <OptionSelect
                id="member-title"
                label="직급·직책"
                value={field.value}
                onChange={field.onChange}
                triggerRef={field.ref}
                error={errors.jobTitleId?.message}
                disabled={isSubmitting}
                options={titles}
              />
            )}
          />
        </PlacementRow>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="member-email">
            회사 메일 <span className="font-normal text-muted-foreground">(선택)</span>
          </FieldLabel>
          <Input
            id="member-email"
            type="email"
            autoComplete="off"
            readOnly={isSubmitting}
            aria-invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
      </FieldGroup>
      <RootError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          취소
        </Button>
        <Button type="submit" disabled={isSubmitting} focusableWhenDisabled>
          {isSubmitting ? "추가하는 중…" : "추가"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MoveForm({
  member,
  teams,
  titles,
  onLock,
  onCancel,
  onSaved,
}: FormProps & PlacementOptions & { member: TeamMemberListItem }) {
  const form = useForm<MoveValues>({
    resolver: zodResolver(moveSchema),
    defaultValues: { departmentId: member.departmentId, jobTitleId: member.jobTitleId },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const changes = {
      ...(values.departmentId !== member.departmentId ? { departmentId: values.departmentId } : {}),
      ...(values.jobTitleId !== member.jobTitleId ? { jobTitleId: values.jobTitleId } : {}),
    };
    if (Object.keys(changes).length === 0) {
      form.setError("root", { message: "바뀐 내용이 없습니다. 팀이나 직급을 바꾸세요." });
      return;
    }
    onLock(true);
    try {
      await sendEdit(`/api/v1/team-members/${member.id}`, "PATCH", changes);
      toast.success(`${member.name} 님의 소속을 바꿨습니다`);
      onSaved();
    } catch (error) {
      showFailure(
        error,
        (field, message) => {
          if (field === "departmentId" || field === "jobTitleId") form.setError(field, { message });
        },
        (message) => form.setError("root", { message }),
      );
    } finally {
      onLock(false);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>부서·직급 이동</DialogTitle>
        <DialogDescription>
          {member.name}({member.personCode})의 팀과 직급을 바꿉니다. 이미 저장된 분석 결과는 바뀌지
          않습니다.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <PlacementRow>
          <Controller
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <OptionSelect
                id="member-team"
                label="부서"
                value={field.value}
                onChange={field.onChange}
                triggerRef={field.ref}
                error={errors.departmentId?.message}
                disabled={isSubmitting}
                options={teams}
              />
            )}
          />
          <Controller
            control={form.control}
            name="jobTitleId"
            render={({ field }) => (
              <OptionSelect
                id="member-title"
                label="직급·직책"
                value={field.value}
                onChange={field.onChange}
                triggerRef={field.ref}
                error={errors.jobTitleId?.message}
                disabled={isSubmitting}
                options={titles}
              />
            )}
          />
        </PlacementRow>
      </FieldGroup>
      <RootError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          취소
        </Button>
        <Button type="submit" disabled={isSubmitting} focusableWhenDisabled>
          {isSubmitting ? "저장하는 중…" : "저장"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LeaveForm({
  member,
  onLock,
  onCancel,
  onSaved,
}: FormProps & { member: TeamMemberListItem }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const leave = async () => {
    setPending(true);
    onLock(true);
    try {
      await sendEdit(`/api/v1/team-members/${member.id}`, "PATCH", { employmentStatus: "LEFT" });
      toast.success(`${member.name} 님을 퇴사 처리했습니다`);
      onSaved();
    } catch (error) {
      setMessage(isRequestFailure(error) ? error.message : "저장하지 못했습니다. 다시 시도하세요.");
    } finally {
      setPending(false);
      onLock(false);
    }
  };
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>퇴사 처리</DialogTitle>
        <DialogDescription>
          {member.name}({member.personCode}) 님을 퇴사 처리합니다.
        </DialogDescription>
      </DialogHeader>
      <ul className="grid list-disc gap-1 pl-5 type-body">
        <li>명부·조직도·인원 수에서 빠집니다.</li>
        <li>다음 분석부터 가용 인력에서 빠집니다. 이미 저장된 분석 결과는 바뀌지 않습니다.</li>
        <li>변경은 감사 기록에 남습니다.</li>
      </ul>
      <RootError message={message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={leave}
          disabled={pending}
          focusableWhenDisabled
        >
          {pending ? "처리하는 중…" : "퇴사 처리"}
        </Button>
      </DialogFooter>
    </div>
  );
}

type PlacementOptions = { teams: Option[]; titles: Option[] };

// 좁을 때도 열을 grid-cols-1(minmax(0, 1fr))로 정하고 칸에 min-w-0 을 준다. 긴 팀 이름이 대화상자 밖으로 밀지 않게 한다.
function PlacementRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">{children}</div>
    </div>
  );
}

function OptionSelect({
  id,
  label,
  value,
  onChange,
  triggerRef,
  error,
  disabled,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  // react-hook-form 이 오류 칸에 초점을 옮길 때 쓴다(Controller 의 field.ref).
  triggerRef: (instance: HTMLElement | null) => void;
  error: string | undefined;
  disabled: boolean;
  options: Option[];
}) {
  return (
    <Field data-invalid={Boolean(error)} className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={value === "" ? null : value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} ref={triggerRef} aria-invalid={Boolean(error)} className="w-full">
          <SelectValue>
            {(selected: string | null) => (
              <span className="truncate">
                {options.find((option) => option.value === selected)?.label ?? `${label} 선택`}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="truncate">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="type-body text-destructive">
      {message}
    </p>
  ) : null;
}

function showFailure(
  error: unknown,
  setField: (field: FieldName, message: string) => void,
  setRoot: (message: string) => void,
) {
  if (!isRequestFailure(error)) {
    setRoot("저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    return;
  }
  const fields = Object.entries(error.fields);
  for (const [field, message] of fields) {
    const name = FIELD_NAMES.find((candidate) => candidate === field);
    if (name && message) setField(name, message);
  }
  if (fields.length === 0) setRoot(error.message);
}
