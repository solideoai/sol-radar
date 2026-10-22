import type { ProjectResult, ProjectStatus } from "@/server/projects";

export const statusLabels: Record<ProjectStatus, string> = {
  PREPARING: "제안 준비",
  SUBMITTED: "제출 완료",
  AWAITING_RESULT: "결과 확인",
  CLOSED: "종료",
};
export const resultLabels: Record<ProjectResult, string> = {
  WON: "수주",
  LOST: "미수주",
  CANCELLED: "취소",
  NOT_SUBMITTED: "미제출",
};
export function projectDate(value: string | null): string {
  return value === null
    ? "미정"
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
}
