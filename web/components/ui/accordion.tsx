"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

// shadcn base-nova 의 accordion 모양을 이 저장소 규칙(글자 눈금·토큰 색·cn 패키지)에 맞춰 손으로 옮긴 것이다.
// Header 는 h3 로 그려진다(Base UI 기본). 열림·닫힘·Enter/Space·aria-expanded 는 Base UI 가 맡는다.
function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger flex flex-1 items-center justify-between gap-4 rounded-lg py-4 text-left type-heading text-foreground outline-none hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-aria-expanded/accordion-trigger:rotate-180 motion-safe:transition-transform motion-safe:duration-150"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

// 높이는 Base UI 가 재어 --accordion-panel-height 로 넘긴다. 여닫을 때 0 에서/로 줄어든다.
function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="h-(--accordion-panel-height) overflow-hidden data-ending-style:h-0 data-starting-style:h-0 motion-safe:transition-[height] motion-safe:duration-150 motion-safe:ease-out"
      {...props}
    >
      <div className={cn("pb-4 type-body text-muted-foreground", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
