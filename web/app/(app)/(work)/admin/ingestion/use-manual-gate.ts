"use client";

import { useCallback, useEffect, useState } from "react";
import { readManualGate, type GateOutcome, type ManualGate } from "./ingestion-api";
import { gateWakeAt } from "./manual-gate";

// 수동 불러오기 판정(GET manual-gate) 읽기(10-26 운영 전환). 화면 진입 때 읽고, 쓰는 쪽이 접수 뒤·run 종료 뒤 refresh 를 부른다.
// 서버가 준 다음 시각(쿨다운 끝·다음 정기 수집 등)이 오면 그때 다시 읽는다. 판정은 늘 서버가 한다.
// localStorage 등 브라우저 저장소로 막지 않는다(다른 관리자·다른 탭의 요청은 서버만 안다).

export type GateState =
  | { phase: "loading" }
  /** checkedAt: 이 응답을 받은 때(ms). 서버 시각이 지났는지 견주는 기준이다. */
  | { phase: "ready"; gate: ManualGate; checkedAt: number }
  | { phase: "denied"; status: 401 | 403 }
  | { phase: "unavailable" }
  | { phase: "absent" }
  | { phase: "failed" };

// setTimeout 상한(약 24.8일)과, 시계가 서버보다 빠를 때 같은 시각을 계속 다시 읽지 않게 하는 최소 간격
const MAX_TIMER_MS = 2_147_483_647;
const MIN_RECHECK_MS = 5_000;
const WAKE_SLACK_MS = 1_000;

/** 이미 판정을 받았으면 일시 실패(503·네트워크)로 지우지 않는다. 권한 거절은 바로 반영한다. */
function nextGateState(prev: GateState, outcome: GateOutcome, checkedAt: number): GateState {
  switch (outcome.kind) {
    case "ok":
      return { phase: "ready", gate: outcome.gate, checkedAt };
    case "denied":
      return { phase: "denied", status: outcome.status };
    case "absent":
      return { phase: "absent" };
    case "unavailable":
      return prev.phase === "ready" ? prev : { phase: "unavailable" };
    case "failed":
      return prev.phase === "ready" ? prev : { phase: "failed" };
  }
}

export function useManualGate(): { state: GateState; refresh: () => void } {
  const [state, setState] = useState<GateState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readManualGate(controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setState((prev) => nextGateState(prev, outcome, Date.now()));
    });
    return () => controller.abort();
  }, [attempt]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const wakeAt = state.phase === "ready" ? gateWakeAt(state.gate, state.checkedAt) : null;
  const checkedAt = state.phase === "ready" ? state.checkedAt : null;
  useEffect(() => {
    if (wakeAt === null) return;
    const delay = Math.min(
      Math.max(wakeAt - Date.now() + WAKE_SLACK_MS, MIN_RECHECK_MS),
      MAX_TIMER_MS,
    );
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [wakeAt, checkedAt, refresh]);

  return { state, refresh };
}
