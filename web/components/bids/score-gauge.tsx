import { MeterBar } from "@/components/bids/meter-bar";

// SOL Score 한 줄 게이지. 정수 점수 + 0~100 막대. 필수자격 미충족처럼 권고에 쓰지 않은 점수는 `참고`를 붙인다.
type ScoreGaugeProps = { score: number | null; reference?: boolean };

function ScoreGauge({ score, reference = false }: ScoreGaugeProps) {
  if (score === null) {
    return (
      <span className="type-body text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">점수 없음</span>
      </span>
    );
  }
  const rounded = Math.round(score);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="type-title tabular-nums text-foreground">{rounded}</span>
      <MeterBar
        value={rounded}
        max={100}
        label="SOL Score"
        valueText={`${rounded}점 / 100점${reference ? " (참고)" : ""}`}
        tone="brand"
        className="min-w-16 flex-1"
      />
      {reference && (
        <span className="shrink-0 rounded-sm border border-border px-1.5 type-caption text-muted-foreground">
          참고
        </span>
      )}
    </div>
  );
}

export { ScoreGauge };
