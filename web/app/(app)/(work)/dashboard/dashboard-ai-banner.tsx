"use client";

import { useEffect, useState } from "react";
import { AiUnavailableNotice } from "@/components/bids/analysis-banner";

// AI gateway 가 끊겼을 때만 카드 위에 09 고정 배너를 둔다(스펙 §5.2).
// 상단바에서 AI 지표를 뺀 뒤(10-26)에는 이 배너가 대시보드를 열 때 /health/ready 를 한 번 읽는다(다른 화면은 읽지 않는다).
// 서버 렌더에서는 상태를 모르므로 그리지 않는다. 읽지 못하면(503·네트워크·모양 다름) 끊겼다고 단정하지 않고 그리지 않는다.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

async function readAiUnavailable(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/health/ready", { cache: "no-store", signal });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return isRecord(body) && isRecord(body.checks) && body.checks.ai === "unavailable";
  } catch {
    return false;
  }
}

export function DashboardAiBanner() {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readAiUnavailable(controller.signal).then((value) => {
      if (!controller.signal.aborted) setUnavailable(value);
    });
    return () => controller.abort();
  }, []);
  return unavailable ? <AiUnavailableNotice /> : null;
}
