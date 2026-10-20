"use client";

import { AiUnavailableNotice } from "@/components/bids/analysis-banner";
import { useTopbarStore } from "@/components/topbar-status";

// 상단바와 같은 AI 상태(zustand 한 곳, 06 §11)를 읽어 끊겼을 때만 카드 위에 09 고정 배너를 둔다(스펙 §5.2).
// 서버 렌더에서는 상태를 모르므로 그리지 않는다. 상단바가 /health/ready 를 읽은 뒤에 나타난다.
export function DashboardAiBanner() {
  const ai = useTopbarStore((state) => state.ai);
  return ai === "unavailable" ? <AiUnavailableNotice /> : null;
}
