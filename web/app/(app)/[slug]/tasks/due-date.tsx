import { cn } from "cn";
import type { TaskView } from "@/server/task";

// 날짜 글자와 상태는 서버 모델이 서울 날짜로 정했다. 기한 지남·오늘은 색만으로 알리지 않도록 "지남"·"오늘" 글자를 붙인다.
// 완료된 작업은 지나도 "지남"을 붙이지 않는다. 나중(later)은 색을 정하지 않고 둘레의 글자색을 따른다.
export function DueDate({
  task,
  className,
}: {
  task: Pick<TaskView, "dueDate" | "dueText" | "dueState">;
  className?: string;
}) {
  if (task.dueDate === null || task.dueText === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">없음</span>
      </span>
    );
  }
  const suffix =
    task.dueState === "overdue" ? " · 지남" : task.dueState === "today" ? " · 오늘" : "";
  return (
    <span
      className={cn(
        "tabular-nums",
        task.dueState === "overdue" && "text-destructive",
        task.dueState === "today" && "text-foreground",
        task.dueState === "done" && "text-muted-foreground",
        className,
      )}
    >
      <time dateTime={task.dueDate}>{task.dueText}</time>
      {suffix}
    </span>
  );
}
