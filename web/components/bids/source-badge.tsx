import { cn } from "cn";
import type { SourceFamily } from "@/server/opportunities";

export const SOURCE_LABELS: Record<SourceFamily, string> = {
  G2B: "나라장터",
  KWATER: "K-water",
  LH: "LH",
  KEPCO: "KEPCO",
};

// 기관 공식 로고의 상징 색(ADR-058). 출처는 글자로도 읽히고, 색은 같은 흰 칸끼리 구분되게 더한 것이다.
const SOURCE_COLORS: Record<SourceFamily, string> = {
  G2B: "border-transparent bg-source-g2b text-source-g2b-foreground",
  KWATER: "border-transparent bg-source-kwater text-source-kwater-foreground",
  LH: "border-transparent bg-source-lh text-source-lh-foreground",
  KEPCO: "border-transparent bg-source-kepco text-source-kepco-foreground",
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
        "inline-flex h-7 min-w-[76px] shrink-0 items-center justify-center rounded-md border px-2 type-caption font-medium whitespace-nowrap",
        // 출처를 모르는 칸은 회색 글자로 낮춘다. 진한 글자의 빈 칸은 행마다 버튼처럼 보였다.
        family === null
          ? "border-border bg-background font-normal text-muted-foreground"
          : SOURCE_COLORS[family],
        className,
      )}
    >
      {family === null ? "미확인" : SOURCE_LABELS[family]}
    </span>
  );
}
