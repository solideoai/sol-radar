import { TriangleAlertIcon } from "lucide-react";

export function OpportunityConflictNotice() {
  return (
    <span className="inline-flex items-center gap-1 type-caption text-warning">
      <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
      출처 간 확인 필요
    </span>
  );
}
