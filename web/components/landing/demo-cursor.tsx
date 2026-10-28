import { cn } from "cn";
import { MousePointer2Icon } from "lucide-react";

// 첫 화면의 두 데모(업무 데모 · 공고 분석 예시)가 같이 쓰는 가짜 커서.
// 커서는 판(position: relative) 안 왼쪽 위를 원점으로 transform 으로 옮긴다. 장면이 바뀌면 rest(쉼 자리)로 비켜 선다.

export type CursorPoint = { x: number; y: number };

export const translateOf = ({ x, y }: CursorPoint): string => `translate(${x}px, ${y}px)`;

/** 판 안 요소를 가리키는 자리: 요소 가운데 조금 오른쪽 아래다. */
export const pointAt = (frame: Element, element: Element): CursorPoint => {
  const box = frame.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const x = rect.left - box.left + Math.min(rect.width * 0.6, rect.width - 12);
  const y = rect.top - box.top + rect.height * 0.62;
  return { x: Math.round(x), y: Math.round(y) };
};

// 가짜 커서: 화살표와 "담당자" 꼬리표. 누르는 단계에서 살짝 작아진다.
// 판 위에 떠 있는 그림이라 화면 낭독기와 마우스에서 뺀다(aria-hidden·pointer-events-none).
export function DemoCursor({
  ref,
  pressed,
  rest,
}: {
  ref: React.Ref<HTMLDivElement>;
  pressed: boolean;
  rest: CursorPoint;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-20 transition-transform duration-720 ease-[cubic-bezier(0.45,0,0.2,1)] motion-reduce:transition-none"
      style={{ transform: translateOf(rest) }}
    >
      <div
        className={cn(
          "flex items-start transition-transform duration-120 motion-reduce:transition-none",
          pressed ? "scale-85" : "scale-100",
        )}
      >
        <MousePointer2Icon
          aria-hidden
          className="size-6 -translate-x-1 -translate-y-1 fill-foreground stroke-background stroke-[1.5]"
        />
        <span className="mt-4 -ml-1 rounded-full bg-foreground px-2 py-0.5 type-label font-semibold text-background">
          담당자
        </span>
      </div>
    </div>
  );
}
