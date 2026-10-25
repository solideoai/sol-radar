"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge } from "@/components/bids/status-badge";
import { viewedOriginOf, type ViewOrigin } from "@/components/bids/notice-origin";
import { Separator } from "@/components/ui/separator";

// 상단바 DEMO 배지(10-25 실수집 계획 B2). 지금 보고 있는 출처(?origin=, 없으면 서버 기본 출처)가 demo 일 때만 보인다.
// 실행 모드(SOL_RUN_MODE) 라벨과 따로다. 주소를 읽는 부분을 이 파일에 모아 topbar-status 는 next/navigation 에 기대지 않는다
// (refreshTopbarStatus·useTopbarStore 를 쓰는 화면이 주소 읽기까지 끌어오지 않게).
function DemoIndicator({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <>
      <span data-slot="topbar-item" data-indicator="demo" className="inline-flex">
        <DemoBadge withTooltip />
      </span>
      <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
    </>
  );
}

function ViewedDemoIndicator({ defaultOrigin }: { defaultOrigin: ViewOrigin }) {
  const origin = viewedOriginOf(useSearchParams().get("origin"), defaultOrigin);
  return <DemoIndicator show={origin === "demo"} />;
}

export function TopbarDemoIndicator({ defaultOrigin }: { defaultOrigin: ViewOrigin }) {
  // 주소를 읽기 전(Suspense)에는 서버가 정한 기본 출처로 그린다.
  return (
    <Suspense fallback={<DemoIndicator show={defaultOrigin === "demo"} />}>
      <ViewedDemoIndicator defaultOrigin={defaultOrigin} />
    </Suspense>
  );
}
