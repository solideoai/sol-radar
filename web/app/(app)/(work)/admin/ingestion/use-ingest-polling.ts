"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  POLL_FAST_MS,
  POLL_FAST_WINDOW_MS,
  POLL_LIMIT_MS,
  POLL_SLOW_MS,
} from "@/app/(app)/(work)/bids/[id]/use-analysis-run";
import type { IngestRun } from "./ingestion-copy";
import { readFirstPage } from "./ingestion-api";

// 수집 이력 첫 쪽 폴링(N8 스펙 §4.8, D14). 주기는 분석 폴링과 같은 상수다(처음 60초 2초, 그 뒤 5초, 시작부터 300초 상한).
// - 시작: 화면을 열 때 첫 쪽에 RUNNING 이 있으면, POST 202 직후, [다시 확인]을 누를 때(start).
// - 멈춤: isSettled 가 참이면 정상 종료(onSettled), 300초가 지나면 지연(delayed), 401·403 이면 권한(denied).
// - 429·5xx·네트워크 오류는 다음 주기에 다시 읽고, 연속 실패 수를 센다.
// - 한 번에 요청 하나만 보낸다(앞 요청이 끝나야 다음을 기다린다). 화면을 떠나면 타이머와 요청을 모두 멈춘다.

/** 연속 실패가 이만큼이면 상태 줄에 "확인하지 못했습니다"를 보인다(§4.3). */
export const FAILURE_NOTICE_AFTER = 3;

export type PollState =
  | { phase: "idle" }
  | { phase: "polling"; failures: number }
  | { phase: "delayed" }
  | { phase: "denied"; status: 401 | 403 };

type Ticket = {
  cancelled: boolean;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
};

const newTicket = (): Ticket => ({
  cancelled: false,
  controller: new AbortController(),
  timer: null,
});

function wait(ticket: Ticket, ms: number): Promise<void> {
  return new Promise((resolve) => {
    ticket.timer = setTimeout(() => {
      ticket.timer = null;
      resolve();
    }, ms);
  });
}

type Handlers = {
  /** 첫 쪽을 읽을 때마다 부른다. */
  onPage: (items: IngestRun[]) => void;
  /** 이 첫 쪽이면 멈춰도 되는지. */
  isSettled: (items: IngestRun[]) => boolean;
  /** 정상으로 멈춘 뒤 한 번 부른다. */
  onSettled: () => void;
};

export function useIngestPolling({
  active,
  initialCheckedAt,
  ...handlers
}: Handlers & {
  /** 서버가 그린 첫 쪽에 실행 중인 run 이 있다. 참이 되면(처음 열 때 포함) POST 없이 읽기 시작한다. */
  active: boolean;
  /** 서버가 첫 쪽을 읽은 시각(ISO). 첫 확인 전 상태 줄 시각 계산의 기준이다. */
  initialCheckedAt: string;
}): {
  state: PollState;
  /** 첫 쪽을 성공적으로 읽은 횟수. 서랍이 같은 주기에 상세를 다시 읽을 때 쓴다. */
  tick: number;
  /** 마지막으로 상태를 확인한 시각(ms). 렌더 중에 시계를 읽지 않으려고 둔다. */
  checkedAt: number;
  start: () => void;
} {
  const [state, setState] = useState<PollState>(() =>
    active ? { phase: "polling", failures: 0 } : { phase: "idle" },
  );
  const [tick, setTick] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.parse(initialCheckedAt));
  // 서버가 새 첫 쪽을 주어 실행 중이 새로 생기면, 읽기는 아래 effect 가 시작하고 표시는 여기서 같은 렌더에 맞춘다.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (active)
      setState((prev) => (prev.phase === "polling" ? prev : { phase: "polling", failures: 0 }));
  }

  // 반복 중에는 늘 마지막 렌더의 처리기를 부른다.
  const handlersRef = useRef<Handlers>(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const ticketRef = useRef<Ticket | null>(null);
  const cancel = useCallback(() => {
    const ticket = ticketRef.current;
    if (ticket === null) return;
    ticket.cancelled = true;
    ticket.controller.abort();
    if (ticket.timer !== null) clearTimeout(ticket.timer);
    ticketRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const loop = useCallback(async (ticket: Ticket) => {
    const release = () => {
      if (ticketRef.current === ticket) ticketRef.current = null;
    };
    const startedAt = Date.now();
    let failures = 0;
    for (;;) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_LIMIT_MS) {
        release();
        setState({ phase: "delayed" });
        return;
      }
      await wait(ticket, elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS);
      if (ticket.cancelled) return;
      const result = await readFirstPage(ticket.controller.signal);
      if (ticket.cancelled) return;
      setCheckedAt(Date.now());
      if (result.kind === "denied") {
        release();
        setState({ phase: "denied", status: result.status });
        return;
      }
      if (result.kind === "failed") {
        failures += 1;
        setState({ phase: "polling", failures });
        continue;
      }
      failures = 0;
      setState((prev) =>
        prev.phase === "polling" && prev.failures === 0 ? prev : { phase: "polling", failures: 0 },
      );
      handlersRef.current.onPage(result.items);
      setTick((value) => value + 1);
      if (handlersRef.current.isSettled(result.items)) {
        release();
        setState({ phase: "idle" });
        handlersRef.current.onSettled();
        return;
      }
    }
  }, []);

  // 처음부터(또는 새 첫 쪽에서) 실행 중이면 읽기 시작한다. 이미 읽는 중이면 그대로 둔다.
  useEffect(() => {
    if (!active || ticketRef.current !== null) return;
    const ticket = newTicket();
    ticketRef.current = ticket;
    void loop(ticket);
  }, [active, loop]);

  // POST 202 직후·[다시 확인]: 지금 읽기를 멈추고 처음 주기(2초)와 새 상한으로 다시 시작한다.
  const start = useCallback(() => {
    cancel();
    const ticket = newTicket();
    ticketRef.current = ticket;
    setState({ phase: "polling", failures: 0 });
    void loop(ticket);
  }, [cancel, loop]);

  return { state, tick, checkedAt, start };
}
