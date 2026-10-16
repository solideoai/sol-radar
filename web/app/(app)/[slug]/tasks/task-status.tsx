import { CircleCheckIcon, CircleDotIcon, CircleIcon, type LucideIcon } from "lucide-react";
import type { TaskStatus } from "@/server/task";

// 글자는 서버(@/server/task 의 TASK_STATUS_LABELS)와 같다 — 서버 모듈은 브라우저로 가져올 수 없다.
// towardLabel 은 "~로 바꿨습니다" 앞에 오는 모양이다. 받침에 따라 조사가 달라 글자로 적어 둔다.
type StatusDisplay = { label: string; towardLabel: string; icon: LucideIcon };

export const TASK_STATUS_DISPLAY: Record<TaskStatus, StatusDisplay> = {
  todo: { label: "할 일", towardLabel: "할 일로", icon: CircleIcon },
  in_progress: { label: "진행 중", towardLabel: "진행 중으로", icon: CircleDotIcon },
  done: { label: "완료", towardLabel: "완료로", icon: CircleCheckIcon },
};

export const TASK_STATUS_ORDER: readonly TaskStatus[] = ["todo", "in_progress", "done"];

// 아이콘은 글자를 돕는 장식이라 숨긴다.
export function TaskStatusLabel({ status }: { status: TaskStatus }) {
  const { label, icon: Icon } = TASK_STATUS_DISPLAY[status];
  return (
    <>
      <Icon aria-hidden className="text-muted-foreground" />
      <span className="truncate">{label}</span>
    </>
  );
}
