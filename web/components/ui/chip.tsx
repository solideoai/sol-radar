import { cva } from "class-variance-authority";
import { cn } from "cn";

// 회색 칩(neutral)과 강조 배지(brand, 파란 1px 테두리 + 파란 글자)다(2026-10-28 화면 개편).
// 상태색 배지(충족·확인 필요·미충족, 추천·보류·비추천)·DEMO·출처 배지는 뜻이 있는 색이라 이 부품으로 바꾸지 않는다.
// sm 은 공고 상세 머리·가정 비교 표처럼 촘촘한 곳에서 지금 줄 높이를 지킨다.
const chipVariants = cva("inline-flex items-center gap-1 rounded-md", {
  variants: {
    tone: {
      neutral: "bg-secondary px-2 text-secondary-foreground",
      brand: "border border-brand px-1.5 font-semibold text-brand",
    },
    size: {
      md: "py-0.5 type-label",
      sm: "h-5 px-1.5 py-0 type-caption",
    },
  },
});

function Chip({
  tone = "neutral",
  size = "md",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "brand"; size?: "md" | "sm" }) {
  return (
    <span
      data-slot="chip"
      data-tone={tone}
      className={cn(chipVariants({ tone, size }), className)}
      {...props}
    />
  );
}

export { Chip };
