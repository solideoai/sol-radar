"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { InsightView } from "@/server/insight";

// 추천 분석 요청과 결과 polling(스펙 2026-10-29-recommendation-insight §4.6, 2026-11-03-recommendation-insight-detail §4.6).
// 분석 실행(use-analysis-run)과 같은 모양이다.
// - [추천 분석]·[다시 요청]·[새 형식으로 다시 분석]은 본문 없는 POST 하나다. 같은 run 의 PENDING 은 서버가 하나로 묶는다(두 번 눌러도 행 하나).
//   네트워크 오류는 같은 Idempotency-Key 로 한 번만 다시 보낸다.
// - PENDING 이면 GET 을 처음 60초는 2초, 그 뒤 5초 간격으로 읽고, pollLimitMs(INSIGHT_POLL_LIMIT_MS, 3분)가 지나면 늦음(delayed)으로 멈춘다.
//   [다시 확인]은 바로 한 번 읽고, 누른 때부터 pollLimitMs 만큼 같은 방식으로 다시 기다린다.
// - 경과(진행률과 늦음 판단)의 시작점은 행의 createdAt 이다(계획 Q3). 새로 고치거나 다른 사람이 요청한 PENDING 을 열어도
//   숫자가 처음으로 돌아가지 않는다. 다만 이 화면에서 누른 새 요청은 누른 시각을 그대로 쓴다. 서버 createdAt 으로 바꾸면
//   기기 시계가 서버보다 빠를 때 숫자가 튀고 곧바로 늦음이 뜬다(사전 리뷰 QA W2). POST 가 이미 있던 요청으로 묶였으면
//   (deduplicated) 그 행의 createdAt 을 따른다.
// - GET 본문은 { insight, previous } 다. previous 는 최신이 FAILED 일 때 그 run 의 마지막 모델 결과다(계획 Q2).
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
  /** 읽은 PENDING 행의 createdAt 을 경과의 시작점으로 삼는다. 이 화면에서 누른 새 요청이면 false 다. */
  followCreatedAt: boolean;
};

