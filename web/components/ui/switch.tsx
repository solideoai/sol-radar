"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

// shadcn base-nova switch 를 들여와 크기·색을 바꿨다(BOOST-2 디자인 스펙 §4.2).
// 원본 꺼짐 상태(bg-input 채움)는 흰 바탕과 대비가 1.4:1 이라 상태가 안 보인다(WCAG 1.4.11).
// 그래서 꺼짐은 muted-foreground 테두리와 손잡이, 켜짐은 radio-group 의 선택 색(primary)과 같다.
// 트랙 20×36px, 손잡이 14px. 누를 자리는 radio 와 같은 방식(after)으로 24px 이상이다.
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-muted-foreground bg-background outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-muted-foreground transition-transform motion-reduce:transition-none data-checked:translate-x-4.5 data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
