import { cn } from "cn";
import type { SourceFamily } from "@/server/opportunities";

export const SOURCE_LABELS: Record<SourceFamily, string> = {
  G2B: "나라장터",
  KWATER: "K-water",
  LH: "LH",
  KEPCO: "KEPCO",
};

export function SourceBadge({
  family,
  className,
}: {
  family: SourceFamily | null;
  className?: string;
}) {
  return (
    <span
      data-slot="source-badge"
      aria-label={family === null ? "출처 미확인" : undefined}
      className={cn(
        "inline-flex h-7 min-w-[76px] shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 type-caption font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      {family === null ? "미확인" : SOURCE_LABELS[family]}
    </span>
  );
}