const newTicket = (followCreatedAt: boolean): Ticket => ({
  cancelled: false,
  controller: new AbortController(),
  timer: null,
  followCreatedAt,
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

// 없어도 되는 칸(v0.2 새 칸)은 있으면 목록이어야 한다.
const isOptionalList = (value: unknown): boolean => value === undefined || Array.isArray(value);

// 서버가 검증해 준 한 건(insightPayloadSchema). 화면이 그리는 칸이 모양대로인지만 다시 본다.
function isInsightView(value: unknown, runId: string): value is InsightView {
  if (!isRecord(value) || typeof value.id !== "string" || value.scoreRunId !== runId) return false;
  if (value.status !== "PENDING" && value.status !== "DONE" && value.status !== "FAILED") {
    return false;
  }
  if (typeof value.createdAt !== "string") return false;
  const payload = value.payload;
  return (
    payload === null ||
    (isRecord(payload) &&
      typeof payload.summary === "string" &&
      Array.isArray(payload.strengths) &&
      Array.isArray(payload.improvements) &&
      Array.isArray(payload.refs) &&
      isOptionalList(payload.factorNotes) &&
      isOptionalList(payload.checkNotes) &&
      isOptionalList(payload.nextSteps) &&
      (payload.staffing === undefined || payload.staffing === null || isRecord(payload.staffing)))
  );
}

type ReadView = { insight: InsightView | null; previous: InsightView | null };

/** GET 본문 { insight, previous }. undefined 는 모양이 달라 다음 간격에 다시 읽는다. previous 는 모양이 다르면 버린다. */
function viewOf(body: unknown, runId: string): ReadView | undefined {
  if (!isRecord(body) || !("insight" in body)) return undefined;
  const previous = isInsightView(body.previous, runId) ? body.previous : null;
  if (body.insight === null) return { insight: null, previous: null };
  return isInsightView(body.insight, runId) ? { insight: body.insight, previous } : undefined;
}

/** 행의 요청 시각(ms). 읽지 못하면 null. */
const createdAtOf = (view: InsightView | null): number | null => {
  if (view?.status !== "PENDING") return null;
  const at = Date.parse(view.createdAt);
  return Number.isNaN(at) ? null : at;
};

type ReadResult = "cancelled" | "stop" | "pending" | "done" | "failed" | "retry";

export function useInsightRequest({
  bidId,
  runId,
  initialInsight,
  initialPrevious,
  pollLimitMs,
  onDone,
}: {
  bidId: string;
  runId: string;
  initialInsight: InsightView | null;
  /** 최신이 FAILED 일 때 그 run 의 마지막 모델 결과(서버 첫 값). */
  initialPrevious: InsightView | null;
  pollLimitMs: number;
  /** 기다리던 결과가 DONE 으로 끝났다. 처음부터 끝난 행에는 부르지 않는다. */
  onDone?: () => void;
}): {
  insight: InsightView | null;
  previous: InsightView | null;
  phase: InsightPhase;
  /** 경과의 시작 시각(ms). 기다리는 중이 아니면 마지막 값을 그대로 둔다. */
  startedAt: number | null;
  request: () => void;
  recheck: () => void;
} {
  const [insight, setInsight] = useState(initialInsight);
  const [previous, setPrevious] = useState(initialPrevious);
  const initialPending = initialInsight?.status === "PENDING";
  const [phase, setPhase] = useState<InsightPhase>(initialPending ? "polling" : "idle");
  const [startedAt, setStartedAt] = useState(() => createdAtOf(initialInsight));
  // 묻기 루프가 늦음을 판단할 때 읽는다(state 는 루프가 시작된 때의 값에 묶인다).
  const startRef = useRef(startedAt);
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

  const startFrom = useCallback((at: number) => {
    startRef.current = at;
    setStartedAt(at);
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
      if (view.insight === null) return "pending";
      setInsight(view.insight);
      setPrevious(view.previous);
      const createdAt = ticket.followCreatedAt ? createdAtOf(view.insight) : null;
      if (createdAt !== null) startFrom(createdAt);
      if (view.insight.status === "PENDING") return "pending";
      return view.insight.status === "DONE" ? "done" : "failed";
    },
    [runId, startFrom, url],
  );

  // now 면 기다리지 않고 바로 한 번 읽는다(끝난 행을 받은 POST·[다시 확인]).
  // 대기 상한은 경과의 시작점부터 잰다. 다만 now(=[다시 확인])면 누른 때부터 다시 잰다. 그래서 [다시 확인]은 상한이 지났어도
  // 다시 기다린다(디자인 스펙 7절, 사전 리뷰 QA W1). 진행률은 그대로 경과의 시작점부터 잰다.
  const poll = useCallback(
    async (ticket: Ticket, now: boolean) => {
      const waitFrom = now ? Date.now() : Number.NEGATIVE_INFINITY;
      for (let first = true; ; first = false) {
        if (!(first && now)) {
          const waited = Date.now() - Math.max(startRef.current ?? Date.now(), waitFrom);
          if (waited >= pollLimitMs) {
            settle(ticket, "delayed");
            return;
          }
          await wait(
            ticket,
            waited < POLL_FAST_WINDOW_MS ? INSIGHT_POLL_FAST_MS : INSIGHT_POLL_SLOW_MS,
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
        if (result === "done" || result === "failed") {
          settle(ticket, "idle");
          if (result === "done") onDone?.();
          return;
        }
      }
    },
    [onDone, pollLimitMs, read, settle],
  );

  // 서버가 PENDING 을 그렸으면(다른 탭에서 요청했거나 새로 고친 경우) POST 없이 그 행을 읽는다.
  useEffect(() => {
    if (!initialPending || ticketRef.current !== null) return;
    const ticket = newTicket(true);
    ticketRef.current = ticket;
    void poll(ticket, false);
  }, [initialPending, poll]);

  const request = useCallback(async () => {
    if (ticketRef.current !== null) return;
    const ticket = newTicket(false);
    ticketRef.current = ticket;
    setPhase("requesting");
    // 누른 시각부터 센다. 이미 있던 요청으로 묶였을 때만 그 행의 createdAt 으로 바꾼다.
    startFrom(Date.now());
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
      ticket.followCreatedAt = body.deduplicated === true;
      setPhase("polling");
      void poll(ticket, body.status !== "PENDING");
      return;
    }
    settle(ticket, "idle");
    toast(messageOf(body));
  }, [poll, settle, startFrom, url]);

  const recheck = useCallback(() => {
    if (ticketRef.current !== null) return;
    // 시작점은 앞선 묻기가 정한 값을 그대로 쓴다.
    const ticket = newTicket(false);
    ticketRef.current = ticket;
    setPhase("polling");
    void poll(ticket, true);
  }, [poll]);

  return { insight, previous, phase, startedAt, request: () => void request(), recheck };
}
