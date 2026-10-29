"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { InsightView } from "@/server/insight";

// 추천 분석 요청과 결과 polling(스펙 2026-10-29-recommendation-insight §4.6, 계획 Task 8). 분석 실행(use-analysis-run)과 같은 모양이다.
// - [추천 분석]·[다시 요청]은 본문 없는 POST 하나다. 같은 run 의 PENDING 은 서버가 하나로 묶는다(두 번 눌러도 행 하나).
//   네트워크 오류는 같은 Idempotency-Key 로 한 번만 다시 보낸다.
// - PENDING 이면 GET 을 처음 60초는 2초, 그 뒤 5초 간격으로 읽고, pollLimitMs(INSIGHT_POLL_LIMIT_MS, 3분)가 지나면 늦음(delayed)으로 멈춘다.
//   [다시 확인]은 바로 한 번 읽고 같은 방식으로 다시 기다린다.
// - DONE·FAILED 면 멈춘다. 401·403·404 는 다시 읽어도 같으므로 멈추고 알린다. 그 밖의 실패(429·5xx·네트워크)는 다음 간격에 다시 읽는다.
// - 오류는 toast 로 알린다. 화면을 떠나면 타이머와 요청을 모두 멈춘다.
// 공고 상세의 api-envelope.ts 는 app 층이라 부품(components)에서 부를 수 없다(lodestar). 오류 봉투는 여기서 message 만 읽는다.

export const INSIGHT_POLL_FAST_MS = 2_000;
export const INSIGHT_POLL_SLOW_MS = 5_000;
const POLL_FAST_WINDOW_MS = 60_000;

const CSRF_HEADERS = { "X-Requested-With": "sol-radar" } as const;
const FALLBACK_MESSAGE = "요청을 처리하지 못했습니다.";
const NETWORK_MESSAGE = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.";
// 다시 읽어도 결과가 바뀌지 않는 응답.
const STOP_STATUSES: readonly number[] = [401, 403, 404];

/** idle: 요청·읽기가 없다. requesting: POST 중. polling: 결과를 기다린다. delayed: pollLimitMs 가 지나 읽기를 멈췄다. */
export type InsightPhase = "idle" | "requesting" | "polling" | "delayed";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null);

const messageOf = (body: unknown): string => {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return typeof error?.message === "string" && error.message.trim() !== ""
    ? error.message
    : FALLBACK_MESSAGE;
};

// 서버가 검증해 준 한 건(insightPayloadSchema). 화면이 그리는 칸이 모양대로인지만 다시 본다.
function isInsightView(value: unknown, runId: string): value is InsightView {
  if (!isRecord(value) || typeof value.id !== "string" || value.scoreRunId !== runId) return false;
  if (value.status !== "PENDING" && value.status !== "DONE" && value.status !== "FAILED") {
    return false;
  }
  const payload = value.payload;
  return (
    payload === null ||
    (isRecord(payload) &&
      typeof payload.summary === "string" &&
      Array.isArray(payload.strengths) &&
      Array.isArray(payload.improvements) &&
      Array.isArray(payload.refs))
  );
}

/** GET 본문 { insight }. undefined 는 모양이 달라 다음 간격에 다시 읽는다. */
function viewOf(body: unknown, runId: string): InsightView | null | undefined {
  if (!isRecord(body) || !("insight" in body)) return undefined;
  if (body.insight === null) return null;
  return isInsightView(body.insight, runId) ? body.insight : undefined;
}

type ReadResult = "cancelled" | "stop" | "pending" | "finished" | "retry";

