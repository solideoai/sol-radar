import { cn } from "cn";
import { Card, CardContent } from "@/components/ui/card";

// 데이터를 읽지 않는다(props 만 받는다). 무엇을 세는지는 쓰는 쪽이 정한다.
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  // 숫자나 짧은 날짜("10. 14.")처럼 한 줄에 드는 값. 긴 글자는 좁은 카드에서 꺾이므로 hint 로 나눠 넘긴다.
  value: string;
  hint?: React.ReactNode;
  // 값이 위험 상태(예: 수집 실패)일 때만 destructive. 색만으로 뜻을 전하지 않도록 값 글자 자체가 상태를 말해야 한다.
  tone?: "default" | "destructive";
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="flex flex-col gap-1">
        <p className="type-label text-muted-foreground">{label}</p>
        <p
          className={cn(
            "type-title tabular-nums",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {value}
        </p>
        {hint ? <p className="type-caption text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
