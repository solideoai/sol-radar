"use client";

import { cn } from "cn";
import { FilterXIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssigneeOption, TaskListFilters, TaskSort } from "@/server/task";
import { TASK_STATUS_DISPLAY, TASK_STATUS_ORDER } from "./task-status";
import { tasksHref } from "./task-query";

// Select 의 값은 글자다. "전체"(조건 없음)를 나타내는 값.
const ALL = "all";

const SORT_LABELS: Record<TaskSort, string> = { created: "최근 만든 순", due: "마감일 순" };

export const DEFAULT_FILTERS: TaskListFilters = { status: null, assignee: null, sort: "created" };

export type Navigate = (
  href: string,
  options: { scroll: boolean; filters?: TaskListFilters },
) => void;

// 조건은 주소의 쿼리에 있다. 화면을 옮기는 일(navigate)은 표를 가진 쪽이 한다 — 기다리는 동안 표를 흐리게 하려고
// 같은 전환(transition)으로 묶는다. filters 는 서버가 다시 읽기 전에도 Select 가 보이는 고른 즉시의 조건이다.
export function TaskToolbar({
  slug,
  filters,
  members,
  navigate,
  onCleared,
}: {
  slug: string;
  filters: TaskListFilters;
  members: AssigneeOption[];
  navigate: Navigate;
  // "조건 지우기"는 누르는 즉시 사라진다. 초점을 받을 곳(표 제목)으로 옮기는 일은 표를 가진 쪽이 한다.
  onCleared: () => void;
}) {
  // 스크롤과 초점은 그대로 둔다(초점은 고른 Select 에 남는다).
  const apply = (next: Partial<TaskListFilters>) => {
    const nextFilters = { ...filters, ...next };
    navigate(tasksHref(slug, nextFilters), { scroll: false, filters: nextFilters });
  };
  const isDefaultQuery =
    filters.status === null && filters.assignee === null && filters.sort === "created";

  const statusItems = [
    { value: ALL, label: "전체" },
    ...TASK_STATUS_ORDER.map((status) => ({
      value: status,
      label: TASK_STATUS_DISPLAY[status].label,
    })),
  ];
  const assigneeItems = [
    { value: ALL, label: "전체" },
    { value: "none", label: "담당자 없음" },
    ...members.map((member) => ({
      value: member.id,
      label: member.isMe ? `${member.name} (나)` : member.name,
    })),
  ];
  const sortItems = (["created", "due"] as const).map((sort) => ({
    value: sort,
    label: SORT_LABELS[sort],
  }));

  return (
    // 기준은 화면 폭이 아니라 카드의 폭이다.
    <div className="grid grid-cols-2 gap-3 border-b border-border px-6 py-4 @2xl:flex @2xl:flex-wrap @2xl:items-end">
      <ToolbarSelect
        id="task-filter-status"
        label="상태"
        className="@2xl:w-36"
        items={statusItems}
        value={filters.status ?? ALL}
        onChange={(value) =>
          apply({ status: TASK_STATUS_ORDER.find((status) => status === value) ?? null })
        }
      />
      <ToolbarSelect
        id="task-filter-assignee"
        label="담당자"
        className="@2xl:w-44"
        items={assigneeItems}
        value={filters.assignee ?? ALL}
        onChange={(value) => apply({ assignee: value === ALL ? null : value })}
      />
      <ToolbarSelect
        id="task-sort"
        label="정렬"
        className="@2xl:w-44"
        items={sortItems}
        value={filters.sort}
        onChange={(value) => apply({ sort: value === "due" ? "due" : "created" })}
      />
      {isDefaultQuery ? null : (
        <Link
          href={`/${slug}/tasks`}
          scroll={false}
          onNavigate={(event) => {
            event.preventDefault();
            navigate(`/${slug}/tasks`, { scroll: false, filters: DEFAULT_FILTERS });
            onCleared();
          }}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "self-end justify-self-start @2xl:ml-auto",
          )}
        >
          <FilterXIcon data-icon="inline-start" />
          조건 지우기
        </Link>
      )}
    </div>
  );
}

function ToolbarSelect({
  id,
  label,
  className,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  className?: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // 라벨은 늘 보인다. 트리거는 도구 줄이라 32px 로 둔다. min-w-0 이 없으면 긴 이름이 칸을 넓힌다.
    <Field className={cn("min-w-0", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null && next !== value) onChange(next);
        }}
      >
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue>
            {(current: string) => (
              <span className="truncate">
                {items.find((item) => item.value === current)?.label}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="truncate">{item.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