export function useInsightRequest({
  bidId,
  runId,
  initialInsight,
  pollLimitMs,
}: {
  bidId: string;
  runId: string;
  initialInsight: InsightView | null;
  pollLimitMs: number;
}): {
  insight: InsightView | null;
  phase: InsightPhase;
  request: () => void;
  recheck: () => void;
} {
  const [insight, setInsight] = useState(initialInsight);
  const initialPending = initialInsight?.status === "PENDING";
  const [phase, setPhase] = useState<InsightPhase>(initialPending ? "polling" : "idle");
  const ticketRef = useRef<Ticket | null>(null);
  const url = `/api/v1/bids/${encodeURIComponent(bidId)}/analyses/${encodeURIComponent(runId)}/insight`;

  const cancel = useCallback(() => {
    const ticket = ticketRef.current;
    if (ticket === null) return;
    ticket.cancelled = true;
    ticket.controller.abort();
    if (ticket.timer !== null) clearTimeout(ticket.timer);
    ticketRef.current = null;
  }, []);

  // 화면을 떠나면 타이머와 요청을 멈춘다.
  useEffect(() => cancel, [cancel]);

  const settle = useCallback((ticket: Ticket, next: InsightPhase) => {
    if (ticketRef.current === ticket) ticketRef.current = null;
    setPhase(next);
  }, []);

  const read = useCallback(
    async (ticket: Ticket): Promise<ReadResult> => {
      let response: Response;
      try {
        response = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: ticket.controller.signal,
        });
      } catch {
        // 잠깐 끊긴 것이면 다음 간격에 다시 읽는다. 떠나서 끊은 것이면 멈춘다.
        return ticket.cancelled ? "cancelled" : "retry";
      }
      const body = await readJson(response);
      if (ticket.cancelled) return "cancelled";
      if (STOP_STATUSES.includes(response.status)) {
        toast(messageOf(body));
        return "stop";
      }
      if (!response.ok) return "retry";
      const view = viewOf(body, runId);
      if (view === undefined) return "retry";
      if (view !== null) setInsight(view);
      return view !== null && view.status !== "PENDING" ? "finished" : "pending";
    },
    [runId, url],
  );

  // now 면 기다리지 않고 바로 한 번 읽는다(끝난 행을 받은 POST·[다시 확인]).
  const poll = useCallback(
    async (ticket: Ticket, now: boolean) => {
      const startedAt = Date.now();
      for (let first = true; ; first = false) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= pollLimitMs) {
          settle(ticket, "delayed");
          return;
        }
        if (!(first && now)) {
          await wait(
            ticket,
            elapsed < POLL_FAST_WINDOW_MS ? INSIGHT_POLL_FAST_MS : INSIGHT_POLL_SLOW_MS,
          );
          if (ticket.cancelled) return;
        }
        const result = await read(ticket);
        if (result === "cancelled") return;
        // 읽기를 멈춘 PENDING 은 진행 표시 대신 [다시 확인]을 둔다.
        if (result === "stop") {
          settle(ticket, "delayed");
          return;
        }
        if (result === "finished") {
          settle(ticket, "idle");
          return;
        }
      }
    },
    [pollLimitMs, read, settle],
  );

  // 서버가 PENDING 을 그렸으면(다른 탭에서 요청했거나 새로 고친 경우) POST 없이 그 행을 읽는다.
  useEffect(() => {
    if (!initialPending || ticketRef.current !== null) return;
    const ticket = newTicket();
    ticketRef.current = ticket;
    void poll(ticket, false);
  }, [initialPending, poll]);

  const request = useCallback(async () => {
    if (ticketRef.current !== null) return;
    const ticket = newTicket();
    ticketRef.current = ticket;
    setPhase("requesting");
    const key = crypto.randomUUID();
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2 && response === null; attempt += 1) {
      try {
        response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", ...CSRF_HEADERS, "Idempotency-Key": key },
          signal: ticket.controller.signal,
        });
      } catch {
        if (ticket.cancelled) return;
      }
    }
    if (ticket.cancelled) return;
    if (response === null) {
      settle(ticket, "idle");
      toast(NETWORK_MESSAGE);
      return;
    }
    const body = await readJson(response);
    if (ticket.cancelled) return;
    if (response.status === 202 && isRecord(body) && typeof body.insightId === "string") {
      // pollUrl 은 같은 경로(GET)라 따로 따르지 않는다. 끝난 행을 돌려받았으면(deduplicated) 바로 읽는다.
      setPhase("polling");
      void poll(ticket, body.status !== "PENDING");
      return;
    }
    settle(ticket, "idle");
    toast(messageOf(body));
  }, [poll, settle, url]);

  const recheck = useCallback(() => {
    if (ticketRef.current !== null) return;
    const ticket = newTicket();
    ticketRef.current = ticket;
    setPhase("polling");
    void poll(ticket, true);
  }, [poll]);

  return { insight, phase, request: () => void request(), recheck };
}
