import { cn } from "cn";

// 점수·요소·Kev 분포·리스크 막대 한 벌. role="meter" 와 값 글자를 꼭 단다(스펙 §9).
// brand 는 규칙 점수와 요소, muted 는 Kev 분포와 리스크, missing 은 값을 알 수 없는 요소다.
const FILL = {
  brand: "bg-brand",
  muted: "bg-muted-foreground",
  missing: "bg-muted-foreground/40",
} as const;

type MeterBarProps = {
  value: number;
  max: number;
  label: string;
  valueText: string;
  tone: keyof typeof FILL;
  className?: string;
};

function MeterBar({ value, max, label, valueText, tone, className }: MeterBarProps) {
  const ratio = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export { MeterBar };
