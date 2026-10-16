import { MonitorIcon } from "lucide-react";

// 데스크톱 전용(docs/06-UI-UX.md §1, docs/16-DECISIONS.md ADR-007). 1280px 미만 레이아웃은 만들지 않고 이 안내만 띄운다.
export function DesktopNotice() {
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 type-label text-muted-foreground xl:hidden"
    >
      <MonitorIcon aria-hidden className="size-4 shrink-0" />
      SOL RADAR는 데스크톱 화면(1280px 이상)에 맞춰 만들었습니다. 좁은 화면에서는 일부가 잘리거나
      가로로 스크롤될 수 있습니다.
    </div>
  );
}
