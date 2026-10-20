"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "cn";
import { createContext, useCallback, useContext, useRef, type Ref, type RefObject } from "react";

// 랜드마크 안 툴팁. 기본 popup 은 <body> 로 portal 되어 랜드마크 밖에 놓이고, 열리면 axe region 위반이 난다.
// <Tooltip landmark> 이면 trigger 가 든 가장 가까운 랜드마크(header·main·nav·aside 등) 안으로 portal 한다.
// trigger 에 랜드마크 조상이 없으면 그대로 <body> 다. 넘침을 자르는(overflow) 조상 안에 든 툴팁(예: 사이드바)은 켜지 않는다.
const LANDMARK =
  "header, main, nav, aside, footer, [role=banner], [role=main], [role=navigation], [role=complementary], [role=contentinfo], [role=region]";
const LandmarkContainer = createContext<RefObject<HTMLElement | null> | null>(null);

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({
  landmark = false,
  ...props
}: TooltipPrimitive.Root.Props & {
  /** popup 을 trigger 의 랜드마크 안에 그린다(위 설명). */
  landmark?: boolean;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return landmark ? <LandmarkContainer value={containerRef}>{root}</LandmarkContainer> : root;
}

// 받은 ref(함수·객체)에 노드를 넘긴다. 사이드바처럼 render 로 감싼 쪽이 trigger 의 ref 를 쓴다.
function assignRef(target: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof target === "function") target(node);
  else if (target) target.current = node;
}

// trigger 의 랜드마크를 기억한다. portal 은 열릴 때 이 값을 읽는다(ref 객체라 다시 그리지 않는다).
function rememberLandmark(containerRef: RefObject<HTMLElement | null>, node: HTMLElement | null) {
  containerRef.current = node?.closest<HTMLElement>(LANDMARK) ?? null;
}

function TooltipTrigger({
  ref: forwardedRef,
  ...props
}: Omit<TooltipPrimitive.Trigger.Props, "ref"> & { ref?: Ref<HTMLElement> }) {
  const containerRef = useContext(LandmarkContainer);
  const attach = useCallback(
    (node: HTMLElement | null) => {
      if (containerRef) rememberLandmark(containerRef, node);
      assignRef(forwardedRef, node);
    },
    [containerRef, forwardedRef],
  );
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" ref={attach} {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  // landmark 가 아니면 undefined 라 Base UI 기본값(<body>)이다. 값이 null 이면 portal 이 <body> 로 물러난다.
  const container = useContext(LandmarkContainer) ?? undefined;
  return (
    // 랜드마크 안에 들어가는 portal 상자는 contents 로 둔다. flex 줄(상단바 header)의 항목이 되어 간격을 밀지 않게.
    <TooltipPrimitive.Portal
      container={container}
      className={container === undefined ? undefined : "contents"}
    >
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 type-caption text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
