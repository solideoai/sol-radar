import type { LucideIcon } from "lucide-react";

// 구역 안 항목 앞의 아이콘 칸. 장식이라 화면 낭독기에서 숨긴다 — 뜻은 옆 제목이 말한다.
export function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-brand"
    >
      <Icon className="size-4" />
    </span>
  );
}
